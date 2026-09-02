import { useRef, useState } from 'react';
import { addDays, todayStr } from '../lib/date';
import { useT } from '../i18n';

/** Shared due-date popover menu: quick presets + a native date input + clear. */
export function DateMenu({
  current,
  onPick,
}: {
  current: string | null;
  onPick: (day: string | null) => void;
}) {
  const t = useT();
  const today = todayStr();
  const [picked, setPicked] = useState(current ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const options: [string, string][] = [
    [t('relToday'), today],
    [t('relTomorrow'), addDays(today, 1)],
    [t('nextWeek'), addDays(today, 7)],
  ];
  return (
    <div className="w-56 p-2">
      {options.map(([label, day]) => (
        <button
          key={day}
          type="button"
          onClick={() => onPick(day)}
          className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-hover"
        >
          {label}
          {current === day && <span className="text-tt">✓</span>}
        </button>
      ))}
      <div className="mt-1 border-t border-line px-3 pt-2">
        <input
          ref={inputRef}
          type="date"
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            if (e.target.value) onPick(e.target.value);
          }}
          className="w-full rounded-md border border-line px-2 py-1.5 text-[13px]"
        />
      </div>
      <button
        type="button"
        onClick={() => onPick(null)}
        className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-[13px] text-p-high hover:bg-hover"
      >
        {t('clear')}
      </button>
    </div>
  );
}
