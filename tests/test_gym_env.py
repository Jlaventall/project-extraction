from gymnasium.utils.env_checker import check_env

from coffeesim.config import default_scenario
from coffeesim.envs.gym_env import CoffeeRoasteryEnv


def test_gymnasium_contract() -> None:
    env = CoffeeRoasteryEnv(default_scenario(10))
    check_env(env, skip_render_check=True)


def test_seeded_resets_are_identical() -> None:
    env = CoffeeRoasteryEnv(default_scenario(10))
    first, first_info = env.reset(seed=123)
    second, second_info = env.reset(seed=123)

    assert first_info["raw"] == second_info["raw"]
    assert all((first[key] == second[key]).all() for key in first)

