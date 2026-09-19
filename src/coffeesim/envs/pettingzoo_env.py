"""Cooperative PettingZoo adapter for weekly CoffeeWorld decisions."""

from __future__ import annotations

from typing import Any

import numpy as np
from gymnasium import spaces

try:
    from pettingzoo import ParallelEnv
except ImportError as exc:  # pragma: no cover - exercised when optional extra is absent
    raise ImportError("Install coffeesim[multiagent] to use CoffeeParallelEnv") from exc

from coffeesim.config import Scenario, default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.envs.gym_env import CoffeeRoasteryEnv


class CoffeeParallelEnv(ParallelEnv):
    """Three cooperative planners acting on one shared weekly world."""

    metadata = {"name": "coffeesim_weekly_v0"}

    def __init__(self, scenario: Scenario | None = None, *, render_mode: str | None = None):
        self.scenario = scenario or default_scenario()
        self.render_mode = render_mode
        self.possible_agents = ["procurement", "roastery", "pricing"]
        self.agents = list(self.possible_agents)
        self._gym = CoffeeRoasteryEnv(self.scenario, render_mode=render_mode)
        self.observation_spaces = {agent: self._gym.observation_space for agent in self.possible_agents}
        self.action_spaces = {
            "procurement": spaces.Box(0.0, 1.0, (len(self.scenario.suppliers),), dtype=np.float32),
            "roastery": spaces.Box(0.0, 1.0, (len(self.scenario.products),), dtype=np.float32),
            "pricing": spaces.Box(0.0, 1.0, (len(self.scenario.products),), dtype=np.float32),
        }

    def observation_space(self, agent: str):
        return self.observation_spaces[agent]

    def action_space(self, agent: str):
        return self.action_spaces[agent]

    def reset(self, seed: int | None = None, options: dict[str, Any] | None = None):
        observation, info = self._gym.reset(seed=seed, options=options)
        self.agents = list(self.possible_agents)
        observations = {agent: observation.copy() for agent in self.agents}
        return observations, {agent: dict(info) for agent in self.agents}

    def step(self, actions: dict[str, np.ndarray]):
        missing = set(self.agents) - set(actions)
        if missing:
            raise ValueError(f"Missing actions for agents: {sorted(missing)}")
        combined = {
            "weekly_green_orders": actions["procurement"],
            "weekly_roast_targets": actions["roastery"],
            "prices": actions["pricing"],
        }
        observation, reward, terminated, truncated, info = self._gym.step(combined)
        if terminated or truncated:
            self.agents = []
        observations = {agent: observation.copy() for agent in self.agents}
        rewards = {agent: reward for agent in self.agents}
        terminations = {agent: terminated for agent in self.possible_agents}
        truncations = {agent: truncated for agent in self.possible_agents}
        infos = {agent: dict(info) for agent in self.possible_agents}
        return observations, rewards, terminations, truncations, infos

    def state(self) -> dict[str, Any]:
        if self._gym.world is None:
            raise RuntimeError("Call reset() before state()")
        return self._gym.world.snapshot()

    def render(self):
        return self._gym.render()

    def close(self):
        self._gym.close()
