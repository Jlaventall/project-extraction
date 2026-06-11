---
name: reputation-dynamics-and-kpi-targets
description: Implement reputation ceiling, bad review sinks with compounding decay, conditional recovery, and quarterly KPI target reviews with auto-adjusting thresholds and consequences
source: auto-skill
extracted_at: '2026-06-09T04:10:00.000Z'
---

## Problem this solves

Flat reputation systems feel artificial — reputation climbs forever with enough revenue and never recovers from bad stretches. Players need:
1. A ceiling (can't maintain perfect reputation easily)
2. Consequences for bad days (compound into negative reviews)
3. Recovery that requires sustained good management, not one-off good days
4. Manager accountability via KPI targets with real consequences

## Reputation dynamics

### Ceiling
```ts
const repCap = 95;
newRep = Math.min(repCap, newRep);
```
Reputation caps at 95, not 100. Hard to maintain "near-perfect."

### Bad review sinks (compounding)

A "bad review day" is any day with `todayCustomers > 0 && actualServed === 0` — customers showed up but the shop served nobody (empty shop, total stockout, no cash).

```ts
const isBadReviewDay = todayCustomers > 0 && actualServed === 0;
const recentBadDays = isBadReviewDay
  ? Math.min(7, prevBadDays + 1)     // increments, capped at 7
  : Math.max(0, prevBadDays - 0.1);  // decays slowly

if (recentBadDays >= 2) {
  newRep = Math.max(0, newRep - 2); // compounding -2 per day
}
```

**Why it works**: single bad day = no penalty (forgivable). Two+ consecutive bad days = reputation sinks at -2/day. Players must actively fix the problem to stop the bleed.

### Recovery (conditional, slow)

```ts
// 30-day trailing averages
const trailingRev = [...dailyRecords.slice(-29).map(r => r.revenue), todayRevenue];
const trailingWaste = [...dailyRecords.slice(-29).map(r => r.waste), todayWaste];
const recentAvgRevenue = trailingRev.reduce((a,b) => a+b, 0) / trailingRev.length;
const recentAvgWaste = trailingWaste.reduce((a,b) => a+b, 0) / trailingWaste.length;

// Recovery: well-run, no bad reviews, below 80 rep
if (!manualMode && recentAvgRevenue > 300 && recentAvgWaste < 100 
    && recentBadDays === 0 && newRep < 80) {
  newRep += 0.3;  // slow climb
}
```

**Conditions for recovery**:
- Manager must be active (no recovery in manual mode)
- 30d avg revenue > $300/day
- 30d avg waste < $100/day
- No active bad review streak
- Rep below 80 (recovery tapers off near ceiling)

## KPI target system for quarterly reviews

### Targets structure
```ts
kpiTargets: { revenueTarget: number; wasteTarget: number; moraleTarget: number }
```

Three targets measured at each quarterly review (days 90, 180, 270, 360):

| KPI | Pass condition | Default |
|---|---|---|
| Revenue/Day | `avgRev >= target` | $500 |
| Waste/Day | `avgWaste <= target` | $200 |
| Morale | `avgMorale >= target` | 60% |

### Scoring
```ts
const targetsMetCount = (revenueMet ? 1 : 0) + (wasteMet ? 1 : 0) + (moraleMet ? 1 : 0);
const score = targetsMetCount >= 3 ? 'exceeds' 
  : targetsMetCount >= 2 ? 'meets' 
  : 'misses';
```

### Consequences (applied immediately)

| Score | Rep delta | Morale delta | Effect |
|---|---|---|---|
| EXCEEDS (3/3) | +5 | +10% | All staff get morale boost, reputation jumps |
| MEETS (2/3) | +2 | +3% | Small morale bump, slight rep increase |
| MISSES (0-1/3) | -3 | -8% | Staff morale drops, reputation sinks, specific gaps shown |

Applied to every staff member:
```ts
updatedStaff = updatedStaff.map(s => ({
  ...s, morale: Math.max(0, Math.min(100, s.morale + moraleDelta)),
}));
newRep += repDelta;  // reputation adjusted before final clamp
```

### Auto-adjusting targets for next period

Targets adjust based on whether they were met — creating a difficulty curve:

```ts
const nextRevTarget = revenueMet 
  ? Math.round(avgRev * 1.1)                    // +10% if met
  : Math.max(200, Math.round(avgRev * 0.8));    // -20% if missed (floor $200)

const nextWasteTarget = wasteMet 
  ? Math.round(avgWaste * 0.8)                  // -20% (tighter) if met
  : Math.round(avgWaste * 1.3);                 // +30% if missed

const nextMoraleTarget = moraleMet 
  ? Math.min(80, Math.round(avgM + 5))          // +5 if met (cap 80)
  : Math.max(40, Math.round(avgM - 10));        // -10 if missed (floor 40)
```

**Why**: meeting targets makes them harder (the bar rises). Missing them lowers the bar so the manager has a chance. This creates natural difficulty scaling and prevents the player from easily "gaming" easy targets.

### User-editable targets

The review modal shows next period's targets as editable number inputs. The player can override auto-generated targets before dismissing:

```tsx
<label>Revenue/Day: 
  <input type="number" value={kpiTargets.revenueTarget} step="50"
    onChange={(e) => setKpiTargets({...kpiTargets, revenueTarget: parseInt(e.target.value)})} />
</label>
```

### Review history (recallable)

All completed reviews are stored in `managerReviews[]` and accessible via a "📜 Review History" button:

```ts
managerReviews: ManagerReview[];  // appended on dismiss
managerReviewOpen: boolean;       // current review modal
pendingReview: ManagerReview | null;  // review waiting to be dismissed
showReviewHistory: boolean;       // toggle history panel
```

Each history entry shows: day, score, targets vs actuals, all consequences. Scrollable, dismissible.

## Reputation health display

Add a "Reputation Health" section to the manager report card showing:

```
Reputation Health
┌─────────────────────────────┐
│ 30d Avg Revenue    $485/day │  (green if >300, red if <)
│ 30d Avg Waste      $120/day │  (green if <100, red if >)
│ Bad Review Streak     —     │  (or "2.3 days ⚠" with pulse)
│ Rep Ceiling         95 max  │
│ No manager      No recovery │  (only in manual mode, red)
└─────────────────────────────┘
```

The bad review streak uses a pulsing animation when >= 2 days — visual urgency.

## What to watch out for

- **Bad review check must come AFTER revenue calculation** — can't check `todayRevenue === 0` because revenue might be zero for other reasons (e.g., zero customers due to reputation). Check `todayCustomers > 0 && actualServed === 0` instead.
- **Reputation delta from review applies BEFORE the final clamp** — order matters: consequences → review delta → rep cap → daily dynamics.
- **Trailing averages use last 30 records** — `dailyRecords.slice(-29)` gives 29 previous + today = 30 total.
- **Review fires only when manager is active** — `[90,180,270,360].includes(totalDay) && !manualMode`.
- **Target adjustments saved via `set({ kpiTargets: ... })`** inside advanceDay — the set call before the final state set ensures targets persist.
- **Review consequences modify `updatedStaff`** (morale) and `newRep` (reputation) — these are local variables that get committed in the final `set()` call, so no extra state update needed.
- **Don't let review targets go to zero** — use `Math.max(200, ...)` for revenue floor, `Math.max(40, ...)` for morale floor.
