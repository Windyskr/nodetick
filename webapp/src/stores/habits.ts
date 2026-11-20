import { create } from 'zustand';
import { api } from '../lib/api';
import { todayStr } from '../lib/date';
import { dayDiff, dayToStamp, effectiveGoal, habitStreaks, parseHabitRule, type HabitContext, type HabitRule } from '../lib/habits';
import type { CheckinRow, Habit, HabitCheckinEntry, HabitEntryResult, HabitYear } from '../lib/types';

/**
 * Habits and their check-ins, shared by the habit page and the Today list.
 * Check-ins load per calendar year (GET /habit/checkins allows 366 days):
 * the current year for active habits, older years when a streak or the
 * detail panel's statistics reach back.
 */

/** GET /habit/checkins takes at most 100 habit ids. */
const MAX_IDS = 100;
const EMPTY: ReadonlyMap<number, CheckinRow> = new Map();

type CheckinMap = ReadonlyMap<number, CheckinRow>;

interface HabitState {
  habits: Habit[];
  loaded: boolean;
  /** habitId → YYYYMMDD stamp → check-in, for the loaded years. */
  checkins: Record<string, CheckinMap>;
  /** habitId → loaded calendar years. */
  years: Record<string, number[]>;
  /** `${habitId}:${stamp}` → the day's check-in entries, once loaded. */
  entries: Record<string, HabitCheckinEntry[]>;

  load: () => Promise<void>;
  ensureYears: (habitIds: string[], years: number[], refresh?: boolean) => Promise<void>;
  /** Load the years before the loaded ones while the habit's current streak runs into them. */
  extendStreakHistory: (habit: Habit) => Promise<void>;
  /** Load every year since the habit started (the detail panel's totals). */
  loadFullHistory: (habit: Habit) => Promise<void>;
  loadEntries: (habitId: string, stamp: number) => Promise<HabitCheckinEntry[]>;

  saveHabit: (id: string | null, input: Record<string, unknown>) => Promise<Habit>;
  setStatus: (id: string, status: number) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  /** TickTick's upsert of the day's value (boolean habits, resets); it drops the day's entries. */
  setDayValue: (habit: Habit, day: string, value: number, status: number) => Promise<void>;
  addEntry: (habit: Habit, day: string, value: number) => Promise<HabitCheckinEntry | null>;
  updateEntry: (habit: Habit, entry: HabitCheckinEntry, patch: { value?: number; time?: string }) => Promise<void>;
  removeEntry: (habit: Habit, entry: HabitCheckinEntry) => Promise<void>;
}

export const entryKey = (habitId: string, stamp: number) => `${habitId}:${stamp}`;

/** The context the lib/habits functions compute a habit's numbers from, with the whole parsed rule. */
export function habitContext(habit: Habit, checkins: CheckinMap | undefined): HabitContext & { rule: HabitRule } {
  return { rule: parseHabitRule(habit), goal: habit.goal, checkins: checkins ?? EMPTY };
}

/** First day with loaded check-ins. */
export function loadedFloor(years: number[] | undefined): string {
  const first = years?.length ? Math.min(...years) : Number(todayStr().slice(0, 4));
  return `${first}-01-01`;
}

/** The earliest year a habit can have check-ins in: its start or creation, whichever is first. */
export function firstYear(habit: Habit): number {
  const current = Number(todayStr().slice(0, 4));
  const candidates = [parseHabitRule(habit).startDate, habit.createdTime ?? null]
    .map((value) => (value ? Number(value.slice(0, 4)) : NaN))
    .filter((year) => Number.isInteger(year) && year > 1970);
  return Math.min(current, ...candidates);
}

/** Local wall-clock time on `day` with the browser's offset, e.g. 2026-11-20T09:30:00+0800. */
export function entryTimeOn(day: string, clock?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return `${day}T${clock ?? `${pad(now.getHours())}:${pad(now.getMinutes())}`}:${clock ? '00' : pad(now.getSeconds())}${zone}`;
}

const pending = new Set<string>();

