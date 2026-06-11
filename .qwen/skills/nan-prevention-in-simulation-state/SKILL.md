---
name: nan-prevention-in-simulation-state
description: Defensive patterns to prevent NaN propagation in game state calculations and UI rendering when staff changes dynamically
source: auto-skill
extracted_at: '2026-06-09T04:35:00.000Z'
---

## Problem this solves

When staff members quit or are fired mid-day, subsequent calculations in `advanceDay()` can produce `NaN` (division by zero, reduce on empty arrays). NaN then propagates to cash, equity, and all KPIs — breaking the UI and corrupting daily records.

## Root causes

### 1. Division by staff count when array is empty
```ts
// BUG: after all staff quit, this is / 0 → NaN
const util = todayCustomers / Math.max(1, activeStaff.length);  // ✓ fixed

// BUG: empty array reduce returns 0, then / 0 → NaN
const effectiveStaff = updatedStaff.filter(s => !s.onLeave)
  .reduce((sum, s) => sum + s.performance, 0);
const maxCups = Math.round(equipment.speed * 10 * (effectiveStaff / Math.max(1, updatedStaff.length)));
// ✓ fixed:
const throughputFactor = updatedStaff.length > 0 ? effectiveStaff / updatedStaff.length : 0;
const maxCups = Math.round(equipment.speed * 10 * throughputFactor);
```

### 2. Stale `get()` reads inside closure
```ts
// BUG: calling get() mid-advanceDay reads state that may have changed
if (!get().manualMode) { ... }
// ✓ fixed: read once at top
const isManual = get().manualMode;
```

### 3. Double set() mid-advanceDay
```ts
// BUG: set({ kpiTargets: ... }) mid-advanceDay creates a second state update
// that can overwrite partial calculations from the main set()
// ✓ fixed: queue the update in a local variable, include in final set()
let nextKpiTargets = null;
if (reviewTriggered) { nextKpiTargets = { revenueTarget: ... }; }
// At end:
set({ ..., ...(nextKpiTargets && { kpiTargets: nextKpiTargets }) });
```

## Defense-in-depth

### Layer 1: Guard divisions at the source

```ts
// Never divide by array length without guard
const safeDivide = (num: number, denom: number) => denom > 0 ? num / denom : 0;

// Or inline guards:
const activeCount = Math.max(1, activeStaff.length);
const staffCount = updatedStaff.length;
const throughputFactor = staffCount > 0 ? effectiveStaff / staffCount : 0;
```

### Layer 2: NaN guard at set() boundary

```ts
set({
  cash: Number.isFinite(newCash) ? newCash : -999999,
  debtRemaining: Number.isFinite(newDebt) ? newDebt : 999999,
  reputation: Number.isFinite(newRep) ? newRep : 0,
  // ... rest
});
```

**Why these fallbacks**: `-999999` for cash signals deep bankruptcy (triggers game over). `999999` for debt signals catastrophic error. `0` for reputation is a safe floor.

### Layer 3: Safe values in UI rendering

```tsx
// At top of Dashboard:
const safeCash = Number.isFinite(cash) ? cash : 0;
const safeDebt = Number.isFinite(debtRemaining) ? debtRemaining : 0;
const safeEquity = Number.isFinite(totalEquity) ? totalEquity : 0;
const safeRep = Number.isFinite(reputation) ? reputation : 0;

// Use safe values everywhere:
<KpiCard label="Cash" value={`$${Math.round(safeCash).toLocaleString()}`} />
<KpiCard label="Equity" value={`$${Math.round(safeEquity).toLocaleString()}`} />
```

### Layer 4: Guard reduce operations

```tsx
// Staff payroll can include NaN salaries if something went wrong
const monthlyStaffCost = staff.reduce((sum, s) => 
  sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);

// Daily records waste
const totalWaste = dailyRecords.reduce((sum, r) => 
  sum + (Number.isFinite(r.waste) ? r.waste : 0), 0);
```

## Checklist for advanceDay() rewrites

Every time `advanceDay()` is modified, verify:

- [ ] No division by array length without `Math.max(1, ...)` or `> 0` guard
- [ ] `get()` called once at top, cached in local variables
- [ ] No `set()` calls mid-function — queue updates in locals, apply in final `set()`
- [ ] All state values at `set()` boundary wrapped in `Number.isFinite()`
- [ ] UI reads use `safe*` variables derived from `Number.isFinite()` checks
- [ ] `reduce` operations guard against NaN in individual values

## When NaN appears

If you see `NaN` in the UI after a staff change:

1. Check `advanceDay()` for any `/ staff.length` without guard
2. Check for `get()` calls inside the function that should be cached
3. Check for multiple `set()` calls that might conflict
4. Add `Number.isFinite()` guards at the `set()` boundary as immediate fix
5. Add `safe*` variables in UI as rendering safeguard
