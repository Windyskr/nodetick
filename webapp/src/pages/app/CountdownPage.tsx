import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Countdown } from '../../lib/types';
import { dayOf, todayStr } from '../../lib/date';
import { useT } from '../../i18n';

export default function CountdownPage() {
  const t = useT();
  const [items, setItems] = useState<Countdown[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Countdown | 'new' | null>(null);

  const load = async () => {
    setItems(await api.listCountdowns());
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm(t('deleteCountdownConfirm'))) return;
    await api.deleteCountdown(id);
    await load();
  };

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="flex items-center px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">{t('countdownTitle')}</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="ml-auto flex items-center gap-1 rounded-full bg-tt px-4 py-1.5 text-[13px] font-medium text-white hover:bg-tt-hover"
        >
          <Plus size={14} /> {t('newCountdown')}
        </button>
      </div>
      <div className="px-5 pb-10">
        {!loaded ? (
          <div className="pt-16 text-center text-ink-3">{t('loading')}</div>
        ) : items.length === 0 ? (
          <div className="pt-16 text-center text-[13px] text-ink-3">
            {t('countdownEmpty')}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((cd) => (
              <CountdownCard key={cd.id} cd={cd} onEdit={() => setEditing(cd)} onDelete={() => void remove(cd.id)} />
            ))}
          </div>
        )}
      </div>
      {editing && (
        <EditModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (name, date, id) => {
            if (id) await api.updateCountdown(id, { name, date });
            else await api.createCountdown(name, date);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CountdownCard({ cd, onEdit, onDelete }: { cd: Countdown; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const target = dayOf(cd.date);
  const today = todayStr();
  const days = target ? Math.round((Date.parse(target) - Date.parse(today)) / 86400000) : null;
  const past = days !== null && days < 0;
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-tt to-[#6b8cff] p-5 text-white shadow-[0_8px_24px_rgba(71,114,250,0.25)]">
      <div className="text-[13px] font-medium opacity-90">{cd.name}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[44px] font-extrabold leading-none tabular-nums">
          {days === null ? '—' : past ? Math.abs(days) : days}
        </span>
        <span className="text-[13px] opacity-90">
          {days === null ? '' : days === 0 ? t('daysToday') : past ? t('daysAgo') : t('daysLeft')}
        </span>
      </div>
      <div className="mt-2 text-[12px] opacity-80">{cd.date}</div>
      <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
        <button type="button" onClick={onEdit} className="rounded-md bg-white/20 p-1.5 hover:bg-white/30" title={t('editCountdown')}>
          <Pencil size={13} />
        </button>
        <button type="button" onClick={onDelete} className="rounded-md bg-white/20 p-1.5 hover:bg-white/30" title={t('delete')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function EditModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Countdown | null;
  onClose: () => void;
  onSave: (name: string, date: string, id?: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(dayOf(initial?.date ?? null) ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) {
      setError(t('nameAndDateRequired'));
      return;
    }
    try {
      await onSave(name.trim(), date, initial?.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-[360px] rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{initial ? t('editCountdown') : t('newCountdown')}</h2>
          <button type="button" onClick={onClose} className="ml-auto text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        {error && <div className="mb-3 rounded-md bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">{error}</div>}
        <input
          autoFocus
          value={name}
          placeholder={t('eventNamePh')}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-5 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        <button type="submit" className="w-full rounded-md bg-tt py-2 text-[14px] font-medium text-white hover:bg-tt-hover">
          {initial ? t('save') : t('create')}
        </button>
      </form>
    </div>
  );
}
