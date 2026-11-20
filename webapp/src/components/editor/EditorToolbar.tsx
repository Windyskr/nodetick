import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Clock, Heading1, Heading2, Heading3, Link2, List, ListOrdered, ListTodo, Minus, Quote, SquareCode } from 'lucide-react';
import { useI18n, useT } from '../../i18n';
import { dateText } from './slash';
import { LINK_KEYS, MARK_BUTTONS, ToolButton, toggleMark } from './BubbleToolbar';

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" />;

/** Toolbar above the text (`toolbar="fixed"`): blocks, inline formats, link, divider and the current time. */
export function EditorToolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const t = useT();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      taskList: current.isActive('taskList'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
      link: current.isActive('link'),
    }),
  });
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => command(editor.chain().focus()).run();
  return (
    <div role="toolbar" aria-label={t('editorFormatting')} className="nt-toolbar flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1">
      <ToolButton label={t('editorHeading1')} active={state.h1} onClick={() => run((c) => c.toggleHeading({ level: 1 }))}><Heading1 size={17} /></ToolButton>
      <ToolButton label={t('editorHeading2')} active={state.h2} onClick={() => run((c) => c.toggleHeading({ level: 2 }))}><Heading2 size={17} /></ToolButton>
      <ToolButton label={t('editorHeading3')} active={state.h3} onClick={() => run((c) => c.toggleHeading({ level: 3 }))}><Heading3 size={17} /></ToolButton>
      <Divider />
      {MARK_BUTTONS.map(({ mark, label, keys, icon }) => (
        <ToolButton key={mark} label={`${t(label)} (${keys})`} active={state[mark]} onClick={() => toggleMark(editor, mark)}>{icon}</ToolButton>
      ))}
      <Divider />
      <ToolButton label={t('editorChecklist')} active={state.taskList} onClick={() => run((c) => c.toggleTaskList())}><ListTodo size={17} /></ToolButton>
      <ToolButton label={t('editorBulletList')} active={state.bulletList} onClick={() => run((c) => c.toggleBulletList())}><List size={17} /></ToolButton>
      <ToolButton label={t('editorNumberedList')} active={state.orderedList} onClick={() => run((c) => c.toggleOrderedList())}><ListOrdered size={17} /></ToolButton>
      <Divider />
      <ToolButton label={t('editorQuote')} active={state.blockquote} onClick={() => run((c) => c.toggleBlockquote())}><Quote size={16} /></ToolButton>
      <ToolButton label={t('editorCodeBlock')} active={state.codeBlock} onClick={() => run((c) => c.toggleCodeBlock())}><SquareCode size={16} /></ToolButton>
      <ToolButton label={`${t('editorLink')} (${LINK_KEYS})`} active={state.link} onClick={onLink}><Link2 size={16} /></ToolButton>
      <ToolButton label={t('editorDivider')} onClick={() => run((c) => c.setHorizontalRule())}><Minus size={16} /></ToolButton>
      <ToolButton label={t('editorNow')} onClick={() => run((c) => c.insertContent(dateText('now', useI18n.getState().lang)))}><Clock size={16} /></ToolButton>
    </div>
  );
}
