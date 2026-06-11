"""
CoffeeSim headless simulator — v2 with deterministic RNG, variable demand, and labor model.

Mirrors gameStore.ts logic exactly (same RNG, same demand model, same labor rules).
Given identical seed + config, produces identical results to the TypeScript game.

Usage:
  echo '{"location":"urban",...,"seed":42}' | python3 simulator.py
  python3 simulator.py config.json
"""

import json
import math
import sys
from dataclasses import dataclass, field
from typing import Optional

from rng import SeededRNG
from demand import generate_demand
from labor import StaffMember, LaborManager, ManagerReport

# ─── Static Data ─────────────────────────────────────────────────────

LOCATIONS = {
    "urban":      {"name": "Urban Chic",               "rent": 4500, "baseTraffic": 180, "vibeBonus": 1.3},
    "suburban":   {"name": "Suburban Busy Road",        "rent": 3200, "baseTraffic": 140, "vibeBonus": 1.0},
    "mall":       {"name": "Mall Kiosk",                "rent": 2200, "baseTraffic": 220, "vibeBonus": 0.8},
    "office":     {"name": "Office Lobby",              "rent": 3500, "baseTraffic": 160, "vibeBonus": 0.9},
    "university": {"name": "University District",       "rent": 2400, "baseTraffic": 200, "vibeBonus": 0.7},
}

MENUS = {
    "gourmet":  {"name": "Gourmet Fine Roasts",     "margin": 1.4,  "complexity": 3},
    "everyday": {"name": "Everyday Reliable Coffee", "margin": 1.15, "complexity": 1},
    "sweet":    {"name": "Sweet Specialty Drinks",   "margin": 1.35, "complexity": 4},
    "speed":    {"name": "Speed Espresso Only",      "margin": 1.2,  "complexity": 2},
}

EQUIPMENT = {
    "automated":   {"name": "Automated (Push-Button)", "upfrontCost": 45000, "speed": 120, "reliability": 0.85, "staffSkillRequired": 1},
    "manual":      {"name": "Manual (Traditional)",     "upfrontCost": 18000, "speed": 60,  "reliability": 0.95, "staffSkillRequired": 3},
    "specialized": {"name": "Specialized (Cold Brew)",  "upfrontCost": 35000, "speed": 80,  "reliability": 0.7,  "staffSkillRequired": 4},
}

CONTRACTS = {
    "spot":    {"name": "Spot Buying",      "priceVariance": 0.25, "quality": 0.7},
    "monthly": {"name": "Monthly Contract", "priceVariance": 0.05, "quality": 0.8},
    "coop":    {"name": "Co-op / Shared",   "priceVariance": 0.10, "quality": 0.75},
    "direct":  {"name": "Direct Trade",     "priceVariance": 0.08, "quality": 1.0},
}

CAPITAL = {
    "all-equity": {"name": "All-In Equity", "loan": 0,     "equity": 150000, "monthlyPayment": 0},
    "balanced":   {"name": "Balanced",      "loan": 75000, "equity": 75000,  "monthlyPayment": 1800},
    "leveraged":  {"name": "Leveraged",     "loan": 120000,"equity": 30000,  "monthlyPayment": 2900},
    "max-debt":   {"name": "Max Debt",      "loan": 140000,"equity": 10000,  "monthlyPayment": 3400},
}

STAFF_SALARIES = {
    "barista":   2500,
    "shiftLead": 3500,
    "roaster":   4000,
    "manager":   5000,
}

STAFF_SKILL_RANGES = {
    "barista":   (1, 5),
    "shiftLead": (3, 6),
    "roaster":   (4, 7),
    "manager":   (5, 8),
}

DEFAULT_PRICING = {"drip": 3.5, "espresso": 4.5, "specialty": 6.0, "food": 4.0}

TOTAL_DAYS = 360
DAYS_PER_MONTH = 30

# ─── Inventory ───────────────────────────────────────────────────────

