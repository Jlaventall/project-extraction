import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';

export function SetupScreen() {
  const { catalog, fetchCatalog, startGame, loading, error } = useGameStore();
  const [seed, setSeed] = useState(42);
  const [horizon, setHorizon] = useState(90);
  const [mode, setMode] = useState<'live' | 'benchmark' | 'pettingzoo'>('live');
  const [strategy, setStrategy] = useState('human_manual');
  const [initialPrices, setInitialPrices] = useState<Record<string, number>>({});
  const [bomOverrides, setBomOverrides] = useState<Record<string, Record<string, number>>>({});
  const exportScenario = () => {
    const blob = new Blob([JSON.stringify({ format: 'coffeesim.scenario.v1', seed, horizon, mode, strategy, initialPrices, bomOverrides }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coffeesim-scenario.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const importScenario = (file: File) => { void file.text().then((text) => { const value = JSON.parse(text) as Partial<typeof scenarioConfig>; if (typeof value.seed === 'number') setSeed(value.seed); if (typeof value.horizon === 'number') setHorizon(value.horizon); if (value.mode) setMode(value.mode); if (typeof value.strategy === 'string') setStrategy(value.strategy); if (value.initialPrices) setInitialPrices(value.initialPrices); if (value.bomOverrides) setBomOverrides(value.bomOverrides); }).catch(() => undefined); };
  const scenarioConfig = { seed, horizon, mode, strategy, initialPrices, bomOverrides };
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
      <div className="scenario-actions"><button className="btn btn-small" onClick={exportScenario}>Export scenario</button><label className="btn btn-small">Import scenario<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importScenario(file); }} /></label></div>

      {catalog && (
        <p className="setup-hint">
          {catalog.suppliers.length} suppliers · {catalog.products.length} SKUs ·{' '}
          {catalog.defaults.roaster_capacity_kg_per_day} kg/day roast capacity
        </p>
      )}
      {catalog && <section className="staffing-panel init-panel">
        <h3>Initialization · finished goods & BOM</h3>
        <p className="config-hint">Recipes constrain which raw origins can satisfy each master roast order. Pricing can be refined in the live dashboard before commit.</p>
        <div className="bom-table"><div className="bom-heading"><span>SKU</span><span>Initial price</span><span>Editable BOM fractions</span></div>{catalog.products.map((product) => <div className="bom-row" key={product.id}><strong>{product.name}</strong><input type="number" min={product.min_price} max={product.max_price} step={0.5} value={initialPrices[product.id] ?? product.base_price} onChange={(event) => setInitialPrices((current) => ({ ...current, [product.id]: Number(event.target.value) }))} /><span className="bom-inputs">{(product.bom ?? []).map((component) => <label key={component.raw_material_id}>{component.raw_material_id}<input type="number" min={0} max={1} step={0.05} value={bomOverrides[product.id]?.[component.raw_material_id] ?? component.fraction} onChange={(event) => setBomOverrides((current) => ({ ...current, [product.id]: { ...(current[product.id] ?? Object.fromEntries((product.bom ?? []).map((item) => [item.raw_material_id, item.fraction]))), [component.raw_material_id]: Number(event.target.value) } }))} /></label>)}</span></div>)}</div>
      </section>}
      {error && <div className="api-error">API error: {error}. Start the Python server on port 8000.</div>}
      {bomErrors.map((message) => <div className="sim-warning" key={message}>{message}</div>)}
      <div className="setup-nav">
        <button
          className="btn btn-primary btn-start"
          disabled={loading || !catalog || bomErrors.length > 0}
          onClick={() => void startGame(seed, horizon, mode, strategy, initialPrices, bomOverrides)}
        >
          {loading ? 'Starting engine…' : 'Start roastery'}
        </button>
      </div>
    </main>
  );
}
