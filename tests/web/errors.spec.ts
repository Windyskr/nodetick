import { test, expect } from './fixtures';

test.describe('error states', () => {
  test('a failed first load offers a retry instead of the sign-in page', async ({ page }) => {
    await page.route('**/open/v1/project', (route) => route.fulfill({ status: 500, json: { error: 'internal server error' } }));
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('alert')).toContainText('数据加载失败');
    await expect(page.getByRole('alert')).toContainText('服务器出错了，请稍后再试。');
    await expect(page).toHaveURL(/\/app\/tasks\/inbox$/);
    await page.unroute('**/open/v1/project');
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
  });

  test('an unreachable server says so', async ({ page }) => {
    await page.route('**/open/v1/project', (route) => route.abort('connectionrefused'));
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('alert')).toContainText('无法连接服务器，请检查网络后重试。');
  });

  test('a failed save shows a toast', async ({ page }) => {
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
    await page.route('**/open/v1/task', (route) => route.fulfill({ status: 500, json: { error: 'internal server error' } }));
    await page.locator('[data-quick-add]').fill('不会被保存的任务');
    await page.keyboard.press('Enter');
    await expect(page.getByText('服务器出错了，请稍后再试。')).toBeVisible();
  });

  test('an expired session goes back to sign-in and returns afterwards', async ({ page, account }) => {
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
    await page.route('**/open/v1/task', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
    await page.locator('[data-quick-add]').fill('会话过期');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftasks%2Finbox/);
    await page.unroute('**/open/v1/task');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[type=password]').fill(account.password);
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/app\/tasks\/inbox$/);
  });

  test('going offline shows a banner until the connection returns', async ({ page, context }) => {
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: '网络已断开' })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: '网络已断开' })).toHaveCount(0);
  });

  test('a wrong password is reported in the UI language', async ({ page, account }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[type=password]').fill('not-the-password');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('邮箱或密码错误。')).toBeVisible();
  });
});