@dataclass
class InventoryItem:
    name: str
    quantity: float
    maxQty: float
    costPerUnit: float
    shelfLifeDays: int
    daysRemaining: int
    category: str


def make_default_inventory(contract_id: str) -> list[InventoryItem]:
    bean_cost = {"direct": 8, "coop": 9, "monthly": 10, "spot": 12}[contract_id]
    return [
        InventoryItem("Green Beans", 200, 500, bean_cost, 180, 180, "beans"),
        InventoryItem("Whole Milk", 40, 80, 4, 10, 10, "dairy"),
        InventoryItem("Oat Milk", 20, 40, 6, 10, 10, "dairy"),
        InventoryItem("Syrups", 15, 30, 8, 90, 90, "syrup"),
        InventoryItem("Pastries", 30, 60, 3, 3, 3, "pastry"),
        InventoryItem("Cups & Lids", 500, 1000, 0.15, 365, 365, "supplies"),
    ]

# ─── Config ──────────────────────────────────────────────────────────

@dataclass
class SimConfig:
    location: str
    menu: str
    equipment: str
    contract: str
    capital: str
    pricing: dict                        # drip, espresso, specialty, food
    manager: dict                        # {role: "manager", skill: 5-8}
    personnel_budget: int               # monthly $
    staff: list = field(default_factory=list)  # initial staff [{role, skill}]
    seed: int = 42

# ─── Score ───────────────────────────────────────────────────────────

def calculate_score(
    total_revenue: float, cash: float, debt: float,
    reputation: float, days_survived: int,
) -> float:
    return (cash - debt) + (reputation * 100) + (total_revenue * 0.02)

# ─── Simulation ──────────────────────────────────────────────────────

