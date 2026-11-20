import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Bold, Code, ExternalLink, Highlighter, Italic, Link2, Pencil, Strikethrough, Underline, Unlink } from 'lucide-react';
import { useT, type Key } from '../../i18n';
import { FloatingBar } from './FloatingBar';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight';

/** Inline formats of the selection toolbar, with their shortcuts. */
export const MARK_BUTTONS: { mark: MarkName; label: Key; keys: string; icon: ReactNode }[] = [
  { mark: 'bold', label: 'editorBold', keys: `${MOD}B`, icon: <Bold size={15} strokeWidth={2.4} /> },
  { mark: 'italic', label: 'editorItalic', keys: `${MOD}I`, icon: <Italic size={15} /> },
  { mark: 'underline', label: 'editorUnderline', keys: `${MOD}U`, icon: <Underline size={15} /> },
  { mark: 'strike', label: 'editorStrike', keys: `${MOD}Shift+S`, icon: <Strikethrough size={15} /> },
  { mark: 'code', label: 'editorInlineCode', keys: `${MOD}E`, icon: <Code size={15} /> },
  { mark: 'highlight', label: 'editorHighlight', keys: `${MOD}Shift+H`, icon: <Highlighter size={15} /> },
];

export const LINK_KEYS = `${MOD}K`;

export function toggleMark(editor: Editor, mark: MarkName) {
  editor.chain().focus().toggleMark(mark).run();
}

/** A toolbar button that keeps the editor's focus and selection. */
export function ToolButton({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-tt-light text-tt' : 'text-ink-2 hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

const BUBBLE_CLASS = 'nt-bubble flex items-center rounded-lg border border-line bg-white shadow-[0_4px_16px_rgba(0,0,0,0.12)]';

/** Formatting toolbar over selected text, like TickTick's. */
export function BubbleToolbar({ editor, onLink, hidden }: { editor: Editor; onLink: () => void; hidden: boolean }) {
  const t = useT();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      link: current.isActive('link'),
    }),
  });
  return (
    <FloatingBar
      editor={editor}
      show={(current) => {
        const { state, view } = current;
        const { from, to, empty } = state.selection;
        return !hidden && current.isEditable && !empty && view.hasFocus() && !state.selection.$from.parent.type.spec.code && state.doc.textBetween(from, to).trim() !== '';
      }}
      className={`${BUBBLE_CLASS} p-1`}
    >
      <div role="toolbar" aria-label={t('editorFormatting')} className="flex items-center gap-0.5">
        {MARK_BUTTONS.map(({ mark, label, keys, icon }) => (
          <ToolButton key={mark} label={`${t(label)} (${keys})`} active={active[mark]} onClick={() => toggleMark(editor, mark)}>
            {icon}
          </ToolButton>
        ))}
        <span className="mx-0.5 h-4 w-px bg-line" />
        <ToolButton label={`${t('editorLink')} (${LINK_KEYS})`} active={active.link} onClick={onLink}>
          <Link2 size={15} />
        </ToolButton>
      </div>
    </FloatingBar>
  );
}

/** With the caret in a link: where it goes, open, edit, remove. */
export function LinkBubble({ editor, onEdit, hidden }: { editor: Editor; onEdit: () => void; hidden: boolean }) {
  const t = useT();
  const href = useEditorState({
    editor,
    selector: ({ editor: current }) => (current.isActive('link') ? String(current.getAttributes('link').href ?? '') : ''),
  });
  return (
    <FloatingBar
      editor={editor}
      placement="bottom"
      show={(current) => !hidden && current.isEditable && current.state.selection.empty && current.view.hasFocus() && current.isActive('link')}
      className={`${BUBBLE_CLASS} max-w-[320px] gap-1 py-1 pl-2.5 pr-1`}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-[12.5px] text-tt hover:underline">
        {href}
      </a>
      <ToolButton label={t('editorLinkOpen')} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>
        <ExternalLink size={14} />
      </ToolButton>
      <ToolButton label={t('editorLinkEdit')} onClick={onEdit}>
        <Pencil size={14} />
      </ToolButton>
      <ToolButton label={t('editorLinkRemove')} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
        <Unlink size={14} />
      </ToolButton>
    </FloatingBar>
  );
}
