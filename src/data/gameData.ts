import type {
  Location,
  MenuOption,
  EquipmentOption,
  ContractOption,
  CapitalStructure,
  InventoryItem,
  ActiveEvent,
  PricingStrategy,
} from '../types';

// ─── Locations ──────────────────────────────────────────────────────

export const LOCATIONS: Location[] = [
  {
    id: 'urban',
    name: 'Urban Chic',
    rent: 4500,
    baseTraffic: 180,
    vibeBonus: 1.3,
    trafficPattern: 'High AM, steady lunch, low PM',
  },
  {
    id: 'suburban',
    name: 'Suburban Busy Road',
    rent: 3200,
    baseTraffic: 140,
    vibeBonus: 1.0,
    trafficPattern: 'AM rush + school runs',
  },
  {
    id: 'mall',
    name: 'Mall Kiosk',
    rent: 2200,
    baseTraffic: 220,
    vibeBonus: 0.8,
    trafficPattern: 'Weekend-heavy, tourist flow',
  },
  {
    id: 'office',
    name: 'Office Lobby',
    rent: 3500,
    baseTraffic: 160,
    vibeBonus: 0.9,
    trafficPattern: 'Weekday AM only, dead weekends',
  },
  {
    id: 'university',
    name: 'University District',
    rent: 2400,
    baseTraffic: 200,
    vibeBonus: 0.7,
    trafficPattern: 'Semester cycles, late night',
  },
];

// ─── Menu Options ───────────────────────────────────────────────────

export const MENUS: MenuOption[] = [
  {
    id: 'gourmet',
    name: 'Gourmet Fine Roasts',
    margin: 1.4,
    complexity: 3,
    skillRequired: 3,
  },
  {
    id: 'everyday',
    name: 'Everyday Reliable Coffee',
    margin: 1.15,
    complexity: 1,
    skillRequired: 1,
  },
  {
    id: 'sweet',
    name: 'Sweet Specialty Drinks',
    margin: 1.35,
    complexity: 4,
    skillRequired: 2,
  },
  {
    id: 'speed',
    name: 'Speed Espresso Only',
    margin: 1.2,
    complexity: 2,
    skillRequired: 2,
  },
];

// ─── Equipment ──────────────────────────────────────────────────────

export const EQUIPMENT: EquipmentOption[] = [
  {
    id: 'automated',
    name: 'Automated (Push-Button)',
    upfrontCost: 45000,
    speed: 120,
    reliability: 0.85,
    staffSkillRequired: 1,
  },
  {
    id: 'manual',
    name: 'Manual (Traditional)',
    upfrontCost: 18000,
    speed: 60,
    reliability: 0.95,
    staffSkillRequired: 3,
  },
  {
    id: 'specialized',
    name: 'Specialized (Cold Brew + Pour Over)',
    upfrontCost: 35000,
    speed: 80,
    reliability: 0.7,
    staffSkillRequired: 4,
  },
];

// ─── Contracts ──────────────────────────────────────────────────────

export const CONTRACTS: ContractOption[] = [
  {
    id: 'spot',
    name: 'Spot Buying',
    priceVariance: 0.25,
    flexibility: 1.0,
    leadTime: 3,
    quality: 0.7,
  },
  {
    id: 'monthly',
    name: 'Monthly Contract',
    priceVariance: 0.05,
    flexibility: 0.3,
    leadTime: 7,
    quality: 0.8,
  },
  {
    id: 'coop',
    name: 'Co-op / Shared Roast',
    priceVariance: 0.1,
    flexibility: 0.6,
    leadTime: 10,
    quality: 0.75,
  },
  {
    id: 'direct',
    name: 'Direct Trade',
    priceVariance: 0.08,
    flexibility: 0.4,
    leadTime: 60,
    quality: 1.0,
  },
];

// ─── Capital Structures ─────────────────────────────────────────────
// Total capital always $150K, split varies

export const CAPITAL_STRUCTURES: CapitalStructure[] = [
  {
    id: 'all-equity',
    name: 'All-In Equity',
    loan: 0,
    equity: 150000,
    monthlyPayment: 0,
    description: 'No debt pressure. You bleed your own cash if things go wrong.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    loan: 75000,
    equity: 75000,
    monthlyPayment: 1800,
    description: 'Manageable payments with skin in the game.',
  },
  {
    id: 'leveraged',
    name: 'Leveraged',
    loan: 120000,
    equity: 30000,
    monthlyPayment: 2900,
    description: 'More upfront power, but payments eat into everything.',
  },
  {
    id: 'max-debt',
    name: 'Max Debt',
    loan: 140000,
    equity: 10000,
    monthlyPayment: 3400,
    description: 'Maximum firepower. One bad month can break you.',
  },
];

// ─── Staff Roles ────────────────────────────────────────────────────

export interface StaffRoleDef {
  role: 'barista' | 'shiftLead' | 'roaster' | 'manager';
  name: string;
  baseSalary: number;
  skillRange: [number, number];
  description: string;
}

