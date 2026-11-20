import type { Page } from '@playwright/test';

/** Words that may stay in Latin script in the Chinese UI. */
export const ALLOWED_IN_ZH = new Set(['NodeTick', 'API', 'JSON', 'iCal', 'ICS', 'Microsoft', 'To', 'Do', 'Web', 'Push', 'CLI', 'OAuth', 'URL', 'ID', 'AM', 'PM', 'Google', 'Apple', 'Outlook', 'Bearer', 'Token', 'ntk', 'npm', 'TickTick', 'PDF', 'Markdown',
  // Key names in shortcut hints ("粗体 (Ctrl+B)") stay as printed on the keyboard.
  'Ctrl', 'Shift', 'Alt', 'Esc', 'Enter', 'Tab']);

/**
 * Text a user reads: visible text nodes plus titles, labels and placeholders.
 * Code samples, URLs and e-mail addresses are not UI copy and are left out.
 */
export async function visibleText(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre, kbd, samp, script, style, [aria-hidden="true"]')) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (node.textContent?.trim()) parts.push(node.textContent);
    }
    for (const el of document.querySelectorAll<HTMLElement>('[title], [aria-label], input[placeholder], textarea[placeholder], [data-placeholder]')) {
      for (const attr of ['title', 'aria-label', 'placeholder', 'data-placeholder']) {
        const value = el.getAttribute(attr);
        if (value) parts.push(value);
      }
    }
    return parts.join('\n');
  });
  return text.replace(/https?:\/\/\S+/g, ' ').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ');
}

/** Copy that belongs to the other language: English words in the Chinese UI, Chinese in the English one. */
export async function strayCopy(page: Page, lang: 'zh' | 'en'): Promise<string[]> {
  const text = await visibleText(page);
  if (lang === 'zh') return [...new Set(text.match(/[A-Za-z][A-Za-z']{2,}/g) ?? [])].filter((word) => !ALLOWED_IN_ZH.has(word));
  // The language switch names Chinese in Chinese, as it should.
  return [...new Set(text.replaceAll('中文', '').match(/[一-鿿]+/g) ?? [])];
}
