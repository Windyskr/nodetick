import { Check } from 'lucide-react';
import { tOf, type Key } from '../i18n';

export const PRIORITY_COLORS: Record<number, string> = {
  0: '#d5d5d5',
  1: '#4772fa',
  2: '#faa80c',
  3: '#d54848',
};

const PRIORITY_KEYS: Record<number, Key> = {
  0: 'priorityNone',
  1: 'priorityLow',
  2: 'priorityMedium',
  3: 'priorityHigh',
};

export const priorityLabel = (priority: number): string => tOf(PRIORITY_KEYS[priority] ?? 'priorityNone');

/**
 * TickTick-style round checkbox: 2px ring in the priority color; completed
 * tasks render a filled gray check.
 */
export function RoundCheck({
  checked,
  priority = 0,
  onClick,
  size = 18,
  title,
}: {
  checked: boolean;
  priority?: number;
  onClick?: () => void;
  size?: number;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="flex shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ width: size, height: size }}
    >
      {checked ? (
        <span className="flex items-center justify-center rounded-full bg-[#bdbdbd] text-white" style={{ width: size, height: size }}>
          <Check size={size * 0.62} strokeWidth={3} />
        </span>
      ) : (
        <span
          className="rounded-full bg-white transition-colors hover:scale-110"
          style={{ width: size, height: size, border: `2px solid ${PRIORITY_COLORS[priority] ?? PRIORITY_COLORS[0]}` }}
        />
      )}
    </button>
  );
}
