import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  CalendarDays,
  Clock,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SquareCode,
  Type,
} from 'lucide-react';
import { useT } from '../../i18n';
import type { SlashCommand, SlashCommandId } from './slash';
import { CLOSED_SLASH_MENU, setSlashIndex, slashMatches, slashMenuKey } from './slashMenu';

const ICONS: Record<SlashCommandId, ReactNode> = {
  text: <Type size={16} />,
  h1: <Heading1 size={16} />,
  h2: <Heading2 size={16} />,
  h3: <Heading3 size={16} />,
  taskList: <ListTodo size={16} />,
  bulletList: <List size={16} />,
  orderedList: <ListOrdered size={16} />,
  quote: <Quote size={16} />,
  codeBlock: <SquareCode size={16} />,
  divider: <Minus size={16} />,
  link: <Link2 size={16} />,
  today: <CalendarDays size={16} />,
  now: <Clock size={16} />,
};

const WIDTH = 236;

/** The `/` menu, at the caret. The plugin in slashMenu.ts owns its state and keys. */
export function SlashMenuView({ editor, onPick }: { editor: Editor; onPick: (command: SlashCommand, range: { from: number; to: number }) => void }) {
  const t = useT();
  const menu = useEditorState({ editor, selector: ({ editor: current }) => slashMenuKey.getState(current.state) ?? CLOSED_SLASH_MENU });
  const listRef = useRef<HTMLDivElement>(null);
  const [, setLayout] = useState(0);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [menu.index, menu.query, menu.active]);

  // Follow the caret when the detail panel scrolls or the window resizes.
  useEffect(() => {
    if (!menu.active) return;
    const relayout = () => setLayout((n) => n + 1);
    window.addEventListener('scroll', relayout, true);
    window.addEventListener('resize', relayout);
    return () => {
      window.removeEventListener('scroll', relayout, true);
      window.removeEventListener('resize', relayout);
    };
  }, [menu.active]);

  if (!menu.active || editor.isDestroyed) return null;
  let caret: { top: number; bottom: number; left: number };
  try {
    caret = editor.view.coordsAtPos(menu.from);
  } catch {
    return null;
  }
  const matches = slashMatches(menu.query);
  const below = window.innerHeight - caret.bottom - 12;
  const above = caret.top - 12;
  const up = below < 240 && above > below;
  const maxHeight = Math.max(120, Math.min(320, up ? above : below));
  const left = Math.max(8, Math.min(caret.left - 6, window.innerWidth - WIDTH - 8));
  const style = up ? { left, bottom: window.innerHeight - caret.top + 6, maxHeight, width: WIDTH } : { left, top: caret.bottom + 6, maxHeight, width: WIDTH };
  const pick = (command: SlashCommand) => onPick(command, { from: menu.from, to: editor.state.selection.from });

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('editorInsert')}
      className="nt-slash fixed z-[70] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      style={style}
      // Clicks must not take the focus (and the caret) out of the editor.
      onMouseDown={(event) => event.preventDefault()}
    >
      {matches.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-ink-3">{t('editorNoResults')}</div>
      ) : (
        matches.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === menu.index}
            onMouseMove={() => index !== menu.index && setSlashIndex(editor.view, index)}
            onClick={() => pick(command)}
            className={`flex h-8 w-full items-center gap-2.5 px-3 text-left text-[13px] ${index === menu.index ? 'bg-hover text-ink' : 'text-ink-2'}`}
          >
            <span className="shrink-0 text-ink-3">{ICONS[command.id]}</span>
            <span className="min-w-0 flex-1 truncate">{t(command.label)}</span>
            {command.hint && <span className="shrink-0 font-mono text-[11px] text-ink-3">{command.hint}</span>}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
