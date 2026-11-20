import type { Key, Lang } from '../../i18n';

/**
 * The `/` quick-insert menu: its commands and the filtering, selection and
 * trigger rules, kept free of editor and DOM code so they can be tested.
 */
export type SlashCommandId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'taskList'
  | 'bulletList'
  | 'orderedList'
  | 'quote'
  | 'codeBlock'
  | 'divider'
  | 'link'
  | 'today'
  | 'now';

export interface SlashCommand {
  id: SlashCommandId;
  label: Key;
  /** Matched against the query whatever the UI language: English, Chinese, pinyin and its initials. */
  keywords: string[];
  /** The Markdown shortcut that does the same, shown next to the name. */
  hint?: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'text', label: 'editorText', keywords: ['text', 'paragraph', 'plain', 'body', '正文', '文本', '段落', 'zhengwen', 'zw', 'wenben', 'duanluo'] },
  { id: 'h1', label: 'editorHeading1', keywords: ['heading', 'title', 'h1', 'heading1', '标题', '一级标题', '大标题', 'biaoti', 'bt', 'yiji'], hint: '#' },
  { id: 'h2', label: 'editorHeading2', keywords: ['heading', 'title', 'h2', 'heading2', 'subtitle', '标题', '二级标题', 'biaoti', 'bt', 'erji'], hint: '##' },
  { id: 'h3', label: 'editorHeading3', keywords: ['heading', 'title', 'h3', 'heading3', '标题', '三级标题', 'biaoti', 'bt', 'sanji'], hint: '###' },
  { id: 'taskList', label: 'editorChecklist', keywords: ['checklist', 'todo', 'to-do', 'task', 'checkbox', 'check', '待办', '待办列表', '清单', '任务', '复选框', '勾选', 'daiban', 'db', 'renwu', 'qingdan'], hint: '[]' },
  { id: 'bulletList', label: 'editorBulletList', keywords: ['bullet', 'bulleted', 'list', 'unordered', 'ul', '无序列表', '列表', '项目符号', 'wuxu', 'liebiao', 'lb'], hint: '-' },
  { id: 'orderedList', label: 'editorNumberedList', keywords: ['numbered', 'number', 'ordered', 'list', 'ol', '有序列表', '编号', '列表', '数字', 'youxu', 'bianhao', 'liebiao', 'lb'], hint: '1.' },
  { id: 'quote', label: 'editorQuote', keywords: ['quote', 'blockquote', 'citation', '引用', '引言', 'yinyong', 'yy'], hint: '>' },
  { id: 'codeBlock', label: 'editorCodeBlock', keywords: ['code', 'codeblock', 'snippet', 'pre', '代码', '代码块', 'daima', 'dm'], hint: '```' },
  { id: 'divider', label: 'editorDivider', keywords: ['divider', 'separator', 'line', 'rule', 'hr', 'horizontal', '分割线', '分隔线', '横线', 'fengexian', 'fgx', 'hengxian'], hint: '---' },
  { id: 'link', label: 'editorLink', keywords: ['link', 'url', 'href', 'web', 'hyperlink', '链接', '网址', '超链接', 'lianjie', 'lj', 'wangzhi'] },
  { id: 'today', label: 'editorToday', keywords: ['today', 'date', 'day', '今天', '日期', '今日', 'jintian', 'riqi', 'jt', 'rq'] },
  { id: 'now', label: 'editorNow', keywords: ['now', 'time', 'datetime', 'clock', '现在', '时间', '当前时间', 'xianzai', 'shijian', 'sj'] },
];

const fold = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '');

/**
 * Commands matching what was typed after `/`, best first: the name starting
 * with the query, then a keyword starting with it, then either containing it.
 */
export function filterSlashCommands(commands: readonly SlashCommand[], query: string, label: (key: Key) => string): SlashCommand[] {
  const q = fold(query);
  if (!q) return commands.slice();
  const scored: { command: SlashCommand; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const name = fold(label(command.label));
    const keywords = command.keywords.map(fold);
    const score = name.startsWith(q) ? 4
      : keywords.some((k) => k.startsWith(q)) ? 3
        : name.includes(q) ? 2
          : keywords.some((k) => k.includes(q)) ? 1 : 0;
    if (score) scored.push({ command, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.command);
}

/** Arrow keys move through the list and wrap around at both ends. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * Whether typing `char` opens the menu. `before` is the text of the line up
 * to the caret. `/` (or a full-width `／`) opens it at the start of a line or
 * after a space, so dates and paths like `1/2` don't. The Chinese IME types
 * `、` for the `/` key, which opens it at the start of a line only.
 */
export function opensSlashMenu(before: string, char: string): boolean {
  if (char === '/' || char === '／') return before === '' || /\s$/.test(before);
  return char === '、' && before === '';
}

/** Longest query that keeps the menu open; past it, `/` was just text. */
const MAX_SLASH_QUERY = 24;

/** Whether the menu closes for this query (it leaves the typed text alone). */
export function closesSlashMenu(query: string, matches: number): boolean {
  if (query.length > MAX_SLASH_QUERY || /^\s/.test(query) || query.includes('\n')) return true;
  // Typing on past a word that matched nothing: the user meant a plain slash.
  return matches === 0 && /\s$/.test(query);
}

/** Text the "today" and "current time" commands insert, in the UI language. */
export function dateText(id: 'today' | 'now', lang: Lang, date = new Date()): string {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const day = new Intl.DateTimeFormat(locale, lang === 'zh' ? { dateStyle: 'long' } : { dateStyle: 'medium' }).format(date);
  if (id === 'today') return day;
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: lang !== 'zh' }).format(date);
  return `${day} ${time}`;
}
