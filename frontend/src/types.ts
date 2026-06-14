// ─── Core Game Types ───────────────────────────────────────────────

export type Phase = 'setup' | 'playing' | 'ended';

export type LocationId = 'urban' | 'suburban' | 'mall' | 'office' | 'university';
export type MenuId = 'gourmet' | 'everyday' | 'sweet' | 'speed';
export type EquipmentId = 'automated' | 'manual' | 'specialized';
export type ContractId = 'spot' | 'monthly' | 'coop' | 'direct';
export type CapitalSplit = 'all-equity' | 'balanced' | 'leveraged' | 'max-debt';

export interface Location {
  id: LocationId;
  name: string;
  rent: number;
  baseTraffic: number;
  vibeBonus: number; // multiplier on price sensitivity
  trafficPattern: string;
}

export interface MenuOption {
  id: MenuId;
  name: string;
  margin: number; // base margin multiplier
  complexity: number; // 1-5, affects waste and training time
  skillRequired: number; // minimum staff skill
}

export interface EquipmentOption {
  id: EquipmentId;
  name: string;
  upfrontCost: number;
  speed: number; // cups per hour
  reliability: number; // 0-1, breakdown resistance
  staffSkillRequired: number;
}

export interface ContractOption {
  id: ContractId;
  name: string;
  priceVariance: number; // how much price fluctuates
  flexibility: number; // 0-1, ability to adjust orders
  leadTime: number; // days to receive
  quality: number; // affects reputation
}

export interface CapitalStructure {
  id: CapitalSplit;
  name: string;
  loan: number;
  equity: number;
  monthlyPayment: number;
  description: string;
}

// ─── Game State ─────────────────────────────────────────────────────

export interface AutoReplenishConfig {
  enabled: boolean;
  thresholdPct: number; // reorder when quantity drops below this % of maxQty
  orderPct: number; // order this % of maxQty when triggered
}

export interface InventoryItem {
  name: string;
  quantity: number;
  maxQty: number;
  costPerUnit: number;
  shelfLifeDays: number;
  daysRemaining: number;
  category: 'beans' | 'dairy' | 'syrup' | 'pastry' | 'supplies';
}

export interface StaffMember {
  id: string;
  role: 'barista' | 'shiftLead' | 'roaster' | 'manager';
  skill: number; // 1-8
  salary: number;
  morale: number; // 0-100
  weeksEmployed: number;
  onLeave: boolean;
  performance: number; // 0-1, reduced during training
  trainingDays: number; // countdown to 0
}

export interface ManagerReport {
  message: string;
  reportType: 'info' | 'warning' | 'request' | 'alert';
  data?: Record<string, unknown>;
}

export interface DemandBreakdown {
  baseTraffic: number;
  repMult: number;
  dow: number;
  seasonal: number;
  gaussian: number;
  shock: number;
  shockSource: string;
  effectiveDemand: number;
}

export interface DailyRecord {
  day: number;
  revenue: number;
  costs: number;
  waste: number;
  customers: number;
  reputation: number;
  cash: number;
  debtRemaining: number;
}

export interface ActiveEvent {
  id: string;
  title: string;
  description: string;
  frequency: 'common' | 'uncommon' | 'rare';
  dayTriggered: number;
  durationDays: number;
  choices: EventChoice[];
  resolved: boolean;
  outcome?: string;
}

export interface EventChoice {
  label: string;
  description: string;
  effects: EventEffects;
}

export interface EventEffects {
  cashDelta?: number;
  reputationDelta?: number;
  trafficDelta?: number; // temporary multiplier
  wasteDelta?: number;
  staffMoraleDelta?: number;
}

export interface PricingStrategy {
  drip: number;
  espresso: number;
  specialty: number;
  food: number;
}

export interface StaffKPI {
  daysWorked: number;
  avgUtilization: number;
  totalMoraleChange: number;
  turnoverRisk: 'low' | 'medium' | 'high';
}

export interface WeeklyJournalEntry {
  gameId: string;            // unique identifier for this game run
  timestamp: string;         // ISO date when compiled
  week: number;              // 1-52
  days: [number, number];    // [startDay, endDay] totalDay range
  month: number;
  location: string;
  capital: string;
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
  avgServed: number;           // avg actually served (can be < demand)
  avgDemandGap: number;        // avg customers turned away
  badReviewDays: number;       // days with 0 served
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
  // Pricing
  pricing: { drip: number; espresso: number; specialty: number; food: number };
  // Events & notable
  events: string[];
  notes: string[];
}

