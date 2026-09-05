import { afterEach, describe, expect, it } from 'vitest';
import { env, reset, SELF } from 'cloudflare:test';
import { issueApiToken } from '../src/auth.js';
import { pushConfigured } from '../src/services/notifications.js';

// The Vitest 4 Cloudflare integration no longer exposes the old implicit
// per-test storage option. Reset bindings explicitly so every test retains
// the isolation assumed by this suite.
afterEach(async () => {
  await reset();
});

const HOST = 'https://nodetick.test';
const EMAIL = 'admin@example.com';
const PASSWORD = 'hunter2hunter2';

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function form(params: Record<string, string>) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  };
}

function json(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/** Register the first (admin) user and mint an API token via /api. */
async function bootstrap(): Promise<{ token: string; cookie: string }> {
  // Each test gets a fresh D1, so this user is always the first (admin) one.
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    ...json({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  expect(reg.status).toBe(200);
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  expect(cookie).toMatch(/^ntk_session=/);

  const created = await SELF.fetch(`${HOST}/api/tokens`, {
    ...json({ name: 'test' }, { Cookie: cookie }),
  });
  expect(created.status).toBe(200);
  const token = ((await created.json()) as { token: string }).token;
  expect(token).toMatch(/^ntk_[0-9a-f]{64}$/);
  return { token, cookie };
}

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

describe('auth', () => {
  it('rejects unauthenticated API calls', async () => {
    const res = await SELF.fetch(`${HOST}/open/v1/project`);
    expect(res.status).toBe(401);
  });

  // Each failed login sleeps 300 ms server-side, so the 10+ sequential
  // attempts legitimately exceed vitest's default per-test timeout.
  it('locks out an IP after repeated failed logins and writes audit events', { timeout: 30_000 }, async () => {
    await bootstrap();
    // Lockout state lives in login_attempts_ip keyed by IP; vitest-pool-workers
    // gives each test a distinct loopback caller, so use a marker header-free
    // flow: hammer /api/login until 429 appears (CF-Connecting-IP is stable in
    // the test runtime, so this exercises the real counter).
    let saw429 = false;
    for (let i = 0; i < 14; i++) {
      const res = await SELF.fetch(`${HOST}/api/login`, json({ email: EMAIL, password: 'definitely-wrong' }));
      if (res.status === 429) {
        saw429 = true;
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain('Too many failed login attempts');
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(saw429).toBe(true);

    // Audit trail recorded the failures (written even as requests failed).
    // The 10th failure flips to a 'login.locked' event, so failed count is
    // LOGIN_MAX_ATTEMPTS - 1 or more depending on prior tests sharing the IP.
    const events = await env.DB.prepare('SELECT action, level FROM audit_events ORDER BY id').all<{
      action: string;
      level: string;
    }>();
    const actions = events.results.map((e) => e.action);
    expect(actions.filter((a) => a === 'login.failed').length).toBeGreaterThanOrEqual(8);
    expect(actions).toContain('login.locked');
  });

  it('rejects a weak or missing SESSION_SECRET instead of signing with it', async () => {
    const { createSession } = await import('../src/auth.js');
    const weakEnv = { DB: env.DB } as unknown as Parameters<typeof createSession>[0]['env'];
    const fakeCtx = {
      env: weakEnv,
      req: { url: `${HOST}/`, header: () => undefined },
      header: () => undefined,
    };
    await expect(createSession(fakeCtx as never, 'u1')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('rejects oversized request bodies with 413', async () => {
    const { token } = await bootstrap();
    const big = 'x'.repeat(1024 * 1024 + 100);
    const res = await SELF.fetch(`${HOST}/open/v1/task/filter`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ keywords: big }),
    });
    expect(res.status).toBe(413);
  });

  it('caps chunked request bodies before JSON parsing', async () => {
    const { token } = await bootstrap();
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024 + 1));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await SELF.fetch(new Request(`${HOST}/open/v1/task/filter`, {
      method: 'POST',
      headers: auth(token),
      body,
    }));
    expect(res.status).toBe(413);
    await res.text();
  });

  it('locks an account even when failed logins rotate the source IP', { timeout: 30_000 }, async () => {
    await bootstrap();
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch(`${HOST}/api/login`, {
        ...json({ email: EMAIL, password: 'definitely-wrong' }, {
          'CF-Connecting-IP': `198.51.100.${i + 1}`,
        }),
      });
      if (i < 9) {
        expect(res.status).toBe(401);
      } else {
        expect(res.status).toBe(429);
      }
    }
    const newIp = await SELF.fetch(`${HOST}/api/login`, {
      ...json({ email: EMAIL, password: 'definitely-wrong' }, {
        'CF-Connecting-IP': '203.0.113.99',
      }),
    });
    expect(newIp.status).toBe(429);
  });

  it('starts a fresh failure window after a lockout expires', async () => {
    await bootstrap();
    const ip = '198.51.100.240';
    await env.DB.prepare(
      'INSERT INTO login_attempts_ip (ip, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind(`ip:${ip}`, 10, Date.now() - 1, Date.now() - 1)
      .run();

    const res = await SELF.fetch(`${HOST}/api/login`, {
      ...json({ email: EMAIL, password: 'definitely-wrong' }, { 'CF-Connecting-IP': ip }),
    });
    expect(res.status).toBe(401);
    const row = await env.DB.prepare('SELECT attempts, locked_until FROM login_attempts_ip WHERE ip = ?')
      .bind(`ip:${ip}`)
      .first<{ attempts: number; locked_until: number | null }>();
    expect(row?.attempts).toBe(1);
    expect(row?.locked_until).toBeNull();
  });

  it('allows only one concurrent registration to become the first admin', async () => {
    const responses = await Promise.all([
      SELF.fetch(`${HOST}/api/register`, json({ email: 'race-a@example.com', password: PASSWORD })),
      SELF.fetch(`${HOST}/api/register`, json({ email: 'race-b@example.com', password: PASSWORD })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
    const admins = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').first<{ count: number }>();
    expect(admins?.count).toBe(1);
  });

  it('rejects cross-origin cookie writes and malformed Authorization headers', async () => {
    const { cookie } = await bootstrap();
    const blocked = await SELF.fetch(`${HOST}/api/tokens`, {
      ...json({ name: 'blocked' }, { Cookie: cookie, Origin: 'https://evil.example' }),
    });
    expect(blocked.status).toBe(403);

    const allowed = await SELF.fetch(`${HOST}/api/tokens`, {
      ...json({ name: 'same-origin' }, { Cookie: cookie, Origin: HOST }),
    });
    expect(allowed.status).toBe(200);

    const confused = await SELF.fetch(`${HOST}/open/v1/project`, {
      headers: { Cookie: cookie, Authorization: 'Basic not-a-bearer' },
    });
    expect(confused.status).toBe(401);
  });

  it('caps batch move arrays', async () => {
    const { token } = await bootstrap();
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Batch work' }),
      })
    ).json()) as Record<string, unknown>;
    const moves = Array.from({ length: 101 }, (_, i) => ({
      fromProjectId: project.id,
      toProjectId: project.id,
      taskId: `t${i}`,
    }));
    const res = await SELF.fetch(`${HOST}/open/v1/task/move`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify(moves),
    });
    expect(res.status).toBe(413);
  });

  it('creates, lists, updates and deletes saved filters', async () => {
    const { token } = await bootstrap();
    const createdRes = await SELF.fetch(`${HOST}/open/v1/filter`, {
      ...json({
        name: '重要且紧急',
        logic: 'or',
        dateMode: 'custom',
        dateStart: '2026-09-01',
        dateEnd: '2026-09-07',
        projectIds: ['inbox'],
        tags: ['work'],
        priorities: [3],
        statuses: [0],
      }, auth(token)),
    });
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as Record<string, unknown>;
    expect(created.name).toBe('重要且紧急');
    expect(created.logic).toBe('or');
    expect(created.dateMode).toBe('custom');
    expect(created.dateStart).toBe('2026-09-01');
    expect(created.priorities).toEqual([3]);

    const listed = (await (
      await SELF.fetch(`${HOST}/open/v1/filter`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(listed.map((filter) => filter.id)).toContain(created.id);

    const updatedRes = await SELF.fetch(`${HOST}/open/v1/filter/${created.id}`, {
      ...json({ name: '本周高优先级', logic: 'and', dateMode: 'week', priorities: [3, 2] }, auth(token)),
    });
    expect(updatedRes.status).toBe(200);
    const updated = (await updatedRes.json()) as Record<string, unknown>;
    expect(updated.name).toBe('本周高优先级');
    expect(updated.logic).toBe('and');
    expect(updated.dateMode).toBe('week');
    expect(updated.priorities).toEqual([3, 2]);
    expect(updated.projectIds).toEqual(['inbox']);

    const deleted = await SELF.fetch(`${HOST}/open/v1/filter/${created.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(deleted.status).toBe(200);
    const afterDelete = (await (
      await SELF.fetch(`${HOST}/open/v1/filter`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(afterDelete.map((filter) => filter.id)).not.toContain(created.id);
  });

  it('rotates the session id on login (session-fixation defense)', async () => {
    const { cookie } = await bootstrap();
    // login again with the same session cookie: a fresh session id must be
    // issued and the old one invalidated
    const res = await SELF.fetch(`${HOST}/api/login`, {
      ...json({ email: EMAIL, password: PASSWORD }, { Cookie: cookie }),
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    const fresh = res.headers.get('set-cookie')!.split(';')[0];
    expect(fresh).not.toBe(cookie);
    // old cookie no longer authenticates
    const old = await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } });
    expect(old.status).toBe(401);
    // new one works
    const neu = await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: fresh } });
    expect(neu.status).toBe(200);
  });

  it('rejects bad credentials', async () => {
    const res = await SELF.fetch(`${HOST}/api/login`, json({ email: EMAIL, password: 'wrong-password' }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid email or password');
  });

  it('accepts the session cookie on /open/v1 in place of a Bearer token', async () => {
    const { cookie } = await bootstrap();
    const res = await SELF.fetch(`${HOST}/open/v1/project`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it('locks registration to the first user without an invite code', async () => {
    // First user registers freely.
    const first = await SELF.fetch(`${HOST}/api/register`, {
      ...json({ email: EMAIL, password: PASSWORD }),
      redirect: 'manual',
    });
    expect(first.status).toBe(200);

    // Second user requires an invite code (none configured in tests).
    const second = await SELF.fetch(
      `${HOST}/api/register`,
      json({ email: 'second@example.com', password: 'longenough1' }),
    );
    expect(second.status).toBe(403);
    expect(await second.text()).toContain('invite code');
  });

  it('rate limits registration attempts by client IP', async () => {
    const ip = '198.51.100.241';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await SELF.fetch(`${HOST}/api/register`, {
        ...json({ email: `rate-limit-${i}@example.com`, password: PASSWORD }, {
          'CF-Connecting-IP': ip,
        }),
        redirect: 'manual',
      });
      statuses.push(response.status);
      if (i < 1) {
        expect(response.status).toBe(200);
      } else if (i < 5) {
        expect(response.status).toBe(403);
      } else {
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBeTruthy();
      }
    }
    expect(statuses).toEqual([200, 403, 403, 403, 403, 429]);
  });

  it('auto-creates the inbox project and accepts writes into it', async () => {
    const { token, cookie } = await bootstrap();
    // first listing materializes the fixed-id inbox project
    const projects = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    const inbox = projects.find((p) => p.id === 'inbox');
    expect(inbox?.name).toBe('Inbox');

    // second listing does not duplicate it
    const again = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(again.filter((p) => p.id === 'inbox')).toHaveLength(1);

    // task create + cookie-authed read inside inbox
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Inbox item', projectId: 'inbox' }),
      })
    ).json()) as Record<string, unknown>;
    expect(task.projectId).toBe('inbox');

    const viaCookie = (await (
      await SELF.fetch(`${HOST}/open/v1/task/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: [0] }),
      })
    ).json()) as Record<string, unknown>[];
    expect(viaCookie.map((t) => t.id)).toContain(task.id);
  });

  it('gives each user an independent logical inbox', async () => {
    const { token } = await bootstrap();
    const first = await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) });
    expect(first.status).toBe(200);

    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('second-user', 'second@example.com', 'test-only', '22'.repeat(16), 0, Date.now())
      .run();
    const secondToken = await issueApiToken(env.DB, 'second-user', 'test');
    const second = await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(secondToken) });
    expect(second.status).toBe(200);
    const secondProjects = (await second.json()) as Record<string, unknown>[];
    expect(secondProjects.filter((project) => project.id === 'inbox')).toHaveLength(1);

    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?')
      .bind('inbox')
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it('flips status 0 ↔ 2 via POST /task/:id (complete + uncomplete)', async () => {
    const { token } = await bootstrap();
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Status work' }),
      })
    ).json()) as Record<string, unknown>;
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Flip me', projectId: project.id }),
      })
    ).json()) as Record<string, unknown>;

    // complete via status
    const done = (await (
      await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectId: project.id, status: 2 }),
      })
    ).json()) as Record<string, unknown>;
    expect(done.status).toBe(2);
    expect(done.completedTime).toBeTruthy();

    // invalid status rejected
    const bad = await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ projectId: project.id, status: 1 }),
    });
    expect(bad.status).toBe(400);

    // uncomplete clears completedTime
    const undone = (await (
      await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectId: project.id, status: 0 }),
      })
    ).json()) as Record<string, unknown>;
    expect(undone.status).toBe(0);
    expect(undone.completedTime).toBeNull();
  });

  it('searches titles, content and desc', async () => {
    const { token } = await bootstrap();
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Search work' }),
      })
    ).json()) as Record<string, unknown>;
    await SELF.fetch(`${HOST}/open/v1/task`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Buy oat milk', projectId: project.id, content: 'barista oat brand' }),
    });
    await SELF.fetch(`${HOST}/open/v1/task`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Plan offsite', projectId: project.id, desc: 'venue shortlist oats farm' }),
    });

    const byTitle = (await (
      await SELF.fetch(`${HOST}/open/v1/task/search`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ keywords: 'offsite' }),
      })
    ).json()) as Record<string, unknown>[];
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0].title).toBe('Plan offsite');

    const byContent = (await (
      await SELF.fetch(`${HOST}/open/v1/task/search`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ keywords: 'barista' }),
      })
    ).json()) as Record<string, unknown>[];
    expect(byContent.map((t) => t.title)).toEqual(['Buy oat milk']);

    const byDesc = (await (
      await SELF.fetch(`${HOST}/open/v1/task/search`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ keywords: 'oats' }),
      })
    ).json()) as Record<string, unknown>[];
    expect(byDesc.map((t) => t.title)).toEqual(['Plan offsite']);
  });

  it('rejects trash operations on unknown ids', async () => {
    const { token } = await bootstrap();
    const ghost = '0'.repeat(24);
    const restore = await SELF.fetch(`${HOST}/open/v1/task/trash/${ghost}/restore`, {
      method: 'POST',
      headers: auth(token),
    });
    expect(restore.status).toBe(404);
    const purge = await SELF.fetch(`${HOST}/open/v1/task/trash/${ghost}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(purge.status).toBe(404);
  });

  it('covers the trash flow: soft delete, restore, purge', async () => {    const { token } = await bootstrap();
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Trash work' }),
      })
    ).json()) as Record<string, unknown>;
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Throwaway', projectId: project.id }),
      })
    ).json()) as Record<string, unknown>;

    // delete → gone from the project data, present in the trash
    const delRes = await SELF.fetch(`${HOST}/open/v1/project/${project.id}/task/${task.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(delRes.status).toBe(200);
    const trash = (await (
      await SELF.fetch(`${HOST}/open/v1/task/trash`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(trash.map((t) => t.id)).toContain(task.id);

    // restore → active again
    const restored = (await (
      await SELF.fetch(`${HOST}/open/v1/task/trash/${task.id}/restore`, {
        method: 'POST',
        headers: auth(token),
      })
    ).json()) as Record<string, unknown>;
    expect(restored.deletedTime).toBeNull();
    const filtered = (await (
      await SELF.fetch(`${HOST}/open/v1/task/filter`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectIds: [project.id], status: [0] }),
      })
    ).json()) as Record<string, unknown>[];
    expect(filtered.map((t) => t.id)).toContain(task.id);

    // delete again + purge → gone everywhere
    await SELF.fetch(`${HOST}/open/v1/project/${project.id}/task/${task.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    const purge = await SELF.fetch(`${HOST}/open/v1/task/trash/${task.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(purge.status).toBe(200);
    const trash2 = (await (
      await SELF.fetch(`${HOST}/open/v1/task/trash`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(trash2).toHaveLength(0);
  });
});

describe('tasks / projects / tags', () => {
  it('covers the full task lifecycle', async () => {
    const { token } = await bootstrap();

    // project create
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Work', color: '#F18181', viewMode: 'kanban' }),
      })
    ).json()) as Record<string, unknown>;
    expect(project.name).toBe('Work');

    // task create with tags, items, dates
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          title: 'Buy milk',
          projectId: project.id,
          priority: 3,
          dueDate: '2026-09-10T09:00:00+0000',
          tags: ['groceries'],
          items: [{ title: 'oat milk' }, { title: 'bread' }],
          reminders: ['TRIGGER:-PT60M'],
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(task.title).toBe('Buy milk');
    expect(task.priority).toBe(3);
    expect((task.items as unknown[]).length).toBe(2);
    expect(task.tags).toEqual(['groceries']);

    // task get
    const got = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${project.id}/task/${task.id}`, {
        headers: auth(token),
      })
    ).json()) as Record<string, unknown>;
    expect(got.id).toBe(task.id);

    // task update (title + estimated pomo)
    const updated = (await (
      await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          id: task.id,
          projectId: project.id,
          title: 'Buy oat milk',
          focusSummaries: [{ estimatedPomo: 2, estimatedDuration: 3000 }],
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(updated.title).toBe('Buy oat milk');
    expect((updated.focusSummaries as Record<string, unknown>[])[0].estimatedPomo).toBe(2);

    // filter by project
    const filtered = (await (
      await SELF.fetch(`${HOST}/open/v1/task/filter`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectIds: [project.id], status: [0] }),
      })
    ).json()) as Record<string, unknown>[];
    expect(filtered.map((t) => t.id)).toContain(task.id);

    // search by keyword
    const found = (await (
      await SELF.fetch(`${HOST}/open/v1/task/search`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ keywords: 'oat' }),
      })
    ).json()) as Record<string, unknown>[];
    expect(found.map((t) => t.id)).toContain(task.id);

    // comments
    const comment = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${project.id}/task/${task.id}/comment`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Done shopping' }),
      })
    ).json()) as Record<string, unknown>;
    expect(comment.title).toBe('Done shopping');
    const comments = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${project.id}/task/${task.id}/comments`, {
        headers: auth(token),
      })
    ).json()) as Record<string, unknown>[];
    expect(comments).toHaveLength(1);

    // move to a second project
    const project2 = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Personal' }),
      })
    ).json()) as Record<string, unknown>;
    const moved = (await (
      await SELF.fetch(`${HOST}/open/v1/task/move`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify([
          { fromProjectId: project.id, toProjectId: project2.id, taskId: task.id },
        ]),
      })
    ).json()) as Record<string, unknown>[];
    expect(moved[0].projectId).toBe(project2.id);

    // complete + completed listing
    const completeRes = await SELF.fetch(
      `${HOST}/open/v1/project/${project2.id}/task/${task.id}/complete`,
      { method: 'POST', headers: auth(token) },
    );
    expect(completeRes.status).toBe(200);
    const completed = (await (
      await SELF.fetch(`${HOST}/open/v1/task/completed`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectIds: [project2.id] }),
      })
    ).json()) as Record<string, unknown>[];
    expect(completed.map((t) => t.id)).toContain(task.id);
    expect(completed.find((t) => t.id === task.id)!.status).toBe(2);

    // delete
    const delRes = await SELF.fetch(`${HOST}/open/v1/project/${project2.id}/task/${task.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(delRes.status).toBe(200);

    // tag created implicitly by task create
    const tags = (await (
      await SELF.fetch(`${HOST}/open/v1/tag`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(tags.map((t) => t.name)).toContain('groceries');

    // project data
    const data = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${project.id}/data`, { headers: auth(token) })
    ).json()) as Record<string, unknown>;
    expect((data.project as Record<string, unknown>).id).toBe(project.id);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(Array.isArray(data.columns)).toBe(true);
  });

  it('stores task time ranges and rejects an end before the start', async () => {
    const { token } = await bootstrap();
    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Time blocks' }),
      })
    ).json()) as Record<string, unknown>;
    const start = '2026-09-10T09:00:00+0800';
    const end = '2026-09-10T11:30:00+0800';
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          title: 'Design review',
          projectId: project.id,
          startDate: start,
          dueDate: end,
          isAllDay: false,
          timeZone: 'Asia/Singapore',
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(task.startDate).toBe(start);
    expect(task.dueDate).toBe(end);
    expect(task.isAllDay).toBe(false);
    expect(task.timeZone).toBe('Asia/Singapore');

    const invalidCreate = await SELF.fetch(`${HOST}/open/v1/task`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        title: 'Invalid range',
        projectId: project.id,
        startDate: end,
        dueDate: start,
      }),
    });
    expect(invalidCreate.status).toBe(400);

    const invalidUpdate = await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ projectId: project.id, startDate: '2026-09-10T12:00:00+0800' }),
    });
    expect(invalidUpdate.status).toBe(400);
  });

  it('manages project groups and columns', async () => {
    const { token } = await bootstrap();
    const group = (await (
      await SELF.fetch(`${HOST}/open/v1/project/group`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Life' }),
      })
    ).json()) as Record<string, unknown>;
    expect(group.name).toBe('Life');

    const project = (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Home', groupId: group.id }),
      })
    ).json()) as Record<string, unknown>;

    const groups = (await (
      await SELF.fetch(`${HOST}/open/v1/project/group`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(groups).toHaveLength(1);

    const column = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${project.id}/column`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'In progress' }),
      })
    ).json()) as Record<string, unknown>;
    expect(column.projectId).toBe(project.id);

    const delGroup = await SELF.fetch(`${HOST}/open/v1/project/group/${group.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(delGroup.status).toBe(200);
  });

  it('does not retain parent or column references across project moves', async () => {
    const { token } = await bootstrap();
    const createProject = async (name: string) => (await (
      await SELF.fetch(`${HOST}/open/v1/project`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name }),
      })
    ).json()) as Record<string, unknown>;
    const first = await createProject('First');
    const second = await createProject('Second');
    const column = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${first.id}/column`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Doing' }),
      })
    ).json()) as Record<string, unknown>;
    const parent = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectId: first.id, title: 'Parent' }),
      })
    ).json()) as Record<string, unknown>;
    const child = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          projectId: first.id,
          title: 'Child',
          parentId: parent.id,
          columnId: column.id,
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(child.parentId).toBe(parent.id);
    expect(child.columnId).toBe(column.id);
    const grandchild = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ projectId: first.id, title: 'Grandchild', parentId: child.id }),
      })
    ).json()) as Record<string, unknown>;
    expect(grandchild.parentId).toBe(child.id);

    const moved = (await (
      await SELF.fetch(`${HOST}/open/v1/task/move`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify([{ fromProjectId: first.id, toProjectId: second.id, taskId: child.id }]),
      })
    ).json()) as Record<string, unknown>[];
    expect(moved[0].projectId).toBe(second.id);
    expect(moved[0].parentId).toBeNull();
    expect(moved[0].columnId).toBeNull();

    const remaining = (await (
      await SELF.fetch(`${HOST}/open/v1/project/${first.id}/task/${grandchild.id}`, {
        headers: auth(token),
      })
    ).json()) as Record<string, unknown>;
    expect(remaining.parentId).toBeNull();

    const parentRow = await env.DB.prepare('SELECT child_ids FROM tasks WHERE id = ?').bind(parent.id).first<{ child_ids: string | null }>();
    expect(parentRow?.child_ids ?? '').not.toContain(String(child.id));
  });
});

