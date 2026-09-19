import pytest

from coffeesim.config import default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.policies.base_stock import BaseStockPolicy
from coffeesim.simulation.world import CoffeeWorld
from coffeesim.simulation.replay import replay_trace


def neutral_action(world: CoffeeWorld) -> WorldAction:
    return WorldAction(prices=dict(world.prices))


def test_same_seed_and_actions_replay_identically() -> None:
    scenario = default_scenario(14)
    left = CoffeeWorld(scenario, seed=917)
    right = CoffeeWorld(scenario, seed=917)
    left_policy = BaseStockPolicy(scenario)
    right_policy = BaseStockPolicy(scenario)

    while not left.truncated:
        left_result = left.step(left_policy.act(left.snapshot()))
        right_result = right.step(right_policy.act(right.snapshot()))
        assert left_result[1:] == right_result[1:]
        assert left_result[0] == right_result[0]

    assert left.trace() == right.trace()


def test_purchase_orders_respect_lead_time() -> None:
    world = CoffeeWorld(default_scenario(20), seed=42)
    opening = world.inventory.quantity("green", "brazil")
    action = neutral_action(world)
    action.green_orders = {"brazil": 75.0}

    world.step(action)

    assert world.inventory.quantity("green", "brazil") == pytest.approx(opening)
    assert world.snapshot()["inbound_green"]["brazil"] == pytest.approx(75.0)
    for _ in range(10):
        if not world.snapshot()["inbound_green"]["brazil"]:
            break
        world.step(neutral_action(world))
    assert world.snapshot()["inbound_green"]["brazil"] == 0.0
    assert world.inventory.quantity("green", "brazil") > opening


def test_supplier_concentration_is_constrained() -> None:
    world = CoffeeWorld(default_scenario(7), seed=42)
    _, _, _, _, info = world.step(WorldAction(green_orders={"brazil": 800.0}))
    assert any("concentration limit" in warning for warning in info["warnings"])
    assert sum(order.quantity_kg for order in world.purchase_orders) == pytest.approx(520.0)


def test_roasting_conserves_mass_and_applies_shrinkage() -> None:
    world = CoffeeWorld(default_scenario(7), seed=4)
    action = neutral_action(world)
    action.roast_targets = {"house": 100.0}

    world.step(action)
    job = world.roast_jobs[0]

    assert job.status == "complete"
    assert 80.0 <= job.roasted_output_kg <= 85.0
    balance = world.mass_balance()
    assert balance["green_error_kg"] == pytest.approx(0.0, abs=1e-7)
    assert balance["roasted_error_kg"] == pytest.approx(0.0, abs=1e-7)
    assert world.ledger.cash_reconciles()


def test_mass_and_cash_invariants_hold_across_episode() -> None:
    scenario = default_scenario(30)
    world = CoffeeWorld(scenario, seed=1337)
    policy = BaseStockPolicy(scenario)

    while not (world.terminated or world.truncated):
        _state, _reward, _terminated, _truncated, info = world.step(policy.act(world.snapshot()))
        assert info["ledger_reconciles"]
        assert info["mass_balance"]["green_error_kg"] == pytest.approx(0.0, abs=1e-6)
        assert info["mass_balance"]["roasted_error_kg"] == pytest.approx(0.0, abs=1e-6)
        assert world.inventory.quantity() >= 0


def test_recorded_trace_replays_to_the_same_final_state() -> None:
    scenario = default_scenario(12)
    world = CoffeeWorld(scenario, seed=77)
    policy = BaseStockPolicy(scenario)
    while not (world.terminated or world.truncated):
        world.step(policy.act(world.snapshot()))

    replayed = replay_trace(world.trace(), scenario)

    assert replayed["final"] == world.snapshot()