export const STAFF_ROLES: StaffRoleDef[] = [
  {
    role: 'barista',
    name: 'Barista',
    baseSalary: 2500,
    skillRange: [1, 5],
    description: 'Frontline. Speed and quality depend on skill.',
  },
  {
    role: 'shiftLead',
    name: 'Shift Lead',
    baseSalary: 3500,
    skillRange: [3, 6],
    description: 'Can train others, handles rushes well.',
  },
  {
    role: 'roaster',
    name: 'Roaster',
    baseSalary: 4000,
    skillRange: [4, 7],
    description: 'Needed for in-house roasting. Controls quality.',
  },
  {
    role: 'manager',
    name: 'Manager',
    baseSalary: 5000,
    skillRange: [5, 8],
    description: 'Reduces waste, handles events better.',
  },
];

// ─── Default Inventory ──────────────────────────────────────────────

export function defaultInventory(contract: ContractOption): InventoryItem[] {
  const beanCost = contract.id === 'direct' ? 8 : contract.id === 'coop' ? 9 : contract.id === 'monthly' ? 10 : 12;

  return [
    { name: 'Green Beans', quantity: 200, maxQty: 500, costPerUnit: beanCost, shelfLifeDays: 180, daysRemaining: 180, category: 'beans' },
    { name: 'Whole Milk', quantity: 40, maxQty: 80, costPerUnit: 4, shelfLifeDays: 10, daysRemaining: 10, category: 'dairy' },
    { name: 'Oat Milk', quantity: 20, maxQty: 40, costPerUnit: 6, shelfLifeDays: 10, daysRemaining: 10, category: 'dairy' },
    { name: 'Syrups', quantity: 15, maxQty: 30, costPerUnit: 8, shelfLifeDays: 90, daysRemaining: 90, category: 'syrup' },
    { name: 'Pastries', quantity: 30, maxQty: 60, costPerUnit: 3, shelfLifeDays: 3, daysRemaining: 3, category: 'pastry' },
    { name: 'Cups & Lids', quantity: 500, maxQty: 1000, costPerUnit: 0.15, shelfLifeDays: 365, daysRemaining: 365, category: 'supplies' },
  ];
}

// ─── Default Pricing ────────────────────────────────────────────────

export const DEFAULT_PRICING: PricingStrategy = {
  drip: 3.5,
  espresso: 4.5,
  specialty: 6.0,
  food: 4.0,
};

// ─── Events Pool ────────────────────────────────────────────────────

