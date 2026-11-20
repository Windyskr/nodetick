import { test, expect } from './fixtures';

const PAGES = ['/app/tasks/inbox', '/app/tasks/all', '/app/calendar', '/app/matrix', '/app/search', '/app/summary', '/app/habit', '/app/focus', '/app/countdown', '/app/tokens', '/app/admin', '/app/stats'];

/** Words that may stay in Latin script in the Chinese UI. */
const ALLOWED_IN_ZH = new Set(['NodeTick', 'API', 'JSON', 'iCal', 'ICS', 'Microsoft', 'To', 'Do', 'Web', 'Push', 'CLI', 'OAuth', 'URL', 'ID', 'AM', 'PM', 'Google', 'Apple', 'Outlook', 'Bearer', 'Token', 'ntk', 'npm', 'TickTick']);

/**
 * Text a user reads: visible text nodes plus titles, labels and placeholders.
 * Code samples, URLs and e-mail addresses are not UI copy and are left out.
 */
async function visibleText(page: import('@playwright/test').Page): Promise<string> {
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
    for (const el of document.querySelectorAll<HTMLElement>('[title], [aria-label], input[placeholder], textarea[placeholder]')) {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(attr);
        if (value) parts.push(value);
      }
    }
    return parts.join('\n');
  });
  return text.replace(/https?:\/\/\S+/g, ' ').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ');
}

test.describe('no stray strings from the other language', () => {
  test('the Chinese UI has no English copy', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const text = await visibleText(page);
      const words = [...new Set(text.match(/[A-Za-z][A-Za-z']{2,}/g) ?? [])].filter((word) => !ALLOWED_IN_ZH.has(word));
      expect(words, path).toEqual([]);
    }
  });

  test.describe('English', () => {
    test.use({ lang: 'en' });
    test('the English UI has no Chinese copy', async ({ page }) => {
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        // The language switch names Chinese in Chinese, as it should.
        const text = (await visibleText(page)).replaceAll('中文', '');
        expect(text.match(/[一-鿿]+/g) ?? [], path).toEqual([]);
      }
    });
  });
});
