import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { cjkRule, schemaExtensions } from '../src/components/editor/extensions';
import { markdownToSlice, parseMarkdown, serializeMarkdown, sliceToMarkdown } from '../src/components/editor/markdown';

const schema = getSchema(schemaExtensions());

const parse = (markdown: string) => parseMarkdown(schema, markdown);
/** Write a document from scratch (no source to reuse): what an edited block looks like. */
const write = (doc: PMNode) => serializeMarkdown(doc);
const json = (markdown: string) => parse(markdown).doc.toJSON();
const p = (...content: object[]) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const text = (value: string, ...marks: string[]) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const doc = (...content: object[]) => schema.nodeFromJSON({ type: 'doc', content });

/** Replace top-level block `index` of a parsed document (an edit somewhere else). */
function editBlock(markdown: string, index: number, replacement: object): string {
  const base = parse(markdown);
  const nodes: PMNode[] = [];
  base.doc.forEach((node, _offset, i) => nodes.push(i === index ? schema.nodeFromJSON(replacement) : node));
  return serializeMarkdown(schema.topNodeType.create(null, nodes), base);
}

/** Plain descriptions as the CLI, the API and TickTick write them. */
const PLAIN = [
  'Buy milk\nat the store',
  '#tag1 #tag2 some text',
  'a * b * c',
  'snake_case_name and _x and a_b_c',
  'x < y && y > z, <b>not html</b>',
  'See https://example.com/a_b?x=1&y=2',
  '  leading spaces\n    four spaces\n\ttab',
  '中文描述\n第二行：注意事项',
  'price: ¥5 & 10% off! (really) [maybe]',
  'C:\\Users\\name\\file.txt',
  'a\n\n\nb',
  'trailing newline\n',
  '\n\nleading blank lines',
  'Notes:\n  - indented item\n  - another',
  'email me: someone@example.com',
  '1/2 cup sugar; 3/4 cup flour',
  'temperature ~20°C ~ 25°C',
  'a = b == c',
  'Line with trailing spaces  \nnext',
  '!important ^caret {braces} |pipes|',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  '![screenshot](https://x.com/a.png)',
  'Setext\n===',
  '&amp; &copy; entities',
  '<!-- comment -->',
  '[ref]: https://example.com',
  '    indented four',
  'Footnote[^1]',
  '中文**粗体**中文',
  'emoji-free: ✓ ✗ → ← ©',
];

/** Markdown the editor shows formatted. */
const MARKDOWN = [
  '# Heading\ntext',
  '## H2\n### H3\n#### H4',
  '- item 1\n- item 2',
  '* star item\n* star item 2',
  '+ plus item',
  '1. one\n2. two',
  '1) paren\n2) paren',
  '3. starts at three\n4. four',
  '- [ ] todo\n- [x] done',
  '- [ ] task\n- plain\n- [X] upper',
  '- a\n  - b\n    - c',
  '1. a\n   - nested bullet\n2. b',
  '- loose\n\n- list',
  '> quote\n> more',
  '> quote\n>\n> second paragraph',
  '```js\nconst a = 1;\n```',
  '~~~\ntilde fence\n~~~',
  '```\n```',
  'above\n\n---\n\nbelow',
  'above\n---\nbelow',
  '**bold** and *italic* and ~~strike~~ and `code` and ==mark== and <u>under</u>',
  '[link](https://x.com) and <https://y.com> and https://z.com/path',
  '[titled](https://x.com "Title")',
  '**[bold link](https://x.com)**',
  '[`code link`](https://x.com)',
  '***both***',
  '``code with ` backtick``',
  '**注意：**这里有重点',
  '这是**重点**内容',
  '- [ ]\n- [ ] ',
  'Mixed list\n- [ ] a\n- b',
  'text\n\n- list\n\ntext after',
  '> quote\n\nafter quote',
  '- item\n\nparagraph',
  'line one  \nline two',
  'escaped \\*stars\\* and \\# hash',
  '\\- not a list\n\\# not a heading',
];

