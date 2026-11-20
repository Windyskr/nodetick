import { test, expect } from './fixtures';

test.describe('loading and empty states', () => {
  test('keeps a spinner up until the first data arrives', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/open/v1/project', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/app/tasks/inbox');
    await expect(page.locator('.animate-spin').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '收集箱' })).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
  });

  test('a new account sees an empty state on every page', async ({ page }) => {
    const pages: [string, string | RegExp][] = [
      ['/app/tasks/inbox', '收集箱清零，漂亮。'],
      ['/app/tasks/all', '这里空空如也，享受一下。'],
      ['/app/tasks/completed', '还没有已完成的任务。'],
      ['/app/tasks/trash', '垃圾桶是空的。'],
      ['/app/matrix', '暂无任务，设置优先级后会显示在这里。'],
      ['/app/habit', '来一起养成习惯吧'],
      ['/app/countdown', /还没有/],
      ['/app/search', '搜索标题、描述、子任务和标签。多个关键词用空格分开，#标签 只匹配标签。'],
      ['/app/summary', '当前范围内没有符合条件的任务'],
      ['/app/stats', '还没有完成的任务。完成任务后，这里会显示你的进度。'],
    ];
    for (const [path, text] of pages) {
      await page.goto(path);
      await expect(page.getByText(text).first(), path).toBeVisible();
    }
  });

  test('new tasks replace the empty state', async ({ page }) => {
    await page.goto('/app/tasks/inbox');
    await expect(page.getByText('收集箱清零，漂亮。')).toBeVisible();
    await page.locator('[data-quick-add]').fill('写周报');
    await page.keyboard.press('Enter');
    await expect(page.getByText('写周报')).toBeVisible();
    await expect(page.getByText('收集箱清零，漂亮。')).toHaveCount(0);
  });
});
