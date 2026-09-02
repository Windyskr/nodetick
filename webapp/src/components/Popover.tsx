import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Minimal popover: button + floating panel, closes on outside click / Escape.
 */
export function Popover({
  trigger,
  children,
  align = 'left',
  panelClass = '',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  panelClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className={`absolute z-50 mt-1 rounded-lg border border-line bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)] ${align === 'right' ? 'right-0' : 'left-0'} ${panelClass}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[13px] hover:bg-hover ${
        danger ? 'text-p-high' : 'text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
