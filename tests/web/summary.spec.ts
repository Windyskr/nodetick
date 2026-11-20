import { test, expect, post } from './fixtures';

const pad = (n: number) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test.describe('summary', () => {
  test('summarizes the week, keeps edits, and saves and applies templates', async ({ page, api, baseURL, context }) => {
    const due = `${localToday()}T00:00:00+0000`;
    const done = await post<{ id: string }>(api, baseURL!, '/open/v1/task', { title: '写周报', projectId: 'inbox', dueDate: due, isAllDay: true });
    await post(api, baseURL!, `/open/v1/project/inbox/task/${done.id}/complete`, {});
    await post(api, baseURL!, '/open/v1/task', { title: '准备评审', projectId: 'inbox', dueDate: due, isAllDay: true });

    await page.goto('/app/summary');
    const doc = page.locator('.nt-prose');
    await expect(doc.getByRole('heading', { level: 2, name: '已完成' })).toBeVisible();
    await expect(doc.getByRole('heading', { level: 2, name: '未完成' })).toBeVisible();
    await expect(doc).toContainText('写周报');
    await expect(doc).toContainText('准备评审');

    await page.getByRole('button', { name: /^分组/ }).click();
    await page.getByRole('menuitemradio', { name: '按清单' }).click();
    await expect(doc.getByRole('heading', { level: 2, name: '收集箱' })).toBeVisible();

    // An edit is kept as a draft across reloads until it is regenerated.
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(150);
    await page.keyboard.type('本周小结');
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.nt-prose')).toContainText('本周小结');
    await page.getByRole('button', { name: '重新生成' }).click();
    await expect(page.locator('.nt-prose')).not.toContainText('本周小结');
    await expect(page.locator('.nt-prose').getByRole('heading', { level: 2, name: '收集箱' })).toBeVisible();

    // Templates remember the settings.
    await page.getByRole('button', { name: '新建模板' }).click();
    await page.getByRole('textbox', { name: '名称' }).fill('周报');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const template = page.getByRole('button', { name: '周报', exact: true });
    await expect(template).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^分组/ }).click();
    await page.getByRole('menuitemradio', { name: '按优先级' }).click();
    await expect(template).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.nt-prose').getByRole('heading', { level: 2, name: '无优先级' })).toBeVisible();
    await template.click();
    await expect(page.locator('.nt-prose').getByRole('heading', { level: 2, name: '收集箱' })).toBeVisible();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: '复制' }).click();
    await expect(page.getByText('摘要已复制')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('## 收集箱');
  });
});
