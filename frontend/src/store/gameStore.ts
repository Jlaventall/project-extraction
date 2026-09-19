import { create } from 'zustand';
import type { ActionDraft, Catalog, GameSnapshot, Phase } from '../types';

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
  fetchCatalog: () => Promise<void>;
  startGame: (seed: number, horizonDays: number) => Promise<void>;
  advanceDay: (useBaseline?: boolean) => Promise<void>;
  setDraftValue: (group: keyof ActionDraft, key: string, value: number) => void;
  setAutoAdvance: (enabled: boolean) => void;
  resetGame: () => void;
}

const emptyDraft: ActionDraft = { weekly_green_orders: {}, weekly_roast_targets: {}, prices: {} };

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`;
    throw new Error(detail);
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

  fetchCatalog: async () => {
    if (get().catalog) return;
    try {
      const catalog = await responseJson(await fetch(`${API_BASE}/api/catalog`)) as Catalog;
      set({ catalog });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to reach simulation API' });
    }
  },

  startGame: async (seed, horizonDays) => {
    set({ loading: true, error: null });
    try {
      const payload = await responseJson(await fetch(`${API_BASE}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, horizon_days: horizonDays }),
      })) as { game_id: string; state: GameSnapshot };
      const catalog = get().catalog;
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
    try {
      const payload = await responseJson(await fetch(`${API_BASE}/api/games/${gameId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, use_baseline: useBaseline }),
      })) as { state: GameSnapshot };
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