describe('habits / focus / countdown', () => {
  it('covers habit check-ins', async () => {
    const { token } = await bootstrap();
    const habit = (await (
      await SELF.fetch(`${HOST}/open/v1/habit`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          name: 'Drink water',
          goal: 8,
          unit: 'cups',
          repeatRule: 'RRULE:FREQ=DAILY;INTERVAL=1',
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(habit.repeatRule).toBe('RRULE:FREQ=DAILY;INTERVAL=1');

    const agg = (await (
      await SELF.fetch(`${HOST}/open/v1/habit/${habit.id}/checkin`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ stamp: 20260801, value: 5, goal: 8 }),
      })
    ).json()) as Record<string, unknown>;
    expect(agg.habitId).toBe(habit.id);
    expect(agg.year).toBe(2026);

    // upsert: same stamp updates the entry
    const agg2 = (await (
      await SELF.fetch(`${HOST}/open/v1/habit/${habit.id}/checkin`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ stamp: 20260801, value: 7 }),
      })
    ).json()) as { checkins: Record<string, unknown>[] };
    expect(agg2.checkins).toHaveLength(1);
    expect(agg2.checkins[0].value).toBe(7);

    const rows = (await (
      await SELF.fetch(
        `${HOST}/open/v1/habit/checkins?habitIds=${habit.id}&from=20260801&to=20260831`,
        { headers: auth(token) },
      )
    ).json()) as Record<string, unknown>[];
    expect(rows[0].habitId).toBe(habit.id);
    expect((rows[0].checkins as Record<string, unknown>[])[0].value).toBe(7);

    const record = await SELF.fetch(`${HOST}/open/v1/habit/${habit.id}/record`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ stamp: 20260801, content: 'small win', emoji: 80 }),
    });
    expect(record.status).toBe(200);
    expect((await record.json() as Record<string, unknown>).content).toBe('small win');

    const records = await SELF.fetch(
      `${HOST}/open/v1/habit/${habit.id}/records?from=20260801&to=20260831`,
      { headers: auth(token) },
    );
    expect(records.status).toBe(200);
    expect(await records.json()).toEqual([
      expect.objectContaining({ stamp: 20260801, content: 'small win', emoji: 80 }),
    ]);

    const malformedRecord = await SELF.fetch(`${HOST}/open/v1/habit/${habit.id}/record`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ stamp: 20260801, content: { nope: true } }),
    });
    expect(malformedRecord.status).toBe(400);
  });

  it('covers focus records and enforces the 30-day window', async () => {
    const { token } = await bootstrap();
    const focus = (await (
      await SELF.fetch(`${HOST}/open/v1/focus`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          type: 0,
          startTime: '2026-08-01T09:00:00+0000',
          endTime: '2026-08-01T09:25:00+0000',
          note: 'deep work',
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(focus.duration).toBe(1500);

    const malformedType = await SELF.fetch(`${HOST}/open/v1/focus`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        type: '0',
        startTime: '2026-08-01T09:00:00+0000',
        endTime: '2026-08-01T09:01:00+0000',
        duration: 60,
      }),
    });
    expect(malformedType.status).toBe(400);

    const malformedDuration = await SELF.fetch(`${HOST}/open/v1/focus`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ type: 0, duration: '60' }),
    });
    expect(malformedDuration.status).toBe(400);

    const list = (await (
      await SELF.fetch(
        `${HOST}/open/v1/focus?from=2026-08-01T00:00:00%2B0000&to=2026-08-29T00:00:00%2B0000&type=0`,
        { headers: auth(token) },
      )
    ).json()) as Record<string, unknown>[];
    expect(list.map((f) => f.id)).toContain(focus.id);

    const tooLong = await SELF.fetch(
      `${HOST}/open/v1/focus?from=2026-08-01T00:00:00%2B0000&to=2026-09-15T00:00:00%2B0000&type=0`,
      { headers: auth(token) },
    );
    expect(tooLong.status).toBe(400);

    const deleted = (await (
      await SELF.fetch(`${HOST}/open/v1/focus/${focus.id}?type=0`, {
        method: 'DELETE',
        headers: auth(token),
      })
    ).json()) as Record<string, unknown>;
    expect(deleted.id).toBe(focus.id);
  });

  it('creates countdowns with the session cookie (webapp path)', async () => {
    const { cookie } = await bootstrap();
    // The SPA writes through /open/v1 with just its session cookie.
    const created = await SELF.fetch(`${HOST}/open/v1/countdown`, {
      ...json({ name: 'Launch day', date: '2026-12-31' }, { Cookie: cookie }),
    });
    expect(created.status).toBe(200);

    const list = (await (
      await SELF.fetch(`${HOST}/open/v1/countdown`, { headers: { Cookie: cookie } })
    ).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Launch day');
    expect(list[0].date).toBe('2026-12-31');
  });

  it('covers countdown create / update / delete via the API', async () => {
    const { token } = await bootstrap();

    // create
    const created = (await (
      await SELF.fetch(`${HOST}/open/v1/countdown`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          name: 'Launch day',
          date: '2026-12-31',
          kind: 'anniversary',
          reminders: ['same-day', '3-days'],
          repeatFlag: 'yearly',
          calculation: 'workday',
          displayMode: 'always',
          style: 2,
          color: '#E5484D',
          icon: '🚀',
          sortOrder: 2,
        }),
      })
    ).json()) as Record<string, unknown>;
    expect(created.name).toBe('Launch day');
    expect(created.date).toBe('2026-12-31');
    expect(created.sortOrder).toBe(2);
    expect(created.kind).toBe('anniversary');
    expect(created.reminders).toEqual(['same-day', '3-days']);
    expect(created.repeatFlag).toBe('yearly');
    expect(created.calculation).toBe('workday');
    expect(created.displayMode).toBe('always');
    expect(created.style).toBe(2);
    expect(created.color).toBe('#E5484D');
    expect(created.icon).toBe('🚀');

    // validation errors
    const noName = await SELF.fetch(`${HOST}/open/v1/countdown`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ date: '2026-12-31' }),
    });
    expect(noName.status).toBe(400);
    const noDate = await SELF.fetch(`${HOST}/open/v1/countdown`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name: 'x' }),
    });
    expect(noDate.status).toBe(400);
    const malformed = await SELF.fetch(`${HOST}/open/v1/countdown`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name: ['not', 'text'], date: { year: 2026 }, style: '2' }),
    });
    expect(malformed.status).toBe(400);

    // update
    const updated = (await (
      await SELF.fetch(`${HOST}/open/v1/countdown/${created.id}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'Launch day!', date: '2027-01-01' }),
      })
    ).json()) as Record<string, unknown>;
    expect(updated.name).toBe('Launch day!');
    expect(updated.date).toBe('2027-01-01');

    // unknown id
    const missing = await SELF.fetch(`${HOST}/open/v1/countdown/${'0'.repeat(24)}`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name: 'ghost' }),
    });
    expect(missing.status).toBe(404);

    // delete + verify
    const del = await SELF.fetch(`${HOST}/open/v1/countdown/${created.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(del.status).toBe(200);
    const list = (await (
      await SELF.fetch(`${HOST}/open/v1/countdown`, { headers: auth(token) })
    ).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(0);
  });
});

describe('notifications', () => {
  it('returns defaults and persists strictly validated settings', async () => {
    const { token } = await bootstrap();
    const initial = await SELF.fetch(`${HOST}/open/v1/notification/config`, { headers: auth(token) });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as { configured: boolean; subscribedDevices: number; settings: Record<string, unknown> };
    expect(initialBody.configured).toBe(pushConfigured(env));
    expect(initialBody.subscribedDevices).toBe(0);
    expect(initialBody.settings.enabled).toBe(false);

    const settings = {
      enabled: true,
      taskEnabled: true,
      habitEnabled: false,
      countdownEnabled: true,
      soundEnabled: false,
      timezone: 'Asia/Singapore',
      allDayTime: '08:30',
    };
    const saved = await SELF.fetch(`${HOST}/open/v1/notification/settings`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify(settings),
    });
    expect(saved.status).toBe(200);
    const configured = (await (
      await SELF.fetch(`${HOST}/open/v1/notification/config`, { headers: auth(token) })
    ).json()) as { settings: typeof settings };
    expect(configured.settings).toEqual(settings);
  });

  it('rejects malformed settings and handles subscription configuration', async () => {
    const { token } = await bootstrap();
    const malformed = await SELF.fetch(`${HOST}/open/v1/notification/settings`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(malformed.status).toBe(400);

    const invalidTime = await SELF.fetch(`${HOST}/open/v1/notification/settings`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({
        enabled: true, taskEnabled: true, habitEnabled: true, countdownEnabled: true,
        soundEnabled: true, timezone: 'Not/AZone', allDayTime: '99:99',
      }),
    });
    expect(invalidTime.status).toBe(400);

    const subscribe = await SELF.fetch(`${HOST}/open/v1/notification/subscribe`, {
      ...json({ endpoint: 'https://push.example/sub', keys: { p256dh: 'abc', auth: 'abc' } }, auth(token)),
    });
    expect(subscribe.status).toBe(pushConfigured(env) ? 200 : 503);
  });
});

