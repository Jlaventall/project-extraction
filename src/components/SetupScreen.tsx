import { useState, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { LOCATIONS, MENUS, EQUIPMENT, CONTRACTS, CAPITAL_STRUCTURES, STAFF_ROLES } from '../data/gameData';
import type { LocationId, MenuId, EquipmentId, ContractId, CapitalSplit } from '../types';

const RESEARCH_URL = import.meta.env.VITE_RESEARCH_URL || 'http://localhost:8765';

interface SavedGame {
  gameId: string;
  weeks: number;
  latest: number;
  summary: {
    location: string;
    capital: string;
    totalRevenue: number;
    endCash: number;
    timestamp: string;
  };
}

interface ResearchResult {
  best_config: {
    location: string;
    menu: string;
    equipment: string;
    contract: string;
    capital: string;
    pricing: Record<string, number>;
    staff: { role: string; skill: number }[];
    manager?: { role: string; skill: number };
    personnel_budget?: number;
  };
  best_result: Record<string, unknown>;
  best_score: number;
  progress: number;
  total: number;
  status: string;
  completed_iterations?: number;
  error?: string;
}

export function SetupScreen() {
  const startGame = useGameStore((s) => s.startGame);
  const [step, setStep] = useState(0);

  const [locationId, setLocationId] = useState<LocationId | null>(null);
  const [menuId, setMenuId] = useState<MenuId | null>(null);
  const [equipmentId, setEquipmentId] = useState<EquipmentId | null>(null);
  const [contractId, setContractId] = useState<ContractId | null>(null);
  const [capitalId, setCapitalId] = useState<CapitalSplit | null>(null);
  const [managerSkill, setManagerSkill] = useState(5);
  const [personnelBudget, setPersonnelBudget] = useState(10000);
  const [staffPicks, setStaffPicks] = useState<{ role: string; skill: number }[]>([
    { role: 'barista', skill: 3 },
  ]);

  // AI Research state
  const [researchActive, setResearchActive] = useState(false);
  const [_researchJobId, setResearchJobId] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [showJournalPanel, setShowJournalPanel] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved games on mount
  useEffect(() => {
    fetch(`${RESEARCH_URL}/api/journal/list`)
      .then(r => r.json())
      .then(d => setSavedGames(d.games || []))
      .catch(() => {});
  }, []);

  // Stop polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const getPartialConfig = useCallback(() => {
    const cfg: Record<string, unknown> = {};
    if (locationId) cfg.location = locationId;
    if (menuId) cfg.menu = menuId;
    if (equipmentId) cfg.equipment = equipmentId;
    if (contractId) cfg.contract = contractId;
    if (capitalId) cfg.capital = capitalId;
    cfg.manager = { role: 'manager', skill: managerSkill };
    cfg.personnel_budget = personnelBudget;
    if (staffPicks.length > 0) cfg.staff = staffPicks;
    return cfg;
  }, [locationId, menuId, equipmentId, contractId, capitalId, managerSkill, personnelBudget, staffPicks]);

  const startResearch = async () => {
    const partial = getPartialConfig();
    try {
      const resp = await fetch(`${RESEARCH_URL}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partial_config: partial, iterations: 200 }),
      });
      const data = await resp.json();
      setResearchJobId(data.job_id);
      setResearchActive(true);
      setResearchResult(null);

      // Poll for results
      pollRef.current = setInterval(async () => {
        const r = await fetch(`${RESEARCH_URL}/api/research/${data.job_id}`);
        const job = await r.json();
        setResearchResult(job);
        if (job.status === 'complete' || job.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setResearchActive(false);
        }
      }, 500);
    } catch {
      alert('Research server not running. Start it with: cd autoresearch && python server.py');
    }
  };

  const applyResearchResult = () => {
    if (!researchResult?.best_config) return;
    const bc = researchResult.best_config;
    setLocationId(bc.location as LocationId);
    setMenuId(bc.menu as MenuId);
    setEquipmentId(bc.equipment as EquipmentId);
    setContractId(bc.contract as ContractId);
    setCapitalId(bc.capital as CapitalSplit);
    if (bc.manager?.skill) setManagerSkill(bc.manager.skill as number);
    if (bc.personnel_budget) setPersonnelBudget(bc.personnel_budget as number);
    if (bc.staff?.length) setStaffPicks(bc.staff);
    setResearchResult(null);
    setResearchJobId(null);
    setStep(5);
  };

  const cancelResearch = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setResearchActive(false);
    setResearchJobId(null);
    setResearchResult(null);
  };

  const handleStart = () => {
    if (!locationId || !menuId || !equipmentId || !contractId || !capitalId) return;
    startGame({
      location: LOCATIONS.find((l) => l.id === locationId)!,
      menu: MENUS.find((m) => m.id === menuId)!,
      equipment: EQUIPMENT.find((e) => e.id === equipmentId)!,
      contract: CONTRACTS.find((c) => c.id === contractId)!,
      capital: CAPITAL_STRUCTURES.find((c) => c.id === capitalId)!,
      manager: { role: 'manager' as const, skill: managerSkill },
      personnelBudget,
      initialStaff: staffPicks,
    });
  };

  const steps = [
    { label: 'Location', done: locationId !== null },
    { label: 'Menu', done: menuId !== null },
    { label: 'Equipment', done: equipmentId !== null },
    { label: 'Supply Contract', done: contractId !== null },
    { label: 'Capital Structure', done: capitalId !== null },
    { label: 'Staffing', done: true },
  ];

  return (
    <div className="setup-screen">
      <h1 className="setup-title">Project Extraction — Setup</h1>
      <p className="setup-subtitle">Configure your coffee shop. Every choice shapes your margins.</p>

      {/* Saved Games / Journals */}
      {savedGames.length > 0 && (
        <div className="saved-games-panel">
          <div className="saved-games-header">
            <h3>📔 Saved Games</h3>
            <button className="btn-tiny" onClick={() => setShowJournalPanel(!showJournalPanel)}>
              {showJournalPanel ? 'Hide' : 'Show'}
            </button>
          </div>
          {showJournalPanel && (
            <div className="saved-games-list">
              {savedGames.slice().reverse().slice(0, 10).map((g, i) => (
                <details key={i} className="saved-game-entry">
                  <summary className="saved-game-summary">
                    <span className="sg-gameId">{g.gameId}</span>
                    <span className="sg-weeks">{g.weeks} weeks</span>
                    <span className="sg-cash">${g.summary.endCash.toLocaleString()}</span>
                  </summary>
                  <div className="saved-game-details">
                    <div className="summary-row"><span>Location</span><span className="mono">{LOCATIONS.find(l => l.id === g.summary.location)?.name || g.summary.location}</span></div>
                    <div className="summary-row"><span>Capital</span><span className="mono">{CAPITAL_STRUCTURES.find(c => c.id === g.summary.capital)?.name || g.summary.capital}</span></div>
                    <div className="summary-row"><span>Revenue</span><span className="mono">${g.summary.totalRevenue.toLocaleString()}</span></div>
                    <div className="summary-row"><span>Saved</span><span className="mono">{new Date(g.summary.timestamp).toLocaleDateString()}</span></div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step indicator */}
      <div className="step-indicator">
        {steps.map((s, i) => (
          <div key={i} className={`step-dot ${i === step ? 'active' : ''} ${s.done ? 'done' : ''}`}>
            <span className="step-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step 0: Location */}
      {step === 0 && (
        <div className="choice-grid">
          {LOCATIONS.map((loc) => (
            <button
              key={loc.id}
              className={`choice-card ${locationId === loc.id ? 'selected' : ''}`}
              onClick={() => setLocationId(loc.id)}
            >
              <h3>{loc.name}</h3>
              <div className="choice-stats">
                <span>Rent: <strong>${loc.rent.toLocaleString()}/mo</strong></span>
                <span>Traffic: <strong>{loc.baseTraffic}/day</strong></span>
                <span>Vibe: <strong>{loc.vibeBonus}x</strong></span>
              </div>
              <p className="choice-desc">{loc.trafficPattern}</p>
            </button>
          ))}
        </div>
      )}

      {/* Step 1: Menu */}
      {step === 1 && (
        <div className="choice-grid">
          {MENUS.map((m) => (
            <button
              key={m.id}
              className={`choice-card ${menuId === m.id ? 'selected' : ''}`}
              onClick={() => setMenuId(m.id)}
            >
              <h3>{m.name}</h3>
              <div className="choice-stats">
                <span>Margin: <strong>{((m.margin - 1) * 100).toFixed(0)}% markup</strong></span>
                <span>Complexity: <strong>{m.complexity}/5</strong></span>
                <span>Skill Req: <strong>{m.skillRequired}</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Equipment */}
      {step === 2 && (
        <div className="choice-grid">
          {EQUIPMENT.map((eq) => (
            <button
              key={eq.id}
              className={`choice-card ${equipmentId === eq.id ? 'selected' : ''}`}
              onClick={() => setEquipmentId(eq.id)}
            >
              <h3>{eq.name}</h3>
              <div className="choice-stats">
                <span>Upfront: <strong>${eq.upfrontCost.toLocaleString()}</strong></span>
                <span>Speed: <strong>{eq.speed} cups/hr</strong></span>
                <span>Reliability: <strong>{(eq.reliability * 100).toFixed(0)}%</strong></span>
                <span>Skill Req: <strong>{eq.staffSkillRequired}</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 3: Supply Contract */}
      {step === 3 && (
        <div className="choice-grid">
          {CONTRACTS.map((c) => (
            <button
              key={c.id}
              className={`choice-card ${contractId === c.id ? 'selected' : ''}`}
              onClick={() => setContractId(c.id)}
            >
              <h3>{c.name}</h3>
              <div className="choice-stats">
                <span>Price Variance: <strong>{(c.priceVariance * 100).toFixed(0)}%</strong></span>
                <span>Flexibility: <strong>{(c.flexibility * 100).toFixed(0)}%</strong></span>
                <span>Lead Time: <strong>{c.leadTime} days</strong></span>
                <span>Quality: <strong>{(c.quality * 100).toFixed(0)}%</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 4: Capital Structure */}
      {step === 4 && (
        <div className="choice-grid">
          {CAPITAL_STRUCTURES.map((cap) => (
            <button
              key={cap.id}
              className={`choice-card ${capitalId === cap.id ? 'selected' : ''}`}
              onClick={() => setCapitalId(cap.id)}
            >
              <h3>{cap.name}</h3>
              <div className="choice-stats">
                <span>Loan: <strong>${cap.loan.toLocaleString()}</strong></span>
                <span>Equity: <strong>${cap.equity.toLocaleString()}</strong></span>
                <span>Monthly Payment: <strong>${cap.monthlyPayment.toLocaleString()}</strong></span>
              </div>
              <p className="choice-desc">{cap.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Step 5: Manager & Staffing */}
      {step === 5 && (
        <div className="staffing-panel">
          <h3>Manager & Staffing</h3>
          <p className="choice-desc">Your manager handles hiring within budget and reports operational issues.</p>

          <div className="manager-config">
            <label className="config-group">
              <span>Manager Skill</span>
              <div className="skill-slider">
                <input
                  type="range" min="5" max="8" step="1"
                  value={managerSkill}
                  onChange={(e) => setManagerSkill(parseInt(e.target.value))}
                />
                <span>{managerSkill}/8</span>
              </div>
              <span className="config-hint">Higher skill = better waste reduction (skill × 2%)</span>
            </label>

            <label className="config-group">
              <span>Personnel Budget</span>
              <div className="skill-slider">
                <input
                  type="range" min="5000" max="20000" step="500"
                  value={personnelBudget}
                  onChange={(e) => setPersonnelBudget(parseInt(e.target.value))}
                />
                <span>${personnelBudget.toLocaleString()}/mo</span>
              </div>
              <span className="config-hint">Manager can hire/fire within this budget</span>
            </label>
          </div>

          <h4 style={{ marginTop: 16, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Initial Staff</h4>
          {staffPicks.map((sp, i) => {
            const roleDef = STAFF_ROLES.find((r) => r.role === sp.role);
            const baseSalary = roleDef?.baseSalary ?? 2500;
            const skillRange = roleDef?.skillRange ?? [1, 5];
            const salary = baseSalary + (sp.skill - skillRange[0]) * 200;
            return (
              <div key={i} className="staff-row">
                <select
                  value={sp.role}
                  onChange={(e) => {
                    const updated = [...staffPicks];
                    updated[i] = { ...updated[i], role: e.target.value };
                    setStaffPicks(updated);
                  }}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>{r.name}</option>
                  ))}
                </select>
                <div className="skill-slider">
                  <label>Skill:</label>
                  <input
                    type="range"
                    min={skillRange[0]}
                    max={skillRange[1]}
                    value={sp.skill}
                    onChange={(e) => {
                      const updated = [...staffPicks];
                      updated[i] = { ...updated[i], skill: parseInt(e.target.value) };
                      setStaffPicks(updated);
                    }}
                  />
                  <span>{sp.skill}</span>
                </div>
                <span className="staff-salary-tag">${salary.toLocaleString()}/mo</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => setStaffPicks(staffPicks.filter((_, j) => j !== i))}
                  disabled={staffPicks.length <= 1}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {staffPicks.length < 6 && (
            <button
              className="btn-small"
              onClick={() => setStaffPicks([...staffPicks, { role: 'barista', skill: 2 }])}
            >
              + Add Staff
            </button>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="setup-nav">
        <button
          className="btn"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          ← Back
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-research"
            onClick={startResearch}
            disabled={researchActive}
          >
            {researchActive ? '⏳ Researching...' : '🔬 Let AI Research'}
          </button>
          {step < 5 ? (
            <>
              <button
                className="btn btn-primary"
                disabled={!steps[step].done && step < 5}
                onClick={() => setStep(step + 1)}
              >
                Next →
              </button>
              {!steps[step].done && step < 5 && (
                <span className="setup-hint">Select a {steps[step].label.toLowerCase()} to continue</span>
              )}
            </>
          ) : (
            <button
              className="btn btn-primary btn-start"
              onClick={handleStart}
            >
              Open Shop
            </button>
          )}
        </div>
      </div>

      {/* Research Modal Overlay */}
      {researchResult && (
        <div className="research-overlay" onClick={cancelResearch}>
          <div className="research-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔬 AI Research Results</h3>
            {researchResult.status === 'running' && (
              <div className="research-progress">
                <p>Running {researchResult.completed_iterations ?? 0} / {researchResult.total} simulations...</p>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${((researchResult.completed_iterations ?? 0) / researchResult.total) * 100}%` }}
                  />
                </div>
                {researchResult.best_score != null && (
                  <p className="best-so-far">Best so far: Score {researchResult.best_score.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                )}
              </div>
            )}
            {researchResult.status === 'complete' && researchResult.best_config && (
              <div className="research-complete">
                <div className="research-score">
                  <span className="score-label">Best Score</span>
                  <span className="score-value">{researchResult.best_score.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="research-config">
                  <div className="config-row"><span>Location</span><span>{LOCATIONS.find(l => l.id === researchResult.best_config!.location)?.name}</span></div>
                  <div className="config-row"><span>Menu</span><span>{MENUS.find(m => m.id === researchResult.best_config!.menu)?.name}</span></div>
                  <div className="config-row"><span>Equipment</span><span>{EQUIPMENT.find(e => e.id === researchResult.best_config!.equipment)?.name}</span></div>
                  <div className="config-row"><span>Contract</span><span>{CONTRACTS.find(c => c.id === researchResult.best_config!.contract)?.name}</span></div>
                  <div className="config-row"><span>Capital</span><span>{CAPITAL_STRUCTURES.find(c => c.id === researchResult.best_config!.capital)?.name}</span></div>
                  <div className="config-row"><span>Staff</span><span>{researchResult.best_config.staff?.length ?? 0} barista(s)</span></div>
                </div>
                {researchResult.best_result && (
                  <div className="research-outcomes">
                    <div className="outcome-row"><span>Final Cash</span><span>${(researchResult.best_result as any).final_cash?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                    <div className="outcome-row"><span>Revenue</span><span>${(researchResult.best_result as any).total_revenue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                    <div className="outcome-row"><span>Reputation</span><span>{(researchResult.best_result as any).final_reputation?.toFixed(0)}</span></div>
                    <div className="outcome-row"><span>Days</span><span>{(researchResult.best_result as any).days_survived}</span></div>
                  </div>
                )}
                <div className="research-actions">
                  <button className="btn btn-small" onClick={cancelResearch}>Dismiss</button>
                  <button className="btn btn-primary" onClick={applyResearchResult}>Apply &amp; Review</button>
                </div>
              </div>
            )}
            {researchResult.status === 'error' && (
              <div className="research-error">
                <p>Research failed: {researchResult.error ?? 'Unknown error'}</p>
                <button className="btn btn-small" onClick={cancelResearch}>Dismiss</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
