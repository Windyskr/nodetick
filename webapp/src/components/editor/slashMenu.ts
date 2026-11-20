import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { tOf } from '../../i18n';
import { SLASH_COMMANDS, closesSlashMenu, filterSlashCommands, moveSelection, opensSlashMenu, type SlashCommand } from './slash';

/** Where the menu is: the trigger character's position and what was typed after it. */
export interface SlashMenuState {
  active: boolean;
  from: number;
  query: string;
  index: number;
}

export const CLOSED_SLASH_MENU: SlashMenuState = { active: false, from: 0, query: '', index: 0 };

export const slashMenuKey = new PluginKey<SlashMenuState>('slashMenu');

type Meta = { open: number } | { close: true } | { index: number };

const TRIGGERS = '/／、';

/** Commands for a query, named in the current UI language. */
export const slashMatches = (query: string) => filterSlashCommands(SLASH_COMMANDS, query, tOf);

export function setSlashIndex(view: EditorView, index: number) {
  view.dispatch(view.state.tr.setMeta(slashMenuKey, { index } satisfies Meta));
}

export function closeSlashMenu(view: EditorView) {
  if (slashMenuKey.getState(view.state)?.active) view.dispatch(view.state.tr.setMeta(slashMenuKey, { close: true } satisfies Meta));
}

/** Text of the line before the caret (inline nodes count as one character). */
function lineBefore(view: EditorView, pos: number): string | null {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  if ($pos.marks().some((mark) => mark.type.spec.code)) return null;
  return $pos.parent.textBetween(0, $pos.parentOffset, undefined, '￼');
}

export interface SlashMenuOptions {
  /** Run the picked command over `range` (the trigger and the query). */
  onSelect: (command: SlashCommand, range: { from: number; to: number }) => void;
}

/**
 * The `/` menu's state and keys. Typing `/` opens it at the caret; letters
 * after it filter; arrows move; Enter or Tab runs a command; Escape closes it
 * and keeps the text. Nothing happens while an IME composes (Chinese input):
 * ProseMirror holds back keys then, and composed text never opens the menu,
 * unless the IME commits a single `/` or `、` on its own.
 */
export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: 'slashMenu',
  // Before the keymaps, so Enter picks a command instead of splitting the line.
  priority: 1000,

  addOptions() {
    return { onSelect: () => undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let composing = false;
    const open = (view: EditorView, from: number) => view.dispatch(view.state.tr.setMeta(slashMenuKey, { open: from } satisfies Meta));
    return [
      new Plugin<SlashMenuState>({
        key: slashMenuKey,
        state: {
          init: () => CLOSED_SLASH_MENU,
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(slashMenuKey) as Meta | undefined;
            if (meta && 'open' in meta) return { active: true, from: meta.open, query: '', index: 0 };
            if (meta && 'close' in meta) return CLOSED_SLASH_MENU;
            if (!prev.active) return prev;
            const mapped = tr.mapping.mapResult(prev.from);
            const from = mapped.pos;
            const { selection } = state;
            const $head = selection.$head;
            // Gone when the slash is deleted, the caret leaves its line or moves before it.
            if (mapped.deleted || !selection.empty || $head.pos <= from || from < $head.start()) return CLOSED_SLASH_MENU;
            const trigger = state.doc.textBetween(from, from + 1);
            if (!trigger || !TRIGGERS.includes(trigger)) return CLOSED_SLASH_MENU;
            const query = state.doc.textBetween(from + 1, $head.pos, '\n', '￼');
            const count = slashMatches(query).length;
            if (closesSlashMenu(query, count)) return CLOSED_SLASH_MENU;
            const index = meta && 'index' in meta ? meta.index : query === prev.query ? Math.min(prev.index, Math.max(0, count - 1)) : 0;
            return { active: true, from, query, index };
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (view.composing || composing) return false;
            const before = lineBefore(view, from);
            if (before === null || !opensSlashMenu(before, text)) return false;
            view.dispatch(view.state.tr.insertText(text, from, to).setMeta(slashMenuKey, { open: from } satisfies Meta));
            return true;
          },
          handleKeyDown(view, event) {
            const menu = slashMenuKey.getState(view.state);
            if (!menu?.active || event.isComposing || event.keyCode === 229) return false;
            const matches = slashMatches(menu.query);
            switch (event.key) {
              case 'ArrowDown':
              case 'ArrowUp':
                if (!matches.length) return false;
                setSlashIndex(view, moveSelection(menu.index, event.key === 'ArrowDown' ? 1 : -1, matches.length));
                return true;
              case 'Enter':
              case 'Tab': {
                const command = matches[menu.index];
                closeSlashMenu(view);
                // Nothing matched: Enter and Tab do what they always do.
                if (!command || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
                options.onSelect(command, { from: menu.from, to: view.state.selection.from });
                return true;
              }
              case 'Escape':
                closeSlashMenu(view);
                return true;
              default:
                return false;
            }
          },
          handleDOMEvents: {
            compositionstart: () => {
              composing = true;
              return false;
            },
            compositionend: (view, event) => {
              const data = event.data;
              // ProseMirror reads the composed text right after this event.
              setTimeout(() => {
                composing = false;
                if (view.isDestroyed || data.length !== 1 || !TRIGGERS.includes(data)) return;
                const { selection } = view.state;
                if (!selection.empty || slashMenuKey.getState(view.state)?.active) return;
                const before = lineBefore(view, selection.from);
                if (before?.endsWith(data) && opensSlashMenu(before.slice(0, -data.length), data)) open(view, selection.from - data.length);
              }, 0);
              return false;
            },
            blur: (view) => {
              closeSlashMenu(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
