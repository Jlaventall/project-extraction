from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class LedgerEntry:
    time: float
    category: str
    amount: float
    cash_effect: bool
    reward_effect: bool
    memo: str = ""


class Ledger:
    def __init__(self, starting_cash: float) -> None:
        self.starting_cash = float(starting_cash)
        self.cash = float(starting_cash)
        self.entries: list[LedgerEntry] = []

    def post(
        self,
        time: float,
        category: str,
        amount: float,
        *,
        cash: bool = True,
        reward: bool = True,
        memo: str = "",
    ) -> None:
        amount = float(amount)
        self.entries.append(LedgerEntry(float(time), category, amount, cash, reward, memo))
        if cash:
            self.cash += amount

    def reward_since(self, index: int) -> float:
        return sum(entry.amount for entry in self.entries[index:] if entry.reward_effect)

    def cash_reconciles(self, tolerance: float = 1e-6) -> bool:
        expected = self.starting_cash + sum(
            entry.amount for entry in self.entries if entry.cash_effect
        )
        return abs(expected - self.cash) <= tolerance

    def totals(self) -> dict[str, float]:
        totals: dict[str, float] = {}
        for entry in self.entries:
            totals[entry.category] = totals.get(entry.category, 0.0) + entry.amount
        return {key: round(value, 2) for key, value in totals.items()}

    def snapshot(self, limit: int = 100) -> list[dict]:
        return [asdict(entry) for entry in self.entries[-limit:]]

