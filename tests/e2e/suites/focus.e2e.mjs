import { eq, has, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;
  let pomodoroId;
  let timingId;

  h.test('focus create: pomodoro with auto-computed duration', () => {
    const f = h.j(
      ['focus', 'create', '--type', 'pomodoro',
        '--start-time', '2026-08-10T09:00:00+0000',
        '--end-time', '2026-08-10T09:25:00+0000',
        '--note', `${pfx} deep work`],
      'focus create pomodoro',
    );
    ok(/^[0-9a-f]{24}$/.test(f.id), 'id shape');
    eq(f.type, 0, 'type pomodoro');
    eq(f.duration, 1500, 'duration computed from start/end');
    eq(f.note, `${pfx} deep work`, 'note');
    pomodoroId = f.id;
  });

  h.test('focus create: timing type with explicit duration', () => {
    const f = h.j(
      ['focus', 'create', '--type', 'timing',
        '--start-time', '2026-08-10T14:00:00+0000',
        '--end-time', '2026-08-10T15:00:00+0000',
        '--duration', '3600',
        '--pause-duration', '120'],
      'focus create timing',
    );
    eq(f.type, 1, 'type timing');
    eq(f.duration, 3600, 'explicit duration wins');
    eq(f.pauseDuration, 120, 'pauseDuration');
    timingId = f.id;
  });

  h.test('focus get: by id and type', () => {
    const f = h.j(['focus', 'get', pomodoroId, '--type', 'pomodoro'], 'focus get');
    eq(f.id, pomodoroId, 'id');
    eq(f.duration, 1500, 'duration');
    const text = h.runOk(['focus', 'get', pomodoroId, '--type', 'p'], 'focus get text');
    has(text.stdout, 'Pomodoro', 'text shows type label');
  });

  h.test('focus get: wrong type does not return the record', () => {
    h.runFails(['focus', 'get', pomodoroId, '--type', 'timing'], 'focus record not found', 'focus get wrong type');
  });

  h.test('focus list: window containing the record', () => {
    const list = h.j(
      ['focus', 'list', '--from', '2026-08-01T00:00:00+0000', '--to', '2026-08-30T23:59:59+0000', '--type', '0'],
      'focus list pomodoro',
    );
    ok(list.some((f) => f.id === pomodoroId), 'contains pomodoro record');
    const timing = h.j(
      ['focus', 'list', '--from', '2026-08-01T00:00:00+0000', '--to', '2026-08-30T23:59:59+0000', '--type', '1'],
      'focus list timing',
    );
    ok(timing.some((f) => f.id === timingId), 'timing list is type-scoped');
  });

  h.test('focus list: window missing the record is empty', () => {
    const list = h.j(
      ['focus', 'list', '--from', '2026-07-01T00:00:00+0000', '--to', '2026-07-30T23:59:59+0000', '--type', '0'],
      'focus list empty window',
    );
    eq(list, [], 'no records in july window');
  });

  h.test('focus list: window over 30 days fails', () => {
    h.runFails(
      ['focus', 'list', '--from', '2026-08-01T00:00:00+0000', '--to', '2026-09-15T00:00:00+0000', '--type', '0'],
      '30 days',
      'focus list 40d window',
    );
  });

  h.test('focus delete: removes the record', () => {
    const gone = h.j(['focus', 'delete', pomodoroId, '--type', '0'], 'focus delete');
    eq(gone.id, pomodoroId, 'delete echoes the removed record');
    h.runFails(['focus', 'get', pomodoroId, '--type', '0'], 'focus record not found', 'focus get after delete');
  });

  h.test('focus delete: timing record too', () => {
    const gone = h.j(['focus', 'delete', timingId, '--type', '1'], 'focus delete timing');
    eq(gone.id, timingId, 'timing removed');
  });
}
