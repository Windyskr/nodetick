import { eq, has, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;
  let habitId;

  h.test('habit create: full options round-trip', () => {
    const x = h.j(
      ['habit', 'create',
        '--name', `${pfx}-water`,
        '--goal', '8',
        '--step', '1',
        '--unit', 'cups',
        '--color', '#4AB8A9',
        '--encouragement', 'keep going',
        '--type', 'WEEKLY',
        '--repeat', 'RRULE:FREQ=DAILY;INTERVAL=1',
        '--reminders', 'TRIGGER:-PT30M'],
      'habit create',
    );
    ok(/^[0-9a-f]{24}$/.test(x.id), 'id shape');
    eq(x.name, `${pfx}-water`, 'name');
    eq(x.goal, 8, 'goal');
    eq(x.step, 1, 'step');
    eq(x.unit, 'cups', 'unit');
    eq(x.color, '#4AB8A9', 'color');
    eq(x.encouragement, 'keep going', 'encouragement');
    eq(x.repeatRule, 'RRULE:FREQ=DAILY;INTERVAL=1', 'repeatRule');
    eq(x.reminders, ['TRIGGER:-PT30M'], 'reminders');
    habitId = x.id;
  });

  h.test('habit list: contains the created habit', () => {
    const list = h.j(['habit', 'list'], 'habit list');
    ok(list.some((x) => x.id === habitId), 'list contains habit');
  });

  h.test('habit get: JSON and text views', () => {
    const x = h.j(['habit', 'get', habitId], 'habit get');
    eq(x.id, habitId, 'id');
    const text = h.runOk(['habit', 'get', habitId], 'habit get text');
    has(text.stdout, `${pfx}-water`, 'text shows name');
    has(text.stdout, 'Goal:      8', 'text shows goal');
  });

  h.test('habit update: non-numeric --goal fails instead of being dropped', () => {
    h.runFails(['habit', 'update', habitId, '--goal', 'lots'], '--goal must be a number', 'habit update bad goal');
  });

  h.test('habit update: name/goal/unit', () => {
    const x = h.j(['habit', 'update', habitId, '--name', `${pfx}-water2`, '--goal', '10', '--unit', 'ml'], 'habit update');
    eq(x.name, `${pfx}-water2`, 'updated name');
    eq(x.goal, 10, 'updated goal');
    eq(x.unit, 'ml', 'updated unit');
  });

  h.test('habit checkin: creates an entry', () => {
    const agg = h.j(['habit', 'checkin', habitId, '--stamp', '20260801', '--value', '5', '--goal', '10'], 'habit checkin');
    eq(agg.habitId, habitId, 'aggregate habitId');
    eq(agg.year, 2026, 'aggregate year');
    const entry = agg.checkins.find((c) => c.stamp === 20260801);
    ok(entry, 'stamp present');
    eq(entry.value, 5, 'value');
    eq(entry.goal, 10, 'goal');
  });

  h.test('habit checkin: same stamp upserts instead of duplicating', () => {
    const agg = h.j(['habit', 'checkin', habitId, '--stamp', '20260801', '--value', '7'], 'habit checkin upsert');
    eq(agg.checkins.filter((c) => c.stamp === 20260801).length, 1, 'single entry for stamp');
    eq(agg.checkins.find((c) => c.stamp === 20260801).value, 7, 'value updated');
  });

  h.test('habit checkin: invalid stamp fails', () => {
    h.runFails(['habit', 'checkin', habitId, '--stamp', '202608'], 'stamp must be YYYYMMDD', 'bad stamp');
  });

  h.test('habit checkins: range query', () => {
    const rows = h.j(['habit', 'checkins', '--habits', habitId, '--from', '20260801', '--to', '20260831'], 'habit checkins range');
    eq(rows.length, 1, 'one row per habit');
    eq(rows[0].habitId, habitId, 'row habitId');
    eq(rows[0].checkins.length, 1, 'one checkin in range');
    eq(rows[0].checkins[0].value, 7, 'checkin value');
  });

  h.test('habit checkins: range excludes other months', () => {
    const rows = h.j(['habit', 'checkins', '--habits', habitId, '--from', '20260901', '--to', '20260930'], 'habit checkins other month');
    eq(rows[0].checkins, [], 'no checkins in september window');
  });

  h.test('habit get: unknown id fails', () => {
    h.runFails(['habit', 'get', '0'.repeat(24)], 'habit not found', 'habit get 404');
  });
}