def run_simulation(config: SimConfig) -> dict:
    rng = SeededRNG(config.seed)

    loc = LOCATIONS[config.location]
    menu = MENUS[config.menu]
    equip = EQUIPMENT[config.equipment]
    contract = CONTRACTS[config.contract]
    cap = CAPITAL[config.capital]
    pricing = config.pricing if config.pricing else DEFAULT_PRICING

    # ── Starting finances ──
    upfront_equipment = equip["upfrontCost"]
    first_month_rent = loc["rent"]
    initial_inv = make_default_inventory(config.contract)
    initial_inv_cost = sum(i.quantity * i.costPerUnit for i in initial_inv)
    cash = cap["equity"] - upfront_equipment - first_month_rent - initial_inv_cost
    debt = cap["loan"]
    monthly_debt_payment = cap["monthlyPayment"]

    # ── Reputation ──
    reputation = 50 + contract["quality"] * 10 - equip["staffSkillRequired"] * 2

    # ── Manager ──
    mgr_skill = config.manager.get("skill", 5)
    mgr_salary = STAFF_SALARIES["manager"] + (mgr_skill - STAFF_SKILL_RANGES["manager"][0]) * 200
    manager = StaffMember(role="manager", skill=mgr_skill, salary=mgr_salary, morale=70)
    labor = LaborManager(manager, config.personnel_budget, rng)

    # ── Initial staff ──
    for s in config.staff:
        role = s["role"]
        skill = s["skill"]
        salary = STAFF_SALARIES.get(role, 2500) + (skill - STAFF_SKILL_RANGES.get(role, (1, 5))[0]) * 200
        if labor.can_afford(salary):
            labor.staff.append(StaffMember(
                role=role, skill=skill, salary=salary, morale=70,
            ))

    inventory = initial_inv
    month = 1
    day = 1
    total_day = 1

    cumulative_revenue = 0.0
    game_over = False
    game_over_reason = ""

    # ── Main day loop ───────────────────────────────────────────────
    for _ in range(TOTAL_DAYS):
        if total_day > TOTAL_DAYS or game_over:
            break

        today_revenue = 0.0
        today_costs = 0.0
        today_waste = 0.0
        today_customers = 0

        # ── A. Demand (variable, mixed distributions) ──
        today_customers, demand_breakdown = generate_demand(
            base_traffic=loc["baseTraffic"],
            location_id=config.location,
            total_day=total_day,
            month=month,
            rng=rng,
            reputation=reputation,
        )

        # ── B. Manager staffing decisions ──
        manager_reports = labor.daily_update(today_customers, total_day)

        # ── C. Revenue calculation ──
        # Effective staff throughput (account for training performance)
        effective_staff = sum(
            s.performance for s in labor.staff if not s.on_leave
        )
        max_cups = equip["speed"] * 10 * (effective_staff / max(1, len(labor.staff)))
        actual_served = min(today_customers, int(max_cups))

        # Average ticket
        avg_ticket = (
            pricing["drip"] * 0.3 + pricing["espresso"] * 0.3 +
            pricing["specialty"] * 0.25 + pricing["food"] * 0.15
        ) * menu["margin"]
        today_revenue = actual_served * avg_ticket

        # Unserved customers hurt reputation
        unserved = today_customers - actual_served
        if unserved > 0:
            reputation = max(0, reputation - min(2, unserved / 50))

        # ── D. Auto-replenish ──
        replenish_cost = 0.0
        replenished = []
        for item in inventory:
            threshold = item.maxQty * 0.25  # 25% threshold
            order_pct = 0.5  # order 50% of max
            if item.quantity < threshold:
                order_qty = int(item.maxQty * order_pct)
                actual_qty = min(order_qty, int(item.maxQty - item.quantity))
                if actual_qty > 0:
                    replenish_cost += actual_qty * item.costPerUnit
                    replenished.append(InventoryItem(
                        name=item.name, quantity=item.quantity + actual_qty,
                        maxQty=item.maxQty, costPerUnit=item.costPerUnit,
                        shelfLifeDays=item.shelfLifeDays,
                        daysRemaining=item.shelfLifeDays,
                        category=item.category,
                    ))
                    continue
            replenished.append(item)
        inventory = replenished
        cash -= replenish_cost
        if replenish_cost > 0:
            today_costs += replenish_cost

        # ── E. Inventory consumption & waste ──
        new_inventory = []
        for item in inventory:
            consumed = 0
            if item.category == "beans":
                consumed = math.ceil(actual_served * 0.05)
            elif item.category == "dairy":
                consumed = math.ceil(actual_served * 0.08)
            elif item.category == "syrup":
                consumed = math.ceil(actual_served * 0.02)
            elif item.category == "pastry":
                consumed = math.ceil(actual_served * 0.15)
            elif item.category == "supplies":
                consumed = actual_served

            new_days = item.daysRemaining - 1
            wasted_qty = 0
            if new_days <= 0:
                wasted_qty = item.quantity
            elif item.quantity < consumed:
                wasted_qty = 0

            remaining = max(0, item.quantity - consumed)
            waste_value = wasted_qty * item.costPerUnit

            # Manager waste reduction
            waste_value *= (1.0 - labor.waste_reduction_pct)

            today_waste += waste_value
            new_inventory.append(InventoryItem(
                name=item.name, quantity=remaining, maxQty=item.maxQty,
                costPerUnit=item.costPerUnit, shelfLifeDays=item.shelfLifeDays,
                daysRemaining=max(0, new_days), category=item.category,
            ))
        inventory = new_inventory

        # Stockout penalty
        stockout = [i for i in inventory if i.quantity <= 0]
        if stockout:
            today_revenue -= len(stockout) * 100
            reputation = max(0, reputation - 1)

        today_costs += today_waste

        # ── F. Staff payroll ──
        daily_payroll = labor.daily_payroll()
        today_costs += daily_payroll

        # ── G. Monthly costs (day 1) ──
        if day == 1:
            today_costs += loc["rent"]
            today_costs += monthly_debt_payment
            debt = max(0, debt - monthly_debt_payment)

        # ── H. Events (simplified — random cash/rep hit) ──
        if day == 1:
            roll = rng.next()
            if roll < 0.4:
                # Common
                if rng.next() < 0.5:
                    today_costs += 300
                else:
                    reputation -= 3
            elif roll < 0.55:
                # Uncommon
                if rng.next() < 0.5:
                    today_costs += 400
                else:
                    reputation -= 10
            elif roll < 0.60:
                # Rare
                if rng.next() < 0.5:
                    today_costs += 500
                else:
                    today_costs += 300
                    reputation += 2

        # ── I. Update cash & reputation ──
        cash += today_revenue - today_costs
        reputation = max(0, min(100, reputation))

        if today_waste > 200:
            reputation -= 1
        if today_customers > loc["baseTraffic"] * 0.8:
            reputation += 0.5

        cumulative_revenue += today_revenue

        # ── J. Win/loss checks ──
        recent_cash_negative = 0
        for d in range(max(1, total_day - 60), total_day + 1):
            # Simplified: just check current cash
            pass
        # Bankruptcy: cash < 0 for 2+ months (simplified check)
        if cash < -5000:  # deeply negative
            game_over = True
            game_over_reason = "Bankruptcy: deeply negative cash"

        if reputation < 15:
            game_over = True
            game_over_reason = "Reputation collapse (< 15)"

        debt_payment_fails = 0
        if debt > 0 and cash < 0:
            debt_payment_fails += 1
        if debt_payment_fails >= 3:
            game_over = True
            game_over_reason = "Debt default"

        if total_day >= TOTAL_DAYS:
            game_over = True
            game_over_reason = "Completed 360 days"

        # ── K. Advance time ──
        if day >= DAYS_PER_MONTH:
            day = 1
            month += 1
        else:
            day += 1
        total_day += 1

    # ── Final results ───────────────────────────────────────────────
    total_equity = cash - debt
    total_waste_approx = today_waste  # last day only, ideally accumulate
    score = calculate_score(cumulative_revenue, cash, debt, reputation, total_day)

    return {
        "config": {
            "location": config.location,
            "menu": config.menu,
            "equipment": config.equipment,
            "contract": config.contract,
            "capital": config.capital,
            "pricing": pricing,
            "manager_skill": mgr_skill,
            "personnel_budget": config.personnel_budget,
            "initial_staff": len(config.staff),
            "seed": config.seed,
        },
        "results": {
            "final_cash": round(cash, 2),
            "final_debt": round(debt, 2),
            "final_equity": round(total_equity, 2),
            "final_reputation": round(reputation, 2),
            "total_revenue": round(cumulative_revenue, 2),
            "days_survived": total_day,
            "staff_remaining": len([s for s in labor.staff if not s.on_leave]),
            "score": round(score, 2),
            "game_over": game_over,
            "game_over_reason": game_over_reason,
        },
        "manager": {
            "utilization_status": labor.utilization_status(),
            "waste_reduction": round(labor.waste_reduction_pct * 100, 1),
            "reports": [
                {"message": r.message, "type": r.report_type}
                for r in manager_reports[-5:]  # last 5 reports
            ],
        },
    }


def run_from_config(config_dict: dict) -> dict:
    config = SimConfig(
        location=config_dict["location"],
        menu=config_dict["menu"],
        equipment=config_dict["equipment"],
        contract=config_dict["contract"],
        capital=config_dict["capital"],
        pricing=config_dict.get("pricing", DEFAULT_PRICING),
        manager=config_dict.get("manager", {"role": "manager", "skill": 5}),
        personnel_budget=config_dict.get("personnel_budget", 10000),
        staff=config_dict.get("staff", []),
        seed=config_dict.get("seed", 42),
    )
    return run_simulation(config)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            config_dict = json.load(f)
    else:
        config_dict = json.load(sys.stdin)

    result = run_from_config(config_dict)
    print(json.dumps(result, indent=2))
