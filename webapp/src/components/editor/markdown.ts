/**
 * Markdown <-> editor document for task descriptions.
 *
 * Descriptions come from the CLI, the API and TickTick as plain text that is
 * also Markdown, so the stored text stays the source of truth:
 *
 * - Every source line is its own block. A paragraph line becomes one editor
 *   paragraph (Enter starts a new line, as in the old textarea) and blank
 *   lines become empty paragraphs. Lists, quotes, headings and code blocks
 *   keep their Markdown meaning.
 * - Writing reuses the source text of every block that did not change, so
 *   editing one line never escapes, renumbers or reflows another, and an
 *   unchanged document gives back the exact text it was read from.
 * - Changed blocks are written with as little escaping as possible: the
 *   result is parsed again and only lines that would read back differently
 *   are escaped.
 *
 * The parser is markdown-it (CommonMark) with GFM strikethrough, task lists
 * and bare-URL links, plus `==highlight==` and `<u>underline</u>`. Syntax the
 * editor cannot show (tables, images, HTML, reference links, setext headings,
 * indented code) is left as text, so it survives untouched. Two deliberate
 * departures from CommonMark, both for plain-text descriptions and Chinese:
 * a line after a list item or quote that doesn't continue it starts a new
 * block (no lazy continuation), and `**bold**` may end next to full-width
 * punctuation (`**注意：**这里`).
 */
