import { request, type FullConfig } from '@playwright/test';
import { ADMIN, ADMIN_STATE } from './fixtures';

/** Sign the admin in (registering it on a fresh server) and keep the session for the specs. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  let res = await api.post('/api/login', { data: ADMIN });
  if (!res.ok()) {
    res = await api.post('/api/register', { data: ADMIN });
    if (!res.ok()) throw new Error(`cannot sign in or register ${ADMIN.email}: ${res.status()} ${await res.text()}`);
  }
  await api.storageState({ path: ADMIN_STATE });
  await api.dispose();
}
