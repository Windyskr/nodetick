import { Check } from 'lucide-react';
import { tOf, type Key } from '../i18n';

/** TickTick Open API priority values, as the CLI and the server store them. */
export const PRIORITY = { none: 0, low: 1, medium: 3, high: 5 } as const;

/** Highest first, the order every priority picker lists them in. */
export const PRIORITY_LEVELS: number[] = [PRIORITY.high, PRIORITY.medium, PRIORITY.low, PRIORITY.none];

export const PRIORITY_COLORS: Record<number, string> = {
  [PRIORITY.none]: '#d5d5d5',
  [PRIORITY.low]: '#4772fa',
  [PRIORITY.medium]: '#faa80c',
  [PRIORITY.high]: '#d54848',
};

const PRIORITY_KEYS: Record<number, Key> = {
  [PRIORITY.none]: 'priorityNone',
  [PRIORITY.low]: 'priorityLow',
  [PRIORITY.medium]: 'priorityMedium',
  [PRIORITY.high]: 'priorityHigh',
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