import markdownit from 'markdown-it';
import type { MarkdownIt, StateBlock, StateInline, Token } from 'markdown-it';
import { Fragment, Mark, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const PUNCT_RE = /[\p{P}\p{S}]/u;
/** Full-width CJK punctuation, which CommonMark otherwise treats like ASCII punctuation. */
const CJK_PUNCT_RE = /[\u3000-\u303f\ufe30-\ufe4f\uff00-\uffef]/u;

function isWhiteSpaceCode(code: number): boolean {
  if (code >= 0x2000 && code <= 0x200a) return true;
  return code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d || code === 0x20 ||
    code === 0xa0 || code === 0x1680 || code === 0x202f || code === 0x205f || code === 0x3000;
}

function codePointBefore(src: string, index: number): number {
  const low = src.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = src.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}

function isPunctCode(code: number, cjkAsLetters: boolean): boolean {
  const ch = String.fromCodePoint(code);
  return PUNCT_RE.test(ch) && !(cjkAsLetters && CJK_PUNCT_RE.test(ch));
}

type StateInlineClass = MarkdownIt['inline']['State'];

/**
 * CommonMark's flanking rules leave `**注意：**这里` as literal asterisks: the
 * closing `**` sits between punctuation and a letter. For `*`, `~~` and `==`,
 * full-width punctuation counts as a letter here (as in the CJK-friendly
 * proposal), so bold text ending in `：` or `。` works. `_` keeps the
 * CommonMark rules, which protect snake_case words.
 */
function cjkFriendlyState(Base: StateInlineClass): StateInlineClass {
  return class CjkFriendlyState extends Base {
    scanDelims(start: number, canSplitWord: boolean) {
      const max = this.posMax;
      const marker = this.src.charCodeAt(start);
      const cjk = marker !== 0x5f;
      let pos = start;
      while (pos < max && this.src.charCodeAt(pos) === marker) pos++;
      const lastChar = start > 0 ? codePointBefore(this.src, start) : 0x20;
      const nextChar = pos < max ? this.src.codePointAt(pos)! : 0x20;
      const lastPunct = isPunctCode(lastChar, cjk);
      const nextPunct = isPunctCode(nextChar, cjk);
      const lastSpace = isWhiteSpaceCode(lastChar);
      const nextSpace = isWhiteSpaceCode(nextChar);
      const leftFlanking = !nextSpace && (!nextPunct || lastSpace || lastPunct);
      const rightFlanking = !lastSpace && (!lastPunct || nextSpace || nextPunct);
      return {
        can_open: leftFlanking && (canSplitWord || !rightFlanking || lastPunct),
        can_close: rightFlanking && (canSplitWord || !leftFlanking || nextPunct),
        length: pos - start,
      };
    }
  };
}

const EQUALS = 0x3d;

/** `==highlight==`, modelled on markdown-it's `~~strikethrough~~`. */
function highlightTokenize(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (silent || state.src.charCodeAt(start) !== EQUALS) return false;
  const scanned = state.scanDelims(start, true);
  let length = scanned.length;
  if (length < 2) return false;
  if (length % 2) {
    state.push('text', '', 0).content = '=';
    length--;
  }
  for (let i = 0; i < length; i += 2) {
    state.push('text', '', 0).content = '==';
    state.delimiters.push({ marker: EQUALS, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
  }
  state.pos += scanned.length;
  return true;
}

function highlightPairs(state: StateInline, delimiters: StateInline['delimiters']) {
  const lone: number[] = [];
  for (const startDelim of delimiters) {
    if (startDelim.marker !== EQUALS || startDelim.end === -1) continue;
    const endDelim = delimiters[startDelim.end];
    const open = state.tokens[startDelim.token];
    open.type = 'mark_open';
    open.tag = 'mark';
    open.nesting = 1;
    open.markup = '==';
    open.content = '';
    const close = state.tokens[endDelim.token];
    close.type = 'mark_close';
    close.tag = 'mark';
    close.nesting = -1;
    close.markup = '==';
    close.content = '';
    const before = state.tokens[endDelim.token - 1];
    if (before.type === 'text' && before.content === '=') lone.push(endDelim.token - 1);
  }
  // A lone `=` left of a closing `==` belongs outside the mark.
  while (lone.length) {
    const i = lone.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function highlightPostProcess(state: StateInline): boolean {
  highlightPairs(state, state.delimiters);
  for (const meta of state.tokens_meta) if (meta?.delimiters) highlightPairs(state, meta.delimiters);
  return false;
}

/** `<u>underline</u>`: the only HTML the parser reads (raw HTML stays text). */
function underlineTokenize(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x3c) return false;
  if (src.startsWith('<u>', pos)) {
    if (src.indexOf('</u>', pos + 3) < 0) return false;
    if (!silent) state.push('u_open', 'u', 1).markup = '<u>';
    state.pos += 3;
    return true;
  }
  if (src.startsWith('</u>', pos)) {
    if (!silent) {
      let open = 0;
      for (const token of state.tokens) open += token.type === 'u_open' ? 1 : token.type === 'u_close' ? -1 : 0;
      if (open <= 0) return false;
      state.push('u_close', 'u', -1).markup = '</u>';
    }
    state.pos += 4;
    return true;
  }
  return false;
}

/** An opening `<u>` whose closing tag ended up elsewhere (inside code, say) is text after all. */
function underlineBalance(state: StateInline): boolean {
  const stack: number[] = [];
  state.tokens.forEach((token, i) => {
    if (token.type === 'u_open') stack.push(i);
    else if (token.type === 'u_close') stack.pop();
  });
  for (const i of stack) {
    const token = state.tokens[i];
    token.type = 'text';
    token.tag = '';
    token.nesting = 0;
    token.content = '<u>';
  }
  return false;
}

/**
 * No lazy continuation: a line right after a list item or quote that isn't
 * indented (or `>`-prefixed) to continue it starts a new block, as it reads
 * in a plain-text description ("- milk\n- eggs\nRemember the coupon").
 * These run as terminator checks (silent) only and never produce tokens.
 */
function endsListParagraph(state: StateBlock, line: number, _endLine: number, silent: boolean): boolean {
  return silent && state.sCount[line] < state.blkIndent;
}

function endsQuote(_state: StateBlock, _line: number, _endLine: number, silent: boolean): boolean {
  // The quote rule asks only about lines without a `>`.
  return silent;
}

let parser: MarkdownIt | null = null;

function getParser(): MarkdownIt {
  if (parser) return parser;
  const md = new markdownit('default', { html: false, linkify: true, typographer: false });
  // Constructs the editor has no block for stay plain text lines; `text_join`
  // is off so backslash escapes stay apart from text (see `taskMarker`).
  md.disable(['table', 'code', 'lheading', 'reference', 'html_block', 'html_inline', 'entity', 'image', 'text_join', 'replacements', 'smartquotes']);
  // Only URLs with a scheme become links ("readme.md" is a domain name too).
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  md.linkify.add('//', null);
  // Keep link targets as written: no percent-encoding or punycode.
  md.normalizeLink = (url: string) => url;
  md.normalizeLinkText = (url: string) => url;
  md.inline.State = cjkFriendlyState(md.inline.State);
  md.inline.ruler.before('emphasis', 'highlight', highlightTokenize);
  md.inline.ruler2.before('emphasis', 'highlight', highlightPostProcess);
  md.inline.ruler.before('autolink', 'underline', underlineTokenize);
  md.inline.ruler2.push('underline_balance', underlineBalance);
  md.block.ruler.before('paragraph', 'no_lazy_list', endsListParagraph, { alt: ['paragraph'] });
  md.block.ruler.before('paragraph', 'no_lazy_quote', endsQuote, { alt: ['blockquote'] });
  parser = md;
  return md;
}

// ---------------------------------------------------------------------------
// Tokens -> nodes
// ---------------------------------------------------------------------------

/** Blocks read from source lines [start, end). */
interface Placed {
  nodes: PMNode[];
  start: number;
  end: number;
}

const TASK_RE = /^\[([ xX])\](?=[ \t]|$)[ \t]*/;

const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'taskList' || node.type.name === 'orderedList';

/** An empty paragraph, or one of spaces only: a blank line in Markdown. */
const isBlankLine = (node: PMNode) =>
  // Text only (a line break has no text but size 1), and nothing but spaces.
  node.type.name === 'paragraph' && node.content.size === node.textContent.length && /^[ \t]*$/.test(node.textContent);

/** The list syntax two consecutive lists share: they merge when it is the same. */
function listKind(node: PMNode, marker?: string): string {
  return node.type.name === 'orderedList' ? `o${marker ?? node.attrs.delimiter ?? '.'}` : `b${marker ?? node.attrs.bullet ?? '-'}`;
}

/**
 * How list `b` relates to list `a` right before it (with `blank` empty lines between):
 * - `merge`: one Markdown list split in two (task and plain items),
 * - `conflict`: they would merge but are separate lists (needs another marker),
 * - `separate`: different list syntax, no interaction.
 */
function listJoin(a: PMNode, aMarker: string | undefined, b: PMNode, bMarker: string | undefined, blank: number): 'merge' | 'conflict' | 'separate' {
  if (listKind(a, aMarker) !== listKind(b, bMarker)) return 'separate';
  const taskA = a.type.name === 'taskList';
  const taskB = b.type.name === 'taskList';
  if (blank === 0 && b.type.name !== 'orderedList' && taskA !== taskB && a.attrs.tight === b.attrs.tight) return 'merge';
  return 'conflict';
}

/** The first item is written as "-" alone, which can't interrupt a paragraph. */
function firstItemEmpty(list: PMNode): boolean {
  const item = list.firstChild;
  if (!item) return true;
  // Leading empty lines of an item are left out when more follows (Writer.list).
  let i = 0;
  while (i < item.childCount - 1 && isBlankLine(item.child(i))) i++;
  return isBlankLine(item.child(i));
}

/**
 * Blank lines between two blocks read from the source that are Markdown
 * syntax, not empty lines: the one between two quotes or before a list that
 * can't interrupt a paragraph, and all of them inside one list split into runs.
 */
function syntaxBlanks(a: PMNode | null, b: PMNode, gap: number): number {
  if (!a) return 0;
  if (isList(a) && isList(b) && listJoin(a, undefined, b, undefined, 0) === 'merge') return gap;
  return needsBlank(a, undefined, b, undefined, 0) ? Math.min(1, gap) : 0;
}

/**
 * Whether Markdown needs a blank line between blocks `a` and `b` to keep them
 * apart: two quotes in a row would be one, some lists can't interrupt a
 * paragraph, and the items of a loose list are a blank line apart.
 */
function needsBlank(a: PMNode, aMarker: string | undefined, b: PMNode, bMarker: string | undefined, blank: number): boolean {
  if (isList(a) && isList(b)) return listJoin(a, aMarker, b, bMarker, blank) === 'merge' ? !a.attrs.tight : false;
  if (a.type.name === 'blockquote') return b.type.name === 'blockquote';
  if (a.type.name === 'paragraph' && !isBlankLine(a)) {
    if (b.type.name === 'orderedList') return (b.attrs.start ?? 1) !== 1 || firstItemEmpty(b);
    if (b.type.name === 'bulletList') return firstItemEmpty(b);
  }
  return false;
}

class Reader {
  private pos = 0;

  constructor(
    private schema: Schema,
    private tokens: Token[],
    private lines: string[],
  ) {}

  /** Blocks up to the closing token of the current container (or the end). */
  blocks(top: boolean): Placed[] {
    const out: Placed[] = [];
    while (this.pos < this.tokens.length && this.tokens[this.pos].nesting !== -1) {
      const placed = this.block(top);
      if (placed) out.push(...placed);
    }
    return out;
  }

  private block(top: boolean): Placed[] | null {
    const token = this.tokens[this.pos];
    switch (token.type) {
      case 'paragraph_open':
        return this.paragraph(top);
      case 'heading_open':
        return [this.heading()];
      case 'bullet_list_open':
      case 'ordered_list_open':
        return this.list(top);
      case 'blockquote_open':
        return [this.blockquote()];
      case 'fence':
        return [this.fence()];
      case 'hr': {
        this.pos++;
        const [start, end] = token.map!;
        return [{ nodes: [this.schema.nodes.horizontalRule.create()], start, end }];
      }
      default:
        this.skip();
        return null;
    }
  }

  private skip() {
    let depth = 0;
    do {
      depth += this.tokens[this.pos].nesting;
      this.pos++;
    } while (depth > 0 && this.pos < this.tokens.length);
  }

  private paragraph(top: boolean): Placed[] {
    const open = this.tokens[this.pos];
    const inline = this.tokens[this.pos + 1];
    this.pos += 3;
    const [start, end] = open.map!;
    const lines = inlineLines(this.schema, inline.children ?? []);
    if (lines.length !== end - start) {
      // A line break inside a code span: lines and nodes don't pair up.
      return [{ nodes: lines.map((content) => this.schema.nodes.paragraph.create(null, content)), start, end }];
    }
    return lines.map((content, i) => {
      // Top-level text keeps its indentation (it has no Markdown meaning there).
      const indent = top ? /^[ \t]*/.exec(this.lines[start + i])![0] : '';
      const nodes = indent ? [this.schema.text(indent), ...content] : content;
      return { nodes: [this.schema.nodes.paragraph.create(null, nodes)], start: start + i, end: start + i + 1 };
    });
  }

  private heading(): Placed {
    const open = this.tokens[this.pos];
    const inline = this.tokens[this.pos + 1];
    this.pos += 3;
    const level = Math.min(Math.max(open.markup.length, 1), 6);
    const content = inlineLines(this.schema, inline.children ?? []).flat();
    const [start, end] = open.map!;
    return { nodes: [this.schema.nodes.heading.create({ level }, content)], start, end };
  }

  private fence(): Placed {
    const token = this.tokens[this.pos++];
    const text = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
    const node = this.schema.nodes.codeBlock.create(
      { language: token.info.trim() || null, fence: token.markup },
      text ? this.schema.text(text) : null,
    );
    const [start, end] = token.map!;
    return { nodes: [node], start, end };
  }

  private blockquote(): Placed {
    const open = this.tokens[this.pos++];
    const [start] = open.map!;
    // An empty quote's range runs on over the blank lines after it.
    let end = open.map![1];
    while (end > start + 1 && !this.lines[end - 1].trim()) end--;
    const children = this.blocks(false);
    this.pos++; // blockquote_close
    const content = withBlankLines(this.schema, children, start, end);
    const node = this.schema.nodes.blockquote.createAndFill(null, content) ?? this.schema.nodes.blockquote.createAndFill()!;
    return { nodes: [node], start, end };
  }

  private list(top: boolean): Placed[] {
    const open = this.tokens[this.pos++];
    const ordered = open.type === 'ordered_list_open';
    const marker = open.markup;
    const level = open.level;
    const start = ordered ? Number(open.attrGet('start') ?? 1) : 1;
    const indent = top ? /^ */.exec(this.lines[open.map![0]])![0].length : 0;
    // markdown-it hides the paragraphs of tight lists.
    let tight = true;
    for (let i = this.pos; i < this.tokens.length && this.tokens[i].level > level; i++) {
      const token = this.tokens[i];
      if (token.type === 'paragraph_open' && token.level === level + 2 && !token.hidden) tight = false;
    }
    const items: { node: PMNode; task: boolean; start: number; end: number }[] = [];
    while (this.tokens[this.pos]?.type === 'list_item_open') {
      const itemOpen = this.tokens[this.pos++];
      const task = ordered ? null : this.taskMarker();
      const children = this.blocks(false);
      this.pos++; // list_item_close
      const itemStart = itemOpen.map![0];
      const itemEnd = children.length ? children[children.length - 1].end : itemStart + 1;
      const content = withBlankLines(this.schema, children, children[0]?.start ?? itemStart, null);
      const type = task ? this.schema.nodes.taskItem : this.schema.nodes.listItem;
      const attrs = task ? { checked: task.checked } : null;
      const node = type.createAndFill(attrs, content) ?? type.createAndFill(attrs)!;
      items.push({ node, task: !!task, start: itemStart, end: itemEnd });
    }
    this.pos++; // list close
    if (ordered) {
      const node = this.schema.nodes.orderedList.create({ start, delimiter: marker === ')' ? ')' : '.', tight, indent }, items.map((i) => i.node));
      return [{ nodes: [node], start: items[0].start, end: items[items.length - 1].end }];
    }
    // GFM allows task and plain items in one list; the editor has a list
    // type for each, so the list becomes one block per run of items.
    const runs: Placed[] = [];
    let i = 0;
    while (i < items.length) {
      let j = i;
      while (j < items.length && items[j].task === items[i].task) j++;
      const type = items[i].task ? this.schema.nodes.taskList : this.schema.nodes.bulletList;
      const node = type.create({ bullet: marker, tight, indent }, items.slice(i, j).map((item) => item.node));
      runs.push({ nodes: [node], start: items[i].start, end: items[j - 1].end });
      i = j;
    }
    return runs;
  }

  /** `[ ]` / `[x]` opening the item's first paragraph: strips it and reports the state. */
  private taskMarker(): { checked: boolean } | null {
    if (this.tokens[this.pos]?.type !== 'paragraph_open') return null;
    const first = this.tokens[this.pos + 1]?.children?.[0];
    if (!first || first.type !== 'text') return null;
    const match = TASK_RE.exec(first.content);
    if (!match) return null;
    first.content = first.content.slice(match[0].length);
    return { checked: match[1] !== ' ' };
  }
}

/** Inline tokens -> one array of inline nodes per line (line breaks split paragraphs). */
function inlineLines(schema: Schema, tokens: Token[]): PMNode[][] {
  const lines: PMNode[][] = [[]];
  const stack: Mark[] = [];
  const marks = () => stack.reduce<readonly Mark[]>((set, mark) => mark.addToSet(set), Mark.none);
  const push = (text: string, extra?: Mark) => {
    if (!text) return;
    const set = extra ? extra.addToSet(marks()) : marks();
    lines[lines.length - 1].push(schema.text(text, set));
  };
  const open = (mark: Mark | undefined) => {
    if (mark) stack.push(mark);
  };
  const close = (name: string) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type.name === name) {
        stack.splice(i, 1);
        return;
      }
    }
  };
  const { marks: types } = schema;
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'text_special':
        push(token.content);
        break;
      case 'softbreak':
      case 'hardbreak':
        lines.push([]);
        break;
      case 'code_inline':
        push(token.content, types.code.create());
        break;
      case 'strong_open':
        open(types.bold.create());
        break;
      case 'strong_close':
        close('bold');
        break;
      case 'em_open':
        open(types.italic.create());
        break;
      case 'em_close':
        close('italic');
        break;
      case 's_open':
        open(types.strike.create());
        break;
      case 's_close':
        close('strike');
        break;
      case 'mark_open':
        open(types.highlight.create());
        break;
      case 'mark_close':
        close('highlight');
        break;
      case 'u_open':
        open(types.underline.create());
        break;
      case 'u_close':
        close('underline');
        break;
      case 'link_open':
        open(types.link.create({ href: token.attrGet('href') ?? '', title: token.attrGet('title') || null }));
        break;
      case 'link_close':
        close('link');
        break;
      default:
        push(token.content);
    }
  }
  return lines;
}