export interface ManagerReview {
  totalDay: number;        // which review (day 90, 180, 270, 360)
  targets: {              // targets set for this period
    revenueTarget: number;  // avg daily revenue target
    wasteTarget: number;    // max avg daily waste
    moraleTarget: number;   // min avg staff morale
  };
  kpis: {
    avgDailyRevenue: number;
    avgDailyCustomers: number;
    avgWaste: number;
    staffCount: number;
    turnoverCount: number;
    avgMorale: number;
    reputationTrend: 'up' | 'down' | 'stable';
    cashTrend: 'up' | 'down' | 'stable';
  };
  results: {              // measured against targets
    revenueMet: boolean;
    wasteMet: boolean;
    moraleMet: boolean;
    targetsMetCount: number;
    score: 'exceeds' | 'meets' | 'misses';
  };
  consequences: string[];  // what happened (morale change, rep boost, etc.)
  manager: {
    skill: number;
    salary: number;
    morale: number;
    wasteReduction: number;
    hiresMade: number;
    staffQuit: number;
  };
}

export interface GameState {
  phase: Phase;

  // Setup choices
  location: Location | null;
  menu: MenuOption | null;
  equipment: EquipmentOption | null;
  contract: ContractOption | null;
  capital: CapitalStructure | null;
  pricing: PricingStrategy;

  // Manager & labor
  manager: StaffMember | null;
  personnelBudget: number; // monthly $
  managerReports: ManagerReport[];
  manualMode: boolean;     // true when no manager — user handles everything
  managerReviews: ManagerReview[];
  managerReviewOpen: boolean;
  pendingReview: ManagerReview | null;
  showReviewHistory: boolean;

  // KPI targets (set at start of each review period)
  kpiTargets: { revenueTarget: number; wasteTarget: number; moraleTarget: number };

  // Staff KPIs (computed per staff member)
  staffKPIs: Record<string, StaffKPI>;
  hiresMade: number;
  staffQuit: number;

  // Reputation dynamics
  recentAvgRevenue: number;
  recentAvgWaste: number;
  recentBadDays: number;

  // Journal
  journalEntries: WeeklyJournalEntry[];
  weekStartDay: number;
  weekStartCash: number;
  weekStartStaff: number;
  gameId: string;            // unique ID for this run

  // Live state
  month: number; // 1-12
  day: number; // 1-30 per month (simplified)
  totalDay: number; // 1-360
  seed: number;

  cash: number;
  debtRemaining: number;
  monthlyDebtPayment: number;

  reputation: number; // 0-100
  inventory: InventoryItem[];
  staff: StaffMember[];

  dailyRecords: DailyRecord[];
  activeEvents: ActiveEvent[];
  resolvedEvents: ActiveEvent[];

  // Auto-play settings
  autoReplenish: Record<string, AutoReplenishConfig>;
  autoAdvance: boolean;
  autoAdvanceSpeed: number;

  // Derived
  todayRevenue: number;
  todayCosts: number;
  todayWaste: number;
  todayCustomers: number;
  todayDemandBreakdown: DemandBreakdown | null;
  wasteReductionPct: number; // manager effect

  gameOver: boolean;
  gameOverReason?: string;

  // Actions
  startGame: (config: SetupConfig) => void;
  advanceDay: () => void;
  setPricing: (pricing: PricingStrategy) => void;
  orderInventory: (category: string, qty: number) => void;
  setAutoReplenish: (category: string, config: Partial<AutoReplenishConfig>) => void;
  setPersonnelBudget: (budget: number) => void;
  setStaffWage: (id: string, wage: number) => void;
  promoteStaff: (id: string) => void;
  demoteStaff: (id: string) => void;
  hireStaff: (role: string, skill: number, salary?: number) => void;
  fireStaff: (id: string) => void;
  dismissManagerReview: () => void;
  recallReview: () => void;
  replaceManager: (skill: number, salary: number) => void;
  saveJournalEntry: (entry: WeeklyJournalEntry) => void;
  toggleReviewHistory: () => void;
  setKpiTargets: (targets: { revenueTarget: number; wasteTarget: number; moraleTarget: number }) => void;
  setAutoAdvance: (enabled: boolean) => void;
  setAutoAdvanceSpeed: (speed: number) => void;
  resolveEvent: (eventId: string, choiceIndex: number) => void;
  resetGame: () => void;
}

export interface SetupConfig {
  location: Location;
  menu: MenuOption;
  equipment: EquipmentOption;
  contract: ContractOption;
  capital: CapitalStructure;
  manager: { role: 'manager'; skill: number };
  personnelBudget: number;
  initialStaff: { role: string; skill: number }[];
}