describe('unchanged documents', () => {
  it.each([...PLAIN, ...MARKDOWN])('writes %j back exactly', (markdown) => {
    const base = parse(markdown);
    expect(serializeMarkdown(base.doc, base)).toBe(markdown);
  });

  it('keeps Windows line endings', () => {
    const base = parse('line1\r\nline2\r\n');
    expect(serializeMarkdown(base.doc, base)).toBe('line1\r\nline2\r\n');
  });

  it('reads the empty description as one empty line', () => {
    const base = parse('');
    expect(base.doc.childCount).toBe(1);
    expect(serializeMarkdown(base.doc, base)).toBe('');
    expect(write(base.doc)).toBe('');
  });
});

describe('writing from scratch', () => {
  it.each(PLAIN)('does not escape plain text: %j', (markdown) => {
    expect(write(parse(markdown).doc)).toBe(markdown.replace(/[ \t]+$/gm, ''));
  });

  it.each([...PLAIN, ...MARKDOWN])('reads %j back the same', (markdown) => {
    const once = parse(markdown).doc;
    const again = parse(write(once)).doc;
    expect(again.toJSON()).toEqual(once.toJSON());
  });
});

describe('line model', () => {
  it('gives every source line its own paragraph', () => {
    expect(json('a\nb\n\nc')).toEqual({ type: 'doc', content: [p(text('a')), p(text('b')), p(), p(text('c'))] });
  });

  it('shows leading whitespace of top-level lines', () => {
    expect(json('  two\n\tthree')).toEqual({ type: 'doc', content: [p(text('  two')), p(text('\tthree'))] });
  });

  it('ends a list or quote at a line that does not continue it (no lazy continuation)', () => {
    const types = (markdown: string) => (json(markdown).content as { type: string }[]).map((node) => node.type);
    expect(types('- milk\n- eggs\nRemember the coupon')).toEqual(['bulletList', 'paragraph']);
    expect(types('> quoted\nmy reply')).toEqual(['blockquote', 'paragraph']);
    expect(types('- item\n  continued')).toEqual(['bulletList']);
    expect(types('- a\n\nb')).toEqual(['bulletList', 'paragraph', 'paragraph']);
    expect(write(parse('- milk\nRemember').doc)).toBe('- milk\nRemember');
    expect(write(parse('> a\n\n> b').doc)).toBe('> a\n\n> b');
  });

  it('keeps the indentation of an edited top-level list', () => {
    const out = editBlock('Notes:\n  - a\n  - b', 1, { type: 'bulletList', attrs: { indent: 2 }, content: [{ type: 'listItem', content: [p(text('a2'))] }, { type: 'listItem', content: [p(text('b'))] }] });
    expect(out).toBe('Notes:\n  - a2\n  - b');
  });

  it('writes __bold__ the usual way once that line is edited', () => {
    expect(write(parse('__init__ and _x_').doc)).toBe('**init** and *x*');
  });

  it('writes new lines with a single line break', () => {
    expect(write(doc(p(text('first')), p(text('second')), p(), p(text('third'))))).toBe('first\nsecond\n\nthird');
  });
});

describe('edits elsewhere leave the rest of the text alone', () => {
  const source = [
    '#tag Plain *line* with 2*3*4 and snake_case',
    '  indented: x < y',
    '',
    '* star bullet',
    '* [link](https://x.com/a_b)',
    '',
    '1) first',
    '1) lazy numbering',
    '',
    'Last line https://example.com/?q=a_b',
  ].join('\n');

  it('rewrites only the edited line', () => {
    const out = editBlock(source, 0, p(text('Edited first line')));
    expect(out).toBe(source.replace(/^.*$/m, 'Edited first line'));
  });

  it('keeps lists it did not touch byte for byte', () => {
    const base = parse(source);
    const last = base.doc.childCount - 1;
    const out = editBlock(source, last, p(text('New last line')));
    expect(out).toBe(`${source.split('\n').slice(0, -1).join('\n')}\nNew last line`);
  });

  it('keeps the syntax of an edited list', () => {
    const base = parse(source);
    let index = -1;
    base.doc.forEach((node, _o, i) => {
      if (node.type.name === 'bulletList') index = i;
    });
    const list = base.doc.child(index).toJSON();
    list.content[0].content[0].content[0].text = 'star bullet, edited';
    const out = editBlock(source, index, list);
    expect(out).toBe(source.replace('* star bullet', '* star bullet, edited'));
  });

  it('does not save an unchanged document as different text', () => {
    const base = parse(source);
    const copy = schema.nodeFromJSON(base.doc.toJSON());
    expect(serializeMarkdown(copy, base)).toBe(source);
  });
});

