import { test, expect } from './fixtures';

test.describe('keyboard shortcuts', () => {
  test('? lists the shortcuts and G + a letter opens a view', async ({ page }) => {
    await page.goto('/app/tasks/inbox');
    await expect(page.getByRole('heading', { name: '收集箱' })).toBeVisible();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: '快捷键' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('添加任务');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/app\/calendar$/);
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/app\/tasks\/today$/);
  });

  test('letters typed into a field stay in the field', async ({ page }) => {
    await page.goto('/app/tasks/inbox');
    const input = page.locator('[data-quick-add]');
    await input.click();
    await page.keyboard.type('gc?');
    await expect(input).toHaveValue('gc?');
    await expect(page).toHaveURL(/\/app\/tasks\/inbox$/);
    await expect(page.getByRole('dialog', { name: '快捷键' })).toHaveCount(0);
  });

  test('the account menu opens the list too', async ({ page }) => {
    await page.goto('/app/tasks/inbox');
    await page.locator('button[title*="@"]').first().click();
    await page.getByRole('button', { name: '快捷键' }).click();
    await expect(page.getByRole('dialog', { name: '快捷键' })).toBeVisible();
  });
});
