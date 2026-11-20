import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { Link2 } from 'lucide-react';
import { useT } from '../../i18n';
import { isSubmitEnter } from '../../lib/keys';

/** The text a link goes on (empty: insert the URL as its own text) and its current target. */
export interface LinkTarget {
  from: number;
  to: number;
  href: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_RE = /^(?:https?|ftp|mailto|tel):/i;

/** "example.com/x" → "https://example.com/x", "me@x.org" → "mailto:me@x.org"; null when it can't be a link. */
export function normalizeHref(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (SCHEME_RE.test(value)) return ALLOWED_RE.test(value) ? value : null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
  if (/^[^\s/]+\.[^\s/]+/.test(value) && !/\s/.test(value)) return `https://${value.replace(/^\/\//, '')}`;
  return null;
}

/** Small dialog under the text for typing or changing a link (Ctrl/Cmd+K, the toolbars, `/` → Link). */
export function LinkEditor({ editor, target, onClose }: { editor: Editor; target: LinkTarget; onClose: () => void }) {
  const t = useT();
  const [href, setHref] = useState(target.href);
  const [invalid, setInvalid] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useMemo(() => {
    try {
      const start = editor.view.coordsAtPos(target.from);
      const width = Math.min(300, window.innerWidth - 16);
      const left = Math.max(8, Math.min(start.left, window.innerWidth - width - 8));
      const below = window.innerHeight - start.bottom > 140;
      return below ? { left, top: start.bottom + 6, width } : { left, bottom: window.innerHeight - start.top + 6, width };
    } catch {
      return { left: 8, top: 8, width: 300 };
    }
  }, [editor, target]);

  const finish = () => {
    onClose();
    editor.commands.focus();
  };

  const apply = () => {
    const url = normalizeHref(href);
    if (!url) {
      if (!href.trim() && target.href) remove();
      else setInvalid(true);
      return;
    }
    const { from, to } = target;
    const chain = editor.chain().focus();
    if (from === to) {
      chain.insertContentAt(from, { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
    } else {
      chain.setTextSelection({ from, to }).setLink({ href: url }).setTextSelection(to);
    }
    chain.run();
    onClose();
  };

  const remove = () => {
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).unsetLink().setTextSelection(target.to).run();
    onClose();
  };

  // A click elsewhere closes it, like the app's other popovers.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('editorLink')}
      className="fixed z-[70] rounded-lg border border-line bg-white p-2 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      style={position}
    >
      <div className="flex items-center gap-2 rounded-md border border-line px-2 focus-within:border-tt">
        <Link2 size={14} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          value={href}
          placeholder={t('editorLinkPlaceholder')}
          aria-label={t('editorLinkPlaceholder')}
          aria-invalid={invalid}
          onChange={(event) => {
            setHref(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (isSubmitEnter(event)) {
              event.preventDefault();
              apply();
            } else if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              finish();
            }
          }}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {invalid && <p className="mt-1.5 px-0.5 text-[12px] text-p-high">{t('editorLinkInvalid')}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        {target.href && (
          <button type="button" onClick={remove} className="mr-auto rounded-md px-1.5 py-1 text-[12.5px] text-ink-3 hover:text-p-high">
            {t('editorLinkRemove')}
          </button>
        )}
        <button type="button" onClick={finish} className="h-7 rounded-md border border-line px-3 text-[12.5px] text-ink-2 hover:bg-hover">
          {t('cancel')}
        </button>
        <button type="button" onClick={apply} className="h-7 rounded-md bg-tt px-3 text-[12.5px] text-white hover:bg-tt-hover">
          {t('save')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
