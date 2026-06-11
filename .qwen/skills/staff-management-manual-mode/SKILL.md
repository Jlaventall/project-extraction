---
name: staff-management-manual-mode
description: Implement per-staff wage control, promote/demote/hire/fire actions, manager-driven auto-labor with manual fallback, and quarterly KPI reviews
source: auto-skill
extracted_at: '2026-06-09T03:23:59.343Z'
---

## When to use

When a simulation game has a manager/labor system and you want to give the user granular control over staffing — including the ability to fire the manager and take over manually — plus periodic performance reviews with KPIs.

## Core concept: Manager-driven vs Manual mode

The simulation has two staffing modes, controlled by a single boolean `manualMode`:

| | Manager Active | Manual Mode |
|---|---|---|
| **Morale management** | Auto (utilization-based) | None — morale stays flat |
| **Auto-hiring** | When utilization > threshold, within budget | Disabled |
| **Wage setting** | Fixed by manager role/skill | User editable per-staff |
| **Waste reduction** | `min(15%, skill × 2%)` | Zero |
| **Turnover** | Morale < 20 → 5% chance | None |

**Firing the manager** sets `manualMode = true`. The user must manually hire a replacement to restore automation. A pulsing `⚠ Manual Mode` badge warns the player.

## State shape (Zustand)

```ts
// In GameState:
manager: StaffMember | null;
personnelBudget: number;   // monthly $ cap
manualMode: boolean;
managerReports: ManagerReport[];
managerReviews: ManagerReview[];
managerReviewOpen: boolean;
pendingReview: ManagerReview | null;
hiresMade: number;
staffQuit: number;
```

## Actions

### setStaffWage(id, wage)
- Validates against personnelBudget: `othersPayroll + wage ≤ budget`
- Only allowed in manual mode (or for manager role)
- Silent fail if budget exceeded

