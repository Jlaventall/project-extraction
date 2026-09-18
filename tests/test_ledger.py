from coffeesim.domain.ledger import Ledger


def test_cash_and_reward_ledgers_do_not_double_count_inventory_purchase() -> None:
    ledger = Ledger(1_000.0)
    ledger.post(0.0, "procurement", -200.0, reward=False)
    ledger.post(1.0, "sales", 300.0)
    ledger.post(1.0, "cogs", -120.0, cash=False)

    assert ledger.cash == 1_100.0
    assert ledger.reward_since(0) == 180.0
    assert ledger.cash_reconciles()

