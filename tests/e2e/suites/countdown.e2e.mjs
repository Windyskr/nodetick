import { eq, ok } from '../lib.mjs';
import { httpCreateCountdown } from '../lib.mjs';

export async function run({ h, server, session }) {
  const pfx = h.pfx;
  let countdownId;

  h.test('countdown create: name + date round-trip', () => {
    const c = h.j(['countdown', 'create', '--name', `${pfx}-launch`, '--date', '2026-12-31'], 'countdown create');
    ok(/^[0-9a-f]{24}$/.test(c.id), 'id shape');
    eq(c.name, `${pfx}-launch`, 'name');
    eq(c.date, '2026-12-31', 'date');
    countdownId = c.id;
  });

  h.test('countdown create: missing --name fails', () => {
    h.runFails(['countdown', 'create', '--date', '2026-12-31'], 'required option', 'countdown create validation');
  });

  h.test('countdown create: missing --date fails', () => {
    h.runFails(['countdown', 'create', '--name', 'x'], 'required option', 'countdown create validation');
  });

  h.test('countdown create: empty date rejected by the server', () => {
    h.runFails(
      ['countdown', 'create', '--name', 'x', '--date', ''],
      'date must be a valid YYYY-MM-DD date',
      'countdown create empty date',
    );
  });

  h.test('countdown update: name and date', () => {
    const c = h.j(
      ['countdown', 'update', countdownId, '--name', `${pfx}-launch2`, '--date', '2027-01-01'],
      'countdown update',
    );
    eq(c.name, `${pfx}-launch2`, 'updated name');
    eq(c.date, '2027-01-01', 'updated date');
  });

  h.test('countdown update: unknown id fails', () => {
    h.runFails(
      ['countdown', 'update', '0'.repeat(24), '--name', 'ghost'],
      'countdown not found',
      'countdown update 404',
    );
  });

  h.test('countdown list: contains the updated countdown', () => {
    const list = h.j(['countdown', 'list'], 'countdown list');
    const found = list.find((c) => c.id === countdownId);
    ok(found, 'list contains countdown');
    eq(found.name, `${pfx}-launch2`, 'list reflects update');

    const text = h.runOk(['countdown', 'list'], 'countdown list text');
    ok(text.stdout.includes(`${pfx}-launch2`), 'text output shows countdown');
  });

  if (session) {
    // Cross-check: a countdown created via the web dashboard (form + CSRF)
    // must be visible through the CLI, proving both paths share one store.
    const dashName = `${pfx}-from-dashboard`;
    try {
      await httpCreateCountdown(server, session.cookie, dashName, '2027-06-01');
    } catch (err) {
      console.log(`  (dashboard countdown create failed, skipping cross-check: ${err.message})`);
    }
    h.test('countdown list: dashboard-created countdown visible to the CLI', () => {
      const list = h.j(['countdown', 'list'], 'countdown list after dashboard create');
      const found = list.find((c) => c.name === dashName);
      ok(found, 'dashboard countdown visible');
      eq(found.date, '2027-06-01', 'date round-trip');
    });
  } else {
    console.log('  (skip dashboard cross-check: no session — set NODETICK_EMAIL/PASSWORD to enable)');
  }

  h.test('countdown delete: removes the countdown', () => {
    h.runOk(['countdown', 'delete', countdownId], 'countdown delete');
    const list = h.j(['countdown', 'list'], 'countdown list after delete');
    ok(!list.some((c) => c.id === countdownId), 'countdown removed');
  });

  h.test('countdown delete: unknown id fails', () => {
    h.runFails(['countdown', 'delete', '0'.repeat(24)], 'countdown not found', 'countdown delete 404');
  });
}
