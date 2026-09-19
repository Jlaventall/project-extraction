from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Supplier:
    id: str
    name: str
    unit_cost: float
    mean_lead_days: float
    lead_std_days: float
    minimum_order: float
    maximum_order: float
    quality: float
    reliability: float


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    base_price: float
    min_price: float
    max_price: float
    base_daily_demand_kg: float
    shelf_life_days: float
    roast_profile: str


@dataclass(frozen=True)
class Scenario:
    name: str = "Independent Roastery"
    horizon_days: int = 90
    starting_cash: float = 50_000.0
    credit_limit: float = 25_000.0
    starting_green_kg: float = 420.0
    starting_roasted_kg_per_sku: float = 25.0
    green_capacity_kg: float = 2_500.0
    roasted_capacity_kg: float = 900.0
    roaster_capacity_kg_per_day: float = 240.0
    packaging_capacity_kg_per_day: float = 360.0
    roast_setup_hours: float = 1.0
    daily_fixed_cost: float = 380.0
    daily_labor_cost: float = 620.0
    holding_cost_per_kg_day: float = 0.035
    backorder_penalty_per_kg_day: float = 4.0
    lost_sale_penalty_per_kg: float = 9.0
    maximum_backorder_days: float = 3.0
    energy_cost_per_green_kg: float = 0.55
    minimum_active_suppliers: int = 2
    supplier_concentration_limit: float = 0.65
    demand_spike_probability: float = 0.08
    demand_spike_low: float = 1.35
    demand_spike_high: float = 1.85
    shrinkage_low: float = 0.15
    shrinkage_high: float = 0.20
    roast_breakdown_probability: float = 0.04
    repair_hours_low: float = 2.0
    repair_hours_high: float = 10.0
    suppliers: tuple[Supplier, ...] = field(default_factory=tuple)
    products: tuple[Product, ...] = field(default_factory=tuple)


def default_scenario(horizon_days: int = 90) -> Scenario:
    return Scenario(
        horizon_days=horizon_days,
        suppliers=(
            Supplier("colombia", "Colombia Cooperative", 7.10, 5.0, 1.2, 50.0, 600.0, 0.86, 0.90),
            Supplier("ethiopia", "Ethiopia Direct Trade", 8.60, 8.0, 2.0, 35.0, 450.0, 0.94, 0.82),
            Supplier("brazil", "Brazil Contract", 6.35, 3.0, 0.7, 75.0, 800.0, 0.78, 0.96),
        ),
        products=(
            Product("house", "House Blend", 22.0, 15.0, 32.0, 31.0, 30.0, "medium"),
            Product("espresso", "Espresso", 25.0, 18.0, 36.0, 22.0, 35.0, "medium-dark"),
            Product("single_origin", "Single Origin", 31.0, 22.0, 44.0, 13.0, 24.0, "light"),
        ),
    )
