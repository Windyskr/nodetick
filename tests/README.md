# Tests

Four independent layers:

| Layer | Location | Runs against | Tools |
| ----- | -------- | ------------ | ----- |
| Server integration | `worker/test/` | in-memory Workers runtime (miniflare D1) | vitest + @cloudflare/vitest-pool-workers |
| Webapp unit | `webapp/test/` | pure frontend logic in Node (no DOM) | vitest |
| **E2E via the nodetick CLI** | `tests/e2e/` | a deployed (or local `wrangler dev`) server | our own CLI (`cli/dist/index.js`) |
| **Browser E2E** | `tests/web/` | the production build of the web app on a local worker (or a deployment) | Playwright (`@playwright/test`) + Google Chrome |

## Webapp unit tests (`webapp/test/`)

Covers the frontend logic that has no DOM dependency, so it runs in plain Node:

- `quickparse.test.ts` — the smart quick-add parser: zh/en date tokens
  (今天/明天/后天/下周/周X, M月D日/号, today/tomorrow/next week/weekdays),
  M-D / M/D with past-date year rollover, ISO dates, calendar validity
  (rejects 2月30日), priority tokens (`!0`–`!3`, `!高 !中 !低 !无`,
  `!high !medium !med !low !none`), tags, combinations, whitespace handling
- `date.test.ts` — date buckets (overdue/today/tomorrow/next7/later/nodate),
  localized rendering (short dates, detail dates, weekdays, durations,
  relative times), rollover arithmetic, stamps
- `i18n.test.ts` — en/zh dictionary parity (no missing/extra/empty keys),
  TickTick-canonical zh terms, `{0}` placeholder interpolation, server-error
  localization mapping

```bash
pnpm --filter webapp test    # or: pnpm exec vitest run (inside webapp/)
```

## E2E: nodetick CLI against a live server (`tests/e2e/`)

The runner rebuilds the CLI from source, then exercises **every command** —
including the auth flow through the real config file — against the target
server.

Test case files:

```
tests/e2e/
  lib.mjs                  harness: CLI runner (isolated HOME, env vars
                           stripped), assertions, CLI build step, HTTP helpers
                           (/api/* register+login, token mint+revoke,
                           session-cookie countdown create)
  run-all.mjs              entry point: setup -> all suites -> teardown -> report
  suites/
    auth.e2e.mjs           status / token install (writes config) / logout /
                           unauthenticated errors
    project.e2e.mjs        create/get/update/delete, data, groups, kanban columns
    task.e2e.mjs           create (all flags), get, update (parent link/unlink,
                           focus summaries), complete, completed, filter, search,
                           move (single+batch), comments, delete, error cases
    tag.e2e.mjs            create, list, label upsert
    habit.e2e.mjs          create (all flags), get, update, checkin upsert,
                           checkins range queries
    focus.e2e.mjs          create (pomodoro/timing, duration auto-calc), get,
                           list (30-day window enforcement), delete
    countdown.e2e.mjs      create / update / delete / list, dashboard
                           cross-check (needs session)
    backup.e2e.mjs         export to file, import round-trip (nothing
                           skipped), foreign / invalid file errors
```

### Run

```bash
# against production
NODETICK_SERVER=https://nodetick.example.workers.dev \
NODETICK_EMAIL=admin@example.com NODETICK_PASSWORD='...' \
pnpm test:e2e

# against a local dev server
pnpm dev &
NODETICK_SERVER=http://localhost:8787 NODETICK_EMAIL=... NODETICK_PASSWORD=... pnpm test:e2e
```

Credential options (in priority order):

1. `NODETICK_TOKEN` — use an existing API token (it is *not* revoked afterwards).
2. `NODETICK_EMAIL` + `NODETICK_PASSWORD` — log in over `/api/login`, mint an
   ephemeral API token via `/api/tokens` and revoke it when the run finishes.
   Also enables the session-cookie countdown cross-check.

Behavior details:

- The harness always rebuilds the CLI (`pnpm --filter cli build`) so suites never
  run against a stale build.
- Every CLI invocation uses an **isolated HOME** with `NODETICK_SERVER` /
  `NODETICK_TOKEN` stripped from the environment: the suite exercises the real
  config-file path (`~/.config/nodetick/config.json`) that
  `auth token --server` writes.
- Cleanup: fixture projects/tasks/focus records/countdowns are deleted through
  the CLI; the ephemeral token is revoked. Habits and tags have no delete API
  (by design, matching the read-mostly official surface), so they accumulate
  under the test account, named `e2e-<runid>-…`.
- `auth login` (browser OAuth) is intentionally not exercised by the suite; the
  token path covers the same server-side auth.

## Browser E2E: the web app (`tests/web/`)

Drives the production build of the SPA in a real browser and checks the
states unit tests can't see: loading, failures, empty accounts, phone-sized
screens and stray strings from the other language.

```
tests/web/
  playwright.config.ts   one worker, Google Chrome, traces and screenshots on failure
  server.mjs             wrangler dev on port 8798 with a throwaway D1 directory
  global-setup.ts        registers (or signs in) the admin account
  fixtures.ts            `account` (a fresh user per test, deleted afterwards),
                         `page` (signed in as it), `lang`, `api`, helpers
  states.spec.ts         first-load spinner, empty state on every page, empty
                         state replaced by new tasks
  errors.spec.ts         failed first load → retry screen (not the sign-in page),
                         unreachable server, failed save toast, expired session →
                         sign-in and back, offline banner, wrong password
  responsive.spec.ts     390 px wide: list drawer, full-screen task detail, no
                         horizontal scrolling on any page
  language.spec.ts       no English copy in the Chinese UI and no Chinese in the
                         English UI (code samples, URLs and e-mails excepted)
  shortcuts.spec.ts      `?` panel, `G` + letter navigation, keys typed into fields
                         stay there, the account-menu entry
```

```bash
pnpm test:web                         # builds the SPA, starts a local worker, runs everything
pnpm exec playwright test -c tests/web/playwright.config.ts errors   # one spec, no rebuild

# against a deployment (needs an admin account; users created by the tests are deleted)
E2E_BASE_URL=https://nodetick.example.workers.dev E2E_EMAIL=admin@example.com E2E_PASSWORD='...' \
  pnpm exec playwright test -c tests/web/playwright.config.ts
```

- Uses the installed Google Chrome (`channel: 'chrome'`). Without it, run
  `pnpm exec playwright install chromium` once and set `E2E_CHANNEL=chromium`.
- `E2E_PORT` moves the local server off 8798 (its inspector uses the port + 1000).
- Failures leave a screenshot and a trace under `test-results/web/`
  (`pnpm exec playwright show-trace <trace.zip>`).