describe('oauth', () => {
  it('exchanges a PKCE authorization code for an API token', async () => {
    // Fresh storage per test: this registration creates the first user.
    const email = 'oauth@example.com';
    const reg = await SELF.fetch(`${HOST}/api/register`, {
      ...json({ email, password: PASSWORD }),
      redirect: 'manual',
    });
    expect(reg.status).toBe(200);
    const userId = (
      await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>()
    )!.id;

    const verifier = 'test-verifier-' + 'a'.repeat(40);
    const challenge = await s256Challenge(verifier);
    const { createTestCode } = await import('../src/oauth.js');
    const code = await createTestCode(env.DB, userId, challenge, 'http://localhost:8765/callback');

    const tokenParams = {
      code,
      client_id: 'nodetick-cli',
      code_verifier: verifier,
      grant_type: 'authorization_code',
      scope: 'tasks:read tasks:write',
      redirect_uri: 'http://localhost:8765/callback',
    };
    const res = await SELF.fetch(`${HOST}/oauth/token`, {
      ...form(tokenParams),
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { access_token?: string };
    expect(data.access_token).toMatch(/^ntk_/);

    // The minted token works against the API.
    const projects = await SELF.fetch(`${HOST}/open/v1/project`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    expect(projects.status).toBe(200);

    // Code is single-use.
    const replay = await SELF.fetch(`${HOST}/oauth/token`, {
      ...form(tokenParams),
      redirect: 'manual',
    });
    expect(replay.status).toBe(400);

    // A malformed JSON object is a client error, never an unhandled exception.
    const malformed = await SELF.fetch(`${HOST}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(malformed.status).toBe(400);

    // Two simultaneous exchanges can consume the same authorization code only once.
    const code2 = await createTestCode(env.DB, userId, challenge, 'http://localhost:8765/callback');
    const concurrentParams = { ...tokenParams, code: code2 };
    const concurrent = await Promise.all([
      SELF.fetch(`${HOST}/oauth/token`, { ...form(concurrentParams), redirect: 'manual' }),
      SELF.fetch(`${HOST}/oauth/token`, { ...form(concurrentParams), redirect: 'manual' }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 400]);
  });
});

describe('recurring tasks', () => {
  it('spawns the next occurrence when completing via the complete endpoint', async () => {
    const { token } = await bootstrap();
    await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) }); // ensure inbox exists
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          title: 'Water the plants',
          projectId: 'inbox',
          dueDate: '2030-01-01T09:00:00+0000',
          repeatFlag: 'RRULE:FREQ=DAILY',
          items: [{ title: 'check soil' }],
        }),
      })
    ).json()) as Record<string, unknown>;

    const completeRes = await SELF.fetch(
      `${HOST}/open/v1/project/inbox/task/${task.id}/complete`,
      { method: 'POST', headers: auth(token) },
    );
    expect(completeRes.status).toBe(200);
    const next = (await completeRes.json()) as Record<string, unknown> | null;
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(task.id);
    expect(next!.dueDate).toBe('2030-01-02T09:00:00+0000');
    expect(next!.repeatFlag).toBe('RRULE:FREQ=DAILY');
    expect(next!.status).toBe(0);
    // Subtasks restart unchecked on the fresh occurrence.
    expect((next!.items as { status: number }[])[0].status).toBe(0);

    // The original is completed; the clone is active.
    const active = (await (
      await SELF.fetch(`${HOST}/open/v1/task/filter`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ status: [0] }),
      })
    ).json()) as { id: string }[];
    expect(active.map((t) => t.id)).toContain(next!.id);
    expect(active.map((t) => t.id)).not.toContain(task.id);
  });

  it('spawns weekly occurrences when completing via a status update', async () => {
    const { token } = await bootstrap();
    await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) }); // ensure inbox exists
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          title: 'Weekly review',
          projectId: 'inbox',
          dueDate: '2030-01-07T00:00:00+0000',
          repeatFlag: 'RRULE:FREQ=WEEKLY',
        }),
      })
    ).json()) as Record<string, unknown>;

    const updated = (await (
      await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ status: 2 }),
      })
    ).json()) as Record<string, unknown>;
    expect(updated.status).toBe(2);

    const active = (await (
      await SELF.fetch(`${HOST}/open/v1/task/filter`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ status: [0] }),
      })
    ).json()) as { id: string; dueDate: string }[];
    const clone = active.find((t) => t.id !== task.id);
    expect(clone).toBeDefined();
    expect(clone!.dueDate).toBe('2030-01-14T00:00:00+0000');
  });

  it('returns a null body when completing a non-recurring task', async () => {
    const { token } = await bootstrap();
    await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) }); // ensure inbox exists
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'One-off', projectId: 'inbox' }),
      })
    ).json()) as Record<string, unknown>;
    const res = await SELF.fetch(`${HOST}/open/v1/project/inbox/task/${task.id}/complete`, {
      method: 'POST',
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe('tag management', () => {
  it('renames a tag everywhere, recolors it, and deletes it', async () => {
    const { token } = await bootstrap();
    await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) }); // ensure inbox exists
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Tagged', projectId: 'inbox', tags: ['urgent'] }),
      })
    ).json()) as Record<string, unknown>;

    // rename + recolor
    const renamed = (await (
      await SELF.fetch(`${HOST}/open/v1/tag/urgent`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ name: 'asap', label: 'ASAP', color: '#4772FA' }),
      })
    ).json()) as Record<string, unknown>;
    expect(renamed.name).toBe('asap');
    expect(renamed.color).toBe('#4772FA');

    const after = (await (
      await SELF.fetch(`${HOST}/open/v1/project/inbox/task/${task.id}`, {
        headers: auth(token),
      })
    ).json()) as { tags: string[] };
    expect(after.tags).toEqual(['asap']);

    // rename onto an existing name is rejected
    await SELF.fetch(`${HOST}/open/v1/task`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Other', projectId: 'inbox', tags: ['clash'] }),
    });
    const clash = await SELF.fetch(`${HOST}/open/v1/tag/clash`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name: 'asap' }),
    });
    expect(clash.status).toBe(409);

    // delete strips the tag from tasks
    const del = await SELF.fetch(`${HOST}/open/v1/tag/asap`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(del.status).toBe(200);
    const stripped = (await (
      await SELF.fetch(`${HOST}/open/v1/project/inbox/task/${task.id}`, {
        headers: auth(token),
      })
    ).json()) as { tags: string[] };
    expect(stripped.tags).toEqual([]);

    const gone = await SELF.fetch(`${HOST}/open/v1/tag/asap`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(gone.status).toBe(404);
  });
});

describe('backup export/import', () => {
  it('exports full JSON, imports it back, and serves an iCal feed', async () => {
    const { token, cookie } = await bootstrap();
    await SELF.fetch(`${HOST}/open/v1/project`, { headers: auth(token) }); // ensure inbox exists
    const task = (await (
      await SELF.fetch(`${HOST}/open/v1/task`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Exported', projectId: 'inbox', dueDate: '2030-05-04T00:00:00+0000' }),
      })
    ).json()) as Record<string, unknown>;

    const exportRes = await SELF.fetch(`${HOST}/api/export`, { headers: { Cookie: cookie } });
    expect(exportRes.status).toBe(200);
    const backup = (await exportRes.json()) as Record<string, unknown>;
    expect(backup.app).toBe('nodetick');
    const backupTasks = backup.tasks as { id: string; title: string }[];
    expect(backupTasks.map((t) => t.id)).toContain(task.id);

    // Modify the task server-side, then restore its older state via import.
    await SELF.fetch(`${HOST}/open/v1/task/${task.id}`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Changed on server' }),
    });
    const importRes = await SELF.fetch(`${HOST}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(backup),
    });
    expect(importRes.status).toBe(200);
    expect(((await importRes.json()) as { imported: number }).imported).toBeGreaterThan(0);
    const restored = (await (
      await SELF.fetch(`${HOST}/open/v1/project/inbox/task/${task.id}`, { headers: auth(token) })
    ).json()) as { title: string };
    expect(restored.title).toBe('Exported');

    // iCal feed lists the scheduled task.
    const icsRes = await SELF.fetch(`${HOST}/api/export/calendar.ics`, { headers: { Cookie: cookie } });
    expect(icsRes.status).toBe(200);
    const ics = await icsRes.text();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Exported');
    expect(ics).toContain(`UID:${task.id}@nodetick`);
  });

  it('rejects import of foreign files', async () => {
    const { cookie } = await bootstrap();
    const res = await SELF.fetch(`${HOST}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ app: 'other' }),
    });
    expect(res.status).toBe(400);
  });
});