/**
 * Children of a container with their blank lines turned into empty
 * paragraphs (less the blank line Markdown itself needs between blocks).
 * `end` is the container's last line; null leaves trailing blank lines out
 * (list items: those separate items).
 */
function withBlankLines(schema: Schema, children: Placed[], start: number, end: number | null): PMNode[] {
  const out: PMNode[] = [];
  let cursor = start;
  let prev: PMNode | null = null;
  const blank = (count: number) => {
    for (let i = 0; i < count; i++) out.push(schema.nodes.paragraph.create());
  };
  for (const placed of children) {
    const gap = placed.start - cursor;
    blank(gap - syntaxBlanks(prev, placed.nodes[0], gap));
    out.push(...placed.nodes);
    prev = placed.nodes[placed.nodes.length - 1];
    cursor = placed.end;
  }
  if (end !== null) blank(Math.max(0, end - cursor));
  return out;
}

// ---------------------------------------------------------------------------
// Parsed documents
// ---------------------------------------------------------------------------

/** A top-level block and the source lines it came from. */
interface Segment {
  nodes: PMNode[];
  start: number;
  end: number;
  key: string | null;
}

/** A parsed description: the document plus what's needed to write it back faithfully. */
export interface MarkdownDocument {
  doc: PMNode;
  /** The text exactly as given. */
  source: string;
  lines: string[];
  eol: '\n' | '\r\n';
  segments: Segment[];
  /** Keys of the top-level nodes, in order (unchanged-document check). */
  keys: string[];
}

