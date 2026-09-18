from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class InventoryLot:
    lot_id: str
    category: str
    item_id: str
    quantity_kg: float
    unit_cost: float
    created_at: float
    expires_at: float
    quality: float = 1.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PurchaseOrder:
    order_id: str
    supplier_id: str
    quantity_kg: float
    unit_cost: float
    ordered_at: float
    due_at: float
    status: str = "in_transit"


@dataclass
class RoastJob:
    job_id: str
    sku: str
    green_input_kg: float
    green_cost: float
    submitted_at: float
    started_at: float | None = None
    completed_at: float | None = None
    roasted_output_kg: float = 0.0
    shrinkage: float = 0.0
    status: str = "queued"


@dataclass
class Backorder:
    order_id: str
    sku: str
    quantity_kg: float
    unit_price: float
    created_at: float


@dataclass
class WorldAction:
    green_orders: dict[str, float] = field(default_factory=dict)
    roast_targets: dict[str, float] = field(default_factory=dict)
    prices: dict[str, float] = field(default_factory=dict)
    # Weekly master-schedule inputs. The engine expands these into daily work.
    weekly_green_orders: dict[str, float] = field(default_factory=dict)
    weekly_roast_targets: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: dict[str, Any] | None) -> "WorldAction":
        value = value or {}
        return cls(
            green_orders={str(k): float(v) for k, v in value.get("green_orders", {}).items()},
            roast_targets={str(k): float(v) for k, v in value.get("roast_targets", {}).items()},
            prices={str(k): float(v) for k, v in value.get("prices", {}).items()},
            weekly_green_orders={str(k): float(v) for k, v in value.get("weekly_green_orders", {}).items()},
            weekly_roast_targets={str(k): float(v) for k, v in value.get("weekly_roast_targets", {}).items()},
        )
