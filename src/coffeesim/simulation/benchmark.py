"""Reproducible policy benchmarks with complete run artifacts."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Callable

import numpy as np

from coffeesim.config import Scenario, default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.policies.base_stock import BaseStockPolicy
from coffeesim.simulation.world import CoffeeWorld

Policy = Callable[[dict], WorldAction]


def random_policy(scenario: Scenario, seed: int) -> Policy:
    rng = np.random.default_rng(seed)

    def act(_state: dict) -> WorldAction:
        return WorldAction(
            weekly_green_orders={supplier.id: float(rng.uniform(0, supplier.maximum_order)) for supplier in scenario.suppliers},
            weekly_roast_targets={product.id: float(rng.uniform(0, scenario.roaster_capacity_kg_per_day * 7)) for product in scenario.products},
            prices={product.id: product.base_price for product in scenario.products},
        )

    return act


def run_policy(name: str, policy: Policy, scenario: Scenario, seed: int) -> dict:
    world = CoffeeWorld(scenario, seed=seed)
    rewards: list[float] = []
    while not (world.terminated or world.truncated):
        _, reward, _, _, _ = world.step(policy(world.snapshot()))
        rewards.append(reward)
    final = world.snapshot()
    return {
        "format": "coffeesim.benchmark.v1",
        "policy": name,
        "seed": seed,
        "scenario": {"name": scenario.name, "horizon_days": scenario.horizon_days},
        "summary": {
            "days": final["day"], "total_reward": round(sum(rewards), 4),
            "mean_daily_reward": round(float(np.mean(rewards)) if rewards else 0.0, 4),
            "cash": final["cash"], "service_level": final["service_level"],
            "termination_reason": final["termination_reason"], "mass_balance": final["mass_balance"],
        },
        "actions": list(world.action_history), "daily": list(world.daily_history),
        "events": list(world.all_event_log), "ledger": [asdict(entry) for entry in world.ledger.entries],
        "final": final,
    }


def run_benchmark(*, days: int = 90, seed: int = 42, output_dir: Path | None = None) -> list[dict]:
    scenario = default_scenario(days)
    policies = {
        "baseline": lambda state: BaseStockPolicy(scenario).act(state),
        "random": random_policy(scenario, seed + 1),
    }
    reports = [run_policy(name, policy, scenario, seed) for name, policy in policies.items()]
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        for report in reports:
            (output_dir / f"{report['policy']}-seed-{seed}-days-{days}.json").write_text(json.dumps(report, indent=2) + "\n")
        (output_dir / f"summary-seed-{seed}-days-{days}.json").write_text(json.dumps([report["summary"] | {"policy": report["policy"]} for report in reports], indent=2) + "\n")
    return reports
