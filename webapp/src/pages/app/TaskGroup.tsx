import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Collapsible group header with count and optional right-side action. */
export function TaskGroup({
  label,
  count,
  red,
  defaultOpen = true,
  action,
  children,
}: {
  label: string;
  count: number;
  red?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex h-7 items-center gap-1 px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[14px] font-bold text-ink"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {label}
          <span className={`ml-1 font-normal ${red ? 'text-p-high' : 'text-ink-3'}`}>{count}</span>
        </button>
        <span className="ml-auto">{action}</span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}
