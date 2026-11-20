import { describe, expect, it } from 'vitest';
import {
  abandon,
  advance,
  AUTO_START_GRACE_MS,
  DEFAULT_FOCUS_SETTINGS,
  displayMs,
  elapsedMs,
  finish,
  type FocusSettings,
  IDLE_TIMER,
  longEnoughToSave,
  parseFocusSettings,
  parseFocusTimer,
  pause,
  pausedMs,
  phaseEnd,
  recordPayload,
  resume,
  setMode,
  skipBreak,
  startBreak,
  startFocus,
} from '../src/lib/focusTimer';

const MIN = 60_000;
const T0 = Date.parse('2026-11-20T09:00:00Z');
const settings = (patch: Partial<FocusSettings> = {}): FocusSettings => ({ ...DEFAULT_FOCUS_SETTINGS, ...patch });

describe('pomodoro phases', () => {
  it('runs focus → short break → focus, with a long break after every N pomodoros', () => {
    const s = settings({ autoBreak: true, autoStartNext: true, longBreakInterval: 2 });
    let timer = startFocus(IDLE_TIMER, s, T0, { taskId: 't1' });
    expect(phaseEnd(timer)).toBe(T0 + 25 * MIN);

    // The first pomodoro ends: a record and a running short break.
    let step = advance(timer, s, T0 + 25 * MIN + 400);
    expect(step.events).toHaveLength(1);
    expect(step.events[0]).toMatchObject({ kind: 'focusDone', at: T0 + 25 * MIN, next: 'shortBreak' });
    const record = step.events[0].kind === 'focusDone' ? step.events[0].record : null;
    expect(record).toMatchObject({ type: 0, startMs: T0, endMs: T0 + 25 * MIN, duration: 1500, pauseDuration: 0, taskId: 't1' });
    timer = step.timer;
    expect(timer).toMatchObject({ phase: 'shortBreak', status: 'running', startedAt: T0 + 25 * MIN, cycle: 1, taskId: 't1' });

    // Break over: the next pomodoro starts when the break ended, not when we noticed.
    step = advance(timer, s, T0 + 30 * MIN + 900);
    expect(step.events).toEqual([{ kind: 'breakDone', at: T0 + 30 * MIN }]);
    timer = step.timer;
    expect(timer).toMatchObject({ phase: 'focus', status: 'running', startedAt: T0 + 30 * MIN });

    // The second pomodoro earns the long break.
    step = advance(timer, s, T0 + 55 * MIN);
    expect(step.events[0]).toMatchObject({ kind: 'focusDone', next: 'longBreak' });
    expect(step.timer).toMatchObject({ phase: 'longBreak', status: 'running', plannedMs: 15 * MIN, cycle: 2 });
  });

  it('waits for the user between phases without auto-start', () => {
    const s = settings();
    const done = advance(startFocus(IDLE_TIMER, s, T0), s, T0 + 25 * MIN);
    expect(done.timer).toMatchObject({ phase: 'shortBreak', status: 'idle', cycle: 1 });
    expect(displayMs(done.timer, s, T0 + 26 * MIN)).toBe(5 * MIN);

    const onBreak = startBreak(done.timer, s, T0 + 27 * MIN);
    expect(onBreak).toMatchObject({ status: 'running', startedAt: T0 + 27 * MIN, plannedMs: 5 * MIN });
    const over = advance(onBreak, s, T0 + 40 * MIN);
    expect(over.events).toEqual([{ kind: 'breakDone', at: T0 + 32 * MIN }]);
    expect(over.timer).toMatchObject({ phase: 'focus', status: 'idle', cycle: 1 });
  });

  it('skips a break, starting the next pomodoro when auto-start is on', () => {
    const waiting = advance(startFocus(IDLE_TIMER, settings(), T0), settings(), T0 + 25 * MIN).timer;
    expect(skipBreak(waiting, settings(), T0 + 26 * MIN)).toMatchObject({ phase: 'focus', status: 'idle', cycle: 1 });
    expect(skipBreak(waiting, settings({ autoStartNext: true }), T0 + 26 * MIN)).toMatchObject({ phase: 'focus', status: 'running', startedAt: T0 + 26 * MIN });
    // Ending a break is skipping it, and never makes a record.
    expect(finish(startBreak(waiting, settings(), T0 + 26 * MIN), settings(), T0 + 28 * MIN).record).toBeNull();
  });

  it('does not chain phases that ran out while no tab was open', () => {
    const s = settings({ autoBreak: true, autoStartNext: true });
    // Back three hours later: the pomodoro still counts, nothing else starts by itself.
    const late = advance(startFocus(IDLE_TIMER, s, T0), s, T0 + 3 * 60 * MIN);
    expect(late.events.map((e) => e.kind)).toEqual(['focusDone']);
    expect(late.timer).toMatchObject({ phase: 'shortBreak', status: 'idle' });
    // Within the grace period the chain continues from the exact end.
    const soon = advance(startFocus(IDLE_TIMER, s, T0), s, T0 + 25 * MIN + AUTO_START_GRACE_MS - 1);
    expect(soon.timer).toMatchObject({ phase: 'shortBreak', status: 'running', startedAt: T0 + 25 * MIN });
  });
});

