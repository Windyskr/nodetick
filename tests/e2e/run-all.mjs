#!/usr/bin/env node
/**
 * End-to-end test suite: runs the nodetick CLI against a live NodeTick
 * server (deployed Worker or local `wrangler dev`) and exercises every
 * command, including auth via the real config-file path.
 *
 * Usage:
 *   NODETICK_SERVER=https://nodetick.example.workers.dev \
 *   NODETICK_EMAIL=admin@example.com NODETICK_PASSWORD=... \
 *   npm run test:e2e
 *
 * Token acquisition, in priority order:
 *   1. NODETICK_TOKEN                — use as-is (never revoked afterwards)
 *   2. NODETICK_EMAIL + NODETICK_PASSWORD  — HTTP login, mint + revoke an
 *      ephemeral dashboard token (session cookie also enables the
 *      web-dashboard-backed countdown cross-check)
 */
import {
  Harness,
  buildCli,
  httpLogin,
  httpMintToken,
  httpRevokeToken,
} from './lib.mjs';

const SERVER = (process.env.NODETICK_SERVER ?? '').replace(/\/+$/, '');
if (!SERVER) {
  console.error('Usage: NODETICK_SERVER=https://your-worker NODETICK_EMAIL=... NODETICK_PASSWORD=... npm run test:e2e');
  process.exit(2);
}

console.log(`NodeTick E2E — nodetick CLI vs ${SERVER}\n`);
buildCli();

const h = new Harness(SERVER);

// --- Acquire credentials (HTTP-level, not part of the CLI test surface) ---
let session = null; // { cookie } | null — only available when we log in
let mintedTokenId = null;
let token;

if (process.env.NODETICK_TOKEN) {
  token = process.env.NODETICK_TOKEN;
  console.log('[setup] using NODETICK_TOKEN from environment');
} else if (process.env.NODETICK_EMAIL && process.env.NODETICK_PASSWORD) {
  const email = process.env.NODETICK_EMAIL;
  const password = process.env.NODETICK_PASSWORD;
  console.log(`[setup] logging in as ${email}`);
  const cookie = await httpLogin(SERVER, email, password);
  session = { cookie };
  const minted = await httpMintToken(SERVER, cookie, `${h.pfx}-cli`);
  token = minted.token;
  mintedTokenId = minted.id;
  console.log('[setup] ephemeral dashboard token minted');
} else {
  console.error('Provide NODETICK_TOKEN, or NODETICK_EMAIL + NODETICK_PASSWORD.');
  process.exit(2);
}

const ctx = { h, server: SERVER, session, token };

const suites = [
  ['auth', () => import('./suites/auth.e2e.mjs')],
  ['project', () => import('./suites/project.e2e.mjs')],
  ['task', () => import('./suites/task.e2e.mjs')],
  ['tag', () => import('./suites/tag.e2e.mjs')],
  ['habit', () => import('./suites/habit.e2e.mjs')],
  ['focus', () => import('./suites/focus.e2e.mjs')],
  ['countdown', () => import('./suites/countdown.e2e.mjs')],
];

for (const [name, load] of suites) {
  console.log(`\n— ${name} —`);
  const mod = await load();
  await mod.run(ctx);
}

// auth cleanup tests run last (logout invalidates the CLI-side token).
{
  console.log('\n— auth (teardown) —');
  const mod = await import('./suites/auth.e2e.mjs');
  await mod.runTeardown(ctx);
}

// --- Teardown ---
try {
  if (mintedTokenId && session) {
    await httpRevokeToken(SERVER, session.cookie, mintedTokenId);
    console.log('\n[teardown] ephemeral token revoked');
  }
} finally {
  h.cleanup();
}

process.exit(h.report() === 0 ? 0 : 1);