export const EVENTS_POOL: Omit<ActiveEvent, 'dayTriggered' | 'resolved'>[] = [
  // Common
  {
    id: 'equip-maintenance',
    title: 'Equipment Maintenance Due',
    description: 'Your espresso machine needs a routine service. Ignore it and risk a breakdown.',
    frequency: 'common',
    durationDays: 1,
    choices: [
      { label: 'Service now ($300)', description: 'Preventive maintenance, keeps reliability high.', effects: { cashDelta: -300 } },
      { label: 'Skip it', description: 'Save money now, risk breakdown later.', effects: { reputationDelta: -3 } },
    ],
  },
  {
    id: 'milk-delay',
    title: 'Milk Delivery Delayed',
    description: 'Your dairy supplier is 2 days late. Alternative milk is available at premium.',
    frequency: 'common',
    durationDays: 2,
    choices: [
      { label: 'Buy premium oat milk (+$200)', description: 'Keep customers happy, eat the cost.', effects: { cashDelta: -200, reputationDelta: 2 } },
      { label: '86 all milk drinks', description: 'Lost sales on lattes and cappuccinos.', effects: { cashDelta: -500, reputationDelta: -5 } },
    ],
  },
  {
    id: 'staff-sick',
    title: 'Staff Called In Sick',
    description: 'Your best barista is out today. Coverage is thin.',
    frequency: 'common',
    durationDays: 1,
    choices: [
      { label: 'Pay overtime (+$150)', description: 'Existing staff cover the shift.', effects: { cashDelta: -150, staffMoraleDelta: -5 } },
      { label: 'Run short-staffed', description: 'Slower service, longer lines.', effects: { reputationDelta: -4, cashDelta: -300 } },
    ],
  },
  {
    id: 'competitor-promo',
    title: 'Competitor Promo Next Door',
    description: 'The shop across the street is running a "Buy One Get One" week.',
    frequency: 'common',
    durationDays: 5,
    choices: [
      { label: 'Match the promo', description: 'Protect volume, sacrifice margin.', effects: { cashDelta: -400, reputationDelta: 3 } },
      { label: 'Hold prices, push quality', description: 'Some customers drift, but loyal ones stay.', effects: { cashDelta: -250, reputationDelta: 1 } },
      { label: 'Ignore it', description: 'Lose foot traffic for the week.', effects: { cashDelta: -600 } },
    ],
  },
  // Uncommon
  {
    id: 'health-inspection',
    title: 'Health Inspection',
    description: 'The health department is doing rounds today.',
    frequency: 'uncommon',
    durationDays: 1,
    choices: [
      { label: 'Deep clean first ($200 lost day)', description: 'Close for half a day to prep.', effects: { cashDelta: -400, reputationDelta: 8 } },
      { label: 'Hope for the best', description: '50/50 chance of passing.', effects: { cashDelta: -100, reputationDelta: -10 } },
    ],
  },
  {
    id: 'equip-breakdown',
    title: 'Equipment Breakdown!',
    description: 'Your main grinder just died during morning rush.',
    frequency: 'uncommon',
    durationDays: 2,
    choices: [
      { label: 'Emergency repair ($800)', description: 'Same-day fix, expensive.', effects: { cashDelta: -800 } },
      { label: 'Order replacement part ($400, 3 days)', description: 'Cheaper but slower.', effects: { cashDelta: -400, reputationDelta: -8 } },
    ],
  },
  {
    id: 'price-spike',
    title: 'Green Coffee Price Spike',
    description: 'A frost in Brazil drove up commodity prices 15%.',
    frequency: 'uncommon',
    durationDays: 15,
    choices: [
      { label: 'Absorb the cost', description: 'Margin compression, but keep prices stable.', effects: { cashDelta: -600 } },
      { label: 'Raise prices 10%', description: 'Protect margin, risk volume.', effects: { reputationDelta: -5, cashDelta: 200 } },
    ],
  },
  {
    id: 'viral-post',
    title: 'Viral Social Media Post',
    description: 'A local influencer posted about your shop. Could go either way.',
    frequency: 'uncommon',
    durationDays: 5,
    choices: [
      { label: 'Capitalize (promote it, +$150 marketing)', description: 'Lean into the attention.', effects: { cashDelta: -150, reputationDelta: 10 } },
      { label: 'Let it ride', description: 'See what happens naturally.', effects: { reputationDelta: 3 } },
    ],
  },
  // Rare
  {
    id: 'rent-hike',
    title: 'Landlord Raises Rent',
    description: 'Your lease renewal includes a 12% rent increase.',
    frequency: 'rare',
    durationDays: 1,
    choices: [
      { label: 'Accept it', description: 'Higher fixed costs going forward.', effects: { cashDelta: -500 } },
      { label: 'Negotiate ($500 legal)', description: 'Might reduce it, might not.', effects: { cashDelta: -500, reputationDelta: 0 } },
    ],
  },
  {
    id: 'construction',
    title: 'Sidewalk Construction',
    description: 'City work will block your entrance for 3 weeks. Foot traffic drops 35%.',
    frequency: 'rare',
    durationDays: 21,
    choices: [
      { label: 'Push through with delivery promos', description: 'Invest in delivery apps (+$300).', effects: { cashDelta: -300, reputationDelta: 2 } },
      { label: 'Hunker down, cut hours', description: 'Save on labor, accept lower revenue.', effects: { cashDelta: -200, reputationDelta: -3 } },
    ],
  },
  {
    id: 'food-festival',
    title: 'Food Truck Festival Nearby',
    description: 'A major festival is happening 2 blocks away for the weekend.',
    frequency: 'rare',
    durationDays: 3,
    choices: [
      { label: 'Set up a pop-up stand (+$400)', description: 'Capture festival traffic directly.', effects: { cashDelta: -400, reputationDelta: 5 } },
      { label: 'Stay open late, extend hours', description: 'Catch spillover traffic.', effects: { cashDelta: -100 } },
      { label: 'Normal operations', description: 'Some festival visitors might wander in.', effects: {} },
    ],
  },
  {
    id: 'staff-poached',
    title: 'Key Staff Poached',
    description: 'Your shift lead got an offer from a chain across town. They want to leave.',
    frequency: 'rare',
    durationDays: 1,
    choices: [
      { label: 'Counter-offer (+$500/mo raise)', description: 'Keep them, but higher payroll.', effects: { cashDelta: -500, staffMoraleDelta: 5 } },
      { label: 'Let them go, hire replacement', description: 'Hiring takes 2 weeks, new person is untrained.', effects: { cashDelta: -200, staffMoraleDelta: -10 } },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

export function rollEvent(day: number, _month: number): ActiveEvent | null {
  // Determine which pool to draw from based on frequency
  const roll = Math.random();

  // Common: ~40% chance per month (check on day 1 of each month)
  if (day === 1 && roll < 0.4) {
    const pool = EVENTS_POOL.filter((e) => e.frequency === 'common');
    const event = pool[Math.floor(Math.random() * pool.length)];
    return { ...event, dayTriggered: day, resolved: false };
  }

  // Uncommon: ~15% chance per month
  if (day === 1 && roll < 0.55) {
    const pool = EVENTS_POOL.filter((e) => e.frequency === 'uncommon');
    const event = pool[Math.floor(Math.random() * pool.length)];
    return { ...event, dayTriggered: day, resolved: false };
  }

  // Rare: ~5% chance per month
  if (day === 1 && roll < 0.60) {
    const pool = EVENTS_POOL.filter((e) => e.frequency === 'rare');
    const event = pool[Math.floor(Math.random() * pool.length)];
    return { ...event, dayTriggered: day, resolved: false };
  }

  return null;
}