describe('formatting', () => {
  it('reads inline marks', () => {
    expect(json('**b** *i* ~~s~~ `c` ==h== <u>u</u>')).toEqual({
      type: 'doc',
      content: [p(text('b', 'bold'), text(' '), text('i', 'italic'), text(' '), text('s', 'strike'), text(' '), text('c', 'code'), text(' '), text('h', 'highlight'), text(' '), text('u', 'underline'))],
    });
  });

  it('reads bold that ends in full-width punctuation (CJK)', () => {
    expect(json('**注意：**这里')).toEqual({ type: 'doc', content: [p(text('注意：', 'bold'), text('这里'))] });
    expect(write(doc(p(text('注意：', 'bold'), text('这里'))))).toBe('**注意：**这里');
  });

  it('reads task lists, also mixed with plain items', () => {
    const content = json('- [ ] a\n- b\n- [x] c').content as { type: string; content: { attrs?: { checked: boolean } }[] }[];
    expect(content.map((node) => node.type)).toEqual(['taskList', 'bulletList', 'taskList']);
    expect(content[2].content[0].attrs?.checked).toBe(true);
    expect(write(parse('- [ ] a\n- b\n- [x] c').doc)).toBe('- [ ] a\n- b\n- [x] c');
  });

  it('escapes Markdown typed as literal text', () => {
    expect(write(doc(p(text('2*3*4 = 24'))))).toBe('2\\*3\\*4 = 24');
    expect(write(doc(p(text('# not a heading'))))).toBe('\\# not a heading');
    expect(write(doc(p(text('- not a list'))))).toBe('\\- not a list');
    expect(write(doc(p(text('1. not a list'))))).toBe('1\\. not a list');
    expect(write(doc(p(text('[x](y) not a link'))))).toBe('\\[x\\](y) not a link');
    expect(write(doc(p(text('**not bold**'))))).toBe('\\*\\*not bold\\*\\*');
  });

  it('keeps spaces next to marks outside the delimiters', () => {
    expect(write(doc(p(text('a '), text('bold ', 'bold'), text('b'))))).toBe('a **bold** b');
  });

  it('writes a link to its own URL as the bare URL', () => {
    const link = { type: 'text', text: 'https://x.com', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] };
    expect(write(doc(p(text('see '), link)))).toBe('see https://x.com');
  });

  it('separates two lists that Markdown would merge', () => {
    const item = (value: string) => ({ type: 'listItem', content: [p(text(value))] });
    const out = write(doc({ type: 'bulletList', content: [item('a')] }, p(), { type: 'bulletList', content: [item('b')] }));
    expect(out).toBe('- a\n\n* b');
    expect((parse(out).doc.toJSON().content as { type: string }[]).map((node) => node.type)).toEqual(['bulletList', 'paragraph', 'bulletList']);
  });
});

describe('input rules after Chinese text', () => {
  it('format `**…**` typed right after a CJK character, but not after a letter or digit', () => {
    expect(cjkRule('**').exec('这是**重点**')?.[2]).toBe('重点');
    expect(cjkRule('*').exec('中*斜体*')?.[2]).toBe('斜体');
    expect(cjkRule('~~').exec('中~~删除~~')?.[2]).toBe('删除');
    expect(cjkRule('==').exec('中==高亮==')?.[2]).toBe('高亮');
    expect(cjkRule('**').exec('ab**c**')).toBeNull();
    expect(cjkRule('*').exec('2*3*')).toBeNull();
  });
});

