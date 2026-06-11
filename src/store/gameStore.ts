import { create } from 'zustand';
import type { GameState, SetupConfig, PricingStrategy, StaffMember, DailyRecord, AutoReplenishConfig, ManagerReport, WeeklyJournalEntry, ManagerReview, DemandBreakdown } from '../types';
import { defaultInventory, DEFAULT_PRICING, STAFF_ROLES } from '../data/gameData';
import { SeededRNG } from './rng';

const TOTAL_DAYS = 360;
const DAYS_PER_MONTH = 30;

// ── Demand model data (matches demand.py) ──────────────────────────

const DOW_MODIFIERS: Record<string, number[]> = {
  urban:      [1.0, 1.0, 1.0, 1.0, 1.0, 0.7, 0.5],
  suburban:   [0.9, 0.9, 0.9, 0.9, 1.0, 1.2, 1.1],
  mall:       [0.7, 0.7, 0.7, 0.8, 1.0, 1.4, 1.3],
  office:     [1.0, 1.0, 1.0, 1.0, 1.0, 0.1, 0.05],
  university: [1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 0.4],
};

const SEASONAL_MODIFIERS: Record<string, number[]> = {
  urban:      [0.9, 0.9, 0.95, 1.0, 1.0, 1.0, 0.9, 0.9, 1.0, 1.0, 1.0, 1.1],
  suburban:   [0.95, 0.95, 1.0, 1.0, 1.0, 0.95, 0.9, 0.9, 1.05, 1.0, 1.0, 1.05],
  mall:       [1.1, 1.0, 0.9, 0.9, 0.9, 0.95, 1.0, 1.0, 0.95, 1.0, 1.1, 1.3],
  office:     [0.9, 0.95, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 1.0, 1.0, 1.0, 0.8],
  university: [0.7, 0.7, 1.0, 1.0, 1.0, 0.5, 0.3, 0.3, 1.0, 1.0, 1.0, 0.6],
};

interface ShockDef {
  name: string;
  prob: number;
  dist: 'uniform' | 'pareto' | 'fixed';
  low: number;
  high: number;
}

const SHOCKS: ShockDef[] = [
  { name: 'weather_bad',  prob: 0.08,  dist: 'uniform', low: -0.30, high: -0.05 },
  { name: 'weather_good', prob: 0.06,  dist: 'uniform', low:  0.05, high:  0.25 },
  { name: 'local_event',  prob: 0.03,  dist: 'pareto',  low:  0.10, high:  0.80 },
  { name: 'construction', prob: 0.015, dist: 'fixed',   low: -0.35, high: -0.35 },
  { name: 'competitor',   prob: 0.02,  dist: 'uniform', low: -0.20, high: -0.05 },
  { name: 'viral_post',   prob: 0.01,  dist: 'pareto',  low:  0.15, high:  1.00 },
];

const DEFAULT_AUTO_REPLENISH: Record<string, AutoReplenishConfig> = {
  beans: { enabled: true, thresholdPct: 20, orderPct: 50 },
  dairy: { enabled: true, thresholdPct: 25, orderPct: 60 },
  syrup: { enabled: true, thresholdPct: 20, orderPct: 40 },
  pastry: { enabled: true, thresholdPct: 30, orderPct: 50 },
  supplies: { enabled: true, thresholdPct: 20, orderPct: 50 },
};

let staffIdCounter = 0;
function nextStaffId(): string {
  return `staff-${++staffIdCounter}`;
}

// ── Demand generation (matches demand.py generate_demand) ──────────

function generateDemand(
  baseTraffic: number, locationId: string, totalDay: number,
  month: number, rng: SeededRNG, reputation: number,
): { customers: number; breakdown: DemandBreakdown } {
  const repMult = 0.5 + (reputation / 100) * 0.8;
  const dow = (totalDay - 1) % 7;
  const dowMod = (DOW_MODIFIERS[locationId] ?? DOW_MODIFIERS.urban)[dow];
  const seasonal = (SEASONAL_MODIFIERS[locationId] ?? SEASONAL_MODIFIERS.urban)[(month - 1) % 12];
  let gaussian = rng.nextGaussian(1.0, 0.12);
  gaussian = Math.max(0.5, Math.min(1.5, gaussian));

  let shock = 1.0;
  let shockSource = 'none';
  for (const s of SHOCKS) {
    if (rng.next() < s.prob) {
      if (s.dist === 'uniform') {
        shock = 1.0 + s.low + rng.next() * (s.high - s.low);
      } else if (s.dist === 'pareto') {
        const raw = rng.nextPareto(2.5);
        const norm = Math.min(3.0, (raw - 1.0) / (2.5 / 1.5 - 1.0));
        const val = Math.max(s.low, Math.min(s.high, s.low + norm * (s.high - s.low)));
        shock = 1.0 + val;
      } else {
        shock = 1.0 + s.low;
      }
      shockSource = s.name;
      break;
    }
  }

  const effective = baseTraffic * repMult * dowMod * seasonal * gaussian * shock;
  const customers = Math.max(0, Math.round(effective));

  return {
    customers,
    breakdown: {
      baseTraffic, repMult: +repMult.toFixed(3), dow: +dowMod.toFixed(2),
      seasonal: +seasonal.toFixed(2), gaussian: +gaussian.toFixed(3),
      shock: +shock.toFixed(3), shockSource, effectiveDemand: +effective.toFixed(1),
    },
  };
}

// ── Labor management (matches labor.py) ────────────────────────────

