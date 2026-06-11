"""
Demand modeling — variable daily demand with mixed distributions.

Demand = base_traffic × rep_mult × dow_mod × seasonal × gaussian × shock

Distributions used:
  - Deterministic: day-of-week pattern, seasonal pattern (per location)
  - Gaussian:    daily noise N(1.0, σ=0.12), clamped [0.5, 1.5]
  - Uniform:     weather, competitor shocks
  - Pareto:      rare large shocks (power-law fat tail, α=2.5)
"""

from typing import Tuple, Dict

# Day-of-week modifiers (Mon=0 … Sun=6) per location
DOW_MODIFIERS: Dict[str, list[float]] = {
    "urban":      [1.0,  1.0,  1.0,  1.0,  1.0,  0.7,  0.5],
    "suburban":   [0.9,  0.9,  0.9,  0.9,  1.0,  1.2,  1.1],
    "mall":       [0.7,  0.7,  0.7,  0.8,  1.0,  1.4,  1.3],
    "office":     [1.0,  1.0,  1.0,  1.0,  1.0,  0.1,  0.05],
    "university": [1.0,  1.0,  1.0,  1.0,  1.0,  0.6,  0.4],
}

# Seasonal modifiers (Jan=0 … Dec=11) per location
SEASONAL_MODIFIERS: Dict[str, list[float]] = {
    "urban":      [0.9,  0.9,  0.95, 1.0,  1.0,  1.0,  0.9,  0.9,  1.0,  1.0,  1.0,  1.1],
    "suburban":   [0.95, 0.95, 1.0,  1.0,  1.0,  0.95, 0.9,  0.9,  1.05, 1.0,  1.0,  1.05],
    "mall":       [1.1,  1.0,  0.9,  0.9,  0.9,  0.95, 1.0,  1.0,  0.95, 1.0,  1.1,  1.3],
    "office":     [0.9,  0.95, 1.0,  1.0,  1.0,  0.95, 0.9,  0.85, 1.0,  1.0,  1.0,  0.8],
    "university": [0.7,  0.7,  1.0,  1.0,  1.0,  0.5,  0.3,  0.3,  1.0,  1.0,  1.0,  0.6],
}

# Shock definitions: (name, probability, distribution, (low, high))
# At most one shock fires per day (first match wins, checked in order).
SHOCKS = [
    # name            prob   dist      params (low, high)  — additive to 1.0
    ("weather_bad",   0.08,  "uniform", (-0.30, -0.05)),   # rain, cold
    ("weather_good",  0.06,  "uniform", ( 0.05,  0.25)),   # nice day
    ("local_event",   0.03,  "pareto",  ( 0.10,  0.80)),   # festival, game
    ("construction",  0.015, "fixed",   (-0.35, -0.35)),   # road work
    ("competitor",    0.02,  "uniform", (-0.20, -0.05)),   # competitor promo
    ("viral_post",    0.01,  "pareto",  ( 0.15,  1.00)),   # social media
]


def generate_demand(
    base_traffic: float,
    location_id: str,
    total_day: int,
    month: int,
    rng,  # SeededRNG
    reputation: float,
) -> Tuple[int, Dict]:
    """
    Generate daily customer demand.

    Returns (customer_count, breakdown_dict) where breakdown explains each factor.
    """
    # 1. Reputation multiplier
    rep_mult = 0.5 + (reputation / 100.0) * 0.8

    # 2. Day-of-week modifier (day 1 = Monday)
    dow = (total_day - 1) % 7
    dow_mods = DOW_MODIFIERS.get(location_id, DOW_MODIFIERS["urban"])
    dow_mod = dow_mods[dow]

    # 3. Seasonal modifier
    season_mods = SEASONAL_MODIFIERS.get(location_id, SEASONAL_MODIFIERS["urban"])
    seasonal = season_mods[(month - 1) % 12]

    # 4. Gaussian daily noise σ=0.12, clamped [0.5, 1.5]
    gaussian = rng.next_gaussian(1.0, 0.12)
    gaussian = max(0.5, min(1.5, gaussian))

    # 5. Non-Gaussian shock (at most one per day)
    shock = 1.0
    shock_source = "none"
    for name, prob, dist, params in SHOCKS:
        if rng.next() < prob:
            low, high = params
            if dist == "uniform":
                shock = 1.0 + low + rng.next() * (high - low)
            elif dist == "pareto":
                alpha = 2.5
                raw = rng.paretovariate(alpha)  # ≥ 1
                # Normalize to roughly [0, 3], scale to [low, high]
                norm = min(3.0, (raw - 1.0) / (alpha / (alpha - 1) - 1.0))
                val = low + norm * (high - low)
                shock = 1.0 + max(low, min(high, val))
            elif dist == "fixed":
                shock = 1.0 + low
            shock_source = name
            break

    # 6. Combine all factors
    effective = base_traffic * rep_mult * dow_mod * seasonal * gaussian * shock
    customers = max(0, round(effective))

    breakdown = {
        "base_traffic": base_traffic,
        "rep_mult": round(rep_mult, 3),
        "dow": round(dow_mod, 2),
        "seasonal": round(seasonal, 2),
        "gaussian": round(gaussian, 3),
        "shock": round(shock, 3),
        "shock_source": shock_source,
        "effective_demand": round(effective, 1),
    }

    return customers, breakdown
