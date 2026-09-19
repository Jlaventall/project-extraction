"""Role-ablation benchmark for the cooperative PettingZoo adapter."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from coffeesim.config import default_scenario
from coffeesim.envs.pettingzoo_env import CoffeeParallelEnv
from coffeesim.policies.base_stock import BaseStockPolicy


def run_role_benchmark(*, days: int = 30, seeds: list[int] | None = None, output_dir: Path | None = None) -> dict:
    selected = seeds or [42]
    variants = ["all_baseline", "random_procurement", "random_roastery", "random_pricing"]
    records = []
    scenario = default_scenario(days)
    for seed in selected:
        for variant in variants:
            env = CoffeeParallelEnv(scenario); env.reset(seed=seed)
            policy = BaseStockPolicy(scenario); rng = np.random.default_rng(seed + 100)
            totals = {agent: 0.0 for agent in env.possible_agents}
            for _ in range(days):
                action = policy.act(env.state())
                actions = {
                    "procurement": np.array([action.weekly_green_orders.get(s.id, 0.0) / s.maximum_order for s in scenario.suppliers], dtype=np.float32),
                    "roastery": np.array([action.weekly_roast_targets.get(p.id, 0.0) / (scenario.roaster_capacity_kg_per_day * 7.0) for p in scenario.products], dtype=np.float32),
                    "pricing": np.array([(action.prices.get(p.id, p.base_price) - p.min_price) / (p.max_price - p.min_price) for p in scenario.products], dtype=np.float32),
                }
                if variant == "random_procurement": actions["procurement"] = rng.random(len(scenario.suppliers), dtype=np.float32)
                if variant == "random_roastery": actions["roastery"] = rng.random(len(scenario.products), dtype=np.float32)
                if variant == "random_pricing": actions["pricing"] = rng.random(len(scenario.products), dtype=np.float32)
                _, rewards, *_ = env.step(actions)
                for agent, reward in rewards.items(): totals[agent] += reward
            final = env.state()
            records.append({"variant": variant, "seed": seed, "role_rewards": totals, "cash": final["cash"], "service_level": final["service_level"], "mass_balance": final["mass_balance"]})
            env.close()
    aggregate = {}
    for variant in variants:
        rows = [row for row in records if row["variant"] == variant]
        aggregate[variant] = {"runs": len(rows), "role_reward_mean": {agent: round(float(np.mean([row["role_rewards"][agent] for row in rows])), 4) for agent in ("procurement", "roastery", "pricing")}, "cash_mean": round(float(np.mean([row["cash"] for row in rows])), 2), "service_mean": round(float(np.mean([row["service_level"] for row in rows])), 4), "service_min": round(min(row["service_level"] for row in rows), 4)}
    result = {"format": "coffeesim.pettingzoo-benchmark.v1", "days": days, "seeds": selected, "aggregate": aggregate, "runs": records}
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / f"pettingzoo-roles-days-{days}.json").write_text(json.dumps(result, indent=2) + "\n")
    return result
