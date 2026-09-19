import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';

type ScenarioConfig = { seed: number; horizon: number; coverageDays: number; finishedGoodsCoverageDays: number; regularWorkers: number; shifts: number; temporaryWorkers: number; laborRoles: Record<string, number>; mode: 'live' | 'benchmark' | 'pettingzoo'; strategy: string; initialPrices: Record<string, number>; bomOverrides: Record<string, Record<string, number>> };

export function SetupScreen() {
  const { catalog, fetchCatalog, startGame, loading, error } = useGameStore();
  const [seed, setSeed] = useState(42);
  const [horizon, setHorizon] = useState(90);
  const [coverageDays, setCoverageDays] = useState(14);
  const [finishedGoodsCoverageDays, setFinishedGoodsCoverageDays] = useState(3);
  const [regularWorkers, setRegularWorkers] = useState(4);
  const [shifts, setShifts] = useState(1);
  const [temporaryWorkers, setTemporaryWorkers] = useState(0);
  const [laborRoles, setLaborRoles] = useState<Record<string, number>>({ roasting: 2, packaging: 1, quality: 1 });
  const [mode, setMode] = useState<'live' | 'benchmark' | 'pettingzoo'>('live');
  const [strategy, setStrategy] = useState('human_manual');
  const [initialPrices, setInitialPrices] = useState<Record<string, number>>({});
  const [bomOverrides, setBomOverrides] = useState<Record<string, Record<string, number>>>({});
  const exportScenario = () => {
    const blob = new Blob([JSON.stringify({ format: 'coffeesim.scenario.v1', seed, horizon, coverageDays, finishedGoodsCoverageDays, regularWorkers, shifts, temporaryWorkers, laborRoles, mode, strategy, initialPrices, bomOverrides }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coffeesim-scenario.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const importScenario = (file: File) => { void file.text().then((text) => { const value = JSON.parse(text) as Partial<ScenarioConfig>; if (typeof value.seed === 'number') setSeed(value.seed); if (typeof value.horizon === 'number') setHorizon(value.horizon); if (typeof value.coverageDays === 'number') setCoverageDays(Math.max(1, Math.min(60, value.coverageDays))); if (typeof value.finishedGoodsCoverageDays === 'number') setFinishedGoodsCoverageDays(Math.max(1, Math.min(30, value.finishedGoodsCoverageDays))); if (typeof value.regularWorkers === 'number') setRegularWorkers(Math.max(0, Math.min(12, value.regularWorkers))); if (typeof value.shifts === 'number') setShifts(Math.max(1, Math.min(3, value.shifts))); if (typeof value.temporaryWorkers === 'number') setTemporaryWorkers(Math.max(0, Math.min(12, value.temporaryWorkers))); if (value.laborRoles) setLaborRoles(value.laborRoles); if (value.mode) setMode(value.mode); if (typeof value.strategy === 'string') setStrategy(value.strategy); if (value.initialPrices) setInitialPrices(value.initialPrices); if (value.bomOverrides) setBomOverrides(value.bomOverrides); }).catch(() => undefined); };
  const bomErrors = catalog?.products.flatMap((product) => {
    const recipe = bomOverrides[product.id] ?? Object.fromEntries((product.bom ?? []).map((item) => [item.raw_material_id, item.fraction]));
    const total = Object.values(recipe).reduce((sum, value) => sum + (Number(value) || 0), 0);
    return Math.abs(total - 1) > 0.001 ? [`${product.name} recipe totals ${(total * 100).toFixed(1)}%; it must total 100%.`] : [];
  }) ?? [];

  useEffect(() => { void fetchCatalog(); }, [fetchCatalog]);

  return (
    <main className="setup-screen">
      <div className="eyebrow">PROJECT EXTRACTION · SIMPY REBOOT</div>
      <h1 className="setup-title">Coffee Roastery Control Room</h1>
      <p className="setup-subtitle">
        Operate a lot-tracked roastery under uncertain demand, supplier lead times,
        freshness decay, and constrained production queues.
      </p>

      <section className="choice-grid">
        <article className="choice-card selected">
          <h3>Physical operations</h3>
          <p className="choice-desc">Green lots → roast queue → shrinkage → packaging queue → customer orders.</p>
        </article>
        <article className="choice-card selected">
          <h3>Auditable economics</h3>
          <p className="choice-desc">Cash, COGS, spoilage, backlog penalties, energy, labor, and holding cost.</p>
        </article>
        <article className="choice-card selected">
          <h3>Deterministic replay</h3>
          <p className="choice-desc">A seed and action history reproduce the same event stream exactly.</p>
        </article>
      </section>

      <section className="staffing-panel">
        <h3>Run configuration</h3>
        <div className="manager-config">
          <label className="config-group">
            <span>Random seed</span>
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            <span className="config-hint">Controls demand, yield, and delivery uncertainty.</span>
          </label>
          <label className="config-group">
            <span>Strategy</span>
            <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
              <option value="human_manual">Manual weekly planner</option>
              <option value="baseline">Adaptive baseline</option>
              <option value="random_control">Random control</option>
              <option value="role_ablation">PettingZoo role ablation</option>
            </select>
            <span className="config-hint">Saved with the run so results remain attributable.</span>
          </label>
          <label className="config-group">
            <span>Simulation mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="live">Live control room</option>
              <option value="benchmark">Benchmark-compatible session</option>
              <option value="pettingzoo">PettingZoo-compatible session</option>
            </select>
            <span className="config-hint">All modes use the same deterministic CoffeeWorld contract.</span>
          </label>
          <label className="config-group">
            <span>Episode horizon</span>
            <select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
              <option value={30}>30 days · shakedown</option>
              <option value={90}>90 days · operating quarter</option>
              <option value={360}>360 days · full year</option>
            </select>
            <span className="config-hint">The horizon is a truncation, not a business failure.</span>
          </label>
        </div>
      </section>
      {catalog && <section className="staffing-panel init-panel">
        <h3>Roasts</h3>
        <p className="config-hint">Set each finished-good name, origin recipe, and USD price before the run. Demand responds elastically to price, including extreme values.</p>
        <div className="bom-table"><div className="bom-heading"><span>Name</span><span>Price (USD/kg)</span><span>Origin recipe</span></div>{catalog.products.map((product) => <div className="bom-row" key={product.id}><strong>{product.name}</strong><CurrencyInput value={initialPrices[product.id] ?? product.base_price} minimum={0.01} maximum={1000000} onChange={(value) => setInitialPrices((current) => ({ ...current, [product.id]: value }))} /><span className="bom-inputs">{(product.bom ?? []).map((component) => <span key={component.raw_material_id}>{component.raw_material_id} {Math.round(component.fraction * 100)}%</span>)}</span></div>)}</div>
      </section>}
      {catalog && <section className="staffing-panel init-panel">
        <h3>Labor & shifts</h3>
        <p className="config-hint">Workers determine output capacity and labor margin. A single shift requires at least {catalog.defaults.minimum_workers_per_shift} workers; temporary labor costs {catalog.defaults.temporary_labor_premium.toFixed(2)}× the regular rate.</p>
        <div className="manager-config"><label className="config-group"><span>Regular workers</span><input type="number" min={0} max={catalog.defaults.maximum_workers} step={1} value={regularWorkers} onChange={(event) => setRegularWorkers(Math.max(0, Math.min(catalog.defaults.maximum_workers, Math.round(Number(event.target.value) || 0))))} /></label><label className="config-group"><span>Shifts</span><input type="number" min={1} max={3} step={1} value={shifts} onChange={(event) => setShifts(Math.max(1, Math.min(3, Math.round(Number(event.target.value) || 1))))} /></label><label className="config-group"><span>Temporary workers</span><input type="number" min={0} max={catalog.defaults.maximum_workers} step={1} value={temporaryWorkers} onChange={(event) => setTemporaryWorkers(Math.max(0, Math.min(catalog.defaults.maximum_workers, Math.round(Number(event.target.value) || 0))))} /></label></div>
        <div className="role-grid">{['roasting', 'packaging', 'quality'].map((role) => <label className="config-group" key={role}><span>{role} role workers</span><input type="number" min={0} max={catalog.defaults.maximum_workers} step={1} value={laborRoles[role] ?? 0} onChange={(event) => setLaborRoles((current) => ({ ...current, [role]: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label>)}</div>
      </section>}
      <div className="scenario-actions"><button className="btn btn-small" onClick={exportScenario}>Export scenario</button><label className="btn btn-small">Import scenario<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importScenario(file); }} /></label></div>

      {catalog && (
        <p className="setup-hint">
          {catalog.suppliers.length} suppliers · {catalog.products.length} SKUs ·{' '}
          {catalog.defaults.roaster_capacity_kg_per_day} kg/day roast capacity
        </p>
      )}
      {catalog && <section className="staffing-panel init-panel">
        <h3>Initialization · raw-material coverage</h3>
        <p className="config-hint">Set the raw green-coffee coverage target used by the baseline agent. More coverage improves resilience but commits more capital to inventory and inbound POs.</p>
        <label className="config-group coverage-control"><span>Target raw coverage (days)</span><input type="number" min={1} max={60} step={1} value={coverageDays} onChange={(event) => setCoverageDays(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} /><span className="config-hint">Lead times are shown below; target should normally cover the longest active lead time plus safety stock.</span></label>
        <label className="config-group coverage-control"><span>Finished goods target (days on hand)</span><input type="number" min={1} max={30} step={1} value={finishedGoodsCoverageDays} onChange={(event) => setFinishedGoodsCoverageDays(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /><span className="config-hint">The baseline agent keeps this much roasted inventory before releasing more MO input.</span></label>
        <div className="material-table"><div className="material-heading"><span>Raw material</span><span>On hand</span><span>Target</span><span>Gap / capital</span><span>Lead time</span></div>{catalog.suppliers.map((supplier) => { const onHand = catalog.defaults.starting_green_kg / Math.max(1, catalog.suppliers.length); const target = catalog.products.reduce((total, product) => total + (product.base_daily_demand_kg * coverageDays / 0.825) * (product.bom ?? []).filter((component) => component.raw_material_id === supplier.id).reduce((sum, component) => sum + component.fraction, 0), 0); const gap = Math.max(0, target - onHand); return <div className="material-row" key={supplier.id}><strong>{supplier.name}</strong><span>{onHand.toFixed(1)} kg</span><span>{target.toFixed(1)} kg</span><span>{gap.toFixed(1)} kg · ${(gap * supplier.unit_cost).toFixed(0)}</span><span>{supplier.mean_lead_days.toFixed(1)} ± {supplier.lead_std_days.toFixed(1)} d</span></div>; })}</div>
        <div className="coverage-total">Estimated initial replenishment capital: <strong>${catalog.suppliers.reduce((total, supplier) => { const onHand = catalog.defaults.starting_green_kg / Math.max(1, catalog.suppliers.length); const target = catalog.products.reduce((sum, product) => sum + (product.base_daily_demand_kg * coverageDays / 0.825) * (product.bom ?? []).filter((component) => component.raw_material_id === supplier.id).reduce((fractionTotal, component) => fractionTotal + component.fraction, 0), 0); return total + Math.max(0, target - onHand) * supplier.unit_cost; }, 0).toFixed(0)}</strong></div>
      </section>}
      {catalog && <section className="staffing-panel init-panel">
        <h3>Initialization · finished goods & BOM</h3>
        <p className="config-hint">Recipes constrain which raw origins can satisfy each master roast order. Pricing can be refined in the live dashboard before commit.</p>
        <div className="bom-table"><div className="bom-heading"><span>SKU</span><span>Editable BOM fractions</span></div>{catalog.products.map((product) => <div className="bom-row bom-only-row" key={product.id}><strong>{product.name}</strong><span className="bom-inputs">{(product.bom ?? []).map((component) => <label key={component.raw_material_id}>{component.raw_material_id}<input type="number" min={0} max={1} step={0.05} value={bomOverrides[product.id]?.[component.raw_material_id] ?? component.fraction} onChange={(event) => setBomOverrides((current) => ({ ...current, [product.id]: { ...(current[product.id] ?? Object.fromEntries((product.bom ?? []).map((item) => [item.raw_material_id, item.fraction]))), [component.raw_material_id]: Number(event.target.value) } }))} /></label>)}</span></div>)}</div>
      </section>}
      {error && <div className="api-error">API error: {error}. Start the Python server on port 8000.</div>}
      {bomErrors.map((message) => <div className="sim-warning" key={message}>{message}</div>)}
      <div className="setup-nav">
        <button
          className="btn btn-primary btn-start"
          disabled={loading || !catalog || bomErrors.length > 0}
          onClick={() => void startGame(seed, horizon, mode, strategy, initialPrices, bomOverrides, coverageDays, finishedGoodsCoverageDays, regularWorkers, shifts, temporaryWorkers, laborRoles)}
        >
          {loading ? 'Starting engine…' : 'Start roastery'}
        </button>
      </div>
    </main>
  );
}

function CurrencyInput({ value, minimum, maximum, onChange }: { value: number; minimum: number; maximum: number; onChange: (value: number) => void }) {
  const parsed = Number(value);
  return <span className="currency-input"><span>$</span><input type="text" inputMode="decimal" value={Number.isFinite(parsed) ? parsed.toFixed(2) : minimum.toFixed(2)} onChange={(event) => { const next = Number(event.target.value.replace(/[^0-9.]/g, '')); if (Number.isFinite(next)) onChange(Math.min(maximum, Math.max(minimum, Math.round(next * 100) / 100))); }} /></span>;
}
