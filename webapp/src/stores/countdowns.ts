import { create } from 'zustand';
import { api, type CountdownInput } from '../lib/api';
import type { Countdown } from '../lib/types';
import { LEGACY_NOTES_KEY, parseLegacyNotes } from '../lib/countdown';

/**
 * Countdowns for the countdown page and the calendar's countdown chips.
 * Kept apart from the task store: only these two pages load them.
 */
interface CountdownState {
  items: Countdown[];
  loaded: boolean;
  failed: boolean;
  /** The user's all-day reminder time (notification settings), the default reminder time. */
  allDayTime: string;
  load: () => Promise<void>;
  loadAllDayTime: () => Promise<void>;
  add: (input: CountdownInput) => Promise<Countdown>;
  /** Applied locally at once; rolled back when the server refuses. */
  update: (id: string, patch: Partial<CountdownInput>) => Promise<Countdown>;
  remove: (id: string) => Promise<void>;
}

let loading: Promise<void> | null = null;
let allDayTimeLoaded = false;

/**
 * Notes used to live in this browser's localStorage only. Move them to the
 * server once: a countdown that already has a server note keeps it, notes of
 * deleted countdowns are dropped, failures stay for the next load.
 */
async function migrateLegacyNotes(items: Countdown[]): Promise<Countdown[]> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_NOTES_KEY);
  } catch {
    return items;
  }
  if (raw == null) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const saved = new Map<string, Countdown>();
  const remaining: Record<string, string> = {};
  for (const [id, note] of Object.entries(parseLegacyNotes(raw))) {
    const item = byId.get(id);
    if (!item || item.note) continue;
    try {
      saved.set(id, await api.updateCountdown(id, { note: note.slice(0, 4000) }));
    } catch {
      remaining[id] = note;
    }
  }
  try {
    if (Object.keys(remaining).length) localStorage.setItem(LEGACY_NOTES_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(LEGACY_NOTES_KEY);
  } catch {
    // storage can be unavailable
  }
  return items.map((item) => saved.get(item.id) ?? item);
}

export const useCountdowns = create<CountdownState>((set, get) => ({
  items: [],
  loaded: false,
  failed: false,
  allDayTime: '09:00',

  load: () => {
    loading ??= (async () => {
      try {
        const items = await migrateLegacyNotes(await api.listCountdowns());
        set({ items, loaded: true, failed: false });
      } catch {
        set({ loaded: true, failed: true });
      } finally {
        loading = null;
      }
    })();
    return loading;
  },

  loadAllDayTime: async () => {
    if (allDayTimeLoaded) return;
    allDayTimeLoaded = true;
    try {
      const config = await api.notificationConfig();
      if (/^\d{2}:\d{2}$/.test(config.settings.allDayTime)) set({ allDayTime: config.settings.allDayTime });
    } catch {
      allDayTimeLoaded = false;
    }
  },

  add: async (input) => {
    const created = await api.createCountdown(input);
    set((state) => ({ items: [...state.items, created] }));
    return created;
  },

  update: async (id, patch) => {
    const previous = get().items.find((item) => item.id === id);
    if (previous) set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
    try {
      const saved = await api.updateCountdown(id, patch);
      set((state) => ({ items: state.items.map((item) => (item.id === id ? saved : item)) }));
      return saved;
    } catch (error) {
      if (previous) set((state) => ({ items: state.items.map((item) => (item.id === id ? previous : item)) }));
      throw error;
    }
  },

  remove: async (id) => {
    await api.deleteCountdown(id);
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
}));