const keyCache = new WeakMap<PMNode, string>();

/** Structural identity of a node, independent of the schema instance. */
function keyOf(node: PMNode): string {
  let key = keyCache.get(node);
  if (key === undefined) {
    key = JSON.stringify(node.toJSON());
    keyCache.set(node, key);
  }
  return key;
}

function toLines(source: string): { lines: string[]; eol: '\n' | '\r\n' } {
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  return { lines: source.replace(/\r\n?/g, '\n').split('\n'), eol };
}

function readSegments(schema: Schema, lines: string[]): Segment[] {
  const text = lines.join('\n');
  const tokens = getParser().parse(text, {});
  const placed = new Reader(schema, tokens, lines).blocks(true);
  const segments: Segment[] = [];
  const blankLine = (line: number) => {
    const node = schema.nodes.paragraph.create();
    segments.push({ nodes: [node], start: line, end: line + 1, key: keyOf(node) });
  };
  let cursor = 0;
  let prev: PMNode | null = null;
  for (const block of placed) {
    const gap = block.start - cursor;
    for (let line = cursor + syntaxBlanks(prev, block.nodes[0], gap); line < block.start; line++) blankLine(line);
    segments.push({ ...block, key: block.nodes.length === 1 ? keyOf(block.nodes[0]) : null });
    prev = block.nodes[block.nodes.length - 1];
    cursor = block.end;
  }
  for (let line = cursor; line < lines.length; line++) blankLine(line);
  return segments;
}

