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
    lot_size_kg: float = 5.0


@dataclass(frozen=True)
class BomComponent:
    raw_material_id: str
    fraction: float


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
    bom: tuple[BomComponent, ...] = field(default_factory=tuple)
    lot_size_kg: float = 5.0


@dataclass(frozen=True)
class Scenario:
    name: str = "Independent Roastery"
    horizon_days: int = 90
    starting_cash: float = 50_000.0
    credit_limit: float = 25_000.0
    starting_green_kg: float = 420.0
    procurement_coverage_days: float = 14.0
    finished_goods_coverage_days: float = 3.0
    starting_roasted_kg_per_sku: float = 25.0
    green_capacity_kg: float = 2_500.0
    roasted_capacity_kg: float = 900.0
    roaster_capacity_kg_per_day: float = 240.0
    packaging_capacity_kg_per_day: float = 360.0
    roast_setup_hours: float = 1.0
    daily_fixed_cost: float = 380.0
    daily_labor_cost: float = 620.0
    regular_workers: int = 4
    maximum_workers: int = 12
    shifts: int = 1
    minimum_workers_per_shift: int = 3
    temporary_workers: int = 0
    temporary_labor_premium: float = 1.5
    labor_hourly_cost: float = 19.375
    labor_roles: tuple[tuple[str, int], ...] = (("roasting", 2), ("packaging", 1), ("quality", 1))
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
    demand_growth_rate_daily: float = 0.0015
    shrinkage_low: float = 0.15
    shrinkage_high: float = 0.20
    roast_breakdown_probability: float = 0.04
    repair_hours_low: float = 2.0
    repair_hours_high: float = 10.0
    suppliers: tuple[Supplier, ...] = field(default_factory=tuple)
    products: tuple[Product, ...] = field(default_factory=tuple)

    def validate(self) -> list[str]:
        errors: list[str] = []
        supplier_ids = {supplier.id for supplier in self.suppliers}
        if self.horizon_days < 1: errors.append("horizon_days must be positive")
        if self.procurement_coverage_days <= 0: errors.append("procurement_coverage_days must be positive")
        if self.finished_goods_coverage_days <= 0: errors.append("finished_goods_coverage_days must be positive")
        if self.regular_workers < 0 or self.maximum_workers < 1 or self.regular_workers > self.maximum_workers: errors.append("invalid regular worker count")
        if self.shifts < 1 or self.shifts > 3: errors.append("shifts must be between 1 and 3")
        if self.minimum_workers_per_shift < 1: errors.append("minimum_workers_per_shift must be positive")
        if self.temporary_workers < 0 or self.temporary_labor_premium < 1 or self.labor_hourly_cost <= 0: errors.append("invalid labor settings")
        if self.green_capacity_kg <= 0 or self.roasted_capacity_kg <= 0: errors.append("inventory capacities must be positive")
        if self.roaster_capacity_kg_per_day <= 0 or self.packaging_capacity_kg_per_day <= 0: errors.append("resource capacities must be positive")
        for product in self.products:
            if product.min_price < 0 or product.max_price < product.min_price: errors.append(f"invalid price bounds for {product.id}")
            if product.bom:
                total = sum(component.fraction for component in product.bom)
                if abs(total - 1.0) > 1e-6: errors.append(f"BOM for {product.id} must sum to 1.0")
                for component in product.bom:
                    if component.raw_material_id not in supplier_ids: errors.append(f"{product.id} references unknown raw material {component.raw_material_id}")
                    if component.fraction <= 0: errors.append(f"{product.id} has non-positive BOM fraction")
        return errors


def default_scenario(horizon_days: int = 90) -> Scenario:
    return Scenario(
        horizon_days=horizon_days,
        suppliers=(
            Supplier("colombia", "Colombia Cooperative", 7.10, 5.0, 1.2, 50.0, 600.0, 0.86, 0.90, 5.0),
            Supplier("ethiopia", "Ethiopia Direct Trade", 8.60, 8.0, 2.0, 35.0, 450.0, 0.94, 0.82, 5.0),
            Supplier("brazil", "Brazil Contract", 6.35, 3.0, 0.7, 75.0, 800.0, 0.78, 0.96, 5.0),
        ),
        products=(
            Product("house", "House Blend", 22.0, 15.0, 32.0, 31.0, 30.0, "medium", (BomComponent("brazil", 0.60), BomComponent("colombia", 0.40)), 5.0),
            Product("espresso", "Espresso", 25.0, 18.0, 36.0, 22.0, 35.0, "medium-dark", (BomComponent("brazil", 0.70), BomComponent("colombia", 0.30)), 5.0),
            Product("single_origin", "Single Origin", 31.0, 22.0, 44.0, 13.0, 24.0, "light", (BomComponent("ethiopia", 1.0),), 5.0),
        ),
    )
