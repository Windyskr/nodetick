/**
 * Ways out of the Summary page: copy (rich text + Markdown), print to PDF,
 * a PNG image, email and the system share sheet. `source` is the rendered
 * summary (the editor's `.nt-prose`), null while the plain-text fallback shows.
 */

/** Copy the Markdown, plus the formatted HTML for editors that paste rich text. */
export async function copySummary(markdown: string, html: string | null): Promise<void> {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Some browsers refuse HTML on the clipboard; plain text still works.
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(markdown);
    return;
  }
  const area = document.createElement('textarea');
  area.value = markdown;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy failed');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Styles for the printed page: plain document typography, checklists with real boxes. */
const PRINT_CSS = `
  @page { margin: 16mm; }
  body { font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #191919; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 17px; margin: 18px 0 6px; }
  h3 { font-size: 15px; margin: 12px 0 4px; }
  p { margin: 0; }
  ul, ol { margin: 0; padding-left: 22px; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] ul[data-type="taskList"] { padding-left: 22px; }
  ul[data-type="taskList"] > li { display: flex; gap: 8px; align-items: flex-start; }
  ul[data-type="taskList"] > li > label { flex: none; padding-top: 3px; }
  ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
  li[data-checked="true"] > div { color: #8a8a8a; text-decoration: line-through; }
  blockquote { margin: 6px 0; padding-left: 12px; border-left: 3px solid #d0d0d0; color: #555; }
  pre { background: #f5f5f5; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; }
  code { background: #f2f2f2; border-radius: 3px; padding: 0 3px; }
  mark { background: #fff59d; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 12px 0; }
  a { color: inherit; }
`;

/** Print the summary on its own (the browser's dialog offers "Save as PDF"). */
export function printSummary(title: string, html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${html}</body></html>`);
  doc.close();
  // Checkboxes in the copied HTML keep their state only as attributes.
  for (const box of doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) box.disabled = true;
  const win = frame.contentWindow!;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Browsers that don't fire afterprint still drop the frame eventually.
    setTimeout(cleanup, 60_000);
  }, 50);
}

/** Computed properties carried into the image; enough for text, lists and checklists. */
const IMAGE_PROPS = [
  'display', 'box-sizing', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-style', 'border-right-color',
  'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color',
  'border-radius', 'list-style-type', 'list-style-position',
  'flex', 'flex-direction', 'align-items', 'gap', 'min-width', 'height',
] as const;

function inlineStyles(source: Element, clone: Element): void {
  const style = getComputedStyle(source);
  const target = (clone as HTMLElement).style;
  if (target) for (const prop of IMAGE_PROPS) target.setProperty(prop, style.getPropertyValue(prop));
  const from = source.children;
  const to = clone.children;
  for (let i = 0; i < from.length && i < to.length; i++) inlineStyles(from[i], to[i]);
}

/** An image of the rendered summary (2× for sharp text), drawn through an SVG foreignObject. */
export async function summaryImage(source: HTMLElement, background: string, accent: string): Promise<Blob> {
  const padding = 32;
  const width = Math.ceil(source.getBoundingClientRect().width) + padding * 2;
  const clone = source.cloneNode(true) as HTMLElement;
  inlineStyles(source, clone);
  clone.removeAttribute('contenteditable');
  clone.style.setProperty('width', `${width - padding * 2}px`);
  clone.style.setProperty('padding', '0');
  // The check mark is a pseudo-element, which an inline copy can't carry: draw the boxes instead.
  for (const box of clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const checked = box.closest('li')?.getAttribute('data-checked') === 'true';
    const mark = document.createElement('span');
    mark.textContent = checked ? '✓' : '';
    mark.style.cssText = `display:inline-block;box-sizing:border-box;width:14px;height:14px;border:1.5px solid ${checked ? accent : '#b8b8b8'};border-radius:3px;background:${checked ? accent : 'transparent'};color:#fff;font:bold 10px/11px sans-serif;text-align:center`;
    box.replaceWith(mark);
  }
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;padding:${padding}px;box-sizing:border-box;background:${background}`;
  holder.appendChild(clone);
  document.body.appendChild(holder);
  const height = Math.ceil(holder.getBoundingClientRect().height);
  holder.remove();

  const body = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${width}px;height:${height}px;padding:${padding}px;background:${background}">${body}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // Twice the size for sharp text when shared to phones; very long summaries stay within canvas limits.
  const scale = height > 8000 ? 1 : 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.scale(scale, scale);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('empty image'))), 'image/png');
    } catch (error) {
      // Some browsers taint a canvas that drew a foreignObject.
      reject(error);
    }
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Longest mailto: link that mail apps reliably accept. */
const MAX_MAILTO = 1900;

/**
 * Open a new email with the summary. Returns false when the text was too long
 * for a mailto: link: then only the subject goes in and the caller copies the text.
 */
export function emailSummary(subject: string, body: string): boolean {
  const full = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const fits = full.length <= MAX_MAILTO;
  const link = document.createElement('a');
  link.href = fits ? full : `mailto:?subject=${encodeURIComponent(subject)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return fits;
}

export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** The system share sheet; false if the user closed it. */
export async function shareSummary(title: string, text: string): Promise<boolean> {
  try {
    await navigator.share({ title, text });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

/** "摘要 11月15日-11月21日.png", without characters file systems reject. */
export function summaryFileName(title: string, extension: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'summary'}.${extension}`;
}