describe('clipboard', () => {
  it('copies Markdown and pastes it back', () => {
    const source = parse('**bold** line\n- item');
    const slice = source.doc.slice(0, source.doc.content.size);
    expect(sliceToMarkdown(schema, slice)).toBe('**bold** line\n- item');
    expect(markdownToSlice(schema, '# Title\ntext', false).content.firstChild?.type.name).toBe('heading');
    expect(markdownToSlice(schema, '# Title', true).content.firstChild?.textContent).toBe('# Title');
  });
});

describe('random edits', () => {
  const BLOCKS = ['a', 'b c', '# h', '- x\n- y', '* s', '1. o\n2. t', '1) p', '3. three', '- [ ] t\n- [x] u', '- [ ] m\n- n', '> q\n> r', '```\ncode\n```', '---', '**b** *i*', '[l](https://x.com)', 'https://y.com', '  ind', '\tTab', '中文：**粗**体', '2*3*4', 'x_y', '- a\n  - b', '- l\n\n- m', '> a\n\nb', 'a\n2. b', 'a\n    b', '- a\n\n  b', '+ plus', '- [ ]', '#', '>', '-', '1.', '***', '<u>u</u>', '==h==', '`c`', 'e\\*s'];
  /** Literal text a user may type that looks like Markdown. */
  const TYPED = ['2*3*4', '*a', 'b*', '# x', '- y', '1. z', '2) w', '> q', '[a](b)', '`tick', 'x_y_z', '~~s~~', '==h==', '<u>', 'C:\\t\\', 'https://x.com/a_b', '注意：**粗**', '', '   ', '---', '+ plus', '[ ] box', '[x] done', '***', '\\', '`', '**', '<https://a.b>', '| a |', 'end\\'];
  const MARKS = [{ type: 'bold' }, { type: 'italic' }, { type: 'code' }, { type: 'highlight' }, { type: 'strike' }, { type: 'underline' }, { type: 'link', attrs: { href: 'https://e.com/x_y' } }];
  type Json = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: object[]; content?: Json[] };

  function random(seed: number) {
    let state = seed;
    return (n: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % n;
    };
  }

  /** List markers and tightness may change on purpose (two lists kept apart get another marker). */
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['bullet', 'delimiter', 'tight'].includes(key)).map(([key, v]) => [key, strip(v)]));
  };

  const trimText = (content: Json[] | undefined, leading: boolean) => {
    const out = (content ?? []).map((child) => ({ ...child }));
    while (leading && out.length && out[0].type === 'text') {
      out[0].text = out[0].text!.replace(/^[ \t]+/, '');
      if (out[0].text) break;
      out.shift();
    }
    while (out.length && out[out.length - 1].type === 'text') {
      const last = out[out.length - 1];
      last.text = last.text!.replace(/[ \t]+$/, '');
      if (last.text) break;
      out.pop();
    }
    return out.length ? out : undefined;
  };

  /**
   * What Markdown can express: spaces at line ends (and at the start of
   * nested lines, or of a line right after a list) and empty first lines of
   * list items are gone.
   */
  const expressible = (nodes: Json[] | undefined, top: boolean): Json[] | undefined => {
    let afterList = false;
    return nodes?.map((node) => {
      let result = node;
      if (node.type === 'paragraph') {
        const content = trimText(node.content, !top || afterList);
        result = content ? { type: 'paragraph', content } : { type: 'paragraph' };
      } else if (node.type === 'heading') {
        const content = trimText(node.content, true);
        result = content ? { ...node, content } : { type: 'heading', attrs: node.attrs };
      } else if (node.content && node.type !== 'codeBlock') {
        let content = expressible(node.content, false)!;
        if (node.type === 'listItem' || node.type === 'taskItem') while (content.length > 1 && content[0].type === 'paragraph' && !content[0].content) content = content.slice(1);
        result = { ...node, content };
      }
      if (['bulletList', 'taskList', 'orderedList'].includes(node.type)) afterList = true;
      else if (!(node.type === 'paragraph' && !result.content)) afterList = false;
      return result;
    });
  };

  /**
   * Format part of the first text in the block. The part starts and ends with
   * a letter or digit: CommonMark has no way to open emphasis before
   * punctuation inside a word (`x**_**y` stays literal).
   */
  function addMark(json: Json, mark: object, next: (n: number) => number): boolean {
    if ((json.type === 'paragraph' || json.type === 'heading') && json.content) {
      const i = json.content.findIndex((child) => child.type === 'text' && child.text);
      if (i < 0) return false;
      const node = json.content[i];
      const word = /[\p{L}\p{N}]/u;
      const chars = Array.from(node.text!, (_, k) => k).filter((k) => word.test(node.text![k]));
      if (!chars.length) return false;
      const a = chars[next(chars.length)];
      const ends = chars.filter((k) => k >= a);
      const b = ends[next(ends.length)] + 1;
      const marks = [...(node.marks ?? []).filter((m) => (m as Json).type !== (mark as Json).type), mark];
      json.content.splice(i, 1, ...[
        a > 0 ? { ...node, text: node.text!.slice(0, a) } : null,
        { ...node, text: node.text!.slice(a, b), marks },
        b < node.text!.length ? { ...node, text: node.text!.slice(b) } : null,
      ].filter((part): part is Json => part !== null));
      return true;
    }
    return json.type !== 'codeBlock' && (json.content ?? []).some((child) => addMark(child, mark, next));
  }

  it('reads back as the edited document and keeps untouched blocks verbatim', () => {
    const next = random(42);
    let checked = 0;
    for (let round = 0; round < 1500; round++) {
      const source = Array.from({ length: 1 + next(6) }, () => BLOCKS[next(BLOCKS.length)]).join(['\n', '\n\n', '\n\n\n'][next(3)]);
      const base = parse(source);
      const nodes: PMNode[] = [];
      base.doc.forEach((node) => nodes.push(node));
      const at = next(nodes.length);
      const typed = TYPED[next(TYPED.length)];
      const action = next(6);
      if (action === 0) nodes[at] = schema.nodeFromJSON(typed ? p(text(typed)) : p());
      else if (action === 1) nodes.splice(at, 0, schema.nodeFromJSON(typed ? p(text(typed)) : p()));
      else if (action === 2 && nodes.length > 1) nodes.splice(at, 1);
      else if (action === 3 || action === 5) {
        // Edit the first line inside the block, tick a checkbox, or format part of it.
        const json = nodes[at].toJSON() as Json;
        const edit = (node: Json): boolean => {
          if (node.type === 'paragraph' || node.type === 'heading') {
            node.content = typed ? [text(typed) as Json] : undefined;
            return true;
          }
          if (node.type === 'taskItem') {
            node.attrs = { ...node.attrs, checked: !node.attrs?.checked };
            return true;
          }
          return (node.content ?? []).some(edit);
        };
        if (!(action === 3 ? edit(json) : addMark(json, MARKS[next(MARKS.length)], next))) continue;
        nodes[at] = schema.nodeFromJSON(json);
      } else if (action === 4) {
        const other = next(nodes.length);
        [nodes[at], nodes[other]] = [nodes[other], nodes[at]];
      }
      const edited = schema.topNodeType.create(null, nodes);
      const out = serializeMarkdown(edited, base);
      const context = JSON.stringify({ source, action, at, typed, out });
      expect(strip(expressible(parse(out).doc.toJSON().content, true)), context).toEqual(strip(expressible(edited.toJSON().content, true)));
      // Lines that are valid on their own and were not touched keep their text.
      for (const segment of base.segments) {
        const node = segment.nodes[0];
        if (segment.nodes.length !== 1 || !nodes.includes(node) || isList(node)) continue;
        const raw = base.lines.slice(segment.start, segment.end).join('\n');
        const alone = parse(raw).doc;
        if (!raw.trim() || /^[ \t]/.test(raw) || alone.childCount !== 1 || !alone.firstChild!.eq(node)) continue;
        expect(out.includes(raw), `${context}\nlost ${JSON.stringify(raw)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

const isList = (node: PMNode) => ['bulletList', 'taskList', 'orderedList'].includes(node.type.name);
