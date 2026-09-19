export type Phase = 'setup' | 'playing' | 'ended';
export type SimulationMode = 'live' | 'benchmark' | 'pettingzoo';

export interface Supplier {
  id: string;
  name: string;
  unit_cost: number;
  mean_lead_days: number;
  lead_std_days: number;
  minimum_order: number;
  maximum_order: number;
  quality: number;
  reliability: number;
}

export interface Product {
  id: string;
  name: string;
  base_price: number;
  min_price: number;
  max_price: number;
  base_daily_demand_kg: number;
  shelf_life_days: number;
  roast_profile: string;
  bom?: { raw_material_id: string; fraction: number }[];
}

export interface Catalog {
  scenario: string;
  suppliers: Supplier[];
  products: Product[];
  defaults: {
    horizon_days: number;
    starting_cash: number;
    credit_limit: number;
    roaster_capacity_kg_per_day: number;
  };
}

export interface DailyMetric {
  day: number;
  demand_kg: number;
  served_kg: number;
  backordered_kg: number;
  lost_kg: number;
  spoilage_kg: number;
  roasted_kg: number;
  revenue: number;
  changeovers: number;
  downtime_hours: number;
  reward: number;
  cash_change: number;
  cash: number;
  warnings: string[];
  forecast?: Record<string, number>;
  demand_by_sku?: Record<string, number>;
  roast_hours?: number;
  packaging_hours?: number;
  eod_tally?: {
    sales: number; inventory_value: number; roaster_utilization: number;
    packaging_utilization: number; roast_labor_hours: number;
    packaging_labor_hours: number; cash: number; reward: number;
  };
}

export interface SimEvent {
  time: number;
  day: number;
  type: string;
  category?: 'supply' | 'demand';
  message: string;
  [key: string]: unknown;
}

export interface RoastJob {
  job_id: string;
  sku: string;
  green_input_kg: number;
  roasted_output_kg: number;
  shrinkage: number;
  status: string;
  submitted_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface GameSnapshot {
  simulation_mode?: SimulationMode;
  simulation_strategy?: string;
  scenario: string;
  seed: number;
  day: number;
  horizon_days: number;
  sim_time: number;
  cash: number;
  credit_available: number;
  inventory_value: number;
  green_inventory: Record<string, number>;
  roasted_inventory: Record<string, number>;
  roasted_age_buckets: Record<string, number[]>;
  inbound_green: Record<string, number>;
  backorders: Record<string, number>;
  prices: Record<string, number>;
  demand_forecast: Record<string, number>;
  standing_plan?: {
    weekly_green_orders: Record<string, number>;
    weekly_roast_targets: Record<string, number>;
  };
  resources: {
    roaster_busy: number;
    roaster_queue: number;
    packager_busy: number;
    packager_queue: number;
  };
  service_level: number;
  terminated: boolean;
  truncated: boolean;
  termination_reason: string | null;
  today: DailyMetric | null;
  history: DailyMetric[];
  events: SimEvent[];
  roast_jobs: RoastJob[];
  ledger_totals: Record<string, number>;
  stats?: Record<string, number>;
  mass_balance: { green_error_kg: number; roasted_error_kg: number };
}

export interface ActionDraft {
  weekly_green_orders: Record<string, number>;
  weekly_roast_targets: Record<string, number>;
  prices: Record<string, number>;
}
