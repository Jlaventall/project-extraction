from __future__ import annotations

import math
from dataclasses import asdict
from itertools import count
from typing import Any

import numpy as np
import simpy

from coffeesim.config import Product, Scenario, Supplier, default_scenario
from coffeesim.domain.inventory import LotInventory
from coffeesim.domain.ledger import Ledger
from coffeesim.domain.models import Backorder, InventoryLot, PurchaseOrder, RoastJob, WorldAction


class CoffeeWorld:
    """SimPy-backed coffee roastery with one owner decision per day.

    SimPy controls intra-day event ordering, resource contention, deliveries,
    roasting, and packaging. Domain state remains explicit and serializable.
    """

    DEMAND_WAVES = 8

    def __init__(
        self,
        scenario: Scenario | None = None,
        *,
        seed: int = 42,
    ) -> None:
        self.scenario = scenario or default_scenario()
        self.seed = int(seed)
        self.simulation_mode = "live"
        self.simulation_strategy = "human_manual"
        self.env = simpy.Environment()
        self.roaster = simpy.Resource(self.env, capacity=1)
        self.packager = simpy.Resource(self.env, capacity=1)
        seed_sequence = np.random.SeedSequence(self.seed)
        demand_seed, supply_seed, production_seed, event_seed = seed_sequence.spawn(4)
        self.demand_rng = np.random.default_rng(demand_seed)
        self.supply_rng = np.random.default_rng(supply_seed)
        self.production_rng = np.random.default_rng(production_seed)
        self.event_rng = np.random.default_rng(event_seed)

        self.suppliers = {item.id: item for item in self.scenario.suppliers}
        self.products = {item.id: item for item in self.scenario.products}
        self.inventory = LotInventory()
        self.ledger = Ledger(self.scenario.starting_cash)
        self.purchase_orders: list[PurchaseOrder] = []
        self.roast_jobs: list[RoastJob] = []
        self.backorders: list[Backorder] = []
        self.prices = {item.id: item.base_price for item in self.scenario.products}
        self.standing_green_orders: dict[str, float] = {}
        self.standing_roast_targets: dict[str, float] = {}
        self.day = 0
        self.last_roast_profile: str | None = None
        self.terminated = False
        self.truncated = False
        self.termination_reason: str | None = None
        self.event_log: list[dict[str, Any]] = []
        self.all_event_log: list[dict[str, Any]] = []
        self.action_history: list[dict[str, Any]] = []
        self.daily_history: list[dict[str, Any]] = []
        self._ids = count(1)
        self._daily: dict[str, float] = {}
        self.stats = {
            "green_received": 0.0,
            "green_consumed": 0.0,
            "green_spoiled": 0.0,
            "roasted_opening": 0.0,
            "roasted_produced": 0.0,
            "roasted_reserved": 0.0,
            "roasted_sold": 0.0,
            "roasted_spoiled": 0.0,
            "demand": 0.0,
            "lost_sales": 0.0,
            "roast_hours": 0.0,
            "packaging_hours": 0.0,
            "stockout_transactions": 0,
            "stockout_kg": 0.0,
        }
        self._initialize_inventory()

    def _next_id(self, prefix: str) -> str:
        return f"{prefix}-{next(self._ids):06d}"

    def _initialize_inventory(self) -> None:
        per_supplier = self.scenario.starting_green_kg / max(1, len(self.suppliers))
        for supplier in self.suppliers.values():
            self.inventory.add(
                InventoryLot(
                    lot_id=self._next_id("green"),
                    category="green",
                    item_id=supplier.id,
                    quantity_kg=per_supplier,
                    unit_cost=supplier.unit_cost,
                    created_at=0.0,
                    expires_at=365.0,
                    quality=supplier.quality,
                )
            )
            self.stats["green_received"] += per_supplier
        for product in self.products.values():
            quantity = self.scenario.starting_roasted_kg_per_sku
            self.inventory.add(
                InventoryLot(
                    lot_id=self._next_id("roasted"),
                    category="roasted",
                    item_id=product.id,
                    quantity_kg=quantity,
                    unit_cost=10.0,
                    created_at=0.0,
                    expires_at=product.shelf_life_days,
                    quality=0.90,
                    metadata={"opening_inventory": True},
                )
            )
            self.stats["roasted_opening"] += quantity

    def _log(self, event_type: str, message: str, **data: Any) -> None:
        category = "demand" if event_type in {"demand_spike", "stockout", "stockout_tally", "lost_sale"} else "supply"
        self.event_log.append(
            {
                "time": round(float(self.env.now), 4),
                "day": self.day + 1,
                "type": event_type,
                "category": category,
                "message": message,
                **data,
            }
        )
        self.all_event_log.append(self.event_log[-1])
        if len(self.event_log) > 500:
            self.event_log = self.event_log[-500:]

    @staticmethod
    def _finite_nonnegative(value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0
        return number if math.isfinite(number) and number > 0 else 0.0

    def _sanitize_action(self, action: WorldAction) -> tuple[WorldAction, list[str]]:
        warnings: list[str] = []
        orders: dict[str, float] = {}
        for supplier_id, supplier in self.suppliers.items():
            raw = self._finite_nonnegative(action.green_orders.get(supplier_id, 0.0))
            clipped = min(raw, supplier.maximum_order)
            if 0 < clipped < supplier.minimum_order:
                warnings.append(
                    f"{supplier_id} order rejected below {supplier.minimum_order:.0f} kg minimum"
                )
                clipped = 0.0
            if clipped != raw:
                warnings.append(f"{supplier_id} order clipped to supplier limit")
            orders[supplier_id] = clipped

        roasts: dict[str, float] = {}
        for sku in self.products:
            raw = self._finite_nonnegative(action.roast_targets.get(sku, 0.0))
            clipped = min(raw, self.scenario.roaster_capacity_kg_per_day * 1.5)
            if clipped != raw:
                warnings.append(f"{sku} roast target clipped to scheduling limit")
            roasts[sku] = clipped

        prices = dict(self.prices)
        for sku, product in self.products.items():
            raw = action.prices.get(sku, prices[sku])
            try:
                raw = float(raw)
            except (TypeError, ValueError):
                raw = prices[sku]
            if not math.isfinite(raw):
                raw = prices[sku]
            prices[sku] = min(product.max_price, max(product.min_price, raw))

        return WorldAction(orders, roasts, prices), warnings

    def _place_purchase_orders(self, action: WorldAction, warnings: list[str]) -> None:
        open_green = sum(
            order.quantity_kg for order in self.purchase_orders if order.status == "in_transit"
        )
        capacity_remaining = max(
            0.0,
            self.scenario.green_capacity_kg
            - self.inventory.quantity("green")
            - open_green,
        )
        liquidity = max(0.0, self.ledger.cash + self.scenario.credit_limit)

        requested_total = sum(max(0.0, amount) for amount in action.green_orders.values())
        active_requested = [key for key, amount in action.green_orders.items() if amount > 0]
        concentration_cap = requested_total * self.scenario.supplier_concentration_limit
        for supplier_id, requested in action.green_orders.items():
            if requested <= 0:
                continue
            supplier = self.suppliers[supplier_id]
            if requested_total > 0 and requested > concentration_cap and concentration_cap >= supplier.minimum_order:
                warnings.append(
                    f"{supplier_id} order reduced to {self.scenario.supplier_concentration_limit:.0%} concentration limit; diversify suppliers"
                )
                requested = concentration_cap
            if requested_total > 0 and len(active_requested) < self.scenario.minimum_active_suppliers:
                warnings.append(f"Supplier plan has {len(active_requested)} active source(s); at least {self.scenario.minimum_active_suppliers} are recommended")
            affordable = liquidity / supplier.unit_cost
            quantity = min(requested, capacity_remaining, affordable)
            if quantity + 1e-9 < supplier.minimum_order:
                warnings.append(f"{supplier_id} order rejected by capacity or credit constraint")
                continue
            if quantity + 1e-9 < requested:
                warnings.append(f"{supplier_id} order reduced by capacity or credit constraint")
            lead = max(
                0.25,
                float(self.supply_rng.normal(supplier.mean_lead_days, supplier.lead_std_days)),
            )
            if self.supply_rng.random() > supplier.reliability:
                delay = float(self.supply_rng.uniform(1.0, 4.0))
                lead += delay
                warnings.append(f"{supplier_id} shipment incurred a {delay:.1f}-day exception delay")
                self._log("late_delivery", f"{supplier.name} shipment delayed by {delay:.1f} days", delay_days=round(delay, 3))
            order = PurchaseOrder(
                order_id=self._next_id("po"),
                supplier_id=supplier_id,
                quantity_kg=quantity,
                unit_cost=supplier.unit_cost,
                ordered_at=float(self.env.now),
                due_at=float(self.env.now + lead),
            )
            self.purchase_orders.append(order)
            cost = quantity * supplier.unit_cost
            self.ledger.post(
                self.env.now,
                "procurement",
                -cost,
                reward=False,
                memo=f"{order.order_id} {supplier_id} {quantity:.1f} kg",
            )
            liquidity -= cost
            capacity_remaining -= quantity
            self.env.process(self._delivery_process(order, supplier, lead))
            self._log("purchase_order", f"Ordered {quantity:.1f} kg from {supplier.name}", order_id=order.order_id, quantity_kg=round(quantity, 3), unit_cost=supplier.unit_cost)

    def _delivery_process(self, order: PurchaseOrder, supplier: Supplier, lead: float):
        yield self.env.timeout(lead)
        available_capacity = max(
            0.0, self.scenario.green_capacity_kg - self.inventory.quantity("green")
        )
        accepted = min(order.quantity_kg, available_capacity)
        if accepted > 0:
            delivered_quality = float(np.clip(
                supplier.quality + self.production_rng.normal(0.0, 0.045), 0.45, 1.0
            ))
            self.inventory.add(
                InventoryLot(
                    lot_id=self._next_id("green"),
                    category="green",
                    item_id=supplier.id,
                    quantity_kg=accepted,
                    unit_cost=order.unit_cost,
                    created_at=float(self.env.now),
                    expires_at=float(self.env.now + 365.0),
                    quality=delivered_quality,
                    metadata={"purchase_order": order.order_id},
                )
            )
            if delivered_quality < supplier.quality - 0.06:
                self._log(
                    "quality_variance",
                    f"{supplier.name} lot quality tested below expectation ({delivered_quality:.0%})",
                    supplier_id=supplier.id,
                    quality=round(delivered_quality, 4),
                )
        self.stats["green_received"] += order.quantity_kg
        overflow = order.quantity_kg - accepted
        if overflow > 1e-9:
            self.ledger.post(
                self.env.now,
                "overflow_loss",
                -(overflow * order.unit_cost),
                cash=False,
                memo=order.order_id,
            )
            self.stats["green_spoiled"] += overflow
        order.status = "delivered"
        self._log("delivery", f"Received {accepted:.1f} kg from {supplier.name}", order_id=order.order_id, quantity_kg=round(accepted, 3))

    def _schedule_roasts(self, action: WorldAction, warnings: list[str]) -> None:
        queued_input = sum(
            job.green_input_kg for job in self.roast_jobs if job.status in {"queued", "running"}
        )
        queue_limit = self.scenario.roaster_capacity_kg_per_day * 2.0
        for sku, requested in action.roast_targets.items():
            if requested <= 0:
                continue
            queue_room = max(0.0, queue_limit - queued_input)
            available = self.inventory.quantity("green")
            planned = min(requested, available, queue_room)
            product = self.products[sku]
            if product.bom:
                bom_capacity = min(
                    self.inventory.quantity("green", component.raw_material_id) / component.fraction
                    for component in product.bom
                    if component.fraction > 0
                )
                if bom_capacity < planned:
                    warnings.append(f"{sku} roast reduced by BOM raw-material constraint")
                    planned = min(planned, bom_capacity)
            if planned <= 1e-9:
                warnings.append(f"{sku} roast rejected: no green stock or queue capacity")
                continue
            if planned + 1e-9 < requested:
                warnings.append(f"{sku} roast reduced to {planned:.1f} kg")
            if product.bom:
                taken = cost = quality_total = 0.0
                for component in product.bom:
                    amount, component_cost, component_quality = self.inventory.consume("green", planned * component.fraction, component.raw_material_id)
                    taken += amount; cost += component_cost; quality_total += amount * component_quality
                quality = quality_total / taken if taken else 0.0
            else:
                taken, cost, quality = self.inventory.consume("green", planned)
            self.stats["green_consumed"] += taken
            job = RoastJob(
                job_id=self._next_id("roast"),
                sku=sku,
                green_input_kg=taken,
                green_cost=cost,
                submitted_at=float(self.env.now),
            )
            self.roast_jobs.append(job)
            self.env.process(self._roast_process(job, quality))
            queued_input += taken
            self._log("roast_queued", f"Queued {taken:.1f} kg {sku} roast", job_id=job.job_id, quantity_kg=round(taken, 3), mo_id=job.job_id)

    def _roast_process(self, job: RoastJob, green_quality: float):
        product = self.products[job.sku]
        with self.roaster.request() as request:
            yield request
            job.status = "running"
            job.started_at = float(self.env.now)
            if self.last_roast_profile not in {None, product.roast_profile}:
                yield self.env.timeout(self.scenario.roast_setup_hours / 24.0)
                self._daily["changeovers"] += 1
            duration = max(0.01, job.green_input_kg / self.scenario.roaster_capacity_kg_per_day)
            self.stats["roast_hours"] += duration * 24.0
            self._daily["roast_hours"] += duration * 24.0
            yield self.env.timeout(duration / 2.0)
            if self.event_rng.random() < self.scenario.roast_breakdown_probability:
                repair_hours = float(
                    self.event_rng.uniform(
                        self.scenario.repair_hours_low, self.scenario.repair_hours_high
                    )
                )
                self._daily["downtime_hours"] += repair_hours
                self._log(
                    "roaster_breakdown",
                    f"Roaster stopped for {repair_hours:.1f} repair hours",
                    job_id=job.job_id,
                )
                yield self.env.timeout(repair_hours / 24.0)
            yield self.env.timeout(duration / 2.0)
            shrinkage = float(
                self.production_rng.uniform(
                    self.scenario.shrinkage_low, self.scenario.shrinkage_high
                )
            )
            output = job.green_input_kg * (1.0 - shrinkage)
            if self.production_rng.random() < 0.035:
                defect_factor = float(self.production_rng.uniform(0.55, 0.9))
                output *= defect_factor
                self._log(
                    "quality_failure",
                    f"{job.sku} roast quality hold reduced sellable output to {output:.1f} kg",
                    job_id=job.job_id,
                    yield_factor=round(defect_factor, 4),
                    quantity_kg=round(output, 3),
                )
            energy = job.green_input_kg * self.scenario.energy_cost_per_green_kg
            self.ledger.post(
                self.env.now,
                "roast_energy",
                -energy,
                memo=job.job_id,
            )
            unit_cost = (job.green_cost + energy) / max(output, 1e-9)
            available_capacity = max(
                0.0, self.scenario.roasted_capacity_kg - self.inventory.quantity("roasted")
            )
            accepted = min(output, available_capacity)
            if accepted > 0:
                self.inventory.add(
                    InventoryLot(
                        lot_id=self._next_id("roasted"),
                        category="roasted",
                        item_id=job.sku,
                        quantity_kg=accepted,
                        unit_cost=unit_cost,
                        created_at=float(self.env.now),
                        expires_at=float(self.env.now + product.shelf_life_days),
                        quality=max(0.0, min(1.0, green_quality - shrinkage * 0.08)),
                        metadata={"roast_job": job.job_id, "profile": product.roast_profile},
                    )
                )
            overflow = output - accepted
            if overflow > 1e-9:
                self.ledger.post(
                    self.env.now,
                    "overflow_loss",
                    -(overflow * unit_cost),
                    cash=False,
                    memo=job.job_id,
                )
                self.stats["roasted_spoiled"] += overflow
            self.stats["roasted_produced"] += output
            job.roasted_output_kg = output
            job.shrinkage = shrinkage
            job.completed_at = float(self.env.now)
            job.status = "complete"
            self.last_roast_profile = product.roast_profile
            self._daily["roasted_kg"] += output
            self._log(
                "roast_complete",
                f"Completed {job.sku}: {output:.1f} kg ({shrinkage:.1%} shrink)",
                job_id=job.job_id,
                quantity_kg=round(output, 3),
            )
            self._release_backorders(job.sku)

    def _schedule_daily_demand(self) -> None:
        weekday = self.day % 7
        weekday_factor = (0.92, 0.96, 1.0, 1.03, 1.12, 1.08, 0.82)[weekday]
        seasonal = 1.0 + 0.08 * math.sin((self.day / 365.0) * 2.0 * math.pi)
        growth = (1.0 + self.scenario.demand_growth_rate_daily) ** self.day
        for sku, product in self.products.items():
            price_ratio = self.prices[sku] / product.base_price
            price_factor = price_ratio ** -1.35
            spike = self.demand_rng.random() < self.scenario.demand_spike_probability
            shock = float(self.demand_rng.uniform(self.scenario.demand_spike_low, self.scenario.demand_spike_high)) if spike else float(np.clip(self.demand_rng.lognormal(0.0, 0.16), 0.55, 1.65))
            if spike:
                self._log("demand_spike", f"{sku} demand spike at {shock:.0%} of expected volume", sku=sku, multiplier=round(shock, 4))
            expected = product.base_daily_demand_kg * growth * weekday_factor * seasonal * price_factor * shock
            total = int(self.demand_rng.poisson(max(0.0, expected)))
            if total <= 0:
                continue
            weights = np.array([0.06, 0.10, 0.17, 0.20, 0.18, 0.14, 0.09, 0.06])
            waves = self.demand_rng.multinomial(total, weights)
            for wave_index, quantity in enumerate(waves):
                if quantity <= 0:
                    continue
                base_offset = 0.12 + wave_index * (0.76 / self.DEMAND_WAVES)
                jitter = float(self.demand_rng.uniform(0.0, 0.04))
                self.env.process(
                    self._demand_arrival(base_offset + jitter, sku, float(quantity), self.prices[sku])
                )

    def _expected_demand_forecast(self) -> dict[str, float]:
        """Mean next-day demand without the random shock draw.

        This is intentionally exposed separately from realized demand so a
        human or policy can inspect the decision problem before committing an
        order or roast schedule.
        """
        weekday = (self.day + 1) % 7
        weekday_factor = (0.92, 0.96, 1.0, 1.03, 1.12, 1.08, 0.82)[weekday]
        seasonal = 1.0 + 0.08 * math.sin(((self.day + 1) / 365.0) * 2.0 * math.pi)
        growth = (1.0 + self.scenario.demand_growth_rate_daily) ** (self.day + 1)
        return {
            sku: round(
                product.base_daily_demand_kg
                * growth
                * weekday_factor
                * seasonal
                * (self.prices[sku] / product.base_price) ** -1.35,
                2,
            )
            for sku, product in self.products.items()
        }

    def _demand_arrival(self, delay: float, sku: str, quantity: float, unit_price: float):
        yield self.env.timeout(delay)
        self.stats["demand"] += quantity
        self._daily["demand_kg"] += quantity
        self._daily.setdefault("demand_by_sku", {})[sku] = self._daily.setdefault("demand_by_sku", {}).get(sku, 0.0) + quantity
        taken, cost, _quality = self.inventory.consume("roasted", quantity, sku)
        if taken > 0:
            self.stats["roasted_reserved"] += taken
            self.env.process(self._package_process(sku, taken, unit_price, cost))
        remainder = quantity - taken
        if remainder > 1e-9:
            self._daily["stockout_transactions"] += 1
            self._daily["stockout_kg"] += remainder
            self._daily.setdefault("stockout_by_sku", {})[sku] = self._daily.setdefault("stockout_by_sku", {}).get(sku, 0.0) + remainder
            self.backorders.append(
                Backorder(
                    order_id=self._next_id("demand"),
                    sku=sku,
                    quantity_kg=remainder,
                    unit_price=unit_price,
                    created_at=float(self.env.now),
                )
            )
            self._daily["backordered_kg"] += remainder

    def _package_process(self, sku: str, quantity: float, unit_price: float, inventory_cost: float):
        with self.packager.request() as request:
            yield request
            duration = quantity / self.scenario.packaging_capacity_kg_per_day
            self.stats["packaging_hours"] += duration * 24.0
            self._daily["packaging_hours"] += duration * 24.0
            yield self.env.timeout(max(0.002, duration))
            revenue = quantity * unit_price
            self.ledger.post(self.env.now, "sales", revenue, memo=f"{sku} {quantity:.1f} kg")
            self.ledger.post(
                self.env.now,
                "cogs",
                -inventory_cost,
                cash=False,
                memo=f"{sku} {quantity:.1f} kg",
            )
            self.stats["roasted_reserved"] -= quantity
            self.stats["roasted_sold"] += quantity
            self._daily["served_kg"] += quantity
            self._daily["revenue"] += revenue

    def _release_backorders(self, sku: str) -> None:
        for order in list(self.backorders):
            if order.sku != sku:
                continue
            taken, cost, _quality = self.inventory.consume("roasted", order.quantity_kg, sku)
            if taken <= 1e-9:
                return
            order.quantity_kg -= taken
            self.stats["roasted_reserved"] += taken
            self.env.process(self._package_process(sku, taken, order.unit_price, cost))
            if order.quantity_kg <= 1e-9:
                self.backorders.remove(order)

    def _settle_day(self) -> None:
        now = float(self.env.now)
        expired = self.inventory.expire(now)
        for lot in expired:
            loss = lot.quantity_kg * lot.unit_cost
            self.ledger.post(now, "spoilage", -loss, cash=False, memo=lot.lot_id)
            self._daily["spoilage_kg"] += lot.quantity_kg
            if lot.category == "green":
                self.stats["green_spoiled"] += lot.quantity_kg
            else:
                self.stats["roasted_spoiled"] += lot.quantity_kg

        for order in list(self.backorders):
            age = now - order.created_at
            if age + 1e-9 >= self.scenario.maximum_backorder_days:
                penalty = order.quantity_kg * self.scenario.lost_sale_penalty_per_kg
                self.ledger.post(now, "lost_sale", -penalty, cash=False, memo=order.order_id)
                self.stats["lost_sales"] += order.quantity_kg
                self._daily["lost_kg"] += order.quantity_kg
                self.backorders.remove(order)

        backlog_qty = sum(order.quantity_kg for order in self.backorders)
        if backlog_qty > 0:
            self.ledger.post(
                now,
                "backorder_penalty",
                -(backlog_qty * self.scenario.backorder_penalty_per_kg_day),
                cash=False,
            )
        self.ledger.post(now, "fixed_cost", -self.scenario.daily_fixed_cost)
        self.ledger.post(now, "labor", -self.scenario.daily_labor_cost)
        held = self.inventory.quantity()
        self.ledger.post(
            now,
            "holding_cost",
            -(held * self.scenario.holding_cost_per_kg_day),
            cash=False,
        )
        if self._daily.get("stockout_transactions", 0) > 0:
            self._log(
                "stockout_tally",
                f"{int(self._daily['stockout_transactions'])} missed demand transactions totaling {self._daily['stockout_kg']:.1f} kg",
                transactions=int(self._daily["stockout_transactions"]),
                quantity_kg=round(self._daily["stockout_kg"], 3),
                by_sku={key: round(value, 3) for key, value in self._daily.get("stockout_by_sku", {}).items()},
            )

    def _run_through(self, target: float) -> None:
        """Advance through all events at target, not merely up to it."""
        self.env.run(until=target)
        while self.env.peek() <= target + 1e-10:
            self.env.step()

    def step(self, action: WorldAction | dict[str, Any] | None):
        if self.terminated or self.truncated:
            raise RuntimeError("Episode is complete; create or reset the world before stepping")
        if not isinstance(action, WorldAction):
            action = WorldAction.from_mapping(action)
        if action.weekly_green_orders:
            self.standing_green_orders = dict(action.weekly_green_orders)
        if action.weekly_roast_targets:
            self.standing_roast_targets = dict(action.weekly_roast_targets)
        # Standing POs are released at the start of each simulated week. The
        # master roast schedule is spread across seven operating days and is
        # still bounded by the roaster queue and available green stock.
        if self.standing_green_orders or self.standing_roast_targets:
            action = WorldAction(
                green_orders=(self.standing_green_orders if self.day % 7 == 0 else {}),
                roast_targets={sku: qty / 7.0 for sku, qty in self.standing_roast_targets.items()},
                prices=action.prices,
                weekly_green_orders=self.standing_green_orders,
                weekly_roast_targets=self.standing_roast_targets,
            )
        action, warnings = self._sanitize_action(action)
        self.prices = dict(action.prices)
        self._daily = {
            "demand_kg": 0.0,
            "served_kg": 0.0,
            "backordered_kg": 0.0,
            "lost_kg": 0.0,
            "spoilage_kg": 0.0,
            "roasted_kg": 0.0,
            "revenue": 0.0,
            "changeovers": 0.0,
            "downtime_hours": 0.0,
            "roast_hours": 0.0,
            "packaging_hours": 0.0,
            "stockout_transactions": 0,
            "stockout_kg": 0.0,
        }
        ledger_start = len(self.ledger.entries)
        cash_start = self.ledger.cash
        self._place_purchase_orders(action, warnings)
        self._schedule_roasts(action, warnings)
        for sku in self.products:
            self._release_backorders(sku)
        self._schedule_daily_demand()
        target = float(self.day + 1)
        self._run_through(target)
        self._settle_day()
        reward = self.ledger.reward_since(ledger_start)
        self.day += 1
        if self.ledger.cash < -self.scenario.credit_limit:
            self.terminated = True
            self.termination_reason = "credit_limit_exceeded"
        if self.day >= self.scenario.horizon_days and not self.terminated:
            self.truncated = True
            self.termination_reason = "horizon_reached"

        daily = {
            "day": self.day,
            **{key: round(value, 3) for key, value in self._daily.items() if isinstance(value, (int, float))},
            "demand_by_sku": {key: round(value, 3) for key, value in self._daily.get("demand_by_sku", {}).items()},
            "reward": round(reward, 3),
            "cash_change": round(self.ledger.cash - cash_start, 3),
            "cash": round(self.ledger.cash, 3),
            "warnings": list(warnings),
            "forecast": self._expected_demand_forecast(),
            "eod_tally": {
                "sales": round(self._daily["revenue"], 3),
                "inventory_value": round(self.inventory.value(), 3),
                "roaster_utilization": round(min(1.0, self._daily["roast_hours"] / 24.0), 4),
                "packaging_utilization": round(min(1.0, self._daily["packaging_hours"] / 24.0), 4),
                "roast_labor_hours": round(self._daily["roast_hours"], 3),
                "packaging_labor_hours": round(self._daily["packaging_hours"], 3),
                "cash": round(self.ledger.cash, 3),
                "reward": round(reward, 3),
                "stockout_transactions": int(self._daily.get("stockout_transactions", 0)),
                "stockout_kg": round(self._daily.get("stockout_kg", 0.0), 3),
            },
        }
        self.daily_history.append(daily)
        self.action_history.append(
            {
                "day": self.day,
                "green_orders": dict(action.green_orders),
                "roast_targets": dict(action.roast_targets),
                "prices": dict(action.prices),
                "weekly_green_orders": dict(self.standing_green_orders),
                "weekly_roast_targets": dict(self.standing_roast_targets),
            }
        )
        observation = self.snapshot()
        info = {
            "day": self.day,
            "warnings": warnings,
            "daily": daily,
            "termination_reason": self.termination_reason,
            "ledger_reconciles": self.ledger.cash_reconciles(),
            "mass_balance": self.mass_balance(),
        }
        return observation, reward, self.terminated, self.truncated, info

    def mass_balance(self) -> dict[str, float]:
        green_error = self.stats["green_received"] - (
            self.inventory.quantity("green")
            + self.stats["green_consumed"]
            + self.stats["green_spoiled"]
        )
        roasted_error = self.stats["roasted_opening"] + self.stats["roasted_produced"] - (
            self.inventory.quantity("roasted")
            + self.stats["roasted_reserved"]
            + self.stats["roasted_sold"]
            + self.stats["roasted_spoiled"]
        )
        return {"green_error_kg": green_error, "roasted_error_kg": roasted_error}

    def snapshot(self) -> dict[str, Any]:
        green = {supplier_id: self.inventory.quantity("green", supplier_id) for supplier_id in self.suppliers}
        roasted = {sku: self.inventory.quantity("roasted", sku) for sku in self.products}
        inbound = {supplier_id: 0.0 for supplier_id in self.suppliers}
        for order in self.purchase_orders:
            if order.status == "in_transit":
                inbound[order.supplier_id] += order.quantity_kg
        backlog = {sku: 0.0 for sku in self.products}
        for order in self.backorders:
            backlog[order.sku] += order.quantity_kg
        service_level = (
            self.stats["roasted_sold"] / self.stats["demand"]
            if self.stats["demand"] > 0
            else 1.0
        )
        recent_jobs = [asdict(job) for job in self.roast_jobs[-30:]]
        return {
            "scenario": self.scenario.name,
            "simulation_mode": self.simulation_mode,
            "simulation_strategy": self.simulation_strategy,
            "seed": self.seed,
            "day": self.day,
            "horizon_days": self.scenario.horizon_days,
            "sim_time": round(float(self.env.now), 4),
            "cash": round(self.ledger.cash, 2),
            "credit_available": round(
                max(0.0, self.scenario.credit_limit + self.ledger.cash), 2
            ),
            "inventory_value": round(self.inventory.value(), 2),
            "green_inventory": {key: round(value, 3) for key, value in green.items()},
            "roasted_inventory": {key: round(value, 3) for key, value in roasted.items()},
            "roasted_age_buckets": {
                sku: [round(value, 3) for value in self.inventory.age_buckets(sku, self.env.now)]
                for sku in self.products
            },
            "inbound_green": {key: round(value, 3) for key, value in inbound.items()},
            "backorders": {key: round(value, 3) for key, value in backlog.items()},
            "prices": {key: round(value, 2) for key, value in self.prices.items()},
            "demand_forecast": self._expected_demand_forecast(),
            "standing_plan": {
                "weekly_green_orders": dict(self.standing_green_orders),
                "weekly_roast_targets": dict(self.standing_roast_targets),
            },
            "resources": {
                "roaster_busy": len(self.roaster.users),
                "roaster_queue": len(self.roaster.queue),
                "packager_busy": len(self.packager.users),
                "packager_queue": len(self.packager.queue),
            },
            "service_level": round(service_level, 4),
            "terminated": self.terminated,
            "truncated": self.truncated,
            "termination_reason": self.termination_reason,
            "today": self.daily_history[-1] if self.daily_history else None,
            "history": self.daily_history[-120:],
            "events": self.event_log[-100:],
            "inventory_lots": self.inventory.snapshot(self.env.now),
            "roast_jobs": recent_jobs,
            "ledger_totals": self.ledger.totals(),
            "ledger": self.ledger.snapshot(100),
            "stats": {key: round(value, 4) for key, value in self.stats.items()},
            "mass_balance": {
                key: round(value, 9) for key, value in self.mass_balance().items()
            },
        }

    def trace(self) -> dict[str, Any]:
        return {
            "version": 1,
            "seed": self.seed,
            "scenario": {"name": self.scenario.name, "horizon_days": self.scenario.horizon_days},
            "actions": list(self.action_history),
            "final": self.snapshot(),
        }
