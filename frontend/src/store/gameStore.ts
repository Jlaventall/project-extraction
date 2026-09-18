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
      set({
        state: payload.state,
        phase: payload.state.terminated || payload.state.truncated ? 'ended' : 'playing',
        loading: false,
        draft: {
          weekly_green_orders: Object.fromEntries(Object.keys(get().draft.weekly_green_orders).map((key) => [key, 0])),
          weekly_roast_targets: Object.fromEntries(Object.keys(get().draft.weekly_roast_targets).map((key) => [key, 0])),
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

  setAutoAdvance: (enabled) => set({ autoAdvance: enabled }),

  resetGame: () => set({
    phase: 'setup', gameId: null, state: null, draft: emptyDraft,
    loading: false, error: null, autoAdvance: false,
  }),
}));
