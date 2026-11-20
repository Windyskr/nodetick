import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEscape } from '../../../lib/useEscape';
import { useT } from '../../../i18n';

interface Anchor {
  /** The trigger's rectangle, or a point (a right click). */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * A menu in a portal, so the scrolling settings panel can't clip it. Opens
 * below the anchor (above when there's more room there), right-aligned.
 */
export function FloatingMenu({ anchor, onClose, width = 230, align = 'right', label, children }: {
  anchor: Anchor;
  onClose: () => void;
  width?: number;
  align?: 'left' | 'right';
  label?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const margin = 8;
    const below = window.innerHeight - anchor.bottom - margin;
    const above = anchor.top - margin;
    const height = panel.current?.scrollHeight ?? 0;
    const up = height > below && above > below;
    const left = align === 'right' ? anchor.right - width : anchor.left;
    setStyle({
      position: 'fixed',
      width,
      left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
      ...(up ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
      maxHeight: Math.max(160, (up ? above : below) - 4),
    });
  }, [anchor, width, align]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) close.current();
    };
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close.current();
    };
    const onResize = () => close.current();
    // Opened by this very click: start listening after it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);
  useEscape(onClose);

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      style={style}
      className="z-[70] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_6px_24px_rgba(0,0,0,0.14)]"
    >
      {children}
    </div>,
    document.body,
  );
}

export function anchorOf(element: Element): Anchor {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/** A menu entry with a check mark on the right when chosen. */
export function MenuOption({ label, hint, checked, disabled, multi, onClick }: {
  label: ReactNode;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  /** Several can be chosen: a checkbox role instead of a radio. */
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-[7px] text-left text-[13px] hover:bg-hover disabled:cursor-default disabled:opacity-60 ${checked ? 'text-tt' : 'text-ink'}`}
    >
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint && <span className="ml-1 text-ink-3">{hint}</span>}
      </span>
      <Check size={15} className={`shrink-0 ${checked ? '' : 'invisible'}`} />
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-ink-3">{children}</div>;
}

/** A settings row: name on the left, the current value (opens a menu) on the right. */
export function SettingButton({ label, value, onOpen, expanded }: { label: string; value: string; onOpen: (anchor: Anchor) => void; expanded: boolean }) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => onOpen(anchorOf(event.currentTarget.querySelector('[data-value]') ?? event.currentTarget))}
      className="group flex min-h-[40px] w-full items-center gap-3 px-4 text-left"
    >
      <span className="shrink-0 text-[13.5px] text-ink">{label}</span>
      <span data-value className={`ml-auto flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] text-ink-3 group-hover:bg-hover ${expanded ? 'bg-hover' : ''}`}>
        <span className="truncate">{value}</span>
        <ChevronsUpDown size={12} className="shrink-0" />
      </span>
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors ${checked ? 'justify-end bg-tt' : 'justify-start bg-[#dcdcdc]'}`}
    >
      <span className="h-[18px] w-[18px] rounded-full bg-white shadow-sm" />
    </button>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const t = useT();
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 items-center px-5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}
