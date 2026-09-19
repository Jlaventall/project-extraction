from __future__ import annotations

from coffeesim.config import Scenario
from coffeesim.domain.models import WorldAction


class BaseStockPolicy:
    """Transparent benchmark policy; intentionally simple but operationally valid."""

    def __init__(self, scenario: Scenario) -> None:
        self.scenario = scenario

    def act(self, state: dict) -> WorldAction:
        total_green = sum(state["green_inventory"].values()) + sum(state["inbound_green"].values())
        expected_yield = 1.0 - (self.scenario.shrinkage_low + self.scenario.shrinkage_high) / 2.0
        green_target = (
            sum(product.base_daily_demand_kg for product in self.scenario.products)
            * 10.0
            / expected_yield
        )
        order_gap = max(0.0, green_target - total_green)
        orders = {supplier.id: 0.0 for supplier in self.scenario.suppliers}
        if order_gap > 0:
            cheapest = min(self.scenario.suppliers, key=lambda supplier: supplier.unit_cost)
            orders[cheapest.id] = min(cheapest.maximum_order, max(cheapest.minimum_order, order_gap))

        roasts: dict[str, float] = {}
        total_target = 0.0
        for product in self.scenario.products:
            on_hand = state["roasted_inventory"][product.id]
            backlog = state["backorders"][product.id]
            target = product.base_daily_demand_kg * 3.0 + backlog
            roasts[product.id] = max(0.0, target - on_hand) / expected_yield
            total_target += roasts[product.id]
        if total_target > self.scenario.roaster_capacity_kg_per_day:
            scale = self.scenario.roaster_capacity_kg_per_day / total_target
            roasts = {key: value * scale for key, value in roasts.items()}
        return WorldAction(
            weekly_green_orders=orders,
            weekly_roast_targets={key: value * 7.0 for key, value in roasts.items()},
            prices={product.id: product.base_price for product in self.scenario.products},
        )
