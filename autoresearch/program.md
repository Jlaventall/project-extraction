# CoffeeSim Research Agent — Instructions

You are an autonomous research agent optimizing a coffee shop simulation. Your goal: **maximize the final score** across a 360-day (12-month) simulation.

## How This Works (Local-Only)

This is a **local Python simulation** — no Docker, no Ollama, no external LLM API needed.
- `simulator.py` is the game engine (mirrors the React app's gameStore.ts)
- `server.py` is a lightweight HTTP server that runs experiments and serves results
- `program.md` is these instructions — your reference for how the sim works

**To run**: `cd autoresearch && python3 server.py` (starts HTTP server on port 8765)
**To test a config**: `echo '{"location":"urban",...}' | python3 simulator.py`

## Score Formula

```
score = (cash - debt) + (reputation * 100) + (total_revenue * 0.02)
```

## What You Can Control

| Dimension | Options | Impact |
|---|---|---|
| **location** | urban, suburban, mall, office, university | Rent, traffic volume, vibe bonus |
| **menu** | gourmet, everyday, sweet, speed | Margin multiplier, complexity |
| **equipment** | automated, manual, specialized | Speed (cups/hr), reliability, upfront cost |
| **contract** | spot, monthly, coop, direct | Bean cost, quality (affects starting reputation) |
| **capital** | all-equity, balanced, leveraged, max-debt | Starting cash vs debt pressure |
| **pricing** | drip ($2-6), espresso ($3-7), specialty ($4-9), food ($2-6) | Revenue per customer |
| **staff** | 1-6 baristas, skill 1-5 | Daily salary cost, morale/turnover risk |

## Key Mechanics to Understand

1. **Throughput cap**: `min(effective_traffic, equipment_speed * 10)` — equipment speed limits max customers per day
2. **Reputation multiplier**: `0.5 + (rep/100) * 0.8` — low rep cuts traffic to ~50%, high rep boosts to ~130%
3. **Monthly costs on day 1**: rent + debt payment hit hard at month start
4. **Stockout penalty**: -$100 per empty category per day + -1 reputation
5. **Staff turnover**: morale < 20 → 5% chance to quit each day
6. **Events**: random events on day 1 of each month (40% common, 15% uncommon, 5% rare)
7. **Auto-replenish**: enabled by default — items restock when below threshold %, resetting shelf life. This costs cash each day but prevents stockouts and waste.

## Research Loop

1. **Read** `results.tsv` for past experiments (if it exists)
2. **Hypothesize** a config change (e.g., "higher traffic location + cheaper equipment")
3. **Run** the simulator directly: `echo 'CONFIG_JSON' | python3 simulator.py`
4. **Parse** the JSON output — look at `results.score` and `results.game_over_reason`
5. **Record** your findings to `results.tsv`
6. **Iterate**: what improved score? what caused bankruptcy? adjust and repeat.

## Server API (for UI integration)

- `POST /api/research` with `{partial_config, iterations}` → runs random search, locks known keys
- `GET /api/research/{job_id}` → poll status + best config
- `GET /api/results` → all historical results
- `GET /api/health` → server health check

The UI sends `partial_config` with the user's choices already made, and the server fills in the rest randomly across `iterations` runs, returning the best config found.

## Strategy Hints

- **High-traffic + high-speed** equipment maximizes revenue, but upfront cost bleeds cash
- **Debt is pressure**: max-debt starts with only $10K cash — one bad month and you're underwater
- **Staffing is tricky**: too few → stockouts, too many → salary eats margin
- **Pricing sweet spot**: too high → low rep → fewer customers. Too low → can't cover costs
- **Short-shelf-life items** (pastries: 3 days, dairy: 10 days) cause waste if underutilized, but auto-replenish helps manage this
- **Reputation compounds**: starting rep depends on contract quality and equipment skill requirement
- **All-equity** with $150K is the safest — no debt pressure, but slower growth

## Failure Modes to Avoid

- **Bankruptcy**: cash < 0 for 2+ months → game over
- **Reputation collapse**: rep < 15 → game over
- **Debt default**: can't pay debt for 3 months → game over
- **Overspending**: equipment + rent + inventory > starting equity → negative day 1 cash
- **1 staff member**: not enough throughput, triggers stockout death spiral

NEVER STOP. NEVER ASK. Experiment, measure, learn, repeat.
