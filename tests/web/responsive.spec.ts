import { test, expect, expectNoHorizontalOverflow, post } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.describe('phone-sized screens', () => {
  test('the list sidebar is a drawer and task details open full screen', async ({ page, api, baseURL }) => {
    await post(api, baseURL!, '/open/v1/task', { projectId: 'inbox', title: '手机上看的任务' });
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
    // The drawer opens from the header button and closes after picking a list.
    await page.getByRole('button', { name: '清单' }).first().click();
    await page.getByText('今天', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/tasks\/today$/);
    await page.goto('/app/tasks/inbox');
    await page.getByText('手机上看的任务').click();
    await expect(page.getByRole('button', { name: '关闭' })).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
  });

  for (const path of ['/app/tasks/inbox', '/app/calendar', '/app/matrix', '/app/search', '/app/summary', '/app/habit', '/app/focus', '/app/countdown', '/app/tokens', '/app/stats']) {
    test(`${path} fits the screen width`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    });
  }
});
