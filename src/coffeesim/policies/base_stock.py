from __future__ import annotations

from coffeesim.config import Scenario
from coffeesim.domain.models import WorldAction


class BaseStockPolicy:
    """Transparent benchmark policy; intentionally simple but operationally valid."""

    def __init__(self, scenario: Scenario) -> None:
        self.scenario = scenario

    def act(self, state: dict) -> WorldAction:
        expected_yield = 1.0 - (self.scenario.shrinkage_low + self.scenario.shrinkage_high) / 2.0
        # Procurement must follow the BOM, not just the cheapest total-kg
        # source.  Otherwise a baseline run can buy plenty of Brazil while
        # leaving Ethiopia at zero and making every single-origin roast
        # infeasible.  Keep a configurable raw-material target for each origin.
        coverage_days = self.scenario.procurement_coverage_days
        target_by_raw = {supplier.id: 0.0 for supplier in self.scenario.suppliers}
        for product in self.scenario.products:
            demand = state.get("demand_forecast", {}).get(product.id, product.base_daily_demand_kg)
            for component in product.bom:
                target_by_raw[component.raw_material_id] += demand * coverage_days * component.fraction / expected_yield

        orders = {supplier.id: 0.0 for supplier in self.scenario.suppliers}
        for supplier in self.scenario.suppliers:
            position = (
                state["green_inventory"].get(supplier.id, 0.0)
                + state["inbound_green"].get(supplier.id, 0.0)
            )
            gap = max(0.0, target_by_raw[supplier.id] - position)
            if gap > 0:
                orders[supplier.id] = min(
                    supplier.maximum_order,
                    max(supplier.minimum_order, gap),
                )

        roasts: dict[str, float] = {}
        total_target = 0.0
        for product in self.scenario.products:
            on_hand = state["roasted_inventory"][product.id]
            backlog = state["backorders"][product.id]
            target = state.get("demand_forecast", {}).get(product.id, product.base_daily_demand_kg) * self.scenario.finished_goods_coverage_days + backlog
            roasts[product.id] = max(0.0, target - on_hand) / expected_yield
            total_target += roasts[product.id]
        labor_ratio = min(1.0, ((self.scenario.regular_workers + self.scenario.temporary_workers) * 8.0 * self.scenario.shifts) / max(1.0, self.scenario.minimum_workers_per_shift * 8.0 * self.scenario.shifts))
        effective_capacity = self.scenario.roaster_capacity_kg_per_day * labor_ratio
        if total_target > effective_capacity:
            scale = effective_capacity / total_target
            roasts = {key: value * scale for key, value in roasts.items()}
        return WorldAction(
            weekly_green_orders=orders,
            weekly_roast_targets={key: value * 7.0 for key, value in roasts.items()},
            prices={product.id: product.base_price for product in self.scenario.products},
        )