export const useHabitStore = create<HabitState>((set, get) => {
  /** Merge a year of check-ins (a response always covers the whole year). */
  const applyYear = (result: HabitYear) => {
    set((state) => {
      const next = new Map<number, CheckinRow>();
      for (const [stamp, row] of state.checkins[result.habitId] ?? EMPTY) {
        if (Math.floor(stamp / 10000) !== result.year) next.set(stamp, row);
      }
      for (const row of result.checkins) next.set(row.stamp, row);
      const years = state.years[result.habitId] ?? [];
      return {
        checkins: { ...state.checkins, [result.habitId]: next },
        years: { ...state.years, [result.habitId]: years.includes(result.year) ? years : [...years, result.year] },
      };
    });
  };
  const applyEntries = (result: HabitEntryResult, stamp: number) => {
    applyYear(result);
    set((state) => ({ entries: { ...state.entries, [entryKey(result.habitId, stamp)]: result.entries } }));
  };
  const replaceHabit = (habit: Habit) =>
    set((state) => ({
      habits: state.habits.some((item) => item.id === habit.id)
        ? state.habits.map((item) => (item.id === habit.id ? habit : item))
        : [...state.habits, habit],
    }));

  return {
    habits: [],
    loaded: false,
    checkins: {},
    years: {},
    entries: {},

    load: async () => {
      const habits = await api.listHabits();
      set({ habits });
      const today = todayStr();
      const year = Number(today.slice(0, 4));
      // The week strip and a week's quota reach up to six days back.
      const years = dayDiff(`${year}-01-01`, today) < 7 ? [year, year - 1] : [year];
      await get().ensureYears(habits.filter((habit) => habit.status === 0).map((habit) => habit.id), years, true);
      set({ loaded: true });
    },

    ensureYears: async (habitIds, years, refresh = false) => {
      const requests: Promise<void>[] = [];
      for (const year of years) {
        const ids = habitIds.filter((id) => {
          const key = `${id}:${year}`;
          return !pending.has(key) && (refresh || !(get().years[id] ?? []).includes(year));
        });
        for (let i = 0; i < ids.length; i += MAX_IDS) {
          const chunk = ids.slice(i, i + MAX_IDS);
          chunk.forEach((id) => pending.add(`${id}:${year}`));
          requests.push(
            api.listCheckins(chunk, year * 10000 + 101, year * 10000 + 1231)
              .then((rows) => rows.forEach((row) => applyYear({ ...row, year })))
              .finally(() => chunk.forEach((id) => pending.delete(`${id}:${year}`))),
          );
        }
      }
      await Promise.all(requests);
    },

    extendStreakHistory: async (habit) => {
      const state = get();
      const years = state.years[habit.id];
      if (!years?.length) return;
      const earliest = Math.min(...years);
      if (earliest <= firstYear(habit)) return;
      const streaks = habitStreaks(habitContext(habit, state.checkins[habit.id]), todayStr(), loadedFloor(years));
      if (streaks.reachesFloor) await get().ensureYears([habit.id], [earliest - 1]);
    },

    loadFullHistory: async (habit) => {
      const current = Number(todayStr().slice(0, 4));
      // Ten years at most up front; older years load when the panel shows them.
      const from = Math.max(firstYear(habit), current - 9);
      await get().ensureYears([habit.id], Array.from({ length: current - from + 1 }, (_, i) => from + i));
    },

    loadEntries: async (habitId, stamp) => {
      const entries = await api.listCheckinEntries(habitId, stamp, stamp);
      set((state) => ({ entries: { ...state.entries, [entryKey(habitId, stamp)]: entries } }));
      return entries;
    },

    saveHabit: async (id, input) => {
      const habit = id ? await api.updateHabit(id, input) : await api.createHabit(input);
      replaceHabit(habit);
      if (!id) await get().ensureYears([habit.id], [Number(todayStr().slice(0, 4))]);
      return habit;
    },

    setStatus: async (id, status) => {
      const habit = await api.setHabitStatus(id, status);
      replaceHabit(habit);
      if (status === 0) await get().ensureYears([id], [Number(todayStr().slice(0, 4))]);
    },

    deleteHabit: async (id) => {
      await api.deleteHabit(id);
      set((state) => {
        const { [id]: _checkins, ...checkins } = state.checkins;
        const { [id]: _years, ...years } = state.years;
        return { habits: state.habits.filter((habit) => habit.id !== id), checkins, years };
      });
    },

    setDayValue: async (habit, day, value, status) => {
      const stamp = dayToStamp(day);
      const result = await api.checkin(habit.id, stamp, value, { goal: effectiveGoal(null, habit.goal), status });
      applyYear(result);
      set((state) => ({ entries: { ...state.entries, [entryKey(habit.id, stamp)]: [] } }));
    },

    addEntry: async (habit, day, value) => {
      const stamp = dayToStamp(day);
      const before = new Set((get().entries[entryKey(habit.id, stamp)] ?? []).map((entry) => entry.id));
      const result = await api.addCheckinEntry(habit.id, stamp, value, { time: entryTimeOn(day), goal: effectiveGoal(null, habit.goal) });
      applyEntries(result, stamp);
      return result.entries.filter((entry) => !before.has(entry.id)).at(-1) ?? null;
    },

    updateEntry: async (habit, entry, patch) => {
      applyEntries(await api.updateCheckinEntry(habit.id, entry.id, patch), entry.stamp);
    },

    removeEntry: async (habit, entry) => {
      applyEntries(await api.deleteCheckinEntry(habit.id, entry.id), entry.stamp);
    },
  };
});
