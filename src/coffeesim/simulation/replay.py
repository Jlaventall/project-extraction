from __future__ import annotations

from typing import Any

from coffeesim.config import Scenario, default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.simulation.world import CoffeeWorld


def replay_trace(trace: dict[str, Any], scenario: Scenario | None = None) -> dict[str, Any]:
    """Replay a previously recorded action trace and return its final snapshot."""
    metadata = trace.get("scenario", {})
    selected = scenario or default_scenario(int(metadata.get("horizon_days", 90)))
    world = CoffeeWorld(selected, seed=int(trace.get("seed", 42)))
    for action in trace.get("actions", []):
        if world.terminated or world.truncated:
            break
        world.step(WorldAction.from_mapping(action))
    return world.trace()

