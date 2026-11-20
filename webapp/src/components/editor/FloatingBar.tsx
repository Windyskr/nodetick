import { useEffect, useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';

/**
 * A small bar above (or below) the selection, rendered into <body> so the
 * detail panel's scrolling and the modal's clipping don't cut it off.
 * Shown when `show` says so, hidden while the mouse is still selecting.
 */
export function FloatingBar({
  editor,
  show,
  placement = 'top',
  className = '',
  children,
}: {
  editor: Editor;
  show: (editor: Editor) => boolean;
  placement?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
}) {
  const [, update] = useReducer((n: number) => n + 1, 0);
  const barRef = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);

  useEffect(() => {
    const dom = editor.view.dom;
    const down = () => {
      selecting.current = true;
    };
    const up = () => {
      if (!selecting.current) return;
      selecting.current = false;
      update();
    };
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    dom.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
      dom.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  const visible = !editor.isDestroyed && !selecting.current && show(editor);

  // Place it after rendering, once its size is known.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!visible || !bar) return;
    const { from, to } = editor.state.selection;
    let start: { left: number; top: number; bottom: number };
    let end: { left: number; top: number; bottom: number };
    try {
      start = editor.view.coordsAtPos(from);
      end = editor.view.coordsAtPos(to);
    } catch {
      return;
    }
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    const center = Math.abs(start.top - end.top) < 4 ? (start.left + end.left) / 2 : start.left + width / 2;
    const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
    let top = placement === 'top' ? start.top - height - 8 : end.bottom + 6;
    if (placement === 'top' && top < 8) top = end.bottom + 8;
    if (placement === 'bottom' && top + height > window.innerHeight - 8) top = start.top - height - 6;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = 'visible';
  });

  if (!visible) return null;
  return createPortal(
    <div
      ref={barRef}
      className={`fixed z-[60] ${className}`}
      style={{ left: 0, top: 0, visibility: 'hidden' }}
      // Buttons must not take the focus (and the selection) out of the editor.
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
