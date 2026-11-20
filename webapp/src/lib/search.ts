import type { Task } from './types';
import { tagKey } from './tags';

/** Upper bound on terms, so a pasted paragraph can't make every keystroke slow. */
const MAX_TERMS = 12;
const MAX_KEYWORDS = 200;

/**
 * Whitespace-separated, lower-cased, de-duplicated search terms. Every term
 * has to match somewhere in a task; `#name` only matches tags.
 */
export function searchTerms(raw: string): string[] {
  const terms = new Set<string>();
  for (const part of raw.slice(0, MAX_KEYWORDS).toLocaleLowerCase().split(/\s+/)) {
    if (part && part !== '#') terms.add(part);
  }
  return [...terms].slice(0, MAX_TERMS);
}

export type SnippetField = 'content' | 'item';

export interface TaskMatch {
  /** Higher first: the whole query in the title, then every term in it, then some. */
  score: number;
  /** Context for the first term found outside the title (description or subtask). */
  snippet: { field: SnippetField; text: string } | null;
}

/** Markdown markers that read as noise in a one-line excerpt. */
function plainLine(text: string): string {
  return text
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** About `radius` characters on each side of the hit, cut at the text's ends. */
function excerpt(text: string, at: number, length: number, radius = 36): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + length + radius * 2);
  return `${start > 0 ? '…' : ''}${plainLine(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

/**
 * Match one task against the terms; null when any term is missing. Looks at
 * the title, description (content and desc), subtask titles and tags.
 */
export function matchTask(task: Pick<Task, 'title' | 'content' | 'desc' | 'items' | 'tags'>, terms: string[]): TaskMatch | null {
  if (!terms.length) return { score: 0, snippet: null };
  const title = task.title.toLocaleLowerCase();
  const body = [task.content, task.desc].filter(Boolean).join('\n');
  const bodyLower = body.toLocaleLowerCase();
  const items = task.items.map((item) => item.title);
  const itemsLower = items.map((item) => item.toLocaleLowerCase());
  const tags = task.tags.map(tagKey);
  let plain = 0;
  let inTitle = 0;
  let snippet: TaskMatch['snippet'] = null;
  for (const term of terms) {
    if (term.startsWith('#')) {
      const wanted = term.slice(1);
      if (!tags.some((tag) => tag.startsWith(wanted))) return null;
      continue;
    }
    plain++;
    if (title.includes(term)) {
      inTitle++;
      continue;
    }
    const at = bodyLower.indexOf(term);
    if (at >= 0) {
      snippet ??= { field: 'content', text: excerpt(body, at, term.length) };
      continue;
    }
    const item = itemsLower.findIndex((value) => value.includes(term));
    if (item >= 0) {
      snippet ??= { field: 'item', text: items[item] };
      continue;
    }
    if (!tags.some((tag) => tag.includes(term))) return null;
  }
  const phrase = terms.filter((term) => !term.startsWith('#')).join(' ');
  const score = plain === 0 ? 1
    : phrase && title.includes(phrase) ? 4
      : inTitle === plain ? 3
        : inTitle > 0 ? 2 : 1;
  return { score, snippet };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split `text` into runs, marking the case-insensitive occurrences of `terms`. */
export function highlightParts(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const plain = terms.filter((term) => term && !term.startsWith('#'));
  if (!text || !plain.length) return [{ text, hit: false }];
  // Longest first, so "milk tea" wins over "milk" where both match.
  const pattern = new RegExp(plain.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'giu');
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (!match[0]) continue;
    if (at > last) parts.push({ text: text.slice(last, at), hit: false });
    parts.push({ text: match[0], hit: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

const STATUS_RANK: Record<number, number> = { 0: 0, 2: 1, [-1]: 2 };

/** Search result order: open tasks first, then by match quality, pinned, due date, recency. */
export function compareResults(
  a: { task: Task; match: TaskMatch },
  b: { task: Task; match: TaskMatch },
): number {
  const status = (STATUS_RANK[a.task.status] ?? 3) - (STATUS_RANK[b.task.status] ?? 3);
  if (status) return status;
  if (a.match.score !== b.match.score) return b.match.score - a.match.score;
  if (a.task.pinned !== b.task.pinned) return a.task.pinned ? -1 : 1;
  const due = (task: Task) => task.dueDate ?? task.startDate;
  const aDue = due(a.task);
  const bDue = due(b.task);
  if (aDue !== bDue) {
    if (!aDue) return 1;
    if (!bDue) return -1;
    return aDue < bDue ? -1 : 1;
  }
  return (b.task.modifiedTime ?? '').localeCompare(a.task.modifiedTime ?? '');
}

export const RECENT_SEARCHES_KEY = 'ntk_recent_searches';
const MAX_RECENT = 8;

export function readRecentSearches(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Move `query` to the front of the recent list (case-insensitive de-duplication). */
export function rememberSearch(recent: string[], query: string): string[] {
  const value = query.trim().slice(0, MAX_KEYWORDS);
  if (!value) return recent;
  const key = value.toLocaleLowerCase();
  return [value, ...recent.filter((item) => item.toLocaleLowerCase() !== key)].slice(0, MAX_RECENT);
}

export function persistRecentSearches(recent: string[]): void {
  try {
    if (recent.length) localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent));
    else localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Storage may be unavailable; recent searches then last for this page only.
  }
}