### promoteStaff(id)
- Role ladder: `barista → shiftLead → (no further)` and `roaster → (no promotion)`
- +1 skill (capped at new role's max), morale +10, 2-day training
- Blocks if role already exists on team

### demoteStaff(id)
- `manager → shiftLead`, `shiftLead → barista`, `roaster → barista`
- Skill capped to new role range, morale -20, 1-day training
- Wage recalculated from new role's base + skill

### hireStaff(role, skill, salary?)
- Hiring cost: `salary × 0.25` (1 week wage)
- Checks: cash ≥ cost, staff < 8, payroll + salary ≤ budget
- New hire starts at 50% performance, 3-day training ramp

### fireStaff(id)
- If firing manager → `manualMode = true`, `manager = null`
- All wages unlock for manual editing
- Auto-hiring and morale management stop immediately

### replaceManager(skill, salary)
- Removes old manager, hires new one
- Sets `manualMode = false`
- Hiring cost deducted from cash

## Quarterly Manager Review (every 90 days)

Triggered at `totalDay ∈ {90, 180, 270, 360}` in `advanceDay()`. Only fires when manager is active.

### KPI computation

```ts
const last90 = dailyRecords.slice(-90);
const avgRev = last90.reduce((s, r) => s + r.revenue, 0) / last90.length;
// Similarly: avgCust, avgWaste, avgMorale

// Trend detection (compare first half vs second half of period)
const half = Math.floor(last90.length / 2);
const recentCash = avg of last90.slice(-half).cash;
const earlierCash = avg of last90.slice(0, half).cash;
const cashTrend = recentCash > earlierCash + 1000 ? 'up'
  : recentCash < earlierCash - 1000 ? 'down' : 'stable';
```

### Review modal contents
- Business KPIs: avg revenue/day, customers/day, waste/day, staff count, avg morale, cash trend, rep trend, turnover count
- Manager stats: skill, salary, morale, waste reduction %, hires made, staff quit
- Actions: Dismiss, Demote to Shift Lead, Fire Manager → Manual Mode

### Implementation in advanceDay()

**Critical NaN fix**: Always guard against empty staff arrays. Read `get()` values once at the top of `advanceDay()` to avoid stale closure reads:

```ts
// At start of advanceDay, capture all state once:
const { staff, manualMode, ...rest } = get();
const activeStaff = staff.filter(s => !s.onLeave);
const activeCount = Math.max(1, activeStaff.length);  // NEVER 0 for division
const util = todayCustomers / activeCount;

// Revenue calculation: guard empty staff
const effectiveStaffCount = updatedStaff.filter(s => !s.onLeave).reduce((sum, s) => sum + s.performance, 0);
const staffCount = updatedStaff.length;
const throughputFactor = staffCount > 0 ? effectiveStaffCount / staffCount : 0;  // 0 if no staff
const maxCups = Math.round(equipment.speed * 10 * throughputFactor);

// Auto-hire guard: only when staff exists
if (util > MAX_UTIL && updatedStaff.length > 0) { ... }
```

**Common NaN sources**:
- `reduce` on empty array returns 0, then `/ 0` → `NaN`
- Division by `staff.length` when all staff were fired/quit
- Reading `get().manualMode` inside a closure that captured stale state

At end of advanceDay, after all calculations:
```ts
if ([90, 180, 270, 360].includes(totalDay) && !get().manualMode) {
  // Compute KPIs from dailyRecords...
  set({
    managerReviewOpen: true,
    pendingReview: { totalDay, kpis: {...}, manager: {...} },
    managerReports: [{ message: 'Quarterly review due', reportType: 'request' }, ...],
  });
}
```

## Training system

New hires (and promoted staff) enter training:

```ts
// Each day in advanceDay:
updatedStaff = updatedStaff.map(s => {
  if (s.trainingDays > 0 && !s.onLeave) {
    const newDays = s.trainingDays - 1;
    // Performance ramps: 0.5 → 0.67 → 0.83 → 1.0 over 3 days
    const perf = Math.min(1.0, 0.5 + (3 - newDays) * 0.167);
    return { ...s, trainingDays: newDays, performance: perf };
  }
  return s;
});
```

Performance affects throughput: `maxCups = speed × 10 × (Σ performance / staffCount)`

## Morale system (manager active only)

Based on utilization (`customers / activeStaff`):

| Utilization | Morale change | Performance change |
|---|---|---|
| > 45 cust/staff | -2/day | -0.015/day (min 0.5) |
| < 10 cust/staff | -0.3/day | none |
| 10-45 | +0.1/day | none |

Turnover: morale < 20 AND `rng.next() < 0.05` → staff quits.

## UI patterns

### Staff card (Dashboard)
```
┌─────────────────────────────────────┐
│ [manager]  Skill 6    Training 2d   │
│ [$5800/mo]                         │
│ Morale: 72%  Perf: 83%    [↑] [↓] [✕] │
└─────────────────────────────────────┘
```
- Wage input: editable in manual mode, disabled otherwise
- ↑ promote / ↓ demote / ✕ fire buttons (context-aware availability)
- Manager card has green accent border
- Training days shown as badge

### Hire modal
- Role dropdown → auto-sets skill range and base wage
- Skill slider → auto-calculates wage from formula
- Wage slider → manual override
- Shows hiring cost preview before confirm

### Manager review modal
- 8 KPI cards in 2-column grid
- Manager stat pills (flex-wrap)
- Three action buttons: Dismiss (neutral), Demote (warning), Fire (danger)

## What to watch out for

- **Budget validation on wage edit**: always check `othersPayroll + newWage ≤ budget` before allowing
- **Manager is the first staff member**: in the staff array, don't let user fire if they're the only person left
- **Review only fires once per 90-day mark**: set `pendingReview` and clear it on dismiss — don't re-trigger if already shown
- **Manual mode disables auto-hire**: the `if (!manualMode)` guard around labor logic in `advanceDay()` is critical
- **Training performance ramps linearly**: 0.5 + (3 - remainingDays) × 0.167 — keep this formula identical in both Python sim and TS game for cross-language parity
