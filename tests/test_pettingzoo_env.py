import pytest

pettingzoo = pytest.importorskip("pettingzoo")

from coffeesim.envs.pettingzoo_env import CoffeeParallelEnv
from pettingzoo.test import parallel_api_test


def test_parallel_env_contract() -> None:
    env = CoffeeParallelEnv()
    observations, infos = env.reset(seed=42)
    assert set(observations) == {"procurement", "roastery", "pricing"}
    actions = {agent: env.action_space(agent).sample() for agent in env.agents}
    observations, rewards, terminations, truncations, infos = env.step(actions)
    assert set(rewards) == set(env.agents)
    assert all(isinstance(value, bool) for value in terminations.values())


def test_parallel_api() -> None:
    parallel_api_test(CoffeeParallelEnv(), num_cycles=3)
