"""Reproducible policy benchmarks with complete run artifacts."""

from __future__ import annotations

import json
import statistics
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


def run_benchmark_matrix(*, days: int = 90, seeds: list[int] | None = None, output_dir: Path | None = None) -> dict:
    """Run each policy over multiple seeds and return aggregate statistics."""
    selected_seeds = seeds or [42]
    reports = [report for seed in selected_seeds for report in run_benchmark(days=days, seed=seed, output_dir=output_dir)]
    by_policy: dict[str, list[dict]] = {}
    for report in reports:
        by_policy.setdefault(report["policy"], []).append(report["summary"])
    aggregate = {}
    for policy, rows in by_policy.items():
        rewards = [row["total_reward"] for row in rows]
        cash = [row["cash"] for row in rows]
        service = [row["service_level"] for row in rows]
        aggregate[policy] = {
            "runs": len(rows),
            "seeds": selected_seeds,
            "total_reward_mean": round(statistics.fmean(rewards), 4),
            "total_reward_stddev": round(statistics.pstdev(rewards), 4),
            "total_reward_min": round(min(rewards), 4),
            "cash_mean": round(statistics.fmean(cash), 2),
            "service_level_mean": round(statistics.fmean(service), 4),
            "service_level_min": round(min(service), 4),
            "mass_balance_ok": all(abs(row["mass_balance"]["green_error_kg"]) < 1e-6 and abs(row["mass_balance"]["roasted_error_kg"]) < 1e-6 for row in rows),
        }
    result = {"format": "coffeesim.benchmark-matrix.v1", "days": days, "seeds": selected_seeds, "policies": aggregate}
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"matrix-days-{days}.json").write_text(json.dumps(result, indent=2) + "\n")
    return result
