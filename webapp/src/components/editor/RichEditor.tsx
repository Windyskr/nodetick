import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Extension, getSchema, type Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { Slice, Fragment } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { useI18n } from '../../i18n';
import { schemaExtensions } from './extensions';
import { markdownToSlice, parseMarkdown, serializeMarkdown, sliceToMarkdown, type MarkdownDocument } from './markdown';
import { SlashMenu } from './slashMenu';
import { dateText, type SlashCommand } from './slash';
import { SlashMenuView } from './SlashMenuView';
import { BubbleToolbar, LinkBubble } from './BubbleToolbar';
import { EditorToolbar } from './EditorToolbar';
import { LinkEditor, type LinkTarget } from './LinkEditor';
import type { RichEditorHandle, RichEditorProps } from './types';
import './editor.css';

/** Schema for reading the first value before the editor exists (content is matched by structure, not identity). */
const staticSchema = getSchema(schemaExtensions());

/** Keys on top of TipTap's: new lines instead of line breaks, Ctrl/Cmd+K for links. */
const EditorKeys = Extension.create<{ onLink: () => void }>({
  name: 'editorKeys',
  priority: 900,
  addOptions() {
    return { onLink: () => undefined };
  },
  addKeyboardShortcuts() {
    // Every line is a paragraph (see markdown.ts): Shift+Enter starts one too,
    // inside the same list item, instead of a <br>.
    const newLine = () => !this.editor.isActive('codeBlock') && this.editor.commands.splitBlock();
    return {
      'Shift-Enter': newLine,
      'Mod-Enter': newLine,
      'Mod-k': () => {
        this.options.onLink();
        return true;
      },
    };
  },
});

function runSlashCommand(editor: Editor, command: SlashCommand, range: { from: number; to: number }, openLink: () => void) {
  const chain = editor.chain().focus().deleteRange(range);
  switch (command.id) {
    case 'text':
      chain.clearNodes().setParagraph();
      break;
    case 'h1':
    case 'h2':
    case 'h3':
      chain.clearNodes().setHeading({ level: Number(command.id.slice(1)) as 1 | 2 | 3 });
      break;
    case 'taskList':
      if (!editor.isActive('taskList')) chain.toggleTaskList();
      break;
    case 'bulletList':
      if (!editor.isActive('bulletList')) chain.toggleBulletList();
      break;
    case 'orderedList':
      if (!editor.isActive('orderedList')) chain.toggleOrderedList();
      break;
    case 'quote':
      if (!editor.isActive('blockquote')) chain.setBlockquote();
      break;
    case 'codeBlock':
      chain.setCodeBlock();
      break;
    case 'divider':
      chain.setHorizontalRule();
      break;
    case 'today':
    case 'now':
      chain.insertContent(dateText(command.id, useI18n.getState().lang));
      break;
    case 'link':
      break;
  }
  chain.run();
  if (command.id === 'link') openLink();
}

/**
 * Markdown editor (TipTap/ProseMirror): shows the Markdown formatted, with
 * Markdown shortcuts as you type, a `/` quick-insert menu and a selection
 * toolbar, and reports edits as Markdown. Lazy-loaded; import it through
 * `RichTextEditor` from ./index.tsx.
 */
