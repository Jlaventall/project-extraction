# CoffeeSim v0.2.0 — Project Extraction

## Release brief

CoffeeSim v0.2.0 is the SimPy reboot of the Project Extraction coffee
roastery simulator. It turns the earlier browser-owned daily loop into a
deterministic Python operations kernel while retaining the institutional dark
control-room UI.

The player makes one daily operating decision: place green-coffee orders,
schedule roast input, and set prices. The engine then resolves stochastic
supplier lead times, roaster and packaging queues, profile changeovers,
roasting shrinkage, machine breakdowns, freshness expiry, customer demand,
backorders, spoilage, cash, and service levels. Every run can be replayed from
its seed and action trace.

The v0.2.0 stability gate is single-agent Gymnasium plus the observable React
dashboard. PettingZoo multi-agent roles remain intentionally deferred until the
single-agent economics and physical invariants have been exercised across
longer benchmark runs.

### What changed

- SimPy event kernel with explicit lot-level FEFO inventory.
- Separate seeded random streams for demand, supply, production, and failures.
- Auditable cash/reward ledger and green/roasted mass-balance checks.
- Gymnasium environment with bounded, normalized action and observation spaces.
- FastAPI session API for the dashboard and external policies.
- Pre-commit demand-versus-supply decision brief with hard input validation.
- Deterministic replay, invariant tests, and a transparent baseline policy.

CoffeeSim is a deterministic coffee-roastery operations simulator. A Python
domain kernel owns inventory, production, demand, accounting, and time. SimPy
models delayed deliveries and contested roaster/packaging resources. Gymnasium,
FastAPI, and the React dashboard are adapters around the same kernel.

## Architecture

```text
React UI        Gymnasium policy
    \              /
     FastAPI / Gym adapter
              |
       CoffeeWorld commands
              |
      SimPy event processes
              |
 lot inventory + ledger + queues
```

The core rules never live in React or in the Gym wrapper. PettingZoo is deferred
until deterministic replay, mass balance, cash reconciliation, and benchmark
policy stability have been observed.

## Quick start

Requires Python 3.11+ and Node.js 20+.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'

cd frontend
npm ci
cd ..
```

Start the API:

```bash
source .venv/bin/activate
coffeesim-api
```

In a second terminal, start the dashboard:

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173>. The API health endpoint is
<http://localhost:8000/api/health>.

## Verification

```bash
source .venv/bin/activate
pytest
python -m coffeesim.cli --days 90 --seed 42
python -m coffeesim.cli --benchmark --days 90 --seed 42 --output-dir benchmark-output
python -m pip install -e '.[multiagent]'  # optional PettingZoo adapter
python - <<'PY'
from gymnasium.utils.env_checker import check_env
from coffeesim.envs import CoffeeRoasteryEnv
check_env(CoffeeRoasteryEnv(), skip_render_check=True)
PY

cd frontend
npm run build
```

Save a trace from the API's `/api/games/{id}/trace` endpoint and replay it with:

```bash
coffeesim --replay run-trace.json --json
```

The benchmark command writes one complete JSON artifact per policy containing
actions, every daily record, all events, the full ledger, and the final state,
plus a compact comparison summary.

## Simulation contract

At each daily decision epoch the controller sets supplier orders, roast targets,
and prices. The engine then advances all SimPy events through the next boundary,
settles expiry and daily costs, and returns the next observation and economic
reward. Events exactly on the boundary are drained before the observation.

Inventory is stored as dated lots and consumed first-expiry-first-out. Green and
roasted mass balances and the cash ledger are exposed in every step's `info`
payload. A run is reproducible from its scenario, seed, and action trace.
