import { Component, Suspense, forwardRef, lazy, useEffect, useImperativeHandle, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { RichEditorHandle, RichEditorProps } from './types';

export type { RichEditorHandle, RichEditorProps } from './types';

/**
 * The editor (TipTap, ProseMirror, the Markdown parser) is its own chunk, so
 * the app's first load does not grow. It is fetched when the app is idle and
 * a plain textarea stands in until it arrives (or if it can't be loaded).
 */
const loadEditor = () => import('./RichEditor');

let preloading: Promise<unknown> | null = null;

/**
 * Start downloading the editor now (it is also fetched once the app is
 * idle). Importing the Markdown layer on its own as well makes it (and
 * markdown-it) a chunk of its own, fetched in parallel with the TipTap one.
 */
export function preloadRichEditor(): void {
  preloading ??= Promise.all([import('./markdown'), loadEditor()]).catch(() => {
    preloading = null;
  });
}

if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 2000));
  idle(() => preloadRichEditor());
}

interface FallbackProps extends RichEditorProps {
  focusedRef?: MutableRefObject<boolean>;
}

/** Textarea with the editor's props: shows and edits the Markdown as text. */
const PlainTextEditor = forwardRef<RichEditorHandle, FallbackProps>(function PlainTextEditor(
  { value, onChange, placeholder, editable = true, size = 'compact', className = '', ariaLabel, autoFocus, onBlur, focusedRef },
  ref,
) {
  const [text, setText] = useState(value);
  const element = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ text: value, dirty: false, onChange, onBlur });
  latest.current = { ...latest.current, onChange, onBlur };

  const flush = () => {
    if (!latest.current.dirty) return;
    latest.current.dirty = false;
    latest.current.onChange?.(latest.current.text);
  };

  useEffect(() => {
    if (latest.current.dirty || document.activeElement === element.current) return;
    latest.current.text = value;
    setText(value);
  }, [value]);

  // Replaced by the editor (or closed) mid-edit: hand the text over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  useImperativeHandle(ref, () => ({
    focus: () => element.current?.focus(),
    getMarkdown: () => latest.current.text,
    flush,
    setMarkdown: (markdown: string) => {
      latest.current = { ...latest.current, text: markdown, dirty: false };
      setText(markdown);
    },
  }));

  return (
    <textarea
      ref={element}
      value={text}
      rows={4}
      readOnly={!editable}
      autoFocus={!!autoFocus}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => {
        latest.current = { ...latest.current, text: event.target.value, dirty: true };
        setText(event.target.value);
      }}
      onFocus={() => {
        if (focusedRef) focusedRef.current = true;
      }}
      onBlur={() => {
        if (focusedRef) focusedRef.current = false;
        flush();
        latest.current.onBlur?.(latest.current.text);
      }}
      // Plain Tailwind classes: editor.css only arrives with the editor's chunk.
      className={`block w-full resize-none bg-transparent outline-none placeholder:text-ink-3 ${
        size === 'document' ? 'text-[16px] leading-[1.7] text-ink' : 'text-[13.5px] leading-[1.65] text-ink-2'
      } ${className}`}
    />
  );
});

const LazyRichEditor = lazy(() => loadEditor().catch(() => ({ default: PlainTextEditor as typeof PlainTextEditor })) as Promise<{ default: typeof PlainTextEditor }>);

/** Rendered once the chunk is there: takes over the focus the textarea had. */
const LoadedEditor = forwardRef<RichEditorHandle, FallbackProps>(function LoadedEditor({ focusedRef, ...props }, ref) {
  const autoFocus = props.autoFocus || (focusedRef?.current ? 'end' : false);
  return <LazyRichEditor ref={ref} {...props} autoFocus={autoFocus} />;
});

/** If the editor ever fails to start, the description stays editable as text instead of taking the page down. */
class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Rich-text editor failed, using a plain textarea:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Markdown editor for descriptions (and, next, the Summary page). See
 * ./types.ts for the props; the value in and out is Markdown text.
 */
export const RichTextEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichTextEditor(props, ref) {
  const focusedRef = useRef(false);
  const fallback = <PlainTextEditor ref={ref} {...props} focusedRef={focusedRef} />;
  return (
    <EditorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedEditor ref={ref} {...props} focusedRef={focusedRef} />
      </Suspense>
    </EditorBoundary>
  );
});