describe('pause accounting', () => {
  it('banks focused and paused time and moves the end out by the pause', () => {
    const s = settings();
    let timer = startFocus(IDLE_TIMER, s, T0);
    timer = pause(timer, T0 + 10 * MIN);
    expect(elapsedMs(timer, T0 + 14 * MIN)).toBe(10 * MIN);
    expect(pausedMs(timer, T0 + 14 * MIN)).toBe(4 * MIN);
    expect(phaseEnd(timer)).toBeNull();
    // Paused timers never complete.
    expect(advance(timer, s, T0 + 60 * MIN).events).toEqual([]);

    timer = resume(timer, T0 + 15 * MIN);
    expect(timer.pausedTotal).toBe(5 * MIN);
    expect(phaseEnd(timer)).toBe(T0 + 30 * MIN);
    expect(displayMs(timer, s, T0 + 20 * MIN)).toBe(10 * MIN);

    const done = advance(timer, s, T0 + 31 * MIN).events[0];
    expect(done.kind === 'focusDone' && done.record).toMatchObject({ duration: 1500, pauseDuration: 300, startMs: T0, endMs: T0 + 30 * MIN });
  });

  it('ending while paused counts the pause up to now', () => {
    const s = settings({ pomodoroMinutes: 50 });
    let timer = startFocus(IDLE_TIMER, s, T0, { mode: 'pomodoro' });
    timer = { ...pause(timer, T0 + 12 * MIN), note: '  wrote the outline  ' };
    const { timer: next, record } = finish(timer, s, T0 + 20 * MIN);
    expect(record).toMatchObject({ type: 0, duration: 720, pauseDuration: 480, endMs: T0 + 20 * MIN, note: 'wrote the outline' });
    expect(next).toMatchObject({ status: 'idle', phase: 'focus', cycle: 0 });
  });

  it('discards sessions under five minutes and keeps longer stopwatch runs as type 1', () => {
    const s = settings();
    const short = startFocus(IDLE_TIMER, s, T0, { mode: 'stopwatch' });
    expect(longEnoughToSave(short, T0 + 4 * MIN)).toBe(false);
    expect(finish(short, s, T0 + 4 * MIN).record).toBeNull();
    expect(abandon(short)).toMatchObject({ status: 'idle', mode: 'stopwatch' });

    const long = pause(startFocus(IDLE_TIMER, s, T0, { mode: 'stopwatch', taskId: 'x' }), T0 + 70 * MIN);
    expect(longEnoughToSave(long, T0 + 80 * MIN)).toBe(true);
    const { record } = finish(long, s, T0 + 80 * MIN);
    expect(record).toMatchObject({ type: 1, duration: 4200, pauseDuration: 600, taskId: 'x' });
    // The stopwatch never ends by itself.
    expect(advance(resume(long, T0 + 80 * MIN), s, T0 + 600 * MIN).events).toEqual([]);
    expect(displayMs(startFocus(IDLE_TIMER, s, T0, { mode: 'stopwatch' }), s, T0 + 90_500)).toBe(90_500);
  });

  it('caps an early-ended pomodoro at its planned length', () => {
    const s = settings({ pomodoroMinutes: 10 });
    const { record } = finish(startFocus(IDLE_TIMER, s, T0), s, T0 + 12 * MIN);
    expect(record?.duration).toBe(600);
  });
});

