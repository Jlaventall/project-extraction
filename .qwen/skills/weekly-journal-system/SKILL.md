---
name: weekly-journal-system
description: Auto-compile weekly journal entries with financials, staff snapshots, demand metrics, and auto-notes for gameplay evaluation and AI research analysis
source: auto-skill
extracted_at: '2026-06-09T05:12:00.000Z'
---

## When to use

When a simulation game needs persistent, structured logs of gameplay for post-hoc analysis (by user or AI research), capturing key metrics without requiring real-time monitoring.

## How it works

Compile a journal entry every 7 days inside `advanceDay()`. Track the week's start day, cash, and staff count as state variables. When 7 days have elapsed since the last compile, build the entry and append to `journalEntries[]`.

### State fields

```ts
journalEntries: WeeklyJournalEntry[];
weekStartDay: number;     // totalDay when current week started
weekStartCash: number;    // cash at start of current week
weekStartStaff: number;   // staff count at start of week
```

### Journal entry structure

```ts
interface WeeklyJournalEntry {
  week: number;              // 1-52
  days: [number, number];    // [startDay, endDay] totalDay range
  month: number;

  // Financials
  avgDailyRevenue: number;
  totalRevenue: number;
  avgDailyCosts: number;
  totalCosts: number;
  avgDailyWaste: number;
  avgDailyProfit: number;
  endCash: number;
  endDebt: number;
  endEquity: number;

  // Demand & Customers
  avgDailyCustomers: number;
  totalCustomers: number;
  avgServed: number;
  avgDemandGap: number;
  badReviewDays: number;     // days with demand > 0 but revenue = 0

  // Staff
  staffCount: number;
  staffSnapshot: { role: string; skill: number; morale: number; salary: number }[];
  avgMorale: number;
  hiresThisWeek: number;
  quitsThisWeek: number;

  // Manager
  managerActive: boolean;
  managerSkill: number;
  wasteReduction: number;

  // KPI tracking
  targets: { revenueTarget: number; wasteTarget: number; moraleTarget: number } | null;

  // Events & notable
  events: string[];   // non-info manager reports from the week
  notes: string[];    // auto-generated warnings
}
```

### Compilation logic in advanceDay()

```ts
const newTotalDay = totalDay + 1;
const daysInWeek = newTotalDay - get().weekStartDay;

if (daysInWeek >= 7) {
  const weekRecords = dailyRecords.slice(-daysInWeek);
  const totalRev = weekRecords.reduce((s, r) => s + r.revenue, 0);
  const totalCosts = weekRecords.reduce((s, r) => s + r.costs, 0);
  const totalWaste = weekRecords.reduce((s, r) => s + r.waste, 0);
  const totalCust = weekRecords.reduce((s, r) => s + r.customers, 0);
  const badDays = weekRecords.filter(r => r.customers > 0 && r.revenue === 0).length;

  const entry: WeeklyJournalEntry = {
    week: journalEntries.length + 1,
    days: [get().weekStartDay, totalDay],
    month,
    avgDailyRevenue: +((totalRev / weekRecords.length) || 0).toFixed(0),
    totalRevenue: +totalRev.toFixed(0),
    // ... all fields computed from weekRecords and current state
    notes: [],
  };

  // Auto-notes for notable conditions
  if (newCash < 0) entry.notes.push(`Negative cash: $${Math.round(newCash).toLocaleString()}`);
  if (newRep < 30) entry.notes.push(`Low reputation: ${Math.round(newRep)}`);
  if (entry.avgMorale < 40) entry.notes.push(`Low morale: ${entry.avgMorale}%`);
  if (entry.badReviewDays > 2) entry.notes.push(`${entry.badReviewDays} bad review days`);

  newJournalEntries = [...journalEntries, entry];
  newWeekStartDay = newTotalDay;
  newWeekStartCash = newCash;
}
```

### UI rendering (Dashboard)

Use a `<details>` accordion pattern showing the last 5 weeks (most recent first):

```tsx
{journalEntries.slice(-5).reverse().map((j, i) => (
  <details key={i} className="journal-entry">
    <summary className="journal-summary">
      <span className="journal-week">Week {j.week}</span>
      <span className="journal-days">Day {j.days[0]}-{j.days[1]}</span>
      <span className={`journal-rev ${j.avgDailyProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
        ${j.avgDailyProfit.toLocaleString()}/day
      </span>
    </summary>
    <div className="journal-details">
      {/* Financials, Customers, Staff, Manager, Notes, Events sections */}
    </div>
  </details>
))}
```

### Staff morale color coding

```tsx
<span className={`mono morale-${s.morale >= 60 ? 'good' : s.morale >= 30 ? 'warn' : 'bad'}`}>
  {s.morale}%
</span>
```

## Integration with AI research

The journal entries are plain serializable objects in `GameState`. They can be:

1. **Serialized to JSON** and included in research prompts for LLM analysis
2. **Exported as CSV** via a simple utility function
3. **Queried programmatically** to find trends across weeks

## What to watch out for

- **`weekRecords.slice(-daysInWeek)`** — must use the actual number of days since last compile, not a hardcoded 7, because the first week may have fewer than 7 days if the game started mid-week
- **`daysInWeek >= 7`** — compile exactly at the 7-day boundary; don't use `% 7 === 0` because the week start resets on compile
- **Guard against empty weekRecords** — use `(totalRev / weekRecords.length) || 0` to avoid division by zero on edge cases
- **`staffSnapshot` filters out on-leave staff** — `updatedStaff.filter(s => !s.onLeave)` for accurate active count
- **Auto-notes are additive** — push to `entry.notes` array, don't overwrite
- **Reset in resetGame()** — clear journalEntries, weekStartDay=1, weekStartCash=0, weekStartStaff=0
