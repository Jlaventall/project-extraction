from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from coffeesim.config import Scenario, default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.simulation.world import CoffeeWorld


class CoffeeRoasteryEnv(gym.Env):
    """Weekly master-schedule Gymnasium adapter around :class:`CoffeeWorld`."""

    metadata = {"render_modes": ["human"], "render_fps": 4}

    def __init__(
        self,
        scenario: Scenario | None = None,
        *,
        render_mode: str | None = None,
        reward_scale: float = 1_000.0,
    ) -> None:
        super().__init__()
        self.scenario = scenario or default_scenario()
        self.render_mode = render_mode
        self.reward_scale = float(reward_scale)
        self.supplier_ids = tuple(item.id for item in self.scenario.suppliers)
        self.sku_ids = tuple(item.id for item in self.scenario.products)
        self.world: CoffeeWorld | None = None

        self.action_space = spaces.Dict(
            {
                "weekly_green_orders": spaces.Box(0.0, 1.0, shape=(len(self.supplier_ids),), dtype=np.float32),
                "weekly_roast_targets": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
                "prices": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
            }
        )
        self.observation_space = spaces.Dict(
            {
                "green_inventory": spaces.Box(0.0, 1.0, shape=(len(self.supplier_ids),), dtype=np.float32),
                "roasted_inventory": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
                "roasted_age_buckets": spaces.Box(
                    0.0, 1.0, shape=(len(self.sku_ids), 4), dtype=np.float32
                ),
                "inbound_green": spaces.Box(0.0, 1.0, shape=(len(self.supplier_ids),), dtype=np.float32),
                "backorders": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
                "prices": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
                "resources": spaces.Box(0.0, 1.0, shape=(4,), dtype=np.float32),
                "finance": spaces.Box(-2.0, 5.0, shape=(4,), dtype=np.float32),
                "calendar": spaces.Box(0.0, 1.0, shape=(3,), dtype=np.float32),
                "demand_forecast": spaces.Box(0.0, 1.0, shape=(len(self.sku_ids),), dtype=np.float32),
                "standing_plan": spaces.Box(0.0, 1.0, shape=(len(self.supplier_ids) + len(self.sku_ids),), dtype=np.float32),
                "utilization": spaces.Box(0.0, 1.0, shape=(2,), dtype=np.float32),
            }
        )

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ):
        super().reset(seed=seed)
        actual_seed = int(seed if seed is not None else self.np_random.integers(1, 2**31 - 1))
        self.world = CoffeeWorld(self.scenario, seed=actual_seed)
        raw = self.world.snapshot()
        return self._observation(raw), {"raw": raw, "seed": actual_seed}

    def _world_action(self, action: dict[str, np.ndarray]) -> WorldAction:
        return WorldAction(
            weekly_green_orders={
                supplier.id: float(value) * supplier.maximum_order
                for supplier, value in zip(self.scenario.suppliers, action["weekly_green_orders"], strict=True)
            },
            weekly_roast_targets={
                key: float(value) * self.scenario.roaster_capacity_kg_per_day * 7.0
                for key, value in zip(self.sku_ids, action["weekly_roast_targets"], strict=True)
            },
            prices={
                product.id: product.min_price + float(value) * (product.max_price - product.min_price)
                for product, value in zip(self.scenario.products, action["prices"], strict=True)
            },
        )

    def _observation(self, raw: dict[str, Any]) -> dict[str, np.ndarray]:
        green_capacity = max(1.0, self.scenario.green_capacity_kg)
        roasted_capacity = max(1.0, self.scenario.roasted_capacity_kg)
        green = np.array(
            [raw["green_inventory"][key] / green_capacity for key in self.supplier_ids],
            dtype=np.float32,
        )
        roasted = np.array(
            [raw["roasted_inventory"][key] / roasted_capacity for key in self.sku_ids],
            dtype=np.float32,
        )
        age = np.array(
            [raw["roasted_age_buckets"][key] for key in self.sku_ids], dtype=np.float32
        ) / roasted_capacity
        inbound = np.array(
            [raw["inbound_green"][key] / green_capacity for key in self.supplier_ids],
            dtype=np.float32,
        )
        backlog = np.array(
            [raw["backorders"][key] / 500.0 for key in self.sku_ids], dtype=np.float32
        )
        prices = np.array(
            [
                (raw["prices"][item.id] - item.min_price) / (item.max_price - item.min_price)
                for item in self.scenario.products
            ],
            dtype=np.float32,
        )
        resource = raw["resources"]
        resources = np.array(
            [
                resource["roaster_busy"],
                min(1.0, resource["roaster_queue"] / 10.0),
                resource["packager_busy"],
                min(1.0, resource["packager_queue"] / 20.0),
            ],
            dtype=np.float32,
        )
        finance = np.array(
            [
                raw["cash"] / 100_000.0,
                raw["credit_available"] / max(1.0, self.scenario.credit_limit + self.scenario.starting_cash),
                raw["inventory_value"] / 50_000.0,
                raw["service_level"],
            ],
            dtype=np.float32,
        )
        day = raw["day"]
        calendar = np.array(
            [
                day / max(1, self.scenario.horizon_days),
                (day % 7) / 6.0,
                (day % 30) / 29.0,
            ],
            dtype=np.float32,
        )
        forecast = np.array([raw["demand_forecast"][key] / 100.0 for key in self.sku_ids], dtype=np.float32)
        plan = raw.get("standing_plan", {"weekly_green_orders": {}, "weekly_roast_targets": {}})
        standing = np.array(
            [plan["weekly_green_orders"].get(key, 0.0) / max(1.0, item.maximum_order) for key, item in zip(self.supplier_ids, self.scenario.suppliers, strict=True)]
            + [plan["weekly_roast_targets"].get(key, 0.0) / (self.scenario.roaster_capacity_kg_per_day * 7.0) for key in self.sku_ids],
            dtype=np.float32,
        )
        stats = raw.get("stats", {})
        utilization = np.array([
            min(1.0, (stats.get("roast_hours", 0.0) % 168.0) / 168.0),
            min(1.0, (stats.get("packaging_hours", 0.0) % 168.0) / 168.0),
        ], dtype=np.float32)
        observation = {
            "green_inventory": green,
            "roasted_inventory": roasted,
            "roasted_age_buckets": age,
            "inbound_green": inbound,
            "backorders": backlog,
            "prices": prices,
            "resources": resources,
            "finance": finance,
            "calendar": calendar,
            "demand_forecast": forecast,
            "standing_plan": standing,
            "utilization": utilization,
        }
        return {
            key: np.clip(value, self.observation_space[key].low, self.observation_space[key].high).astype(np.float32)
            for key, value in observation.items()
        }

    def step(self, action: dict[str, np.ndarray]):
        if self.world is None:
            raise RuntimeError("Call reset() before step()")
        raw, reward, terminated, truncated, info = self.world.step(self._world_action(action))
        info = {**info, "raw": raw, "unscaled_reward": reward}
        if self.render_mode == "human":
            self.render()
        return self._observation(raw), reward / self.reward_scale, terminated, truncated, info

    def render(self):
        if self.world is None:
            return None
        state = self.world.snapshot()
        print(
            f"Day {state['day']:3d} | cash ${state['cash']:,.0f} | "
            f"service {state['service_level']:.1%} | "
            f"green {sum(state['green_inventory'].values()):.0f} kg | "
            f"roasted {sum(state['roasted_inventory'].values()):.0f} kg"
        )
        return None
