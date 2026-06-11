import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { EventPanel } from './EventPanel';
import { STAFF_ROLES } from '../data/gameData';

const RESEARCH_URL = import.meta.env.VITE_RESEARCH_URL || 'http://localhost:8765';

export function Dashboard() {
  const {
    month, day, cash, debtRemaining, monthlyDebtPayment, reputation,
    inventory, staff, pricing, todayRevenue, todayCustomers,
    dailyRecords, activeEvents, location, menu, equipment, contract, capital,
    advanceDay, gameOver, gameOverReason, setPricing, orderInventory, resetGame,
    autoReplenish, autoAdvance, autoAdvanceSpeed,
    setAutoReplenish, setAutoAdvance, setAutoAdvanceSpeed,
    manager, personnelBudget, managerReports, todayDemandBreakdown,
    wasteReductionPct, seed, manualMode, pendingReview,
    managerReviewOpen, dismissManagerReview,
    setStaffWage, promoteStaff, demoteStaff, hireStaff, fireStaff,
    toggleReviewHistory, showReviewHistory, managerReviews,
    kpiTargets, setKpiTargets, recentAvgRevenue, recentAvgWaste, recentBadDays,
    recallReview,
    journalEntries,
  } = useGameStore();

  // AI Optimize state
  const [optimizeActive, setOptimizeActive] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<Record<string, unknown> | null>(null);

  // Hire modal
  const [showHireModal, setShowHireModal] = useState(false);
  const [hireRole, setHireRole] = useState('barista');
  const [hireSkill, setHireSkill] = useState(3);
  const [hireWage, setHireWage] = useState(2500);

  // Auto-advance interval
  const autoAdvanceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optimizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceDayRef = useRef(advanceDay);
  advanceDayRef.current = advanceDay;

  useEffect(() => {
    if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
    if (autoAdvance && !gameOver && !managerReviewOpen) {
      autoAdvanceRef.current = setInterval(() => {
        advanceDayRef.current();
      }, autoAdvanceSpeed);
    }
    return () => {
      if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
      if (optimizePollRef.current) clearInterval(optimizePollRef.current);
    };
  }, [autoAdvance, autoAdvanceSpeed, gameOver, managerReviewOpen]);

  const startOptimize = async () => {
    // Send current fixed config, let AI search pricing + staff only
    const fixedConfig: Record<string, unknown> = {};
    if (location) fixedConfig.location = location.id;
    if (menu) fixedConfig.menu = menu.id;
    if (equipment) fixedConfig.equipment = equipment.id;
    if (contract) fixedConfig.contract = contract.id;
    if (capital) fixedConfig.capital = capital.id;
    if (staff.length > 0) fixedConfig.staff = staff.map(s => ({ role: s.role, skill: s.skill }));

    try {
      const resp = await fetch(`${RESEARCH_URL}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partial_config: fixedConfig, iterations: 100 }),
      });
      const data = await resp.json();
      setOptimizeActive(true);

      optimizePollRef.current = setInterval(async () => {
        const r = await fetch(`${RESEARCH_URL}/api/research/${data.job_id}`);
        const job = await r.json();
        if (job.status === 'complete') {
          if (optimizePollRef.current) clearInterval(optimizePollRef.current);
          setOptimizeActive(false);
          setOptimizeResult(job);
        } else if (job.status === 'error') {
          if (optimizePollRef.current) clearInterval(optimizePollRef.current);
          setOptimizeActive(false);
        }
      }, 500);
    } catch {
      alert('Research server not running. Start it with: cd autoresearch && python server.py');
    }
  };

  const applyOptimizeResult = () => {
    if (!optimizeResult?.best_config) return;
    const bc = optimizeResult.best_config as Record<string, unknown>;
    if (bc.pricing) setPricing(bc.pricing as typeof pricing);
    setOptimizeResult(null);
  };

  const isGameOver = gameOver;

  // Calculate monthly totals for chart
  const chartData = dailyRecords.slice(-90).map((r) => ({
    day: r.day,
    revenue: Math.round(Number.isFinite(r.revenue) ? r.revenue : 0),
    costs: Math.round(Number.isFinite(r.costs) ? r.costs : 0),
    cash: Math.round(Number.isFinite(r.cash) ? r.cash : 0),
    reputation: Math.round(Number.isFinite(r.reputation) ? r.reputation : 0),
    profit: Math.round((Number.isFinite(r.revenue) ? r.revenue : 0) - (Number.isFinite(r.costs) ? r.costs : 0)),
  }));

  const totalEquity = cash - debtRemaining;
  const safeCash = Number.isFinite(cash) ? cash : 0;
  const safeDebt = Number.isFinite(debtRemaining) ? debtRemaining : 0;
  const safeEquity = Number.isFinite(totalEquity) ? totalEquity : 0;
  const safeRep = Number.isFinite(reputation) ? reputation : 0;
  const monthlyStaffCost = staff.reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);
  const totalWaste = dailyRecords.reduce((sum, r) => sum + (Number.isFinite(r.waste) ? r.waste : 0), 0);

  // Win/loss scoring
  const finalScore = isGameOver ? calculateScore(dailyRecords, safeCash, safeDebt, safeRep) : null;

  if (isGameOver) {
    return (
      <div className="end-screen">
        <h1>{gameOverReason}</h1>
        <div className="score-card">
          <div className="score-row">
            <span>Ending Cash</span>
            <strong>${Math.round(safeCash).toLocaleString()}</strong>
          </div>
          <div className="score-row">
            <span>Remaining Debt</span>
            <strong>-${Math.round(safeDebt).toLocaleString()}</strong>
          </div>
          <div className="score-row">
            <span>Net Equity</span>
            <strong>${Math.round(safeEquity).toLocaleString()}</strong>
          </div>
          <div className="score-row">
            <span>Final Reputation</span>
            <strong>{Math.round(safeRep)}/100</strong>
          </div>
          <div className="score-row">
            <span>Total Revenue</span>
            <strong>${Math.round(dailyRecords.reduce((s, r) => s + (Number.isFinite(r.revenue) ? r.revenue : 0), 0)).toLocaleString()}</strong>
          </div>
          <div className="score-row">
            <span>Total Waste</span>
            <strong>${Math.round(totalWaste).toLocaleString()}</strong>
          </div>
          <div className="score-row score-total">
            <span>Final Score</span>
            <strong>{Math.round(finalScore ?? 0).toLocaleString()}</strong>
          </div>
        </div>
        <button className="btn btn-primary" onClick={resetGame}>Play Again</button>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header bar */}
      <header className="dash-header">
        <div className="dash-title">
          <h1>Project Extraction</h1>
          <span className="dash-location">{location?.name} · {menu?.name}</span>
        </div>
        <div className="dash-date">
          <span className="month-badge">Month {month}/12</span>
          <span className="day-badge">Day {day}</span>
          <button className={`btn btn-advance ${managerReviewOpen ? 'btn-disabled' : ''}`} onClick={advanceDay} disabled={managerReviewOpen} title={managerReviewOpen ? 'Review pending — accept the quarterly review first' : 'Advance one day'}>
            {managerReviewOpen ? '⏸ Review Pending' : 'Advance Day ▶'}
          </button>
          <button
            className={`btn btn-auto-advance ${autoAdvance ? 'active' : ''} ${managerReviewOpen ? 'btn-disabled' : ''}`}
            onClick={() => setAutoAdvance(!autoAdvance)}
            disabled={managerReviewOpen}
            title={autoAdvance ? 'Pause auto-advance' : managerReviewOpen ? 'Review pending' : 'Start auto-advance'}
          >
            {autoAdvance ? '⏸ Auto' : '▶ Auto'}
          </button>
          <select
            className="speed-select"
            value={autoAdvanceSpeed}
            onChange={(e) => setAutoAdvanceSpeed(Number(e.target.value))}
            title="Auto-advance speed"
          >
            <option value={500}>0.5s</option>
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
          </select>
        </div>
      </header>

      {/* KPI Row */}
      <div className="kpi-row">
        <KpiCard label="Cash" value={`$${Math.round(safeCash).toLocaleString()}`} trend={safeEquity >= 0 ? 'up' : 'down'} />
        <KpiCard label="Debt" value={`$${Math.round(safeDebt).toLocaleString()}`} sub={`$${monthlyDebtPayment}/mo payment`} />
        <KpiCard label="Equity" value={`$${Math.round(safeEquity).toLocaleString()}`} trend={safeEquity > (capital?.equity ?? 0) ? 'up' : 'down'} />
        <KpiCard label="Reputation" value={`${Math.round(safeRep)}/100`} trend={safeRep > 50 ? 'up' : 'down'} />
        <KpiCard label="Today Revenue" value={`$${Math.round(todayRevenue).toLocaleString()}`} />
        <KpiCard label="Today Customers" value={todayCustomers.toString()} />
      </div>

      {/* Event Panel */}
      {activeEvents.length > 0 && <EventPanel events={activeEvents} />}

      {/* Main grid */}
      <div className="dash-grid">
        {/* Financial Chart */}
        <div className="dash-card chart-card">
          <h3>Financial Ledger</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f38" />
              <XAxis dataKey="day" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1d23', border: '1px solid #2a2f38', borderRadius: 6 }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Area type="monotone" dataKey="cash" stroke="#22c55e" fill="#22c55e22" name="Cash" strokeWidth={2} />
              <Area type="monotone" dataKey="profit" stroke="#3b82f6" fill="#3b82f622" name="Daily Profit" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Reputation Chart */}
        <div className="dash-card chart-card">
          <h3>Reputation Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f38" />
              <XAxis dataKey="day" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1d23', border: '1px solid #2a2f38', borderRadius: 6 }}
              />
              <Line type="monotone" dataKey="reputation" stroke="#f59e0b" strokeWidth={2} dot={false} name="Reputation" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pricing */}
        <div className="dash-card">
          <div className="card-header-row">
            <h3>Pricing Strategy</h3>
            <button
              className="btn-small btn-optimize"
              onClick={startOptimize}
              disabled={optimizeActive}
            >
              {optimizeActive ? '⏳...' : '🔬 Optimize'}
            </button>
          </div>
          <div className="pricing-grid">
            <PriceInput label="Drip Coffee" value={pricing.drip} onChange={(v) => setPricing({ ...pricing, drip: v })} />
            <PriceInput label="Espresso" value={pricing.espresso} onChange={(v) => setPricing({ ...pricing, espresso: v })} />
            <PriceInput label="Specialty" value={pricing.specialty} onChange={(v) => setPricing({ ...pricing, specialty: v })} />
            <PriceInput label="Food" value={pricing.food} onChange={(v) => setPricing({ ...pricing, food: v })} />
          </div>
        </div>

        {/* Inventory */}
        <div className="dash-card">
          <h3>Inventory</h3>
          <div className="inventory-list">
            {inventory.map((item) => {
              const pct = (item.quantity / item.maxQty) * 100;
              const urgency = item.daysRemaining <= 3 ? 'critical' : item.daysRemaining <= 7 ? 'warning' : '';
              const config = autoReplenish[item.category];
              return (
                <div key={item.name} className={`inv-item ${urgency}`}>
                  <div className="inv-header">
                    <span className="inv-name">{item.name}</span>
                    <span className="inv-days">{item.daysRemaining}d left</span>
                  </div>
                  <div className="inv-bar">
                    <div className="inv-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="inv-footer">
                    <span>{Math.round(item.quantity)} / {item.maxQty}</span>
                    <div className="inv-actions">
                      <button
                        className="btn-small"
                        onClick={() => orderInventory(item.category, Math.floor(item.maxQty * 0.3))}
                      >
                        Reorder
                      </button>
                      <label className="auto-replenish-toggle">
                        <input
                          type="checkbox"
                          checked={config?.enabled ?? false}
                          onChange={(e) => setAutoReplenish(item.category, { enabled: e.target.checked })}
                        />
                        <span className="toggle-label">Auto</span>
                      </label>
                    </div>
                  </div>
                  {config?.enabled && (
                    <div className="replenish-config">
                      <label>
                        Threshold
                        <input
                          type="range"
                          min="10"
                          max="60"
                          step="5"
                          value={config.thresholdPct}
                          onChange={(e) => setAutoReplenish(item.category, { thresholdPct: Number(e.target.value) })}
                        />
                        <span>{config.thresholdPct}%</span>
                      </label>
                      <label>
                        Order
                        <input
                          type="range"
                          min="20"
                          max="80"
                          step="5"
                          value={config.orderPct}
                          onChange={(e) => setAutoReplenish(item.category, { orderPct: Number(e.target.value) })}
                        />
                        <span>{config.orderPct}%</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Staff Management */}
        <div className="dash-card">
          <div className="card-header-row">
            <h3>Staff</h3>
            {manualMode && <span className="manual-badge">⚠ Manual Mode</span>}
          </div>
          <div className="staff-list">
            {staff.map((s) => {
              const canPromote = s.role !== 'manager' && s.role !== 'roaster' && !staff.some(x => x.role === (s.role === 'barista' ? 'shiftLead' : 'manager'));
              const canDemote = s.role !== 'barista';
              const canFire = s.role !== 'manager' || staff.length <= 1;
              return (
                <div key={s.id} className={`staff-item ${s.role === 'manager' ? 'is-manager' : ''} ${s.trainingDays > 0 ? 'in-training' : ''}`}>
                  <div className="staff-top">
                    <div className="staff-info">
                      <span className={`staff-role ${s.role === 'manager' ? 'role-manager' : ''}`}>{s.role}</span>
                      <span className="staff-skill">Skill {s.skill}</span>
                      {s.trainingDays > 0 && <span className="training-badge">Training {s.trainingDays}d</span>}
                    </div>
                    <div className="staff-wage">
                      <input
                        type="number"
                        min="500"
                        max="10000"
                        step="100"
                        value={s.salary}
                        onChange={(e) => setStaffWage(s.id, parseInt(e.target.value) || 0)}
                        disabled={!manualMode && s.role !== 'manager'}
                        title={manualMode ? 'Set wage' : 'Wage fixed by manager'}
                      />
                      <span className="wage-period">/mo</span>
                    </div>
                  </div>
                  <div className="staff-bottom">
                    <div className="staff-meta">
                      <span className="staff-morale">Morale: {Math.round(s.morale)}%</span>
                      <span className={`staff-perf ${s.performance < 0.7 ? 'low-perf' : ''}`}>Perf: {(s.performance * 100).toFixed(0)}%</span>
                    </div>
                    <div className="staff-actions">
                      {canPromote && <button className="btn-tiny" onClick={() => promoteStaff(s.id)} title="Promote">↑</button>}
                      {canDemote && <button className="btn-tiny" onClick={() => demoteStaff(s.id)} title="Demote">↓</button>}
                      {canFire && <button className="btn-tiny btn-danger-tiny" onClick={() => fireStaff(s.id)} title="Fire">✕</button>}
                    </div>
                  </div>
                </div>
              );
            })}
            {staff.length < 8 && (
              <button className="btn-small" style={{ marginTop: 8 }} onClick={() => setShowHireModal(true)}>
                + Hire Staff
              </button>
            )}
          </div>
          <div className="monthly-costs">
            <div className="cost-row"><span>Monthly Staff</span><span>${monthlyStaffCost.toLocaleString()}</span></div>
            <div className="cost-row"><span>Rent</span><span>${location?.rent.toLocaleString()}</span></div>
            <div className="cost-row"><span>Debt Service</span><span>${monthlyDebtPayment.toLocaleString()}</span></div>
          </div>
        </div>

        {/* Hire Modal */}
        {showHireModal && (
          <div className="research-overlay" onClick={() => setShowHireModal(false)}>
            <div className="research-modal hire-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Hire Staff</h3>
              <div className="hire-form">
                <label>
                  Role
                  <select value={hireRole} onChange={(e) => {
                    setHireRole(e.target.value);
                    const rd = STAFF_ROLES.find(r => r.role === e.target.value);
                    if (rd) {
                      setHireSkill(rd.skillRange[0]);
                      setHireWage(rd.baseSalary);
                    }
                  }}>
                    {STAFF_ROLES.map(r => <option key={r.role} value={r.role}>{r.name}</option>)}
                  </select>
                </label>
                <label>
                  Skill
                  <div className="skill-slider">
                    <input type="range"
                      min={STAFF_ROLES.find(r => r.role === hireRole)?.skillRange[0] ?? 1}
                      max={STAFF_ROLES.find(r => r.role === hireRole)?.skillRange[1] ?? 5}
                      value={hireSkill}
                      onChange={(e) => {
                        const s = parseInt(e.target.value);
                        setHireSkill(s);
                        const rd = STAFF_ROLES.find(r => r.role === hireRole);
                        if (rd) setHireWage(rd.baseSalary + (s - rd.skillRange[0]) * 200);
                      }}
                    />
                    <span>{hireSkill}</span>
                  </div>
                </label>
                <label>
                  Monthly Wage
                  <div className="skill-slider">
                    <input type="range" min="500" max="10000" step="100" value={hireWage}
                      onChange={(e) => setHireWage(parseInt(e.target.value))}
                    />
                    <span>${hireWage.toLocaleString()}</span>
                  </div>
                </label>
                <div className="hire-cost">
                  Hiring cost: <strong>${(hireWage * 0.25).toLocaleString()}</strong> (1 week wage)
                </div>
                <div className="research-actions">
                  <button className="btn btn-small" onClick={() => setShowHireModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => { hireStaff(hireRole, hireSkill, hireWage); setShowHireModal(false); }}>Hire</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Setup summary */}
        <div className="dash-card">
          <h3>Setup Summary</h3>
          <div className="summary-list">
            <div className="summary-row"><span>Equipment</span><span>{equipment?.name}</span></div>
            <div className="summary-row"><span>Contract</span><span>{contract?.name}</span></div>
            <div className="summary-row"><span>Capital</span><span>{capital?.name}</span></div>
            <div className="summary-row"><span>Seed</span><span className="mono">{seed}</span></div>
          </div>
        </div>

        {/* Manager Report */}
        <div className="dash-card">
          <div className="card-header-row">
            <h3>Manager Report</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {manager && <span className="manager-skill-badge">Skill {manager.skill}</span>}
              {managerReviews.length > 0 && !managerReviewOpen && (
                <button className="btn-tiny" onClick={recallReview} title="Recall last review">📋 Recall</button>
              )}
            </div>
          </div>
          <div className="manager-summary">
            <div className="summary-row"><span>Personnel Budget</span><span className="mono">${personnelBudget?.toLocaleString()}/mo</span></div>
            <div className="summary-row"><span>Monthly Payroll</span><span className="mono">${staff.reduce((s, m) => s + m.salary, 0).toLocaleString()}</span></div>
            <div className="summary-row"><span>Waste Reduction</span><span className="mono">{(wasteReductionPct * 100).toFixed(1)}%</span></div>
            <div className="summary-row"><span>Staff</span><span className="mono">{staff.filter(s => !s.onLeave).length} active</span></div>
          </div>
          {managerReports.length > 0 && (
            <div className="manager-reports">
              {managerReports.slice(0, 5).map((r, i) => (
                <div key={i} className={`report-item report-${r.reportType}`}>
                  <span className="report-type">{r.reportType}</span>
                  <span className="report-message">{r.message}</span>
                </div>
              ))}
            </div>
          )}
          {todayDemandBreakdown && (
            <div className="demand-breakdown">
              <h4>Today's Demand</h4>
              <div className="summary-row"><span>Base</span><span className="mono">{todayDemandBreakdown.baseTraffic}</span></div>
              <div className="summary-row"><span>Rep ×</span><span className="mono">{todayDemandBreakdown.repMult}</span></div>
              <div className="summary-row"><span>Day-of-week</span><span className="mono">{todayDemandBreakdown.dow}</span></div>
              <div className="summary-row"><span>Seasonal</span><span className="mono">{todayDemandBreakdown.seasonal}</span></div>
              <div className="summary-row"><span>Noise (Gaussian)</span><span className="mono">{todayDemandBreakdown.gaussian}</span></div>
              <div className="summary-row"><span>Shock</span><span className="mono">{todayDemandBreakdown.shock} ({todayDemandBreakdown.shockSource})</span></div>
            </div>
          )}
          {/* Reputation Dynamics */}
          <div className="rep-dynamics">
            <h4>Reputation Health</h4>
            <div className="summary-row"><span>30d Avg Revenue</span><span className={`mono trend-${recentAvgRevenue > 300 ? 'up' : 'down'}`}>${recentAvgRevenue.toLocaleString()}/day</span></div>
            <div className="summary-row"><span>30d Avg Waste</span><span className={`mono trend-${recentAvgWaste < 100 ? 'up' : 'down'}`}>${recentAvgWaste.toLocaleString()}/day</span></div>
            <div className="summary-row"><span>Bad Review Streak</span><span className={`mono ${recentBadDays >= 2 ? 'danger-streak' : ''}`}>{recentBadDays >= 2 ? `${recentBadDays.toFixed(1)} days ⚠` : '—'}</span></div>
            <div className="summary-row"><span>Rep Ceiling</span><span className="mono">95 max</span></div>
            {manualMode && <div className="summary-row rep-manual"><span>No manager</span><span className="mono">No recovery boost</span></div>}
          </div>
        </div>

        {/* Weekly Journal */}
        <div className="dash-card">
          <div className="card-header-row">
            <h3>📔 Weekly Journal</h3>
            <span className="journal-badge">{journalEntries.length} week{journalEntries.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="journal-list">
            {journalEntries.length === 0 && <p className="journal-empty">Journal entries compile every 7 days. Keep playing!</p>}
            {journalEntries.slice(-5).reverse().map((j, i) => (
              <details key={i} className="journal-entry">
                <summary className="journal-summary">
                  <span className="journal-week">Week {j.week}</span>
                  <span className="journal-days">Day {j.days[0]}-{j.days[1]}</span>
                  <span className="journal-config">{j.location} · {j.capital}</span>
                  <span className={`journal-rev ${j.avgDailyProfit >= 0 ? 'profit-up' : 'profit-down'}`}>
                    ${j.avgDailyProfit.toLocaleString()}/day
                  </span>
                </summary>
                <div className="journal-details">
                  <div className="journal-section">
                    <h5>Financials</h5>
                    <div className="summary-row"><span>Revenue</span><span className="mono">${j.totalRevenue.toLocaleString()}</span></div>
                    <div className="summary-row"><span>Costs</span><span className="mono">${j.totalCosts.toLocaleString()}</span></div>
                    <div className="summary-row"><span>Waste/Day</span><span className="mono">${j.avgDailyWaste.toLocaleString()}</span></div>
                    <div className="summary-row"><span>End Cash</span><span className={`mono ${j.endCash < 0 ? 'danger' : ''}`}>${j.endCash.toLocaleString()}</span></div>
                  </div>
                  <div className="journal-section">
                    <h5>Customers</h5>
                    <div className="summary-row"><span>Total</span><span className="mono">{j.totalCustomers.toLocaleString()}</span></div>
                    <div className="summary-row"><span>Avg/Day</span><span className="mono">{j.avgDailyCustomers.toLocaleString()}</span></div>
                    <div className="summary-row"><span>Bad Review Days</span><span className={`mono ${j.badReviewDays > 0 ? 'danger' : ''}`}>{j.badReviewDays}</span></div>
                  </div>
                  <div className="journal-section">
                    <h5>Staff ({j.staffCount} active)</h5>
                    {j.staffSnapshot.map((s, k) => (
                      <div key={k} className="journal-staff">
                        <span className="staff-role">{s.role}</span>
                        <span className="mono">skill {s.skill}</span>
                        <span className={`mono morale-${s.morale >= 60 ? 'good' : s.morale >= 30 ? 'warn' : 'bad'}`}>{s.morale}%</span>
                      </div>
                    ))}
                    <div className="summary-row"><span>Avg Morale</span><span className="mono">{j.avgMorale}%</span></div>
                    {j.hiresThisWeek > 0 && <div className="summary-row"><span>Hired</span><span className="mono">{j.hiresThisWeek}</span></div>}
                    {j.quitsThisWeek > 0 && <div className="summary-row"><span>Quit</span><span className="mono danger">{j.quitsThisWeek}</span></div>}
                  </div>
                  {j.managerActive && (
                    <div className="journal-section">
                      <h5>Manager</h5>
                      <div className="summary-row"><span>Skill</span><span className="mono">{j.managerSkill}</span></div>
                      <div className="summary-row"><span>Waste Reduction</span><span className="mono">{j.wasteReduction}%</span></div>
                    </div>
                  )}
                  {j.notes.length > 0 && (
                    <div className="journal-section">
                      <h5>Notes</h5>
                      {j.notes.map((n, k) => <div key={k} className="journal-note">{n}</div>)}
                    </div>
                  )}
                  {j.events.length > 0 && (
                    <div className="journal-section">
                      <h5>Events</h5>
                      {j.events.map((e, k) => <div key={k} className="journal-event">{e}</div>)}
                    </div>
                  )}
                  <div className="journal-section">
                    <h5>Pricing</h5>
                    <div className="summary-row"><span>Drip</span><span className="mono">${j.pricing.drip.toFixed(2)}</span></div>
                    <div className="summary-row"><span>Espresso</span><span className="mono">${j.pricing.espresso.toFixed(2)}</span></div>
                    <div className="summary-row"><span>Specialty</span><span className="mono">${j.pricing.specialty.toFixed(2)}</span></div>
                    <div className="summary-row"><span>Food</span><span className="mono">${j.pricing.food.toFixed(2)}</span></div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Manager Review Modal */}
      {managerReviewOpen && pendingReview && (
        <div className="research-overlay">
          <div className="research-modal review-modal" onClick={(e) => e.stopPropagation()}>
            <h3>📋 Quarterly Review — Day {pendingReview.totalDay}</h3>

            {/* KPI Targets vs Actual */}
            <div className="review-targets">
              <h4>KPI Targets vs Actual</h4>
              <div className="target-row">
                <span>Revenue/Day</span>
                <span className={`target-val ${pendingReview.results.revenueMet ? 'met' : 'miss'}`}>
                  ${pendingReview.kpis.avgDailyRevenue.toLocaleString()}
                </span>
                <span className="target-arrow">→</span>
                <span className="target-label">${pendingReview.targets.revenueTarget.toLocaleString()}</span>
                <span className={`target-badge ${pendingReview.results.revenueMet ? 'met' : 'miss'}`}>
                  {pendingReview.results.revenueMet ? '✓' : '✗'}
                </span>
              </div>
              <div className="target-row">
                <span>Waste/Day</span>
                <span className={`target-val ${pendingReview.results.wasteMet ? 'met' : 'miss'}`}>
                  ${pendingReview.kpis.avgWaste.toLocaleString()}
                </span>
                <span className="target-arrow">≤</span>
                <span className="target-label">${pendingReview.targets.wasteTarget.toLocaleString()}</span>
                <span className={`target-badge ${pendingReview.results.wasteMet ? 'met' : 'miss'}`}>
                  {pendingReview.results.wasteMet ? '✓' : '✗'}
                </span>
              </div>
              <div className="target-row">
                <span>Avg Morale</span>
                <span className={`target-val ${pendingReview.results.moraleMet ? 'met' : 'miss'}`}>
                  {pendingReview.kpis.avgMorale}%
                </span>
                <span className="target-arrow">≥</span>
                <span className="target-label">{pendingReview.targets.moraleTarget}%</span>
                <span className={`target-badge ${pendingReview.results.moraleMet ? 'met' : 'miss'}`}>
                  {pendingReview.results.moraleMet ? '✓' : '✗'}
                </span>
              </div>
            </div>

            {/* Score & Consequences */}
            <div className={`review-score ${pendingReview.results.score}`}>
              <span className="score-grade">{pendingReview.results.score.toUpperCase()}</span>
              <span className="score-count">{pendingReview.results.targetsMetCount}/3 targets</span>
            </div>
            <div className="review-consequences">
              {pendingReview.consequences.map((c, i) => (
                <div key={i} className="consequence-item">{c}</div>
              ))}
            </div>

            {/* Manager Stats */}
            <div className="review-manager">
              <h4>Manager</h4>
              <div className="mgr-stats">
                <span>Skill {pendingReview.manager.skill}</span>
                <span>${pendingReview.manager.salary.toLocaleString()}/mo</span>
                <span>Morale {pendingReview.manager.morale}%</span>
                <span>Waste -{pendingReview.manager.wasteReduction}%</span>
                <span>Hires: {pendingReview.manager.hiresMade}</span>
                <span>Lost: {pendingReview.manager.staffQuit}</span>
              </div>
            </div>

            {/* KPI Targets for next period */}
            <div className="review-next-targets">
              <h4>Next Period Targets</h4>
              <div className="target-inputs">
                <label>Revenue/Day: <input type="number" value={kpiTargets.revenueTarget} step="50"
                  onChange={(e) => setKpiTargets({...kpiTargets, revenueTarget: parseInt(e.target.value) || 0})} /></label>
                <label>Waste Max: <input type="number" value={kpiTargets.wasteTarget} step="25"
                  onChange={(e) => setKpiTargets({...kpiTargets, wasteTarget: parseInt(e.target.value) || 0})} /></label>
                <label>Morale Min: <input type="number" value={kpiTargets.moraleTarget} step="5" min="0" max="100"
                  onChange={(e) => setKpiTargets({...kpiTargets, moraleTarget: parseInt(e.target.value) || 0})} /></label>
              </div>
            </div>

            <div className="research-actions review-actions">
              <button className="btn btn-primary btn-accept" onClick={dismissManagerReview}>
                ✓ Accept &amp; Continue
              </button>
              <button className="btn btn-small" onClick={toggleReviewHistory}>📜 History</button>
              <button className="btn btn-small btn-optimize" onClick={() => { demoteStaff(manager?.id ?? ''); dismissManagerReview(); }}>Demote Manager</button>
              <button className="btn btn-danger" onClick={() => { fireStaff(manager?.id ?? ''); dismissManagerReview(); }}>Fire → Manual</button>
            </div>
          </div>
        </div>
      )}

      {/* Review History Panel */}
      {showReviewHistory && (
        <div className="research-overlay" onClick={toggleReviewHistory}>
          <div className="research-modal history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <h3>📜 Review History</h3>
              <button className="btn-tiny" onClick={toggleReviewHistory}>✕</button>
            </div>
            {managerReviews.length === 0 && <p className="no-history">No reviews yet.</p>}
            {managerReviews.map((rev, i) => (
              <div key={i} className="history-item">
                <div className="history-day">Day {rev.totalDay}</div>
                <div className="history-score">{rev.results.score}</div>
                <div className="history-targets">
                  <span>Rev ${rev.kpis.avgDailyRevenue.toLocaleString()}/{rev.targets.revenueTarget}</span>
                  <span>Waste ${rev.kpis.avgWaste.toLocaleString()}/{rev.targets.wasteTarget}</span>
                  <span>Morale {rev.kpis.avgMorale}%/{rev.targets.moraleTarget}%</span>
                </div>
                <div className="history-consequences">
                  {rev.consequences.map((c, j) => <div key={j}>{c}</div>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optimize Result Modal */}
      {optimizeResult && !!(optimizeResult as Record<string, unknown>).best_config && (
        <div className="research-overlay" onClick={() => setOptimizeResult(null)}>
          <div className="research-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔬 Optimization Results</h3>
            <>
                <div className="research-score">
                  <span className="score-label">Best Score</span>
                  <span className="score-value">{((optimizeResult as Record<string, unknown>).best_score as number)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="research-config">
                  <div className="config-row"><span>Drip</span><span>${(optimizeResult.best_config as Record<string, any>).pricing?.drip}</span></div>
                  <div className="config-row"><span>Espresso</span><span>${(optimizeResult.best_config as Record<string, any>).pricing?.espresso}</span></div>
                  <div className="config-row"><span>Specialty</span><span>${(optimizeResult.best_config as Record<string, any>).pricing?.specialty}</span></div>
                  <div className="config-row"><span>Food</span><span>${(optimizeResult.best_config as Record<string, any>).pricing?.food}</span></div>
                </div>
                {(optimizeResult as Record<string, unknown>).best_result && (
                  <div className="research-outcomes">
                    <div className="outcome-row"><span>Cash</span><span>${((optimizeResult.best_result as Record<string, any>).final_cash)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                    <div className="outcome-row"><span>Revenue</span><span>${((optimizeResult.best_result as Record<string, any>).total_revenue)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                  </div>
                )}
                <div className="research-actions">
                  <button className="btn btn-small" onClick={() => setOptimizeResult(null)}>Dismiss</button>
                  <button className="btn btn-primary" onClick={applyOptimizeResult}>Apply Pricing</button>
                </div>
              </>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: 'up' | 'down' }) {
  return (
    <div className={`kpi-card ${trend ? `trend-${trend}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="price-input">
      <label>{label}</label>
      <input
        type="number"
        step="0.25"
        min="1"
        max="15"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

function calculateScore(records: { revenue: number }[], cash: number, debt: number, reputation: number): number {
  const totalRevenue = records.reduce((s, r) => s + r.revenue, 0);
  return (cash - debt) + (reputation * 100) + (totalRevenue * 0.02);
}
