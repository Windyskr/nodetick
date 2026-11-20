/**
 * Public API of the rich-text editor (`RichTextEditor` in ./index.tsx).
 * The value is Markdown; the editor shows it formatted and writes Markdown back.
 */
export interface RichEditorProps {
  /**
   * The Markdown to show. The editor loads it on mount and again whenever it
   * changes while the editor is not focused (another tab or device saved);
   * while the user is typing, their text wins.
   */
  value: string;
  /**
   * New Markdown after edits: at most every `changeDelay` ms while typing,
   * and right away on blur, unmount and page hide. Not called when the text
   * is unchanged, so an untouched document is never saved again.
   */
  onChange?: (markdown: string) => void;
  /** Debounce for `onChange` while typing (ms). Default 1000. */
  changeDelay?: number;
  /** Shown while the document is empty. */
  placeholder?: string;
  /** Focus on mount; `'end'` puts the caret after the last character. */
  autoFocus?: boolean | 'start' | 'end';
  /** False renders the Markdown read-only (links open on click). Default true. */
  editable?: boolean;
  /**
   * `bubble` (default): a small toolbar over selected text.
   * `fixed`: a toolbar above the text, plus the bubble.
   * `none`: Markdown shortcuts, keys and the `/` menu only.
   */
  toolbar?: 'bubble' | 'fixed' | 'none';
  /** Type scale: `compact` for the task detail (13.5px), `document` for full pages (16px). */
  size?: 'compact' | 'document';
  /** Classes for the outer element (sizing, min-height, margins). */
  className?: string;
  /** Accessible name of the text area. */
  ariaLabel?: string;
  /** Called on blur with the latest Markdown (after `onChange`, if anything changed). */
  onBlur?: (markdown: string) => void;
}

/** Imperative handle (`ref`) for callers that need more than props. */
export interface RichEditorHandle {
  focus: (position?: 'start' | 'end') => void;
  /** The current Markdown, including edits `onChange` has not reported yet. */
  getMarkdown: () => string;
  /** Report pending edits through `onChange` now. */
  flush: () => void;
  /** Replace the content (resets undo history), e.g. when a template is applied. */
  setMarkdown: (markdown: string) => void;
}
