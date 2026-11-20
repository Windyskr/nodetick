/**
 * Task descriptions are Markdown. These turn them into the text a reader
 * sees, for one-line previews (task rows, search excerpts). Regular
 * expressions on purpose: the Markdown parser lives in the editor's lazily
 * loaded chunk, and a preview may be approximate.
 */

const LINK_RE = /!?\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*>|(?:\\.|[^()\s\\]|\([^()]*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

function plainLine(line: string): string {
  let text = line;
  if (/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(text) || /^\s{0,3}(?:`{3,}|~{3,})/.test(text)) return '';
  text = text
    // Quote markers, heading hashes, list markers and checkboxes.
    .replace(/^\s{0,3}(?:>[ \t]?)+/, '')
    .replace(/^\s{0,3}#{1,6}(?:[ \t]+|$)/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?|$)/, '')
    // Links and images keep their text; autolinks their address.
    .replace(LINK_RE, '$1')
    .replace(/<((?:https?|ftp|mailto):[^\s<>]*)>/gi, '$1')
    .replace(/<\/?u>/g, '')
    .replace(/(`+)(.+?)\1/g, '$2')
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\p{L}\p{N}*\\])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}_\\])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return text;
}

/** Markdown → the text it reads as, line by line. */
export function markdownToPlainText(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').split('\n').map(plainLine).join('\n');
}

/** The first line of a description that has text, as plain text on one line. */
export function descriptionPreview(markdown: string, max = 140): string {
  for (const line of markdownToPlainText(markdown).split('\n')) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) return text.length > max ? `${text.slice(0, max)}…` : text;
  }
  return '';
}
