import { Extension, markInputRule, type AnyExtension } from '@tiptap/core';
import { Code } from '@tiptap/extension-code';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { StarterKit } from '@tiptap/starter-kit';
import { tfOf } from '../../i18n';

/**
 * Links are created from URLs with an explicit scheme only, the same rule
 * the Markdown parser applies (markdown.ts), so a typed link survives a save.
 */
export const AUTOLINK_RE = /^(?:https?|ftp):\/\/\S/i;

/**
 * Markdown details kept on the nodes so a list or code block that is written
 * again keeps its syntax: `*` bullets, `1)` numbering, loose lists, `~~~`.
 */
const MarkdownAttributes = Extension.create({
  name: 'markdownAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'taskList'],
        attributes: {
          bullet: {
            default: '-',
            parseHTML: (element) => element.getAttribute('data-bullet') ?? '-',
            renderHTML: (attributes) => (attributes.bullet && attributes.bullet !== '-' ? { 'data-bullet': attributes.bullet } : {}),
          },
        },
      },
      {
        types: ['orderedList'],
        attributes: {
          delimiter: {
            default: '.',
            parseHTML: (element) => (element.getAttribute('data-delimiter') === ')' ? ')' : '.'),
            renderHTML: (attributes) => (attributes.delimiter === ')' ? { 'data-delimiter': ')' } : {}),
          },
        },
      },
      {
        types: ['bulletList', 'taskList', 'orderedList'],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element) => element.getAttribute('data-tight') !== 'false',
            renderHTML: (attributes) => (attributes.tight === false ? { 'data-tight': 'false' } : {}),
          },
          // Spaces before the markers of a top-level list ("Notes:\n  - a").
          indent: {
            default: 0,
            parseHTML: (element) => Math.min(3, Number(element.getAttribute('data-indent')) || 0),
            renderHTML: (attributes) => (attributes.indent ? { 'data-indent': attributes.indent } : {}),
          },
        },
      },
      {
        types: ['codeBlock'],
        attributes: {
          fence: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-fence'),
            renderHTML: (attributes) => (attributes.fence ? { 'data-fence': attributes.fence } : {}),
          },
        },
      },
    ];
  },
});

/**
 * TipTap's mark input rules want a space before `**`; Chinese has none, so
 * `这是**重点**` would stay literal asterisks. These rules also fire after a
 * CJK character (the lookbehind keeps that character in place).
 */
const CJK_BEFORE = '(?<=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303f\\uff00-\\uffef])';
/** Same shape as TipTap's rules (`**text**` at the end of the typed text). Exported for tests. */
export const cjkRule = (delimiter: string) => {
  // With the `u` flag only syntax characters may be escaped (`\~` is an error).
  const d = delimiter.replace(/[*]/g, '\\$&');
  const c = delimiter[0].replace(/[*]/g, '\\$&');
  return new RegExp(`${CJK_BEFORE}(${d}(?!\\s+${d})((?:[^${c}]+))${d}(?!\\s+${d}))$`, 'u');
};

const CjkMarkInputRules = Extension.create({
  name: 'cjkMarkInputRules',
  addInputRules() {
    const { marks } = this.editor.schema;
    return [
      markInputRule({ find: cjkRule('**'), type: marks.bold }),
      markInputRule({ find: cjkRule('*'), type: marks.italic }),
      markInputRule({ find: cjkRule('~~'), type: marks.strike }),
      markInputRule({ find: cjkRule('=='), type: marks.highlight }),
    ];
  },
});

/**
 * The extensions that define the document schema. The editor adds its own
 * behaviour (placeholder, slash menu, keys) on top; tests build the schema
 * from this list alone, so both read and write Markdown the same way.
 */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      code: false,
      // An extra empty paragraph at the end would add a line to the text.
      trailingNode: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      dropcursor: { color: 'var(--color-tt)', width: 2 },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        markdownLinks: true,
        defaultProtocol: 'https',
        shouldAutoLink: (url) => AUTOLINK_RE.test(url),
      },
    }),
    // Marks around inline code (`[`code`](url)`, `**`x`**`) are valid Markdown;
    // the stock code mark drops them.
    Code.extend({ excludes: 'code' }),
    Highlight,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => tfOf('editorTaskCheckbox', node.textContent.trim() || '…') },
    }),
    MarkdownAttributes,
    CjkMarkInputRules,
  ];
}
