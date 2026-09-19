# CoffeeSim UI design briefing

## Purpose

CoffeeSim is an operations control room for a seeded roastery simulation. The
interface should let a planner answer three questions quickly:

1. What assumptions and constraints am I starting with?
2. What should I commit today, and what will it cost or risk?
3. What actually happened, and why did performance move?

The product uses three top-level views: **Init**, **Control Room**, and
**History**. The dark control-room visual language is intentional: dense
operational information, restrained color, and strong amber/green/red state
signals.

## Captures

- [Init reference capture](design/screenshots/init.svg)
- [Control Room reference capture](design/screenshots/control-room.svg)
- [History reference capture](design/screenshots/history.svg)

The current workspace has no headless browser executable, so these are static
SVG design captures of the implemented layout rather than browser pixel
screenshots. A future visual QA pass should replace them with Playwright or
Chromium captures at 1440×900 and 390×844.

## Screen 1 — Init

Init is the commitment surface. It should be read top-to-bottom before starting
a run:

- Run configuration: seed, strategy, mode, horizon.
- Roasts: finished-good name, origin/BOM recipe, USD price, and price-response
  note. Prices are user-entered with two decimal places; do not silently clamp
  to the default product price range.
- Raw-material coverage: target days, on-hand, inbound, target, replenishment
  gap, estimated capital, and supplier lead time/variability.
- Labor & shifts: regular workers, shifts, temporary workers, role allocation,
  minimum viable staffing, and temp premium.
- Finished-goods coverage policy: roasted inventory days-on-hand target.

Init should make cash exposure explicit. Coverage and labor changes should show
their capital or margin consequence before `Start roastery` is pressed.

## Screen 2 — Control Room

Control Room is the decision surface for the current operating day:

- Header: simulation identity, day/event time, autopilot, and commit action.
- KPI strip: cash/liquidity, service, raw inventory, finished inventory, and
  physics audit.
- Decision brief: demand versus supply, BOM coverage, weekly PO cash, and MO
  projected output.
- PO and MO controls: integer lot-size inputs, supplier lead-time context,
  on-hand/inbound inventory, and capacity meters.
- Operating trace: cash, demand, served volume, and forecast behavior belong in
  this view because they inform the next commitment.
- Inventory/jobs: finished-good stock, backlog, roast jobs, and current output.
- Anomalies card above the event stream: persistent, counted warnings; no
  transient warning banners.
- Event stream: timestamped supply/demand events and downloadable JSON.

Manual commits are additive. Each click forms a PO/MO immediately, affects cash,
and persists the standing plan. Autopilot uses the weekly release cadence.

## Screen 3 — History

History is the retrospective surface:

- Cumulative reward, mean daily reward, service, ending cash, and demand/supply
  event totals.
- Strategy comparison across completed browser runs.
- Cumulative production, sales, spoilage, lost sales, and exceptions.
- Daily operations ledger with revenue, margin, fulfilled/missed orders, labor,
  utilization, stockout quantity, and cash.
- Full-run JSON and event-log JSON exports.

History should not contain editable planning controls. It is for attribution,
diagnosis, and replay.

## Interaction rules

- PO/MO fields use whole-number lot increments. Lot normalization is order
  formation, not an anomaly and must not create warnings or events.
- Pricing accepts positive numeric USD values with cent precision. Demand uses
  price elasticity and should visibly respond to unusually low/high prices.
- Customer demand arrives as individual 1–2 kg orders. Stockout transaction
  counts therefore represent customer orders rather than aggregate demand
  waves.
- Keep anomalies persistent and aggregated; keep the event stream chronological
  and detailed.
- Use green for healthy service/reconciliation, amber for planning attention,
  and red only for blocked or failed conditions.

## Visual QA checklist

- Check all three tabs at desktop and narrow mobile widths.
- Confirm Init price fields visibly show `$` and two decimals and remain editable.
- Confirm Control Room trace appears above anomalies/event stream without
  displacing PO/MO controls.
- Confirm History has no planning inputs.
- Confirm anomaly counts survive multiple manual commits and do not duplicate
  identical messages unnecessarily.
- Confirm exports work from Control Room and History.
- Confirm a manual commit changes cash and creates a new PO/MO entry immediately.
