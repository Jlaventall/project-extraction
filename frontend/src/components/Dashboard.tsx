import { useEffect, useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useGameStore } from '../store/gameStore';
import { EventPanel } from './EventPanel';

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;
const kilos = (value: number) => `${value.toFixed(1)} kg`;
const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);

export function Dashboard() {
  const [forecastTracksPrice, setForecastTracksPrice] = useState(true);
  const {
    phase, catalog, state, gameId, draft, loading, error, autoAdvance, runHistory,
    advanceDay, setDraftValue, setAutoAdvance, resetGame,
  } = useGameStore();

  useEffect(() => {
    if (!autoAdvance || loading || phase !== 'playing') return;
    const timer = window.setTimeout(() => { void advanceDay(true); }, 550);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, loading, phase, state?.day, advanceDay]);

  if (!state || !catalog) return null;
  const greenTotal = sum(state.green_inventory);
  const roastedTotal = sum(state.roasted_inventory);
  const backlogTotal = sum(state.backorders);
  const expectedYield = 0.825;
  const exceptionCounts = state.events.reduce<Record<string, number>>((counts, event) => {
    const key = event.type === 'stockout' ? 'no_stock' : event.type === 'quality_failure' || event.type === 'quality_variance' ? 'quality' : event.type === 'late_delivery' ? 'late' : event.type === 'demand_spike' ? 'demand' : '';
    if (key) counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const forecastAtDraftPrices = Object.fromEntries(catalog.products.map((product) => {
    const committedPrice = state.prices[product.id] ?? product.base_price;
    const draftPrice = draft.prices[product.id] ?? committedPrice;
    const priceEffect = forecastTracksPrice ? (draftPrice / committedPrice) ** -1.35 : 1;
    const committedForecast = state.demand_forecast?.[product.id] ?? product.base_daily_demand_kg;
    return [product.id, committedForecast * priceEffect];
  }));
  const queuedGreenBySku = Object.fromEntries(catalog.products.map((product) => [
    product.id,
    state.roast_jobs
      .filter((job) => job.sku === product.id && (job.status === 'queued' || job.status === 'running'))
      .reduce((total, job) => total + job.green_input_kg, 0),
  ]));
  const plannedRoastInput = sum(draft.weekly_roast_targets) / 7;
  const weeklyDemandTotal = sum(forecastAtDraftPrices) * 7;
  const weeklyRawNeed = sum(draft.weekly_roast_targets);
  const weeklyExpectedOutput = weeklyRawNeed * expectedYield;
  const bomNeedByRaw = Object.fromEntries(catalog.suppliers.map((supplier) => [supplier.id, 0]));
  catalog.products.forEach((product) => {
    const mo = draft.weekly_roast_targets[product.id] ?? 0;
    (product.bom ?? []).forEach((component) => { bomNeedByRaw[component.raw_material_id] = (bomNeedByRaw[component.raw_material_id] ?? 0) + mo * component.fraction; });
  });
  const roastQueueRoom = Math.max(
    0,
    catalog.defaults.roaster_capacity_kg_per_day * 2 - sum(queuedGreenBySku),
  );
  const orderCost = catalog.suppliers.reduce(
    (total, supplier) => total + (draft.weekly_green_orders[supplier.id] ?? 0) * supplier.unit_cost,
    0,
  );
  const belowMinimum = catalog.suppliers
    .filter((supplier) => {
      const amount = draft.weekly_green_orders[supplier.id] ?? 0;
      return amount > 0 && amount < supplier.minimum_order;
    })
    .map((supplier) => `${supplier.name} order is below its ${supplier.minimum_order} kg minimum`);
  const planErrors = [
    ...belowMinimum,
    orderCost > state.credit_available + 0.01 ? `Orders exceed available liquidity by ${money(orderCost - state.credit_available)}` : '',
    plannedRoastInput > roastQueueRoom + 0.01 ? `Today's roast release exceeds queue room by ${kilos(plannedRoastInput - roastQueueRoom)}` : '',
    plannedRoastInput > greenTotal + 0.01 ? `Today's roast release needs ${kilos(plannedRoastInput - greenTotal)} more green coffee currently on hand` : '',
  ].filter(Boolean);
  const balanceHealthy = Math.abs(state.mass_balance.green_error_kg) < 1e-6
    && Math.abs(state.mass_balance.roasted_error_kg) < 1e-6;

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="dash-title">
          <div className="eyebrow">LIVE SIMULATION · SEED {state.seed}</div>
          <h1>{state.scenario}</h1>
          <span className="dash-location">SimPy event time {state.sim_time.toFixed(2)}</span>
        </div>
        <div className="dash-date">
          <span className="month-badge">DAY {state.day}/{state.horizon_days}</span>
          <button
            className={`btn btn-auto-advance ${autoAdvance ? 'active' : ''}`}
            disabled={phase === 'ended'}
            onClick={() => setAutoAdvance(!autoAdvance)}
          >
            {autoAdvance ? 'Stop autopilot' : 'Run baseline'}
          </button>
          <button
            className="btn btn-advance"
            disabled={loading || phase === 'ended' || planErrors.length > 0}
            onClick={() => void advanceDay(false)}
          >
            {loading ? 'Processing…' : 'Commit weekly plan'}
          </button>
        </div>
      </header>

      {phase === 'ended' && (
        <section className="run-ended">
          <strong>Run complete:</strong> {state.termination_reason?.replaceAll('_', ' ')}
          <button className="btn btn-primary" onClick={resetGame}>New run</button>
        </section>
      )}
      {error && <div className="api-error">{error}</div>}
      {state.today?.warnings.map((warning) => <div className="sim-warning" key={warning}>{warning}</div>)}

      <section className="kpi-row">
        <Kpi label="Cash" value={money(state.cash)} sub={`${money(state.credit_available)} liquidity`} trend={state.cash >= 0 ? 'up' : 'down'} />
        <Kpi label="Service level" value={`${(state.service_level * 100).toFixed(1)}%`} sub={`${kilos(backlogTotal)} backordered`} trend={state.service_level >= 0.95 ? 'up' : 'down'} />
        <Kpi label="Green coffee" value={kilos(greenTotal)} sub={`${kilos(sum(state.inbound_green))} inbound`} />
        <Kpi label="Roasted coffee" value={kilos(roastedTotal)} sub={`${money(state.inventory_value)} inventory value`} />
        <Kpi label="Physics audit" value={balanceHealthy ? 'BALANCED' : 'DRIFT'} sub="green + roasted mass" trend={balanceHealthy ? 'up' : 'down'} />
      </section>

      <section className="dash-card run-summary-card">
        <div className="card-header-row"><div><h3>Simulation summary</h3><p className="card-note">Mode <strong>{state.simulation_mode ?? 'live'}</strong> · strategy <strong>{state.simulation_strategy ?? 'human_manual'}</strong>.</p></div><span className="status-pill">DAY {state.day}</span></div>
        <div className="summary-grid">
          <Summary label="Cumulative reward" value={money(state.history.reduce((total, day) => total + day.reward, 0))} />
          <Summary label="Mean daily reward" value={money(state.history.length ? state.history.reduce((total, day) => total + day.reward, 0) / state.history.length : 0)} />
          <Summary label="Service level" value={`${(state.service_level * 100).toFixed(2)}%`} />
          <Summary label="Ending cash" value={money(state.cash)} />
          <Summary label="Demand events" value={String(state.events.filter((event) => event.category === 'demand').length)} />
          <Summary label="Supply events" value={String(state.events.filter((event) => event.category === 'supply').length)} />
        </div>
      </section>
      {runHistory.length > 0 && <section className="dash-card"><div className="card-header-row"><div><h3>Strategy history</h3><p className="card-note">Completed runs saved in this browser.</p></div><span className="status-pill">{runHistory.length} runs</span></div><div className="history-table"><div className="history-heading"><span>Mode / strategy</span><span>Seed</span><span>Reward</span><span>Cash</span><span>Service</span></div>{[...runHistory].reverse().slice(0, 8).map((run) => <div className="history-row" key={`${run.completedAt}-${run.seed}`}><strong>{run.mode} · {run.strategy}</strong><span>{run.seed}</span><span>{money(run.reward)}</span><span>{money(run.cash)}</span><span>{(run.service * 100).toFixed(1)}%</span></div>)}</div></section>}

      <section className="dash-card top-pricing-card">
        <div className="card-header-row"><div><h3>Pricing & demand control</h3><p className="card-note">Price elasticity is applied to each SKU forecast before demand is realized.</p></div><button className="btn btn-small" onClick={() => setForecastTracksPrice(!forecastTracksPrice)}>{forecastTracksPrice ? 'Auto forecast' : 'Fixed forecast'}</button></div>
        <div className="pricing-grid">
          {catalog.products.map((product) => <div className="price-input" key={product.id}><label>{product.name}</label><input type="number" min={product.min_price} max={product.max_price} step={0.5} value={draft.prices[product.id] ?? product.base_price} onChange={(event) => setDraftValue('prices', product.id, bounded(event.target.value, product.min_price, product.max_price))} /><small>{kilos(forecastAtDraftPrices[product.id] * 7)} / week forecast</small></div>)}
        </div>
      </section>

      <section className="dash-grid">
        <article className="dash-card exceptions-card"><div className="card-header-row"><h3>Exceptions this run</h3><span className="status-pill">event tallies</span></div><div className="exception-grid"><Summary label="Late deliveries" value={String(exceptionCounts.late ?? 0)} /><Summary label="Quality events" value={String(exceptionCounts.quality ?? 0)} /><Summary label="No/low stock" value={String(exceptionCounts.no_stock ?? 0)} /><Summary label="Demand spikes" value={String(exceptionCounts.demand ?? 0)} /></div></article>
        <article className="dash-card"><div className="card-header-row"><h3>Resource utilization · current week</h3><span className="status-pill">7-day tally</span></div><div className="summary-list"><Summary label="Roaster utilization" value={`${Math.min(100, ((state.stats?.roast_hours ?? 0) % 168) / 168 * 100).toFixed(0)}%`} /><Summary label="Roast days active" value={String(state.history.slice(-7).filter((day) => (day.roasted_kg ?? 0) > 0).length)} /><Summary label="Roaster labor" value={`${((state.stats?.roast_hours ?? 0) % 168).toFixed(1)} hr`} /><Summary label="Packaging labor" value={`${((state.stats?.packaging_hours ?? 0) % 168).toFixed(1)} hr`} /></div></article>
      </section>

      <section className="dash-card cumulative-card">
        <div className="card-header-row">
          <div><h3>Cumulative production & exception stats</h3><p className="card-note">Totals since the start of this seeded run.</p></div>
          <span className="status-pill">{state.events.filter((event) => ['quality_failure', 'late_delivery', 'demand_spike', 'stockout'].includes(event.type)).length} recent exceptions</span>
        </div>
        <div className="cumulative-grid">
          <Summary label="Green received" value={kilos(state.stats?.green_received ?? 0)} />
          <Summary label="Green consumed" value={kilos(state.stats?.green_consumed ?? 0)} />
          <Summary label="Roasted produced" value={kilos(state.stats?.roasted_produced ?? 0)} />
          <Summary label="Roasted sold" value={kilos(state.stats?.roasted_sold ?? 0)} />
          <Summary label="Spoilage" value={kilos((state.stats?.green_spoiled ?? 0) + (state.stats?.roasted_spoiled ?? 0))} />
          <Summary label="Lost sales" value={kilos(state.stats?.lost_sales ?? 0)} />
        </div>
      </section>

      <section className="decision-brief dash-card">
        <div className="card-header-row">
          <div>
            <h3>Decision brief · weekly master schedule</h3>
            <p className="card-note">PO quantity is kg ordered per weekly release. MO quantity is green input per week; expected finished output includes the {expectedYield.toFixed(1)} yield factor.</p>
          </div>
          <span className={`status-pill ${planErrors.length ? 'status-danger' : 'status-ok'}`}>
            {planErrors.length ? 'PLAN BLOCKED' : 'PLAN FEASIBLE'}
          </span>
        </div>
        <div className="decision-summary">
          <span>Raw on hand: <strong>{kilos(greenTotal)}</strong> + {kilos(sum(state.inbound_green))} inbound</span>
          <span>MO raw need: <strong>{kilos(weeklyRawNeed)}</strong> → {kilos(weeklyExpectedOutput)} finished</span>
          <span>Finished on hand: <strong>{kilos(roastedTotal)}</strong> vs {kilos(weeklyDemandTotal)} weekly demand</span>
          <span>Weekly PO cash: <strong>{money(orderCost)}</strong> / {money(state.credit_available)} liquidity</span>
        </div>
        {planErrors.map((message) => <div className="plan-error" key={message}>{message}</div>)}
        <div className="decision-table">
          <div className="decision-heading"><span>SKU</span><span>Demand/week</span><span>Trend A/F</span><span>FG on hand</span><span>MO output</span><span>Raw need</span><span>Coverage</span></div>
          {catalog.products.map((product) => {
            const forecast = forecastAtDraftPrices[product.id];
            const ready = state.roasted_inventory[product.id];
            const weeklyDemand = forecast * 7;
            const moRaw = draft.weekly_roast_targets[product.id] ?? 0;
            const projected = ready + queuedGreenBySku[product.id] * expectedYield + moRaw * expectedYield;
            const gap = projected - weeklyDemand - state.backorders[product.id];
            return (
              <div className="decision-row" key={product.id}>
                <strong>{product.name}</strong>
                <span>{kilos(weeklyDemand)}</span>
                <span className="demand-sparkline"><ResponsiveContainer width="100%" height={32}><LineChart data={state.history.slice(-14).map((day) => ({ actual: day.demand_by_sku?.[product.id] ?? 0, forecast: (day.forecast?.[product.id] ?? forecast) }))}><Line type="monotone" dataKey="actual" stroke="#f59e0b" dot={false} strokeWidth={1.5} /><Line type="monotone" dataKey="forecast" stroke="#60a5fa" dot={false} strokeWidth={1.5} /></LineChart></ResponsiveContainer></span>
                <span>{kilos(ready)}</span>
                <span>{kilos(moRaw * expectedYield)}</span>
                <span>{kilos(moRaw)}</span>
                <span className={gap < 0 ? 'text-danger' : 'text-positive'}>{(projected / Math.max(0.1, weeklyDemand)).toFixed(1)}w</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="dash-grid">
        <article className="dash-card controls-card">
          <div className="card-header-row">
            <h3>Standing procurement PO · weekly kg</h3>
            <span className="status-pill">weekly release · stochastic arrival</span>
          </div>
          <div className="control-table">
            {catalog.suppliers.map((supplier) => (
              <label className="control-row" key={supplier.id}>
                <span>
                  <strong>{supplier.name}</strong>
                  <small>{money(supplier.unit_cost)}/kg · {supplier.mean_lead_days}d mean · min {supplier.minimum_order}kg · on hand {kilos(state.green_inventory[supplier.id] ?? 0)} · inbound {kilos(state.inbound_green[supplier.id] ?? 0)} · BOM need {kilos(bomNeedByRaw[supplier.id] ?? 0)}</small>
                </span>
                <input
                  type="number" min={0} max={supplier.maximum_order} step={5}
                  value={draft.weekly_green_orders[supplier.id] ?? 0}
                  onChange={(event) => setDraftValue('weekly_green_orders', supplier.id, bounded(event.target.value, 0, supplier.maximum_order))}
                />
                <PlanMeter value={draft.weekly_green_orders[supplier.id] ?? 0} target={supplier.maximum_order} label={`supplier cap ${supplier.maximum_order} kg`} />
              </label>
            ))}
          </div>
        </article>

        <article className="dash-card controls-card">
          <div className="card-header-row">
            <h3>Master roast MO · weekly green input</h3>
            <span className="status-pill">7-day bottleneck {catalog.defaults.roaster_capacity_kg_per_day * 7} kg</span>
          </div>
          <div className="control-table">
            {catalog.products.map((product) => (
              <label className="control-row" key={product.id}>
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.roast_profile} · {state.roasted_inventory[product.id].toFixed(1)}kg ready</small>
                </span>
                <input
                  type="number" min={0} max={catalog.defaults.roaster_capacity_kg_per_day * 1.5} step={5}
                  value={draft.weekly_roast_targets[product.id] ?? 0}
                  onChange={(event) => setDraftValue('weekly_roast_targets', product.id, bounded(event.target.value, 0, catalog.defaults.roaster_capacity_kg_per_day * 7))}
                />
                <PlanMeter value={draft.weekly_roast_targets[product.id] ?? 0} target={forecastAtDraftPrices[product.id] * 7 / expectedYield} label={`weekly demand ${kilos(forecastAtDraftPrices[product.id] * 7 / expectedYield)} green`} />
              </label>
            ))}
          </div>
        </article>

        <article className="dash-card controls-card">
          <div className="card-header-row">
            <h3>Wholesale pricing</h3>
            <span className="status-pill">$/kg</span>
          </div>
          <div className="pricing-grid">
            {catalog.products.map((product) => (
              <div className="price-input" key={product.id}>
                <label>{product.name}</label>
                <input
                  type="number" min={product.min_price} max={product.max_price} step={0.5}
                  value={draft.prices[product.id] ?? product.base_price}
                  onChange={(event) => setDraftValue('prices', product.id, bounded(event.target.value, product.min_price, product.max_price))}
                />
              </div>
            ))}
          </div>
        </article>

        <article className="dash-card">
          <h3>Resource queues</h3>
          <div className="summary-list">
            <Summary label="Roaster" value={state.resources.roaster_busy ? 'RUNNING' : 'IDLE'} />
            <Summary label="Roast jobs queued" value={String(state.resources.roaster_queue)} />
            <Summary label="Packaging line" value={state.resources.packager_busy ? 'RUNNING' : 'IDLE'} />
            <Summary label="Packaging jobs queued" value={String(state.resources.packager_queue)} />
            <Summary label="Last-day roast output" value={kilos(state.today?.roasted_kg ?? 0)} />
            <Summary label="Profile changeovers" value={String(state.today?.changeovers ?? 0)} />
            <Summary label="Unplanned downtime" value={`${(state.today?.downtime_hours ?? 0).toFixed(1)} hr`} />
          </div>
        </article>
      </section>

      <section className="chart-card dash-card">
        <div className="card-header-row">
          <h3>Operating trace</h3>
          <span className="status-pill">cash · demand · service</span>
        </div>
        <ResponsiveContainer width="100%" height={290}>
          <LineChart data={state.history} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="#2a2f38" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#6b7280" />
            <YAxis yAxisId="cash" stroke="#22c55e" tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
            <YAxis yAxisId="kg" orientation="right" stroke="#3b82f6" />
            <Tooltip contentStyle={{ background: '#1a1d23', border: '1px solid #2a2f38' }} />
            <Legend />
            <Line yAxisId="cash" type="monotone" dataKey="cash" stroke="#22c55e" dot={false} name="Cash" />
            <Line yAxisId="kg" type="monotone" dataKey="demand_kg" stroke="#f59e0b" dot={false} name="Demand kg" />
            <Line yAxisId="kg" type="monotone" dataKey="served_kg" stroke="#3b82f6" dot={false} name="Served kg" />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="dash-card daily-ops-card">
        <div className="card-header-row"><div><h3>Daily operations ledger</h3><p className="card-note">End-of-day operating and financial tallies. Latest 14 days shown.</p></div><span className="status-pill">{state.history.length} days recorded</span></div>
        <div className="daily-ops-table">
          <div className="daily-ops-heading"><span>Day</span><span>Sales</span><span>Margin</span><span>Fulfilled / missed</span><span>Labor hr</span><span>Util.</span><span>Stockout kg</span><span>Cash</span></div>
          {[...state.history].slice(-14).reverse().map((day) => { const tally = day.eod_tally; return <div className="daily-ops-row" key={day.day}><strong>{day.day}</strong><span>{money(tally?.revenue ?? day.revenue)}</span><span>{money(tally?.gross_margin ?? 0)}</span><span>{tally?.orders_fulfilled ?? 0} / {tally?.orders_missed ?? 0}</span><span>{(tally?.total_labor_hours ?? ((day.roast_hours ?? 0) + (day.packaging_hours ?? 0))).toFixed(1)}</span><span>{((tally?.labor_utilization ?? 0) * 100).toFixed(0)}%</span><span className={tally?.stockout_kg ? 'text-danger' : ''}>{(tally?.stockout_kg ?? 0).toFixed(1)}</span><span>{money(tally?.cash ?? day.cash)}</span></div>; })}
        </div>
      </section>

      <section className="dash-grid">
        <article className="dash-card">
          <h3>Inventory by SKU</h3>
          <div className="inventory-list">
            {catalog.products.map((product) => {
              const ready = state.roasted_inventory[product.id];
              const backlog = state.backorders[product.id];
              return (
                <div className={`inv-item ${ready < product.base_daily_demand_kg ? 'warning' : ''}`} key={product.id}>
                  <div className="inv-header"><span className="inv-name">{product.name}</span><span>{kilos(ready)}</span></div>
                  <div className="inv-bar"><div className="inv-fill" style={{ width: `${Math.min(100, ready / (product.base_daily_demand_kg * 4) * 100)}%` }} /></div>
                  <div className="inv-footer"><span>Backlog {kilos(backlog)}</span><span>Life {product.shelf_life_days}d</span></div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="dash-card">
          <h3>Recent roast jobs</h3>
          <div className="job-list">
            {[...state.roast_jobs].reverse().slice(0, 8).map((job) => (
              <div className="job-row" key={job.job_id}>
                <span><strong>{job.sku}</strong><small>{job.job_id}</small></span>
                <span>{job.status === 'complete' ? `${job.green_input_kg.toFixed(0)} → ${job.roasted_output_kg.toFixed(1)} kg` : `${job.green_input_kg.toFixed(0)} kg input · pending`}</span>
                <span className={`job-status ${job.status}`}>{job.status}</span>
              </div>
            ))}
            {state.roast_jobs.length === 0 && <div className="journal-empty">No batches scheduled yet.</div>}
          </div>
        </article>
      </section>

      <EventPanel events={state.events} snapshot={state} gameId={gameId} />
    </main>
  );
}

function Kpi({ label, value, sub, trend }: { label: string; value: string; sub: string; trend?: 'up' | 'down' }) {
  return (
    <div className={`kpi-card ${trend ? `trend-${trend}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="summary-row"><span>{label}</span><span>{value}</span></div>;
}

function PlanMeter({ value, target, label }: { value: number; target: number; label: string }) {
  const ratio = target > 0 ? value / target : 0;
  return (
    <span className="plan-meter" title={`${value.toFixed(0)} kg planned · ${label}`}>
      <span className="plan-meter-track"><span className="plan-meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span>
      <small>{label}</small>
    </span>
  );
}

function bounded(raw: string, minimum: number, maximum: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}