/** Parse a description. Use the result's `doc` in the editor and pass it back to `serializeMarkdown`. */
export function parseMarkdown(schema: Schema, source: string): MarkdownDocument {
  const { lines, eol } = toLines(source);
  const segments = readSegments(schema, lines);
  const nodes = segments.flatMap((segment) => segment.nodes);
  const doc = schema.topNodeType.createAndFill(null, nodes) ?? schema.topNodeType.createAndFill()!;
  return { doc, source, lines, eol, segments, keys: nodes.map(keyOf) };
}

/** Top-level nodes of a Markdown text (the writer re-reads its output with this). */
function parseNodes(schema: Schema, text: string): PMNode[] {
  return readSegments(schema, text.split('\n')).flatMap((segment) => segment.nodes);
}

// ---------------------------------------------------------------------------
// Nodes -> Markdown
// ---------------------------------------------------------------------------

/** Outer to inner; code is innermost because nothing can be nested inside it. */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'highlight', 'underline'];

const markRank = (mark: Mark) => {
  const i = MARK_ORDER.indexOf(mark.type.name);
  return i < 0 ? MARK_ORDER.length : i;
};

function openDelimiter(mark: Mark): string {
  switch (mark.type.name) {
    case 'link':
      return '[';
    case 'bold':
      return '**';
    case 'italic':
      return '*';
    case 'strike':
      return '~~';
    case 'highlight':
      return '==';
    case 'underline':
      return '<u>';
    default:
      return '';
  }
}

function linkDestination(href: string): string {
  let depth = 0;
  let balanced = true;
  for (const ch of href) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) balanced = false;
  }
  if (depth !== 0) balanced = false;
  if (balanced && href && !/[\s<>]/.test(href)) return href.replace(/\\(?=[()])/g, '\\\\');
  return `<${href.replace(/[<>\\]/g, '\\$&')}>`;
}