const MAX_UTIL = 45;
const MIN_UTIL = 10;
const TRAINING_DAYS = 3;

function createDailyRecord(day: number, cash: number, debt: number, rep: number): DailyRecord {
  return {
    day,
    revenue: 0,
    costs: 0,
    waste: 0,
    customers: 0,
    reputation: rep,
    cash,
    debtRemaining: debt,
  };
}

export const useGameStore = create<GameState>((set, get) => ({
  // ─── Initial state ───────────────────────────────────────────────
  phase: 'setup',
  location: null,
  menu: null,
  equipment: null,
  contract: null,
  capital: null,
  pricing: { ...DEFAULT_PRICING },

  manager: null,
  personnelBudget: 10000,
  managerReports: [],
  manualMode: false,
  managerReviews: [],
  managerReviewOpen: false,
  pendingReview: null,
  showReviewHistory: false,
  kpiTargets: { revenueTarget: 0, wasteTarget: 0, moraleTarget: 0 },
  staffKPIs: {},
  hiresMade: 0,
  staffQuit: 0,
  recentAvgRevenue: 0,
  recentAvgWaste: 0,
  recentBadDays: 0,
  journalEntries: [],
  weekStartDay: 1,
  weekStartCash: 0,
  weekStartStaff: 0,

  month: 1,
  day: 1,
  totalDay: 1,
  seed: 42,

  cash: 0,
  debtRemaining: 0,
  monthlyDebtPayment: 0,

  reputation: 50,
  inventory: [],
  staff: [],

  dailyRecords: [],
  activeEvents: [],
  resolvedEvents: [],

  todayRevenue: 0,
  todayCosts: 0,
  todayWaste: 0,
  todayCustomers: 0,
  todayDemandBreakdown: null,
  wasteReductionPct: 0,

  autoReplenish: { ...DEFAULT_AUTO_REPLENISH },
  autoAdvance: false,
  autoAdvanceSpeed: 2000,

  gameId: '',

  gameOver: false,
  gameOverReason: undefined,

  // ─── Actions ─────────────────────────────────────────────────────

  startGame: (config: SetupConfig) => {
    staffIdCounter = 0;
    const { location, menu, equipment, contract, capital, manager, personnelBudget, initialStaff } = config;

    // Upfront costs
    const upfrontEquipment = equipment.upfrontCost;
    const firstMonthRent = location.rent;
    const initialInvCost = defaultInventory(contract).reduce((sum, i) => sum + i.quantity * i.costPerUnit, 0);
    const remainingCash = capital.equity - upfrontEquipment - firstMonthRent - initialInvCost;

    // Manager
    const mgrRoleDef = STAFF_ROLES.find((r) => r.role === 'manager')!;
    const mgrSkillBonus = (manager.skill - mgrRoleDef.skillRange[0]) * 200;
    const mgrSalary = mgrRoleDef.baseSalary + mgrSkillBonus;
    const mgrStaff: StaffMember = {
      id: nextStaffId(),
      role: 'manager',
      skill: manager.skill,
      salary: mgrSalary,
      morale: 70,
      weeksEmployed: 0,
      onLeave: false,
      performance: 1.0,
      trainingDays: 0,
    };

    // Initial staff
    let builtStaff: StaffMember[] = [mgrStaff, ...initialStaff.map((s) => {
      const roleDef = STAFF_ROLES.find((r) => r.role === s.role)!;
      const skillBonus = (s.skill - roleDef.skillRange[0]) * 200;
      return {
        id: nextStaffId(),
        role: s.role as StaffMember['role'],
        skill: s.skill,
        salary: roleDef.baseSalary + skillBonus,
        morale: 70,
        weeksEmployed: 0,
        onLeave: false,
        performance: 1.0,
        trainingDays: 0,
      };
    })];

    // Warn if over budget — but DON'T auto-fire at start. Let the daily payroll cost
    // drain naturally. The manager will report the budget issue each day.
    const totalPayroll = builtStaff.reduce((sum, s) => sum + s.salary, 0);
    const overBudgetReports: ManagerReport[] = [];
    if (totalPayroll > personnelBudget) {
      overBudgetReports.push({ message: `Payroll $${totalPayroll.toLocaleString()} exceeds budget $${personnelBudget.toLocaleString()} — manager must reduce staff`, reportType: 'warning' });
    }
    // Manual mode only if the manager themselves can't be paid
    const manualMode = false;

    const seed = Math.floor(Math.random() * 2147483646) + 1;
    const gameId = `${config.location}-${config.capital}-${seed}`;

    set({
      phase: 'playing',
      location, menu, equipment, contract, capital,
      manager: mgrStaff,
      personnelBudget,
      managerReports: overBudgetReports,
      manualMode,
      managerReviews: [],
      managerReviewOpen: false,
      pendingReview: null,
      showReviewHistory: false,
      kpiTargets: { revenueTarget: 500, wasteTarget: 200, moraleTarget: 60 },
      staffKPIs: {},
      hiresMade: 0,
      staffQuit: 0,
      recentAvgRevenue: 0,
      recentAvgWaste: 0,
      recentBadDays: 0,
      journalEntries: [],
      weekStartDay: 1,
      weekStartCash: remainingCash,
      weekStartStaff: builtStaff.length,
      gameId,
      cash: remainingCash,
      debtRemaining: capital.loan,
      monthlyDebtPayment: capital.monthlyPayment,
      reputation: 50 + contract.quality * 10 - equipment.staffSkillRequired * 2,
      inventory: defaultInventory(contract),
      staff: builtStaff,
      seed,
      dailyRecords: [createDailyRecord(1, remainingCash, capital.loan, 50)],
      activeEvents: [], resolvedEvents: [],
      todayRevenue: 0, todayCosts: 0, todayWaste: 0, todayCustomers: 0,
      todayDemandBreakdown: null,
      wasteReductionPct: 0,
      gameOver: false,
    });
  },

  setPricing: (pricing: PricingStrategy) => {
    set({ pricing });
  },

  orderInventory: (category: string, qty: number) => {
    const { inventory } = get();
    const updated = inventory.map((item) => {
      if (item.category === category) {
        const actualQty = Math.min(qty, item.maxQty - item.quantity);
        return { ...item, quantity: item.quantity + actualQty, daysRemaining: item.shelfLifeDays };
      }
      return item;
    });
    const totalCost = updated.reduce((sum, item) => {
      const orig = inventory.find((i) => i.name === item.name)!;
      const diff = item.quantity - orig.quantity;
      return sum + diff * item.costPerUnit;
    }, 0);

    set({ inventory: updated, cash: get().cash - totalCost });
  },

  setAutoReplenish: (category: string, config: Partial<AutoReplenishConfig>) => {
    const { autoReplenish } = get();
    set({
      autoReplenish: {
        ...autoReplenish,
        [category]: { ...autoReplenish[category], ...config },
      },
    });
  },

  setPersonnelBudget: (budget: number) => {
    set({ personnelBudget: budget });
  },

  setStaffWage: (id: string, wage: number) => {
    const { staff, personnelBudget } = get();
    if (!Number.isFinite(wage)) return;
    const others = staff.filter(s => s.id !== id);
    const othersPayroll = others.reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);
    if (othersPayroll + wage > personnelBudget) return; // can't exceed budget
    const updated = staff.map(s => s.id === id ? { ...s, salary: wage } : s);
    set({ staff: updated });
  },

  promoteStaff: (id: string) => {
    const { staff } = get();
    const s = staff.find(x => x.id === id);
    if (!s) return;
    const roleUpgrades: Record<string, StaffMember['role'] | null> = {
      barista: 'shiftLead',
      shiftLead: 'manager',
      roaster: null,
      manager: null,
    };
    const newRole = roleUpgrades[s.role];
    if (!newRole || staff.some(x => x.role === newRole)) return; // already have one or no upgrade
    const roleDef = STAFF_ROLES.find(r => r.role === newRole)!;
    const maxSkill = roleDef.skillRange[1];
    const newSkill = Math.min(maxSkill, s.skill + 1);
    const salary = roleDef.baseSalary + (newSkill - roleDef.skillRange[0]) * 200;
    const updated = staff.map(x => x.id === id
      ? { ...x, role: newRole, skill: newSkill, salary, morale: Math.min(100, x.morale + 10), performance: 1.0, trainingDays: 2 }
      : x
    );
    set({ staff: updated, managerReports: [{ message: `${s.role} promoted to ${newRole} (skill ${newSkill})`, reportType: 'info' as const }, ...get().managerReports].slice(0, 20) });
  },

  demoteStaff: (id: string) => {
    const { staff } = get();
    const s = staff.find(x => x.id === id);
    if (!s) return;
    const roleDowngrades: Record<string, StaffMember['role'] | null> = {
      barista: null,
      shiftLead: 'barista',
      roaster: 'barista',
      manager: 'shiftLead',
    };
    const newRole = roleDowngrades[s.role];
    if (!newRole) return;
    const roleDef = STAFF_ROLES.find(r => r.role === newRole)!;
    const cappedSkill = Math.min(roleDef.skillRange[1], s.skill);
    const salary = roleDef.baseSalary + (cappedSkill - roleDef.skillRange[0]) * 200;
    const updated = staff.map(x => x.id === id
      ? { ...x, role: newRole, skill: cappedSkill, salary, morale: Math.max(0, x.morale - 20), performance: 1.0, trainingDays: 1 }
      : x
    );
    set({ staff: updated, managerReports: [{ message: `${s.role} demoted to ${newRole}`, reportType: 'warning' as const }, ...get().managerReports].slice(0, 20) });
  },

  hireStaff: (role: string, skill: number, salaryOverride?: number) => {
    const { cash, staff, personnelBudget } = get();
    if (staff.length >= 8) return;

    const roleDef = STAFF_ROLES.find((r) => r.role === role);
    if (!roleDef) return;

    const salary = salaryOverride ?? (roleDef.baseSalary + (skill - roleDef.skillRange[0]) * 200);
    const monthlyPayroll = staff.reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);
    if (monthlyPayroll + salary > personnelBudget) return; // can't afford payroll

    // Hiring cost: 1 week of salary as onboarding
    const hiringCost = salary * 0.25;
    if (cash < hiringCost) return; // can't afford

    const newStaff: StaffMember = {
      id: nextStaffId(),
      role: role as StaffMember['role'],
      skill,
      salary,
      morale: 60,
      weeksEmployed: 0,
      onLeave: false,
      performance: 0.5,
      trainingDays: TRAINING_DAYS,
    };

    set({
      staff: [...staff, newStaff],
      cash: cash - hiringCost,
      hiresMade: get().hiresMade + 1,
    });
  },

  fireStaff: (id: string) => {
    const { staff, manager } = get();
    const target = staff.find(s => s.id === id);
    if (!target) return;

    let updatedStaff = staff.filter(s => s.id !== id);

    // If firing the manager → enter manual mode
    let newManualMode = false;
    let newManager = manager;
    if (target.role === 'manager') {
      newManualMode = true;
      newManager = null;
    }

    const reportType: 'alert' | 'info' = target.role === 'manager' ? 'alert' : 'info';
    set({
      staff: updatedStaff,
      manager: newManager,
      manualMode: newManualMode,
      managerReports: [{ message: `${target.role} (skill ${target.skill}) was fired.`, reportType }, ...get().managerReports].slice(0, 20),
    });
  },

  dismissManagerReview: () => {
    const { pendingReview, managerReviews } = get();
    set({
      managerReviews: pendingReview ? [...managerReviews, pendingReview] : managerReviews,
      managerReviewOpen: false,
      pendingReview: null,
    });
  },

  recallReview: () => {
    const { managerReviews, pendingReview, managerReviewOpen } = get();
    if (pendingReview || managerReviewOpen || managerReviews.length === 0) return;
    const last = managerReviews[managerReviews.length - 1];
    set({
      pendingReview: last,
      managerReviewOpen: true,
      managerReviews: managerReviews.slice(0, -1),
    });
  },

  replaceManager: (skill: number, salary: number) => {
    const { cash, staff, personnelBudget } = get();
    // Remove old manager if exists
    const withoutOld = staff.filter(s => s.role !== 'manager');
    const othersPayroll = withoutOld.reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);
    if (othersPayroll + salary > personnelBudget) return;
    if (cash < salary * 0.25) return; // hiring cost

    const newMgr: StaffMember = {
      id: nextStaffId(),
      role: 'manager',
      skill,
      salary,
      morale: 70,
      weeksEmployed: 0,
      onLeave: false,
      performance: 1.0,
      trainingDays: 3,
    };

    set({
      staff: [...withoutOld, newMgr],
      manager: newMgr,
      manualMode: false,
      cash: cash - salary * 0.25,
      hiresMade: get().hiresMade + 1,
      managerReports: [{ message: `New manager hired (skill ${skill}, $${salary.toLocaleString()}/mo)`, reportType: 'info' as const }, ...get().managerReports].slice(0, 20),
    });
  },

  toggleReviewHistory: () => {
    set({ showReviewHistory: !get().showReviewHistory });
  },

  setKpiTargets: (targets) => {
    set({ kpiTargets: targets });
  },

  saveJournalEntry: (entry) => {
    const RESEARCH_URL = typeof window !== 'undefined' ? (import.meta as any).env?.VITE_RESEARCH_URL || 'http://localhost:8765' : 'http://localhost:8765';
    fetch(`${RESEARCH_URL}/api/journal/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: entry.gameId, entry }),
    }).catch(() => {});
  },

  setAutoAdvance: (enabled: boolean) => {
    set({ autoAdvance: enabled });
  },

  setAutoAdvanceSpeed: (speed: number) => {
    set({ autoAdvanceSpeed: speed });
  },

  resolveEvent: (eventId: string, choiceIndex: number) => {
    const { activeEvents, resolvedEvents, cash, reputation } = get();
    const event = activeEvents.find((e) => e.id === eventId);
    if (!event || !event.choices[choiceIndex]) return;

    const choice = event.choices[choiceIndex];
    const newCash = cash + (choice.effects.cashDelta ?? 0);
    const newRep = Math.max(0, Math.min(100, reputation + (choice.effects.reputationDelta ?? 0)));

    set({
      cash: newCash,
      reputation: newRep,
      activeEvents: activeEvents.filter((e) => e.id !== eventId),
      resolvedEvents: [
        ...resolvedEvents,
        { ...event, resolved: true, outcome: choice.label },
      ],
    });
  },

  advanceDay: () => {
    const state = get();
    if (state.gameOver || state.phase !== 'playing') return;
    // Auto-dismiss stale review if pendingReview is null (modal invisible but flag stuck)
    if (state.managerReviewOpen && !state.pendingReview) {
      set({ managerReviewOpen: false });
    }
    // Block advance while review modal is visible — must accept/dismiss first
    if (get().managerReviewOpen) return;

    const { location, menu, equipment, contract, capital, pricing,
      cash, debtRemaining, monthlyDebtPayment, reputation, inventory,
      staff, month, day, totalDay, dailyRecords, activeEvents,
      autoReplenish, personnelBudget, seed, managerReports,
      journalEntries, gameId, kpiTargets: stateKpiTargets, manualMode: isManual,
      weekStartDay, weekStartCash,
    } = state;

    if (!location || !menu || !equipment || !contract || !capital) return;

    // Guard: if cash is already bad, sanitize before proceeding
    const safeCash = Number.isFinite(cash) ? cash : 0;

    const rng = new SeededRNG(seed + totalDay); // deterministic per day

    let newCash = safeCash;
    let newDebt = debtRemaining;
    let newRep = reputation;
    let todayRevenue = 0;
    let todayCosts = 0;
    let todayWaste = 0;
    let todayCustomers = 0;
    const reports: ManagerReport[] = [];
    let nextKpiTargets: { revenueTarget: number; wasteTarget: number; moraleTarget: number } | null = null;

    // ── A. Demand (mixed distributions) ──
    const { customers, breakdown } = generateDemand(
      location.baseTraffic, location.id, totalDay, month, rng, newRep,
    );
    todayCustomers = customers;

    // ── B. Labor management ──
    const activeStaff = staff.filter(s => !s.onLeave);
    const activeCount = Math.max(1, activeStaff.length);
    const util = todayCustomers / activeCount;

    let updatedStaff = staff;
    let wasteReductionPct = 0;
    let newHiresMade = get().hiresMade;
    let newStaffQuit = get().staffQuit;

    if (!isManual && activeCount > 0) {
      // Manager is active — handle morale, turnover, auto-hire
      updatedStaff = staff.map(s => {
        if (s.onLeave) return s;
        let morale = s.morale;
        if (util > MAX_UTIL) { morale -= 2; s.performance = Math.max(0.5, s.performance - 0.015); }
        else if (util < MIN_UTIL) { morale -= 0.3; }
        else { morale += 0.1; }
        morale = Math.max(0, Math.min(100, morale));
        return { ...s, morale, performance: s.performance, weeksEmployed: s.weeksEmployed + 1/365 };
      });

      // Turnover
      const kept: StaffMember[] = [];
      for (const s of updatedStaff) {
        if (s.onLeave) { kept.push(s); continue; }
        if (s.morale < 20 && rng.next() < 0.05) {
          reports.push({ message: `${s.role} (skill ${s.skill}) quit — morale ${Math.round(s.morale)}%`, reportType: 'alert' });
          newStaffQuit++;
        } else {
          kept.push(s);
        }
      }
      updatedStaff = kept;

      // Auto-hire when over-utilized
      if (util > MAX_UTIL && updatedStaff.length > 0) {
        const monthlyPayroll = updatedStaff.reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0), 0);
        const hireSalary = 2500;
        if (monthlyPayroll + hireSalary <= personnelBudget) {
          const skill = rng.nextInt(4) + 1;
          updatedStaff.push({
            id: nextStaffId(), role: 'barista' as const, skill,
            salary: hireSalary, morale: 65, weeksEmployed: 0, onLeave: false,
            performance: 0.5, trainingDays: TRAINING_DAYS,
          });
          reports.push({ message: `Hiring barista (skill ${skill}) — util ${util.toFixed(0)} cust/staff`, reportType: 'info' });
          newHiresMade++;
        }
      }

      // Manager waste reduction
      const mgr = updatedStaff.find(s => s.role === 'manager');
      wasteReductionPct = mgr ? Math.min(0.15, mgr.skill * 0.02) : 0;
    } else {
      // Manual mode or no staff — no auto management
      if (staff.length === 0) {
        reports.push({ message: 'No staff — nothing runs. Hire someone.', reportType: 'alert' });
      }
    }

    // Training progress (always happens)
    updatedStaff = updatedStaff.map(s => {
      if (s.trainingDays > 0 && !s.onLeave) {
        const newDays = Math.max(0, s.trainingDays - 1);
        const perf = Math.min(1.0, 0.5 + (TRAINING_DAYS - newDays) * 0.167);
        return { ...s, trainingDays: newDays, performance: perf };
      }
      return s;
    });

    // ── C. Revenue (staff performance affects throughput) ──
    const effectiveStaffCount = updatedStaff.filter(s => !s.onLeave).reduce((sum, s) => sum + s.performance, 0);
    const staffCount = updatedStaff.length;
    const throughputFactor = staffCount > 0 ? effectiveStaffCount / staffCount : 0;
    const maxCups = Math.round(equipment.speed * 10 * throughputFactor);
    const actualServed = Math.min(todayCustomers, maxCups);

    const avgTicket = (pricing.drip * 0.3 + pricing.espresso * 0.3 + pricing.specialty * 0.25 + pricing.food * 0.15) * menu.margin;
    todayRevenue = actualServed * avgTicket;

    // Unserved customers hurt reputation
    const unserved = todayCustomers - actualServed;
    if (unserved > 0) newRep = Math.max(0, newRep - Math.min(2, unserved / 50));

    // ── D. Auto-replenish ──
    let replenishCost = 0;
    const preReplenished = inventory.map(item => {
      const cfg = autoReplenish[item.category];
      if (!cfg || !cfg.enabled) return item;
      const threshold = item.maxQty * (cfg.thresholdPct / 100);
      if (item.quantity >= threshold) return item;
      const orderQty = Math.floor(item.maxQty * (cfg.orderPct / 100));
      const actualQty = Math.min(orderQty, item.maxQty - item.quantity);
      if (actualQty <= 0) return item;
      replenishCost += actualQty * item.costPerUnit;
      return { ...item, quantity: item.quantity + actualQty, daysRemaining: item.shelfLifeDays };
    });
    newCash -= replenishCost;
    if (replenishCost > 0) todayCosts += replenishCost;

    // ── E. Inventory consumption & waste ──
    const newInventory = preReplenished.map(item => {
      let consumed = 0;
      if (item.category === 'beans') consumed = Math.ceil(actualServed * 0.05);
      else if (item.category === 'dairy') consumed = Math.ceil(actualServed * 0.08);
      else if (item.category === 'syrup') consumed = Math.ceil(actualServed * 0.02);
      else if (item.category === 'pastry') consumed = Math.ceil(actualServed * 0.15);
      else if (item.category === 'supplies') consumed = actualServed;

      const newDays = item.daysRemaining - 1;
      let wasted = newDays <= 0 ? item.quantity : 0;
      const remaining = Math.max(0, item.quantity - consumed);
      let wasteValue = wasted * item.costPerUnit;
      wasteValue *= (1 - wasteReductionPct);
      todayWaste += wasteValue;

      return { ...item, quantity: remaining, daysRemaining: Math.max(0, newDays) };
    });

    // Stockout penalty
    const stockoutItems = newInventory.filter(i => i.quantity <= 0);
    if (stockoutItems.length > 0) {
      todayRevenue -= stockoutItems.length * 100;
      newRep = Math.max(0, newRep - 1);
    }

    todayCosts += todayWaste;

    // ── F. Staff payroll ──
    const dailyPayroll = updatedStaff.filter(s => !s.onLeave).reduce((sum, s) => sum + (Number.isFinite(s.salary) ? s.salary : 0) / 22, 0);
    todayCosts += dailyPayroll;

    // ── G. Monthly costs (day 1) ──
    if (day === 1) {
      todayCosts += location.rent;
      todayCosts += monthlyDebtPayment;
      newDebt = Math.max(0, newDebt - monthlyDebtPayment);
    }

    // ── H. Events (simplified, using seeded RNG) ──
    if (day === 1) {
      const roll = rng.next();
      if (roll < 0.4) {
        if (rng.next() < 0.5) todayCosts += 300; else newRep -= 3;
      } else if (roll < 0.55) {
        if (rng.next() < 0.5) todayCosts += 400; else newRep -= 10;
      } else if (roll < 0.60) {
        if (rng.next() < 0.5) todayCosts += 500; else { todayCosts += 300; newRep += 2; }
      }
    }

    // ── I. Update cash & reputation ──
    newCash += todayRevenue - todayCosts;
    newRep = Math.max(0, Math.min(100, newRep));
    if (todayWaste > 200) newRep -= 1;
    if (todayCustomers > location.baseTraffic * 0.8) newRep += 0.5;

    // ── J. Record ──
    const record: DailyRecord = {
      day: totalDay, revenue: todayRevenue, costs: todayCosts,
      waste: todayWaste, customers: actualServed,
      reputation: newRep, cash: newCash, debtRemaining: newDebt,
    };

    // ── K. Manager Review (every 90 days) ──
    let reviewOpen = false;
    let pending: ManagerReview | null = null;
    const targets = get().kpiTargets;

    if ([90, 180, 270, 360].includes(totalDay) && !get().manualMode) {
      const last90 = dailyRecords.slice(-90);
      const avgRev = last90.length ? last90.reduce((s, r) => s + r.revenue, 0) / last90.length : 0;
      const avgCust = last90.length ? last90.reduce((s, r) => s + r.customers, 0) / last90.length : 0;
      const avgW = last90.length ? last90.reduce((s, r) => s + r.waste, 0) / last90.length : 0;
      const activeCount = updatedStaff.filter(s => !s.onLeave).length;
      const avgM = updatedStaff.length ? updatedStaff.reduce((s, s2) => s + s2.morale, 0) / updatedStaff.length : 0;

      // Trend detection
      const half = Math.max(1, Math.floor(last90.length / 2));
      const recentCash = last90.slice(-half).reduce((s, r) => s + r.cash, 0) / half;
      const earlierCash = last90.slice(0, half).reduce((s, r) => s + r.cash, 0) / half;
      const cashTrend: 'up' | 'down' | 'stable' = recentCash > earlierCash + 1000 ? 'up' : recentCash < earlierCash - 1000 ? 'down' : 'stable';
      const recentRep = last90.slice(-half).reduce((s, r) => s + r.reputation, 0) / half;
      const earlierRep = last90.slice(0, half).reduce((s, r) => s + r.reputation, 0) / half;
      const repTrend: 'up' | 'down' | 'stable' = recentRep > earlierRep + 2 ? 'up' : recentRep < earlierRep - 2 ? 'down' : 'stable';

      // Measure against targets
      const revenueMet = avgRev >= targets.revenueTarget;
      const wasteMet = avgW <= targets.wasteTarget;
      const moraleMet = avgM >= targets.moraleTarget;
      const targetsMetCount = (revenueMet ? 1 : 0) + (wasteMet ? 1 : 0) + (moraleMet ? 1 : 0);
      const score: 'exceeds' | 'meets' | 'misses' = targetsMetCount >= 3 ? 'exceeds' : targetsMetCount >= 2 ? 'meets' : 'misses';

      // Consequences based on results
      const consequences: string[] = [];
      let repDelta = 0;
      let moraleDelta = 0;

      if (score === 'exceeds') {
        repDelta = 5;
        moraleDelta = 10;
        consequences.push('All targets exceeded! +5 rep, +10% team morale');
        consequences.push('Manager bonus: staff feel valued');
      } else if (score === 'meets') {
        repDelta = 2;
        moraleDelta = 3;
        consequences.push('Most targets met. +2 rep, +3% morale');
      } else {
        repDelta = -3;
        moraleDelta = -8;
        consequences.push(`Only ${targetsMetCount}/3 targets met. -3 rep, -8% morale`);
        if (!revenueMet) consequences.push(`Revenue: $${Math.round(avgRev)}/day vs $${targets.revenueTarget} target`);
        if (!wasteMet) consequences.push(`Waste: $${Math.round(avgW)}/day vs $${targets.wasteTarget} max`);
        if (!moraleMet) consequences.push(`Morale: ${Math.round(avgM)}% vs ${targets.moraleTarget}% min`);
        if (targetsMetCount === 0) consequences.push('All targets missed — consider replacing manager');
      }

      // Apply consequences to staff morale
      updatedStaff = updatedStaff.map(s => ({
        ...s,
        morale: Math.max(0, Math.min(100, s.morale + moraleDelta)),
      }));
      // Reputation is adjusted below where it's already handled

      const mgr = updatedStaff.find(s => s.role === 'manager');

      pending = {
        totalDay,
        targets: { ...targets },
        kpis: {
          avgDailyRevenue: +avgRev.toFixed(0),
          avgDailyCustomers: +avgCust.toFixed(0),
          avgWaste: +avgW.toFixed(0),
          staffCount: activeCount,
          turnoverCount: newStaffQuit,
          avgMorale: +avgM.toFixed(0),
          reputationTrend: repTrend,
          cashTrend,
        },
        results: { revenueMet, wasteMet, moraleMet, targetsMetCount, score },
        consequences,
        manager: {
          skill: mgr?.skill ?? 0,
          salary: mgr?.salary ?? 0,
          morale: +(mgr?.morale ?? 0).toFixed(0),
          wasteReduction: +(wasteReductionPct * 100).toFixed(1),
          hiresMade: newHiresMade - get().hiresMade,
          staffQuit: newStaffQuit - get().staffQuit,
        },
      };
      reviewOpen = true;
      reports.push({ message: `Quarterly review due (Day ${totalDay}) — Score: ${score}`, reportType: 'request' });

      // Apply reputation delta from review
      newRep += repDelta;

      // Reset targets for next period based on current performance (queued, applied in main set below)
      const nextRevTarget = revenueMet ? Math.round(avgRev * 1.1) : Math.max(200, Math.round(avgRev * 0.8));
      const nextWasteTarget = wasteMet ? Math.round(avgW * 0.8) : Math.round(avgW * 1.3);
      const nextMoraleTarget = moraleMet ? Math.min(80, Math.round(avgM + 5)) : Math.max(40, Math.round(avgM - 10));
      nextKpiTargets = { revenueTarget: nextRevTarget, wasteTarget: nextWasteTarget, moraleTarget: nextMoraleTarget };
    }

    // ── L. Win/loss ──
    let gameOver = false;
    let gameOverReason: string | undefined;

    if (newCash < -5000) { gameOver = true; gameOverReason = 'Bankruptcy: deeply negative cash'; }
    if (newRep < 15) { gameOver = true; gameOverReason = 'Reputation collapse (< 15)'; }
    const debtFails = dailyRecords.filter(r => r.day % 30 === 1 && r.cash < 0 && newDebt > 0);
    if (debtFails.length >= 3) { gameOver = true; gameOverReason = 'Debt default'; }
    if (totalDay >= TOTAL_DAYS) { gameOver = true; gameOverReason = 'Completed 360 days!'; }

    // ── N. Reputation dynamics (trailing averages) ──
    // Bad reviews: 0 revenue day = negative review, sinks rep fast
    // Recovery: well-run (low waste, high avg revenue) recovers rep slowly
    // Ceiling: rep caps at 95 — hard to maintain perfect
    const repCap = 95;
    newRep = Math.min(repCap, newRep);

    // Bad review: no revenue served customers but made $0 (stockout or empty shop)
    const isBadReviewDay = todayCustomers > 0 && actualServed === 0;
    const recentBadDays = isBadReviewDay
      ? Math.min(7, (get().recentBadDays ?? 0) + 1)
      : Math.max(0, (get().recentBadDays ?? 0) - 0.1);

    if (recentBadDays >= 2) {
      newRep = Math.max(0, newRep - 2); // compounding bad reviews
    }

    // Trailing averages for recovery tracking
    const trailingRev = [...dailyRecords.slice(-29).map(r => r.revenue), todayRevenue];
    const trailingWaste = [...dailyRecords.slice(-29).map(r => r.waste), todayWaste];
    const recentAvgRevenue = trailingRev.length ? trailingRev.reduce((a, b) => a + b, 0) / trailingRev.length : 0;
    const recentAvgWaste = trailingWaste.length ? trailingWaste.reduce((a, b) => a + b, 0) / trailingWaste.length : 0;

    // Recovery: if well-run (good revenue, low waste, no bad reviews), rep slowly climbs
    if (!isManual && recentAvgRevenue > 300 && recentAvgWaste < 100 && recentBadDays === 0 && newRep < 80) {
      newRep += 0.3;
    }

    // ── O. Advance time ──
    const newDay = day >= DAYS_PER_MONTH ? 1 : day + 1;
    const newMonth = day >= DAYS_PER_MONTH ? month + 1 : month;
    const newTotalDay = totalDay + 1;

    // ── P. Weekly journal (compile every 7 days) ──
    let newJournalEntries = journalEntries;
    let newWeekStartDay = weekStartDay;
    let newWeekStartCash = weekStartCash;
    const daysInWeek = newTotalDay - weekStartDay;

    if (daysInWeek >= 7) {
      // Compile week journal
      const weekRecords = dailyRecords.slice(-daysInWeek);
      const totalRev = weekRecords.reduce((s, r) => s + r.revenue, 0);
      const totalCosts = weekRecords.reduce((s, r) => s + r.costs, 0);
      const totalWaste = weekRecords.reduce((s, r) => s + r.waste, 0);
      const totalCust = weekRecords.reduce((s, r) => s + r.customers, 0);
      const badDays = weekRecords.filter(r => r.customers > 0 && r.revenue === 0).length;
      const avgDemand = totalCust / Math.max(1, weekRecords.length);
      const avgServed = actualServed; // approx for this week's last day

      const entry: WeeklyJournalEntry = {
        gameId: gameId,
        timestamp: new Date().toISOString(),
        week: journalEntries.length + 1,
        days: [weekStartDay, totalDay],
        month,
        location: location.id,
        capital: capital.id,
        avgDailyRevenue: +((totalRev / weekRecords.length) || 0).toFixed(0),
        totalRevenue: +totalRev.toFixed(0),
        avgDailyCosts: +((totalCosts / weekRecords.length) || 0).toFixed(0),
        totalCosts: +totalCosts.toFixed(0),
        avgDailyWaste: +((totalWaste / weekRecords.length) || 0).toFixed(0),
        avgDailyProfit: +(((totalRev - totalCosts) / weekRecords.length) || 0).toFixed(0),
        endCash: +newCash.toFixed(0),
        endDebt: +newDebt.toFixed(0),
        endEquity: +((newCash - newDebt)).toFixed(0),
        avgDailyCustomers: +avgDemand.toFixed(0),
        totalCustomers: +totalCust.toFixed(0),
        avgServed: +avgServed.toFixed(0),
        avgDemandGap: +(Math.max(0, todayCustomers - actualServed)).toFixed(0),
        badReviewDays: badDays,
        staffCount: updatedStaff.filter(s => !s.onLeave).length,
        staffSnapshot: updatedStaff.filter(s => !s.onLeave).map(s => ({
          role: s.role, skill: s.skill, morale: +s.morale.toFixed(0), salary: s.salary,
        })),
        avgMorale: updatedStaff.length ? +(updatedStaff.reduce((s, st) => s + st.morale, 0) / updatedStaff.length).toFixed(0) : 0,
        hiresThisWeek: newHiresMade - get().hiresMade,
        quitsThisWeek: newStaffQuit - get().staffQuit,
        managerActive: !!updatedStaff.find(s => s.role === 'manager'),
        managerSkill: updatedStaff.find(s => s.role === 'manager')?.skill ?? 0,
        wasteReduction: +(wasteReductionPct * 100).toFixed(1),
        targets: isManual ? null : { ...stateKpiTargets },
        pricing: { ...pricing },
        events: reports.filter(r => r.reportType !== 'info').map(r => r.message).slice(0, 10),
        notes: isManual ? ['Manual mode — no manager'] : [],
      };

      // Add notable notes
      if (newCash < 0) entry.notes.push(`Negative cash: $${Math.round(newCash).toLocaleString()}`);
      if (newRep < 30) entry.notes.push(`Low reputation: ${Math.round(newRep)}`);
      if (entry.avgMorale < 40) entry.notes.push(`Low morale: ${entry.avgMorale}%`);
      if (entry.badReviewDays > 2) entry.notes.push(`${entry.badReviewDays} bad review days`);

      newJournalEntries = [...journalEntries, entry];
      newWeekStartDay = newTotalDay;
      newWeekStartCash = newCash;

      // Save to server
      get().saveJournalEntry(entry);
    }

    set({
      cash: Number.isFinite(newCash) ? newCash : 0,
      debtRemaining: Number.isFinite(newDebt) ? newDebt : 0,
      reputation: Number.isFinite(newRep) ? newRep : 0,
      inventory: newInventory, staff: updatedStaff,
      month: newMonth, day: newDay, totalDay: newTotalDay,
      dailyRecords: [...dailyRecords, record],
      activeEvents: [...activeEvents],
      todayRevenue, todayCosts, todayWaste, todayCustomers: actualServed,
      todayDemandBreakdown: breakdown,
      wasteReductionPct,
      managerReports: [...reports, ...managerReports].slice(0, 20),
      hiresMade: newHiresMade,
      staffQuit: newStaffQuit,
      managerReviewOpen: reviewOpen,
      pendingReview: pending,
      recentAvgRevenue: +recentAvgRevenue.toFixed(0),
      recentAvgWaste: +recentAvgWaste.toFixed(0),
      recentBadDays: +recentBadDays.toFixed(1),
      ...(nextKpiTargets && { kpiTargets: nextKpiTargets }),
      journalEntries: newJournalEntries,
      weekStartDay: newWeekStartDay,
      weekStartCash: newWeekStartCash,
      gameOver, gameOverReason,
    });
  },

  resetGame: () => {
    staffIdCounter = 0;
    set({
      phase: 'setup',
      location: null, menu: null, equipment: null,
      contract: null, capital: null, pricing: { ...DEFAULT_PRICING },
      manager: null, personnelBudget: 10000, managerReports: [],
      manualMode: false, managerReviews: [], managerReviewOpen: false, pendingReview: null,
      showReviewHistory: false, kpiTargets: { revenueTarget: 500, wasteTarget: 200, moraleTarget: 60 },
      staffKPIs: {}, hiresMade: 0, staffQuit: 0,
      recentAvgRevenue: 0, recentAvgWaste: 0, recentBadDays: 0,
      journalEntries: [], weekStartDay: 1, weekStartCash: 0, weekStartStaff: 0,
      gameId: '',
      month: 1, day: 1, totalDay: 1, seed: 42,
      cash: 0, debtRemaining: 0, monthlyDebtPayment: 0,
      reputation: 50, inventory: [], staff: [],
      dailyRecords: [], activeEvents: [], resolvedEvents: [],
      todayRevenue: 0, todayCosts: 0, todayWaste: 0, todayCustomers: 0,
      todayDemandBreakdown: null, wasteReductionPct: 0,
      autoReplenish: { ...DEFAULT_AUTO_REPLENISH },
      autoAdvance: false, autoAdvanceSpeed: 2000,
      gameOver: false, gameOverReason: undefined,
    });
  },
}));
