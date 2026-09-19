from __future__ import annotations

import argparse
import json
from pathlib import Path

from coffeesim.config import default_scenario
from coffeesim.policies.base_stock import BaseStockPolicy
from coffeesim.simulation.replay import replay_trace
from coffeesim.simulation.world import CoffeeWorld
from coffeesim.simulation.benchmark import run_benchmark


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the CoffeeSim baseline policy")
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--json", action="store_true", help="Print the final state as JSON")
    parser.add_argument("--replay", type=Path, help="Replay a saved trace JSON file")
    parser.add_argument("--benchmark", action="store_true", help="Run baseline and random policy benchmark")
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark-output"))
    args = parser.parse_args()
    if args.benchmark:
        reports = run_benchmark(days=args.days, seed=args.seed, output_dir=args.output_dir)
        print(json.dumps([report["summary"] | {"policy": report["policy"]} for report in reports], indent=2))
        return
    if args.replay:
        result = replay_trace(json.loads(args.replay.read_text()))
        print(json.dumps(result if args.json else result["final"], indent=2))
        return
    scenario = default_scenario(args.days)
    world = CoffeeWorld(scenario, seed=args.seed)
    policy = BaseStockPolicy(scenario)
    while not (world.terminated or world.truncated):
        world.step(policy.act(world.snapshot()))
    state = world.snapshot()
    if args.json:
        print(json.dumps(state, indent=2))
    else:
        print(
            f"Completed {state['day']} days | cash ${state['cash']:,.2f} | "
            f"service {state['service_level']:.1%} | reason {state['termination_reason']}"
        )


if __name__ == "__main__":
    main()
