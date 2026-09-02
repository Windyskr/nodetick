import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { api, yearRange } from '../../lib/api';
import type { Habit, HabitYear } from '../../lib/types';
import { stampToday, todayStr, weekdayShort } from '../../lib/date';
import { useT, useTF } from '../../i18n';

const COLORS = ['#4772fa', '#47a35c', '#faa80c', '#d54848', '#9a68f5', '#0fb5ae'];

export default function HabitPage() {
  const t = useT();
  const f = useTF();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [years, setYears] = useState<Map<string, HabitYear>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    const list = (await api.listHabits()).filter((h) => h.status !== 2);
    setHabits(list);
    if (list.length) {
      const stamp = stampToday();
      const rows = await api.listCheckins(list.map((h) => h.id), ...yearRange(stamp));
      setYears(new Map(rows.map((r) => [r.habitId, r])));
    } else {
      setYears(new Map());
    }
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleToday = async (habit: Habit) => {
    const stamp = stampToday();
    const existing = years.get(habit.id)?.checkins.find((c) => c.stamp === stamp);
    const nextYear = existing
      ? await api.checkin(habit.id, stamp, 0) // value 0 clears today's check-in
      : await api.checkin(habit.id, stamp, habit.goal ?? 1);
    setYears((m) => new Map(m).set(habit.id, nextYear));
  };

  const last7 = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const p = (n: number) => String(n).padStart(2, '0');
      out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    return out;
  }, []);

  const doneOn = (habitId: string, day: string): boolean => {
    const stamp = Number(day.replaceAll('-', ''));
    const c = years.get(habitId)?.checkins.find((x) => x.stamp === stamp);
    if (!c) return false;
    const goal = c.goal ?? 1;
    return (c.value ?? 0) >= goal && goal > 0;
  };

  const streak = (habitId: string): number => {
    let n = 0;
    const d = new Date();
    for (;;) {
      const p = (k: number) => String(k).padStart(2, '0');
      const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (doneOn(habitId, day)) {
        n++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return n;
  };

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="flex items-center px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">{t('habitTitle')}</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="ml-auto flex items-center gap-1 rounded-full bg-tt px-4 py-1.5 text-[13px] font-medium text-white hover:bg-tt-hover"
        >
          <Plus size={14} /> {t('newHabit')}
        </button>
      </div>
      <div className="px-5 pb-10">
        {!loaded ? (
          <div className="pt-16 text-center text-ink-3">{t('loading')}</div>
        ) : habits.length === 0 ? (
          <div className="pt-16 text-center text-[13px] text-ink-3">
            {t('habitEmpty')}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {habits.map((h) => {
              const color = h.color ?? '#4772fa';
              const st = streak(h.id);
              return (
                <div key={h.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: color }} />
                    <span className="text-[15px] font-semibold">{h.name}</span>
                    <span className="ml-auto text-[12px] text-ink-3">
                      {st > 0 ? f('habitStreak', st) : t('habitNoStreak')}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-ink-3">
                    {f('habitGoal', h.goal ?? 1, h.unit ?? t('habitUnit'))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {last7.map((day) => {
                      const done = doneOn(h.id, day);
                      const isToday = day === todayStr();
                      return (
                        <button
                          key={day}
                          type="button"
                          title={day}
                          onClick={() => isToday && void toggleToday(h)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] ${
                            isToday ? 'ring-1 ring-tt/50' : ''
                          } ${done ? 'text-white' : 'text-ink-3'}`}
                          style={{ background: done ? color : '#f5f5f5' }}
                        >
                          <span>{weekdayShort(day)}</span>
                          <span className="flex h-4 items-center">
                            {done ? <Check size={13} /> : isToday ? <Plus size={13} className="text-tt" /> : '·'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showNew && (
        <NewHabitModal
          onClose={() => setShowNew(false)}
          onCreate={async (input) => {
            await api.createHabit(input);
            setShowNew(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function NewHabitModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(1);
  const [unit, setUnit] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate({
        name: name.trim(),
        goal,
        unit: unit.trim() || null,
        color,
        repeatRule: 'RRULE:FREQ=DAILY;INTERVAL=1',
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-[380px] rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{t('newHabit')}</h2>
          <button type="button" onClick={onClose} className="ml-auto text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        {error && <div className="mb-3 rounded-md bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">{error}</div>}
        <input
          autoFocus
          value={name}
          placeholder={t('habitNamePh')}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        <div className="mb-3 flex gap-2">
          <input
            type="number"
            min={1}
            value={goal}
            onChange={(e) => setGoal(Math.max(1, Number(e.target.value)))}
            className="w-24 rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
          />
          <input
            value={unit}
            placeholder={t('habitUnitPh')}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
          />
        </div>
        <div className="mb-5 flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-ink-3' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <button type="submit" className="w-full rounded-md bg-tt py-2 text-[14px] font-medium text-white hover:bg-tt-hover">
          {t('createHabit')}
        </button>
      </form>
    </div>
  );
}
