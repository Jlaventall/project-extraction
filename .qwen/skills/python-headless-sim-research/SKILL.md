---
name: python-headless-sim-research
description: Port a TypeScript game simulation to a headless Python simulator with HTTP research server for AI-driven config optimization — local-only, zero external deps, cross-language deterministic reproducibility
source: auto-skill
extracted_at: '2026-06-09T03:10:00.000Z'
---

## When to use

When you need an AI agent or automated search to explore configuration space for a game/simulation that currently only runs in a browser (React + Zustand/Redux), and you want it to run locally without Docker, Ollama, or external LLM APIs.

## Architecture

```
Browser UI (React)          Python Backend
┌──────────────┐            ┌──────────────────┐
│ SetupScreen  │──POST─────▶│ server.py        │
│ Dashboard    │◀──poll────│  ├─ /api/research │
│              │            │  ├─ /api/results  │
└──────────────┘            │  └─ /api/health   │
                            │                  │
                            │ simulator.py     │
                            │  (game engine)   │
                            └──────────────────┘
```

## Critical: Cross-language reproducibility with shared SeededRNG

The #1 problem with headless sim research is: **autoresearch finds configs that don't reproduce in the browser**. This happens when Python's `random` and JS's `Math.random()` produce different sequences.

**Solution**: Implement the same MINSTD LCG in both languages:

```
s = (48271 × s) mod (2^31 - 1)
output = s / (2^31 - 1)    → uniform in (0, 1)
```

**Python** (`rng.py`):
```python
class SeededRNG:
    A = 48271
    M = 2147483647  # 2^31 - 1
    def __init__(self, seed: int = 42):
        self.seed = abs(seed) % (self.M - 1) + 1  # [1, M-1], 0 forbidden
    def next(self) -> float:
        self.seed = (self.A * self.seed) % self.M
        return self.seed / self.M
    def next_gaussian(self, mu=0, sigma=1):  # Box-Muller
        u1 = max(self.next(), 1e-10)
        u2 = self.next()
        z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return z0 * sigma + mu
```

**TypeScript** (`rng.ts`):
```ts
export class SeededRNG {
  private static A = 48271, M = 2147483647;
  constructor(private seed: number) {
    this.seed = Math.abs(seed) % (SeededRNG.M - 1) + 1;
  }
  next(): number {
    this.seed = (SeededRNG.A * this.seed) % SeededRNG.M;
    return this.seed / SeededRNG.M;
  }
  nextGaussian(mu = 0, sigma = 1): number {
    const u1 = Math.max(this.next(), 1e-10), u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * sigma + mu;
  }
}
```

**Verified identical**: Both produce `0.0009665512, 0.6563953132, 0.8581620286, ...` for seed 42.

### Seeding strategy
- Use `seed + totalDay` as the daily seed in `advanceDay()` — deterministic per day, but each day gets fresh randomness
- The user picks a seed at game start; autoresearch uses `base_seed + iteration` for each experiment

## Step 1: Port game logic to Python (`simulator.py`)

- Mirror every formula from the TS store exactly (same constants, same order of operations)
- Use `dataclass` for state objects — makes serialization trivial
- Accept config as JSON (stdin or CLI arg), output results as JSON (stdout)
- Use `SeededRNG` (not stdlib `random`) — ensures deterministic, reproducible runs that match the browser

### Key parity checks

| TS pattern | Python equivalent |
|---|---|
| `Math.ceil(x)` | `math.ceil(x)` |
| `Math.round(x)` | `round(x)` |
| `Math.max(0, x)` | `max(0, x)` |
| `array.map()` + spread | list comprehension with dataclass copy |
| `set({ ... })` (Zustand) | reassign local variables in loop, return final dict |

### Realistic demand model (not flat baseTraffic)

Replace constant `baseTraffic` with a day-by-day variable demand function:

```
demand = baseTraffic × rep_mult × dow_mod × seasonal × gaussian × shock
```

- **Gaussian** N(1.0, σ=0.12): daily noise, clamped [0.5, 1.5] — via Box-Muller
- **Day-of-week**: per-location modifiers (mall weekends +40%, office weekends -95%)
- **Seasonal**: per-location 12-month modifiers (university summer -70%, mall December +30%)
- **Pareto** (α=2.5): rare fat-tailed positive shocks (festivals, viral posts)
- **Uniform**: weather effects (-30% to +25%), competitor promos

