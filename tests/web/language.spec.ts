import { test, expect } from './fixtures';
import { strayCopy } from './language';

const PAGES = ['/app/tasks/inbox', '/app/tasks/all', '/app/calendar', '/app/matrix', '/app/search', '/app/summary', '/app/habit', '/app/focus', '/app/countdown', '/app/tokens', '/app/admin', '/app/stats'];

test.describe('no stray strings from the other language', () => {
  test('the Chinese UI has no English copy', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await strayCopy(page, 'zh'), path).toEqual([]);
    }
  });

  test.describe('English', () => {
    test.use({ lang: 'en' });
    test('the English UI has no Chinese copy', async ({ page }) => {
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await strayCopy(page, 'en'), path).toEqual([]);
      }
    });
  });
});