describe('restoring after a reload', () => {
  it('round-trips through storage and resumes where wall time says', () => {
    const s = settings();
    const running = startFocus(IDLE_TIMER, s, T0, { taskId: 'abc' });
    const restored = parseFocusTimer(JSON.parse(JSON.stringify(running)));
    expect(restored).toEqual(running);
    // Ten minutes later the restored timer shows fifteen minutes left.
    expect(displayMs(restored, s, T0 + 10 * MIN)).toBe(15 * MIN);
    // And a paused one stays paused.
    const paused = parseFocusTimer(JSON.parse(JSON.stringify(pause(running, T0 + 5 * MIN))));
    expect(displayMs(paused, s, T0 + 50 * MIN)).toBe(20 * MIN);
  });

  it('falls back to idle on malformed or inconsistent state', () => {
    expect(parseFocusTimer(null)).toEqual(IDLE_TIMER);
    expect(parseFocusTimer('{"status":"running"}')).toEqual(IDLE_TIMER);
    expect(parseFocusTimer({ ...IDLE_TIMER, status: 'running', runningSince: null, startedAt: T0 })).toEqual(IDLE_TIMER);
    expect(parseFocusTimer({ ...IDLE_TIMER, mode: 'stopwatch', phase: 'shortBreak' })).toEqual(IDLE_TIMER);
    expect(parseFocusTimer({ ...IDLE_TIMER, cycle: 'two' })).toEqual(IDLE_TIMER);
  });

  it('reads old settings, dropping the sync switch', () => {
    const parsed = parseFocusSettings({ pomodoroMinutes: 500, shortBreakMinutes: 3, sync: true, autoBreak: true, noise: 'pink', noiseVolume: 140 });
    expect(parsed).toMatchObject({ pomodoroMinutes: 120, shortBreakMinutes: 3, autoBreak: true, sound: true, noise: 'pink', noiseVolume: 100 });
    expect(parsed).not.toHaveProperty('sync');
    expect(parseFocusSettings({ noise: 'thunder' }).noise).toBe('off');
  });
});

describe('modes and payloads', () => {
  it('drops a waiting break when switching mode', () => {
    const waiting = advance(startFocus(IDLE_TIMER, settings(), T0), settings(), T0 + 25 * MIN).timer;
    expect(setMode(waiting, 'stopwatch')).toMatchObject({ mode: 'stopwatch', phase: 'focus', cycle: 0 });
    const running = startFocus(IDLE_TIMER, settings(), T0);
    expect(setMode(running, 'stopwatch')).toBe(running);
  });

  it('writes the Open API body with local offsets', () => {
    const body = recordPayload({ key: 'k', type: 0, startMs: T0, endMs: T0 + 25 * MIN, duration: 1500, pauseDuration: 0, taskId: 't', note: '' });
    expect(body).toMatchObject({ type: 0, duration: 1500, pauseDuration: 0, taskId: 't' });
    expect(body).not.toHaveProperty('note');
    expect(Date.parse(String(body.startTime).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))).toBe(T0);
    expect(String(body.endTime)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/);
    expect(recordPayload({ key: 'k', type: 1, startMs: T0, endMs: T0, duration: 0, pauseDuration: 0, taskId: 't', note: 'n' }, false)).not.toHaveProperty('taskId');
  });
});
