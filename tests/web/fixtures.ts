import { test as base, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const ADMIN = {
  email: process.env.E2E_EMAIL ?? 'e2e-admin@example.com',
  password: process.env.E2E_PASSWORD ?? 'e2e-admin-password',
};
export const ADMIN_STATE = fileURLToPath(new URL('../../test-results/web-admin-state.json', import.meta.url));

export type Lang = 'zh' | 'en';

interface Fixtures {
  /** UI language for the test (stored like the language switch does). */
  lang: Lang;
  /** A fresh, empty account created for this test and deleted afterwards. */
  account: { email: string; password: string };
  /** Same-origin API calls with the test account's session (cookie auth). */
  api: APIRequestContext;
  /** The page, signed in as `account`. */
  page: Page;
}

export const test = base.extend<Fixtures>({
  lang: ['zh', { option: true }],

  account: async ({ baseURL }, use) => {
    const admin = await request.newContext({ baseURL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: baseURL! } });
    const email = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'e2e-user-password';
    const created = await admin.post('/api/admin/users', { data: { email, password, admin: false } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    await use({ email, password });
    await admin.delete(`/api/admin/users/${id}`);
    await admin.dispose();
  },

  page: async ({ page, context, baseURL, account, lang }, use) => {
    await context.addInitScript((value) => window.localStorage.setItem('ntk_lang', value), lang);
    const res = await context.request.post('/api/login', { data: account, headers: { Origin: baseURL! } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await use(page);
  },

  // context.request shares the browser context's cookies: depending on
  // `page` makes sure the session exists first. Listing projects once
  // creates the inbox, as the web app's first load does.
  api: async ({ context, page, baseURL }, use) => {
    void page;
    const projects = await context.request.get('/open/v1/project', { headers: { Origin: baseURL! } });
    expect(projects.ok()).toBeTruthy();
    await use(context.request);
  },
});

export { expect };

/** POST JSON to the API as the signed-in user. */
export async function post<T = Record<string, unknown>>(api: APIRequestContext, baseURL: string, path: string, data: unknown): Promise<T> {
  const res = await api.post(path, { data, headers: { Origin: baseURL } });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** The page can't be scrolled sideways: nothing overflows the viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}
