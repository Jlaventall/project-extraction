import { create } from 'zustand';
import type { ActionDraft, Catalog, GameSnapshot, Phase, SimulationMode } from '../types';

// Local development talks to the standalone API; a deployed build uses the
// same-origin Vercel function unless an explicit API URL is configured.
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');

interface GameStore {
  phase: Phase;
  catalog: Catalog | null;
  gameId: string | null;
  state: GameSnapshot | null;
  draft: ActionDraft;
  loading: boolean;
  error: string | null;
  autoAdvance: boolean;
  runHistory: RunRecord[];
  fetchCatalog: () => Promise<void>;
  startGame: (seed: number, horizonDays: number, mode?: SimulationMode, strategy?: string, initialPrices?: Record<string, number>, bomOverrides?: Record<string, Record<string, number>>, coverageDays?: number) => Promise<void>;
  advanceDay: (useBaseline?: boolean) => Promise<void>;
  setDraftValue: (group: keyof ActionDraft, key: string, value: number) => void;
  setAutoAdvance: (enabled: boolean) => void;
  resetGame: () => void;
}

type ActionPayload = ActionDraft & { use_baseline: boolean };
type StoredRun = { seed: number; horizonDays: number; coverageDays: number; mode: SimulationMode; strategy: string; actions: ActionPayload[] };
const RUN_KEY = 'coffeesim-run-v1';
const HISTORY_KEY = 'coffeesim-run-history-v1';
type RunRecord = { mode: string; strategy: string; seed: number; days: number; reward: number; cash: number; service: number; completedAt: string };
function loadHistory(): RunRecord[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as RunRecord[]; } catch { return []; } }
function saveHistory(history: RunRecord[]) { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20))); }
function loadRun(): StoredRun | null {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as StoredRun | null; } catch { return null; }
}
function saveRun(run: StoredRun) { localStorage.setItem(RUN_KEY, JSON.stringify(run)); }
class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const emptyDraft: ActionDraft = { weekly_green_orders: {}, weekly_roast_targets: {}, prices: {} };

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return body;
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'setup',
  catalog: null,
  gameId: null,
  state: null,
  draft: emptyDraft,
  loading: false,
  error: null,
  autoAdvance: false,
  runHistory: loadHistory(),

  fetchCatalog: async () => {
    if (get().catalog) return;
    try {
      const catalog = await responseJson(await fetch(`${API_BASE}/api/catalog`)) as Catalog;
      set({ catalog });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to reach simulation API' });
    }
  },

  startGame: async (seed, horizonDays, mode = 'live', strategy = 'human_manual', initialPrices = {}, bomOverrides = {}, coverageDays = 14) => {
    set({ loading: true, error: null });
    try {
      const payload = await responseJson(await fetch(`${API_BASE}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, horizon_days: horizonDays, mode, strategy, initial_prices: initialPrices, bom_overrides: bomOverrides, coverage_days: coverageDays }),
      })) as { game_id: string; state: GameSnapshot };
      const catalog = get().catalog;
      saveRun({ seed, horizonDays, coverageDays, mode, strategy, actions: [] });
      set({
        gameId: payload.game_id,
        state: payload.state,
        phase: 'playing',
        loading: false,
        draft: {
          weekly_green_orders: Object.fromEntries((catalog?.suppliers ?? []).map((item) => [item.id, 0])),
          weekly_roast_targets: Object.fromEntries((catalog?.products ?? []).map((item) => [item.id, 0])),
          prices: { ...payload.state.prices },
        },
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Unable to create game' });
    }
  },

  advanceDay: async (useBaseline = false) => {
    const { gameId, draft, loading } = get();
    if (!gameId || loading) return;
    set({ loading: true, error: null });
    const action: ActionPayload = { ...draft, use_baseline: useBaseline };
    const requestStep = async (id: string, payload: ActionPayload) => await responseJson(await fetch(`${API_BASE}/api/games/${id}/step`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })) as { state: GameSnapshot };
    try {
      let payload: { state: GameSnapshot };
      try {
        payload = await requestStep(gameId, action);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        const saved = loadRun();
        if (!saved) throw error;
        const recreated = await responseJson(await fetch(`${API_BASE}/api/games`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed: saved.seed, horizon_days: saved.horizonDays, coverage_days: saved.coverageDays ?? 14, mode: saved.mode, strategy: saved.strategy }),
        })) as { game_id: string; state: GameSnapshot };
        for (const previous of saved.actions) await requestStep(recreated.game_id, previous);
        set({ gameId: recreated.game_id });
        payload = await requestStep(recreated.game_id, action);
      }
      const saved = loadRun();
      if (saved) { saved.actions.push(action); saveRun(saved); }
      if (payload.state.terminated || payload.state.truncated) {
        const history = loadHistory();
        history.push({ mode: payload.state.simulation_mode ?? 'live', strategy: payload.state.simulation_strategy ?? 'human_manual', seed: payload.state.seed, days: payload.state.day, reward: payload.state.history.reduce((total, day) => total + day.reward, 0), cash: payload.state.cash, service: payload.state.service_level, completedAt: new Date().toISOString() });
        saveHistory(history); set({ runHistory: history.slice(-20) });
      }
      const standing = payload.state.standing_plan;
      set({
        state: payload.state,
        phase: payload.state.terminated || payload.state.truncated ? 'ended' : 'playing',
        loading: false,
        draft: {
          // A manual commit edits the standing plan; keep it visible for the
          // next decision instead of silently resetting it to zero.
          weekly_green_orders: standing ? { ...standing.weekly_green_orders } : { ...get().draft.weekly_green_orders },
          weekly_roast_targets: standing ? { ...standing.weekly_roast_targets } : { ...get().draft.weekly_roast_targets },
          prices: { ...payload.state.prices },
        },
      });
    } catch (error) {
      set({ loading: false, autoAdvance: false, error: error instanceof Error ? error.message : 'Step failed' });
    }
  },

  setDraftValue: (group, key, value) => {
    const current = get().draft;
    set({ draft: { ...current, [group]: { ...current[group], [key]: Number.isFinite(value) ? value : 0 } } });
  },

  setAutoAdvance: (enabled) => {
    if (!enabled) {
      set({ autoAdvance: false });
      return;
    }
    const { catalog, state, draft } = get();
    if (!catalog || !state) {
      set({ autoAdvance: true });
      return;
    }
    const yieldFactor = 0.825;
    const weekly_roast_targets = Object.fromEntries(catalog.products.map((product) => [
      product.id,
      Number(((state.demand_forecast?.[product.id] ?? product.base_daily_demand_kg) * 7 / yieldFactor).toFixed(1)),
    ]));
    const rawNeed = Object.values(weekly_roast_targets).reduce((total, value) => total + value, 0);
    const cheapest = [...catalog.suppliers].sort((a, b) => a.unit_cost - b.unit_cost)[0];
    const rawPosition = Object.values(state.green_inventory).reduce((a, b) => a + b, 0)
      + Object.values(state.inbound_green).reduce((a, b) => a + b, 0);
    const weekly_green_orders = { ...draft.weekly_green_orders };
    if (cheapest) weekly_green_orders[cheapest.id] = Math.min(cheapest.maximum_order, Math.max(0, Math.ceil(Math.max(0, rawNeed - rawPosition) / cheapest.minimum_order) * cheapest.minimum_order));
    set({ autoAdvance: true, draft: { ...draft, weekly_green_orders, weekly_roast_targets } });
  },

  resetGame: () => set({
    phase: 'setup', gameId: null, state: null, draft: emptyDraft,
    loading: false, error: null, autoAdvance: false,
  }),
}));
