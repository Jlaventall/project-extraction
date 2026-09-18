from __future__ import annotations

from collections.abc import Iterable

from .models import InventoryLot


class LotInventory:
    """Lot-level inventory with first-expiry-first-out consumption."""

    def __init__(self) -> None:
        self._lots: list[InventoryLot] = []

    @property
    def lots(self) -> tuple[InventoryLot, ...]:
        return tuple(self._lots)

    def add(self, lot: InventoryLot) -> None:
        if lot.quantity_kg <= 0:
            return
        self._lots.append(lot)

    def extend(self, lots: Iterable[InventoryLot]) -> None:
        for lot in lots:
            self.add(lot)

    def quantity(self, category: str | None = None, item_id: str | None = None) -> float:
        return sum(
            lot.quantity_kg
            for lot in self._lots
            if (category is None or lot.category == category)
            and (item_id is None or lot.item_id == item_id)
        )

    def value(self, category: str | None = None, item_id: str | None = None) -> float:
        return sum(
            lot.quantity_kg * lot.unit_cost
            for lot in self._lots
            if (category is None or lot.category == category)
            and (item_id is None or lot.item_id == item_id)
        )

    def consume(
        self,
        category: str,
        quantity_kg: float,
        item_id: str | None = None,
    ) -> tuple[float, float, float]:
        """Return (quantity, cost, quantity-weighted quality) consumed."""
        remaining = max(0.0, float(quantity_kg))
        taken = 0.0
        cost = 0.0
        quality_total = 0.0
        candidates = sorted(
            (
                lot
                for lot in self._lots
                if lot.category == category and (item_id is None or lot.item_id == item_id)
            ),
            key=lambda lot: (lot.expires_at, lot.created_at, lot.lot_id),
        )
        for lot in candidates:
            if remaining <= 1e-9:
                break
            amount = min(lot.quantity_kg, remaining)
            lot.quantity_kg -= amount
            remaining -= amount
            taken += amount
            cost += amount * lot.unit_cost
            quality_total += amount * lot.quality
        self._lots = [lot for lot in self._lots if lot.quantity_kg > 1e-9]
        quality = quality_total / taken if taken else 0.0
        return taken, cost, quality

    def expire(self, now: float) -> list[InventoryLot]:
        expired: list[InventoryLot] = []
        kept: list[InventoryLot] = []
        for lot in self._lots:
            if lot.expires_at <= now + 1e-9:
                expired.append(lot)
            else:
                kept.append(lot)
        self._lots = kept
        return expired

    def age_buckets(
        self,
        item_id: str,
        now: float,
        boundaries: tuple[float, ...] = (3.0, 10.0, 20.0),
    ) -> list[float]:
        buckets = [0.0] * (len(boundaries) + 1)
        for lot in self._lots:
            if lot.category != "roasted" or lot.item_id != item_id:
                continue
            age = max(0.0, now - lot.created_at)
            index = 0
            while index < len(boundaries) and age >= boundaries[index]:
                index += 1
            buckets[index] += lot.quantity_kg
        return buckets

    def snapshot(self, now: float) -> list[dict[str, float | str]]:
        return [
            {
                "lot_id": lot.lot_id,
                "category": lot.category,
                "item_id": lot.item_id,
                "quantity_kg": round(lot.quantity_kg, 3),
                "unit_cost": round(lot.unit_cost, 3),
                "quality": round(lot.quality, 3),
                "age_days": round(max(0.0, now - lot.created_at), 3),
                "days_remaining": round(max(0.0, lot.expires_at - now), 3),
            }
            for lot in sorted(self._lots, key=lambda item: (item.category, item.item_id, item.expires_at))
        ]