At most one shock fires per day (first match wins, checked in probability order).

### Realistic labor model (not flat salary deduction)

Replace flat `salary / 22` deduction with manager-driven staffing:

- **Manager** hired at setup (skill 5-8) — reduces waste by `skill × 2%` (cap 15%)
- **Personnel budget** ($5K-$20K/mo) — manager auto-hires when utilization > 45 cust/staff within budget
- **Training**: new hires start at 50% performance, ramp over 3 days: `0.5 + (3 - remainingDays) × 0.167`
- **Morale**: overutilization (>45) → stress/performance drop (-2 morale, -0.015 perf), underutilization (<10) → boredom (-0.3 morale), morale < 20 → 5% turnover chance
- **Manual mode**: if manager fired, all auto-management stops, wages become user-editable, waste reduction = 0
- **Per-staff wages**: user can set individual salaries in manual mode, validated against personnel budget

### KPI targets and quarterly reviews

Every 90 days (90, 180, 270, 360), compute KPIs and measure against targets:

```python
# Targets: revenue >= target, waste <= target, morale >= target
targets_met = sum([rev_met, waste_met, morale_met])
score = 'exceeds' if targets_met >= 3 else 'meets' if targets_met >= 2 else 'misses'

# Consequences:
if score == 'exceeds': rep_delta, morale_delta = +5, +10
elif score == 'meets':   rep_delta, morale_delta = +2, +3
else:                    rep_delta, morale_delta = -3, -8
```

Auto-adjust targets for next period: meeting targets makes them harder (+10% rev, -20% waste, +5 morale), missing makes them easier. This creates natural difficulty scaling.

### Reputation dynamics

- **Ceiling at 95** — perfect reputation unattainable
- **Bad review sink**: days with customers served but $0 revenue compound into -2 rep/day after 2+ consecutive bad days
- **Recovery**: well-run shop (30d avg rev > $300, waste < $100, no bad streaks, rep < 80, manager active) → +0.3 rep/day slow climb
- **No manager = no recovery** — manual mode blocks the recovery boost
- Track `recentBadDays` as a decaying counter: increments on bad days, decays by 0.1 on good days

## Step 2: Build HTTP research server (`server.py`)

Use Python stdlib only — `http.server.BaseHTTPRequestHandler` + `threading`:

```python
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

def run_search(job_id, partial_config, iterations):
    """Fill missing keys from partial_config randomly, run simulator, track best."""
    # ... update a shared dict under threading.Lock

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # POST /api/research → spawn thread, return job_id
    def do_GET(self):
        # GET /api/research/{job_id} → poll status
```

- **Partial config support**: user locks some keys (their choices), server fills the rest randomly
- **Incremental updates**: poll endpoint returns progress + current best config
- **Results log**: append each run to `results.tsv` for historical tracking
- **CORS headers**: `Access-Control-Allow-Origin: *` so the Vite dev server can call it

## Step 3: UI integration

Add a button visible at every step of a multi-step wizard:

```tsx
// Send whatever the user has chosen so far
const partial = {};
if (locationId) partial.location = locationId;
// ... send to /api/research
```

- Poll every 500ms for results
- Show progress bar + "best so far" score while running
- On complete: modal with best config, "Apply & Review" button fills remaining form fields
- During gameplay: same pattern but only searches pricing/replenish params (keeps setup fixed)

## Step 4: Agent instructions (`program.md`)

Document the game mechanics, score formula, strategy hints, and failure modes. This serves as the prompt if you later want to plug in an LLM agent. Include:

- **How this works** (local-only, no Docker/Ollama)
- **Score formula** (what's being optimized)
- **Control dimensions** (what the agent can change, valid values)
- **Key mechanics** (demand model, throughput caps, reputation multipliers)
- **Research loop** (read results → hypothesize → run → parse → iterate)
- **Failure modes** (bankruptcy, reputation collapse, debt default)

## What NOT to do

- Don't use Docker/Ollama/external APIs for the core sim — the Python simulator should run standalone
- Don't use numpy/pandas/etc. — stdlib only keeps deps at zero and startup instant
- Don't skip the seed — deterministic runs are essential for comparing config deltas
- Don't forget auto-actions (replenish) in the Python sim — otherwise configs that rely on them will fail in the browser but pass in the sim
- Don't use `Math.random()` / `random.random()` — always use the shared SeededRNG for any randomness that affects gameplay outcomes