const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { value, onChange, changeDelay = 1000, placeholder = '', autoFocus = false, editable = true, toolbar = 'bubble', size = 'compact', className = '', ariaLabel, onBlur },
  ref,
) {
  const lang = useI18n((state) => state.lang);
  const [link, setLink] = useState<LinkTarget | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // The document the editor was loaded from: unchanged blocks are written as they were.
  const baseRef = useRef<MarkdownDocument>(null as unknown as MarkdownDocument);
  if (!baseRef.current) baseRef.current = parseMarkdown(staticSchema, value);
  /** The Markdown the editor content stands for (loaded or last reported). */
  const syncedRef = useRef(value);
  /** Edits not yet reported through onChange. */
  const dirtyRef = useRef(false);
  /** A new `value` that arrived while the user was typing. */
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onChange, onBlur, placeholder });
  callbacks.current = { onChange, onBlur, placeholder };

  const markdown = () => {
    const editor = editorRef.current;
    return editor ? serializeMarkdown(editor.state.doc, baseRef.current) : syncedRef.current;
  };

  const flush = () => {
    window.clearTimeout(timerRef.current);
    const editor = editorRef.current;
    if (!dirtyRef.current || !editor) return;
    dirtyRef.current = false;
    const next = serializeMarkdown(editor.state.doc, baseRef.current);
    if (next === syncedRef.current) return;
    syncedRef.current = next;
    callbacks.current.onChange?.(next);
  };

  const load = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    window.clearTimeout(timerRef.current);
    const base = parseMarkdown(editor.schema, text);
    baseRef.current = base;
    syncedRef.current = text;
    dirtyRef.current = false;
    pendingRef.current = null;
    // A fresh state: the undo history must not step back into the old text.
    editor.view.updateState(EditorState.create({ doc: base.doc, plugins: editor.state.plugins }));
    // Let the toolbars and menus (which listen to transactions) see the new state.
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  };

  const openLink = () => {
    const editor = editorRef.current;
    if (!editor?.isEditable) return;
    let { from, to } = editor.state.selection;
    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run();
      ({ from, to } = editor.state.selection);
    }
    setLink({ from, to, href: String(editor.getAttributes('link').href ?? '') });
  };
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;

  const extensions = useMemo(
    () => [
      ...schemaExtensions(),
      Placeholder.configure({
        showOnlyCurrent: false,
        placeholder: ({ editor }) => (editor.isEmpty ? callbacks.current.placeholder : ''),
      }),
      SlashMenu.configure({
        onSelect: (command, range) => {
          if (editorRef.current) runSlashCommand(editorRef.current, command, range, () => openLinkRef.current());
        },
      }),
      EditorKeys.configure({ onLink: () => openLinkRef.current() }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: baseRef.current.doc.toJSON(),
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    enableCoreExtensions: { clipboardTextSerializer: false },
    editorProps: {
      attributes: {
        class: 'nt-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      // Copy as Markdown; paste plain text as Markdown (Ctrl+Shift+V: literally).
      clipboardTextSerializer: (slice, view) => sliceToMarkdown(view.state.schema, slice),
      clipboardTextParser: (text, $context, plain, view) =>
        $context.parent.type.spec.code
          ? new Slice(Fragment.from(view.state.schema.text(text)), 0, 0)
          : markdownToSlice(view.state.schema, text, plain),
      handleClick: (_view, _pos, event) => {
        // Ctrl/Cmd+click opens a link; a plain click places the caret.
        const anchor = (event.target as HTMLElement | null)?.closest('a');
        if (!anchor || !(event.metaKey || event.ctrlKey)) return false;
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      dirtyRef.current = true;
      window.clearTimeout(timerRef.current);
      const tick = () => {
        // Don't save half-composed (IME) text; try again shortly.
        if (current.view.composing) timerRef.current = window.setTimeout(tick, 300);
        else flush();
      };
      timerRef.current = window.setTimeout(tick, changeDelay);
    },
    onBlur: () => {
      flush();
      if (pendingRef.current !== null && !dirtyRef.current) load(pendingRef.current);
      callbacks.current.onBlur?.(syncedRef.current);
    },
  });
  editorRef.current = editor;

  // Another tab or device saved: show it, unless the user is typing.
  useEffect(() => {
    if (value === syncedRef.current) {
      pendingRef.current = null;
      return;
    }
    if (editor.isFocused) pendingRef.current = value;
    else load(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // Focus once the view is in the page (also takes over from the loading textarea).
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus(autoFocus === 'start' ? 'start' : 'end');
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The placeholder follows the UI language.
  useEffect(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder, lang]);

  // Report pending edits when the panel closes or the page goes away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    focus: (position = 'end') => editor.commands.focus(position),
    getMarkdown: markdown,
    flush,
    setMarkdown: load,
  }));

  return (
    <div className={`nt-editor nt-editor--${size} ${editable ? '' : 'nt-editor--readonly'} ${className}`}>
      {toolbar === 'fixed' && editable && <EditorToolbar editor={editor} onLink={openLink} />}
      <EditorContent editor={editor} className="nt-editor-body" />
      {editable && toolbar !== 'none' && <BubbleToolbar editor={editor} onLink={openLink} hidden={!!link} />}
      {editable && <LinkBubble editor={editor} onEdit={openLink} hidden={!!link} />}
      {editable && <SlashMenuView editor={editor} onPick={(command, range) => runSlashCommand(editor, command, range, openLink)} />}
      {link && <LinkEditor editor={editor} target={link} onClose={() => setLink(null)} />}
    </div>
  );
});

export default RichEditor;
