import type { Page } from '@playwright/test';
import { test, expect, post, type Lang } from './fixtures';
import { strayCopy } from './language';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Copy that doesn't belong to either language: digits and symbols only. */
async function seed(api: Parameters<typeof post>[0], baseURL: string) {
  const due = `${localDay()}T00:00:00+0000`;
  const open = await post<{ id: string }>(api, baseURL, '/open/v1/task', {
    title: '№1 42', projectId: 'inbox', content: '123', dueDate: due, isAllDay: true, tags: ['t1'],
    reminders: ['TRIGGER:PT0S'], repeatFlag: 'RRULE:FREQ=DAILY', items: [{ title: '1', status: 0 }, { title: '2', status: 2 }],
  });
  const done = await post<{ id: string }>(api, baseURL, '/open/v1/task', { title: '№2 7', projectId: 'inbox', dueDate: due, isAllDay: true });
  await post(api, baseURL, `/open/v1/project/inbox/task/${done.id}/complete`, {});
  await post(api, baseURL, '/open/v1/habit', { name: '💧 8' });
  await post(api, baseURL, '/open/v1/countdown', { name: '🎂 10', date: localDay(10), kind: 'birthday' });
  const start = new Date(Date.now() - 2 * 3600_000);
  await post(api, baseURL, '/open/v1/focus', { type: 0, taskId: open.id, startTime: start.toISOString(), endTime: new Date(start.getTime() + 25 * 60_000).toISOString() });
}

async function expectClean(page: Page, lang: Lang, what: string) {
  await page.waitForLoadState('networkidle');
  expect(await strayCopy(page, lang), what).toEqual([]);
}

/** Opens each dialog, menu and detail view with some data in it and checks its copy. */
async function walkDialogs(page: Page, lang: Lang, email: string) {
  const L = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  await page.goto('/app/tasks/inbox');
  await page.getByText('№1 42').first().click();
  await expect(page.getByRole('textbox', { name: L('描述', 'Description') })).toBeVisible();
  await expectClean(page, lang, 'task detail');

  await page.getByTitle(email).click();
  await page.getByRole('button', { name: L('设置', 'Settings'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'settings dialog');
  await page.keyboard.press('Escape');

  await page.getByTitle(email).click();
  await page.getByRole('button', { name: L('修改密码', 'Change password') }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'change password dialog');
  await page.keyboard.press('Escape');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: L('快捷键', 'Keyboard shortcuts') })).toBeVisible();
  await expectClean(page, lang, 'shortcuts dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: L('通知与提醒', 'Notifications & reminders') }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'notification settings');
  await page.keyboard.press('Escape');

  await page.getByTitle(L('添加过滤器', 'Add filter')).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'filter editor');
  await page.keyboard.press('Escape');

  await page.goto('/app/habit');
  await page.getByText('💧 8').first().click();
  await expect(page.getByText('💧 8').nth(1)).toBeVisible();
  await expectClean(page, lang, 'habit detail');
  await page.getByRole('button', { name: L('新建习惯', 'New habit') }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'habit form');
  await page.keyboard.press('Escape');

  await page.goto('/app/countdown');
  await page.getByText('🎂 10').first().click();
  await expectClean(page, lang, 'countdown detail');
  await page.getByRole('button', { name: L('新建倒计时', 'New countdown') }).click();
  await expectClean(page, lang, 'new countdown menu');
  await page.keyboard.press('Escape');

  await page.goto('/app/focus');
  await page.getByRole('button', { name: L('统计', 'Statistics'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'focus statistics');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: L('添加记录', 'Add record') }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectClean(page, lang, 'focus record dialog');
  await page.keyboard.press('Escape');

  await page.goto('/app/summary');
  await page.getByRole('button', { name: new RegExp(`^${L('显示内容', 'Show')}`) }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectClean(page, lang, 'summary fields menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: L('保存为', 'Save as') }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectClean(page, lang, 'summary save menu');
  await page.keyboard.press('Escape');

  for (const path of ['/app/stats', '/app/calendar', '/app/matrix']) {
    await page.goto(path);
    await expectClean(page, lang, `${path} with data`);
  }
}

test.describe('dialogs and detail views in one language', () => {
  test('Chinese', async ({ page, api, baseURL, account }) => {
    await seed(api, baseURL!);
    await walkDialogs(page, 'zh', account.email);
  });

  test.describe('English', () => {
    test.use({ lang: 'en' });
    test('English', async ({ page, api, baseURL, account }) => {
      await seed(api, baseURL!);
      await walkDialogs(page, 'en', account.email);
    });
  });
});