function closeDelimiter(mark: Mark): string {
  switch (mark.type.name) {
    case 'link': {
      const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/["\\]/g, '\\$&')}"` : '';
      return `](${linkDestination(String(mark.attrs.href ?? ''))}${title})`;
    }
    case 'underline':
      return '</u>';
    default:
      return openDelimiter(mark);
  }
}

function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || (/^ .*[^ ].* $/.test(text)) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const ALNUM_RE = /[\p{L}\p{N}]/u;

/**
 * Backslash-escapes what Markdown would read as syntax (level 1); used for
 * the lines that do not read back right when written as typed (level 0).
 */
function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1] ?? '';
    const next = text[i + 1] ?? '';
    switch (ch) {
      case '\\':
        out += !next || /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : '\\';
        break;
      case '*':
      case '`':
      case '[':
      case ']':
        out += `\\${ch}`;
        break;
      case '_':
        out += ALNUM_RE.test(prev) && ALNUM_RE.test(next) ? '_' : '\\_';
        break;
      case '~':
      case '=':
        out += prev === ch || next === ch ? `\\${ch}` : ch;
        break;
      case '<':
        out += /[A-Za-z/]/.test(next) ? '\\<' : '<';
        break;
      case ':':
        // `https://…` in plain text would turn into a link.
        out += /(?:https?|ftp|mailto)$/i.test(text.slice(Math.max(0, i - 6), i)) ? '\\:' : ':';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** A line Markdown would read as a block start (heading, list, quote, fence, rule): escape that. */
function escapeLineStart(line: string, bulletItemStart: boolean): string {
  const indent = /^[ \t]*/.exec(line)![0];
  let width = 0;
  for (const ch of indent) width = ch === '\t' ? width + 4 - (width % 4) : width + 1;
  if (width >= 4) return line;
  const rest = line.slice(indent.length);
  if (/^(?:#{1,6}(?=[ \t]|$)|[-+*](?=[ \t]|$)|>|`{3,}|~{3,})/.test(rest) || /^([-*_])[ \t]*(?:\1[ \t]*){2,}$/.test(rest)) {
    return `${indent}\\${rest}`;
  }
  const ordered = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(rest);
  if (ordered) return `${indent}${ordered[1]}\\${rest.slice(ordered[1].length)}`;
  if (bulletItemStart && TASK_RE.test(rest)) return `${indent}\\${rest}`;
  return line;
}

interface WriteOptions {
  /** Escaping level per textblock, in document order (missing: 0). */
  levels: number[];
  /** Marker overrides for lists (keeps two lists apart). */
  bullet?: string;
  delimiter?: string;
  /** Indentation override (a list right after another list would nest in it). */
  indent?: number;
}

class Writer {
  private textblock = 0;

  constructor(private options: WriteOptions) {}

  private nextLevel(): number {
    return this.options.levels[this.textblock++] ?? 0;
  }

  /** Inline content; line breaks come out as "\n". */
  inline(node: PMNode, level: number): string {
    let out = '';
    const open: Mark[] = [];
    let pendingSpace = '';
    const closeTo = (keep: number) => {
      while (open.length > keep) out += closeDelimiter(open.pop()!);
    };
    const inLink = () => open.some((mark) => mark.type.name === 'link');
    const text = (value: string) => {
      const escaped = level > 0 ? escapeText(value) : value;
      return inLink() && level === 0 ? escaped.replace(/[[\]]/g, '\\$&') : escaped;
    };
    node.forEach((child, _offset, index) => {
      if (child.type.name === 'hardBreak') {
        closeTo(0);
        out += pendingSpace + '\n';
        pendingSpace = '';
        return;
      }
      if (!child.isText) return;
      const isCode = child.marks.some((mark) => mark.type.name === 'code');
      const marks = child.marks.filter((mark) => mark.type.name !== 'code').slice().sort((a, b) => markRank(a) - markRank(b));
      // A link written as its own URL: bare (level 0) or <url>.
      const linkMark = marks.find((mark) => mark.type.name === 'link');
      let keep = 0;
      while (keep < open.length && marks.some((mark) => mark.eq(open[keep]))) keep++;
      closeTo(keep);
      out += pendingSpace;
      pendingSpace = '';
      const toOpen = marks.filter((mark) => !open.some((o) => o.eq(mark)));
      let value = child.text!;
      if (!isCode && toOpen.length) {
        const lead = /^[ \t]+/.exec(value)?.[0] ?? '';
        out += lead;
        value = value.slice(lead.length);
      }
      if (
        linkMark && toOpen.includes(linkMark) && !isCode && marks.length === 1 &&
        autolinkable(node, index, linkMark, value)
      ) {
        out += level === 0 && /^(?:https?|ftp):\/\//i.test(value) ? value : `<${value}>`;
        return;
      }
      for (const mark of toOpen) {
        out += openDelimiter(mark);
        open.push(mark);
      }
      if (isCode) {
        out += codeSpan(value);
        return;
      }
      const trail = open.length ? /[ \t]+$/.exec(value)?.[0] ?? '' : '';
      if (trail) value = value.slice(0, -trail.length);
      out += text(value);
      pendingSpace = trail;
    });
    closeTo(0);
    return out + pendingSpace;
  }

  paragraph(node: PMNode, bulletItemStart = false): string[] {
    const level = this.nextLevel();
    return this.inline(node, level)
      .split('\n')
      .map((line, i) => escapeLineStart(line, bulletItemStart && i === 0));
  }

  heading(node: PMNode): string[] {
    const level = this.nextLevel();
    let content = this.inline(node, level).replace(/\n/g, ' ');
    // A trailing ` #` run would be taken for the closing sequence.
    content = content.replace(/(^|[ \t])(#+)([ \t]*)$/, '$1\\$2$3');
    const hashes = '#'.repeat(node.attrs.level ?? 1);
    return [content.trim() ? `${hashes} ${content}` : hashes];
  }

  codeBlock(node: PMNode): string[] {
    this.textblock++;
    const text = node.textContent;
    const language = String(node.attrs.language ?? '');
    let char = String(node.attrs.fence ?? '`')[0] === '~' ? '~' : '`';
    if (char === '`' && language.includes('`')) char = '~';
    let length = Math.max(3, String(node.attrs.fence ?? '').length);
    const closing = new RegExp(`^[ \\t]*(\\${char}{3,})`, 'gm');
    for (const match of text.matchAll(closing)) length = Math.max(length, match[1].length + 1);
    const fence = char.repeat(length);
    return [fence + language, ...(text ? text.split('\n') : []), fence];
  }

  /** Children of a container: one line each, blank lines for empty paragraphs. */
  children(nodes: PMNode[], bulletItem = false): string[] {
    const out: string[] = [];
    let prev: PMNode | null = null;
    let blank = 0;
    nodes.forEach((node, index) => {
      if (isBlankLine(node) && index > 0) {
        this.textblock++;
        blank++;
        return;
      }
      for (let i = 0; i < blank; i++) out.push('');
      if (prev && needsBlank(prev, undefined, node, undefined, blank)) out.push('');
      out.push(...this.block(node, bulletItem && index === 0));
      prev = node;
      blank = 0;
    });
    for (let i = 0; i < blank; i++) out.push('');
    return out;
  }

  block(node: PMNode, bulletItemStart = false): string[] {
    switch (node.type.name) {
      case 'paragraph':
        return this.paragraph(node, bulletItemStart);
      case 'heading':
        return this.heading(node);
      case 'codeBlock':
        return this.codeBlock(node);
      case 'horizontalRule':
        return ['---'];
      case 'blockquote':
        return this.children(childrenOf(node)).map((line) => (line ? `> ${line}` : '>'));
      case 'bulletList':
      case 'taskList':
      case 'orderedList':
        return this.list(node);
      default:
        this.textblock += node.isTextblock ? 1 : 0;
        return node.textContent ? [node.textContent] : [];
    }
  }

  list(node: PMNode): string[] {
    const ordered = node.type.name === 'orderedList';
    const bullet = this.options.bullet ?? node.attrs.bullet ?? '-';
    const delimiter = this.options.delimiter ?? node.attrs.delimiter ?? '.';
    const pad = ' '.repeat(Math.min(3, this.options.indent ?? node.attrs.indent ?? 0));
    // Overrides apply to this list only, not to lists nested inside it.
    this.options = { levels: this.options.levels };
    const start = Number(node.attrs.start ?? 1);
    const out: string[] = [];
    node.forEach((item, _offset, index) => {
      const marker = ordered ? `${start + index}${delimiter} ` : `${bullet} `;
      const task = item.type.name === 'taskItem' ? (item.attrs.checked ? '[x] ' : '[ ] ') : '';
      // An item can't start with an empty line in Markdown: leave those out.
      const content = childrenOf(item);
      while (content.length > 1 && isBlankLine(content[0])) {
        content.shift();
        this.textblock++;
      }
      const inner = this.children(content, !ordered && !task);
      const indent = ' '.repeat(marker.length);
      out.push(`${pad}${marker}${task}${inner[0] ?? ''}`.trimEnd());
      for (const line of inner.slice(1)) out.push(line ? pad + indent + line : '');
      if (!node.attrs.tight && index < node.childCount - 1) out.push('');
    });
    return out;
  }
}

/** `index`-th child of `parent` is a link whose text is its own URL (or e-mail address). */
function autolinkable(parent: PMNode, index: number, link: Mark, text: string): boolean {
  const href = String(link.attrs.href ?? '');
  if (link.attrs.title || !(text === href || `mailto:${text}` === href)) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/.test(href)) return false;
  // The link must be this text node alone.
  const before = index > 0 ? parent.child(index - 1) : null;
  const after = index < parent.childCount - 1 ? parent.child(index + 1) : null;
  return !before?.marks.some((mark) => mark.eq(link)) && !after?.marks.some((mark) => mark.eq(link));
}

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

function textblocksOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  if (node.isTextblock) return [node];
  node.descendants((child) => {
    if (child.isTextblock) {
      out.push(child);
      return false;
    }
    return true;
  });
  return out;
}

// --- comparing what was written with what reads back ---

function trimInline(schema: Schema, nodes: PMNode[], leading: boolean): PMNode[] {
  const out = nodes.slice();
  if (leading) {
    while (out.length && out[0].isText) {
      const text = out[0].text!.replace(/^[ \t]+/, '');
      if (text) {
        out[0] = schema.text(text, out[0].marks);
        break;
      }
      out.shift();
    }
  }
  while (out.length && out[out.length - 1].isText) {
    const last = out[out.length - 1];
    const text = last.text!.replace(/[ \t]+$/, '');
    if (text) {
      out[out.length - 1] = schema.text(text, last.marks);
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * What a document reads back as at best: line breaks inside a paragraph
 * become separate lines, and whitespace Markdown drops at line ends (and at
 * the start of nested lines) is gone.
 */
function normalize(schema: Schema, nodes: PMNode[], top: boolean): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    if (node.type.name === 'paragraph') {
      let line: PMNode[] = [];
      const lines: PMNode[][] = [line];
      node.forEach((child) => {
        if (child.type.name === 'hardBreak') lines.push((line = []));
        else line.push(child);
      });
      for (const content of lines) out.push(node.type.create(node.attrs, trimInline(schema, content, !top)));
    } else if (node.type.name === 'heading') {
      out.push(node.type.create(node.attrs, trimInline(schema, childrenOf(node), true)));
    } else if (node.isTextblock || node.isLeaf) {
      out.push(node);
    } else {
      out.push(node.type.create(node.attrs, normalize(schema, childrenOf(node), false), node.marks));
    }
  }
  return out;
}

function sameNodes(a: PMNode[], b: PMNode[]): boolean {
  return a.length === b.length && a.every((node, i) => keyOf(node) === keyOf(b[i]));
}

const MAX_LEVEL = 1;

/** Write a block that changed, escaping only the lines that need it. */
function writeBlock(schema: Schema, node: PMNode, overrides: Omit<WriteOptions, 'levels'>): string[] {
  const textblocks = textblocksOf(node).length;
  const levels = new Array<number>(textblocks).fill(0);
  const attrs = { ...node.attrs };
  if (overrides.bullet) attrs.bullet = overrides.bullet;
  if (overrides.delimiter) attrs.delimiter = overrides.delimiter;
  if (overrides.indent !== undefined) attrs.indent = overrides.indent;
  const expectedNode = overrides.bullet || overrides.delimiter || overrides.indent !== undefined ? node.type.create(attrs, node.content) : node;
  const expected = normalize(schema, [expectedNode], true);
  let lines: string[] = [];
  for (let attempt = 0; attempt <= MAX_LEVEL + 1; attempt++) {
    lines = new Writer({ levels, ...overrides }).block(node);
    const actual = normalize(schema, parseNodes(schema, lines.join('\n')), true);
    if (sameNodes(actual, expected)) return lines;
    const got = actual.length === 1 ? textblocksOf(actual[0]) : null;
    const want = textblocksOf(expected[0]);
    let raised = false;
    want.forEach((block, i) => {
      const bad = !got || got.length !== want.length || keyOf(got[i]) !== keyOf(block);
      if (bad && levels[i] < MAX_LEVEL) {
        levels[i]++;
        raised = true;
      }
    });
    if (!raised) break;
  }
  return lines;
}

/**
 * Write a run of top-level paragraph lines. Lines from the source are used
 * as they were unless they read back differently in their new company.
 */
function writeRun(schema: Schema, run: PMNode[], raws: (string | null)[]): string[] {
  // -1: the source line; 0: as typed; 1: escaped.
  const levels = raws.map((raw) => (raw === null ? 0 : -1));
  const expected = normalize(schema, run, true);
  let lines: string[] = [];
  for (let attempt = 0; attempt <= MAX_LEVEL + 2; attempt++) {
    lines = run.map((node, i) => (levels[i] < 0 ? raws[i]! : new Writer({ levels: [levels[i]] }).paragraph(node).join('\n')));
    const actual = normalize(schema, parseNodes(schema, lines.join('\n')), true);
    if (sameNodes(actual, expected)) return lines;
    const lineCountOk = actual.length === expected.length;
    let raised = false;
    expected.forEach((node, i) => {
      // Lines and nodes pair up unless a node had a line break in it.
      const bad = !lineCountOk || keyOf(actual[i]) !== keyOf(node);
      if (bad && i < levels.length && levels[i] < MAX_LEVEL) {
        levels[i]++;
        raised = true;
      }
    });
    if (!lineCountOk) {
      for (let i = 0; i < levels.length; i++) {
        if (levels[i] < MAX_LEVEL) {
          levels[i]++;
          raised = true;
        }
      }
    }
    if (!raised) break;
  }
  return lines;
}

const ALT_BULLET: Record<string, string> = { '-': '*', '*': '+', '+': '-' };

/**
 * Write a document as Markdown. With the `MarkdownDocument` it was loaded
 * from, unchanged blocks are written exactly as they were read.
 */
export function serializeMarkdown(doc: PMNode, base?: MarkdownDocument | null): string {
  const schema = doc.type.schema;
  const nodes = childrenOf(doc);
  if (base && nodes.length === base.keys.length && nodes.every((node, i) => keyOf(node) === base.keys[i])) return base.source;

  // Pair each top-level node with the source segment it came from.
  const segments = base?.segments ?? [];
  const byKey = new Map<string, number[]>();
  segments.forEach((segment, i) => {
    if (segment.key === null) return;
    const list = byKey.get(segment.key);
    if (list) list.push(i);
    else byKey.set(segment.key, [i]);
  });
  const used = new Set<number>();
  let lastMatch = -1;
  const origin = nodes.map((node) => {
    const candidates = byKey.get(keyOf(node));
    if (!candidates) return -1;
    const free = candidates.filter((i) => !used.has(i));
    const pick = free.find((i) => i > lastMatch) ?? free[0];
    if (pick === undefined) return -1;
    used.add(pick);
    lastMatch = pick;
    return pick;
  });
  const rawOf = (segment: number) => base!.lines.slice(segments[segment].start, segments[segment].end);

  type Neighbour = { node: PMNode; origin: number; marker?: string };
  const out: string[] = [];
  let prev: Neighbour | null = null;
  let blanks: number[] = [];

  /** `prev`, the blank lines since and `origin` were consecutive in the source. */
  const sourceGap = (origin: number) => {
    if (!prev || prev.origin < 0 || origin < 0) return false;
    const chain = [prev.origin, ...blanks, origin];
    return chain.every((value, i) => i === 0 || value === chain[i - 1] + 1);
  };

  /** Blank lines between `prev` and `next`: as in the source if nothing around them changed. */
  const gap = (next: Neighbour | null) => {
    // A list that got another marker no longer relates to its neighbours as in the source.
    if (prev && next && prev.marker === undefined && next.marker === undefined && sourceGap(next.origin)) {
      out.push(...base!.lines.slice(segments[prev.origin].end, segments[next.origin].start));
      return;
    }
    for (const blank of blanks) out.push(blank >= 0 ? rawOf(blank).join('\n') : '');
    if (prev && next && needsBlank(prev.node, prev.marker, next.node, next.marker, blanks.length)) out.push('');
  };

  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (isBlankLine(node)) {
      blanks.push(origin[i]);
      i++;
      continue;
    }
    if (node.type.name === 'paragraph') {
      let j = i;
      while (j < nodes.length && nodes[j].type.name === 'paragraph' && !isBlankLine(nodes[j])) j++;
      const run = nodes.slice(i, j);
      const raws = run.map((_, k) => (origin[i + k] >= 0 ? rawOf(origin[i + k]).join('\n') : null));
      // An indented line after a list would continue its last item.
      if (prev && isList(prev.node) && !sourceGap(origin[i]) && /^[ \t]/.test(node.textContent)) {
        run[0] = node.type.create(node.attrs, trimInline(schema, childrenOf(node), true));
        raws[0] = null;
      }
      gap({ node, origin: origin[i] });
      out.push(...writeRun(schema, run, raws));
      prev = { node: nodes[j - 1], origin: origin[j - 1] };
      blanks = [];
      i = j;
      continue;
    }
    // Two lists that Markdown would merge: give this one another marker.
    let marker: string | undefined;
    if (prev && isList(prev.node) && isList(node) && listJoin(prev.node, prev.marker, node, undefined, blanks.length) === 'conflict') {
      if (node.type.name === 'orderedList') marker = (prev.marker ?? prev.node.attrs.delimiter) === ')' ? '.' : ')';
      else marker = ALT_BULLET[prev.marker ?? prev.node.attrs.bullet ?? '-'] ?? '*';
    }
    // An indented block right after a list would continue (or nest in) its last item.
    const afterList = !!prev && isList(prev.node) && !sourceGap(origin[i]);
    const indent = afterList && isList(node) && node.attrs.indent ? 0 : undefined;
    const indented = afterList && origin[i] >= 0 && /^[ \t]/.test(rawOf(origin[i])[0]);
    const current: Neighbour = { node, origin: origin[i], marker };
    gap(current);
    if (current.origin >= 0 && marker === undefined && indent === undefined && !indented) out.push(...rawOf(current.origin));
    else out.push(...writeBlock(schema, node, { ...(node.type.name === 'orderedList' ? { delimiter: marker } : { bullet: marker }), indent }));
    prev = current;
    blanks = [];
    i++;
  }
  gap(null);
  const text = out.join('\n');
  if (base && text === base.lines.join('\n')) return base.source;
  return base?.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Copied editor content as Markdown (what lands in plain-text fields). */
export function sliceToMarkdown(schema: Schema, slice: Slice): string {
  let content = slice.content;
  if (content.firstChild?.isInline) content = Fragment.from(schema.nodes.paragraph.create(null, content));
  const doc = schema.topNodeType.createAndFill(null, content);
  return doc ? serializeMarkdown(doc) : slice.content.textBetween(0, slice.content.size, '\n');
}

/** Pasted plain text, read as Markdown (Ctrl+Shift+V keeps it literal: one paragraph per line). */
export function markdownToSlice(schema: Schema, text: string, literal: boolean): Slice {
  const nodes = literal
    ? text.replace(/\r\n?/g, '\n').split('\n').map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
    : childrenOf(parseMarkdown(schema, text).doc);
  return Slice.maxOpen(Fragment.fromArray(nodes));
}
