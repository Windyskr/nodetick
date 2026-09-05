# Tests

Three independent layers:

| Layer | Location | Runs against | Tools |
| ----- | -------- | ------------ | ----- |
| Server integration | `worker/test/` | in-memory Workers runtime (miniflare D1) | vitest + @cloudflare/vitest-pool-workers |
| Webapp unit | `webapp/test/` | pure frontend logic in Node (no DOM) | vitest |
| **E2E via the nodetick CLI** | `tests/e2e/` | a deployed (or local `wrangler dev`) server | our own CLI (`cli/dist/index.js`) |

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
npm test -w webapp    # or: npx vitest run (inside webapp/)
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
```

### Run

```bash
# against production
NODETICK_SERVER=https://nodetick.example.workers.dev \
NODETICK_EMAIL=admin@example.com NODETICK_PASSWORD='...' \
npm run test:e2e

# against a local dev server
npx wrangler dev -w worker &
NODETICK_SERVER=http://localhost:8787 NODETICK_EMAIL=... NODETICK_PASSWORD=... npm run test:e2e
```

Credential options (in priority order):

1. `NODETICK_TOKEN` — use an existing API token (it is *not* revoked afterwards).
2. `NODETICK_EMAIL` + `NODETICK_PASSWORD` — log in over `/api/login`, mint an
   ephemeral API token via `/api/tokens` and revoke it when the run finishes.
   Also enables the session-cookie countdown cross-check.

Behavior details:

- The harness always rebuilds the CLI (`npm run build -w cli`) so suites never
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
