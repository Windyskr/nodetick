import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists to localStorage; give the node test environment one.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
});

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const addFocus = vi.fn();
vi.mock('../src/lib/api', () => ({ ApiError, api: { addFocus: (...args: unknown[]) => addFocus(...args) } }));
vi.mock('../src/lib/focusAudio', () => ({ unlockAudio: () => undefined, chimeNow: () => undefined, scheduleChime: () => undefined, setNoise: () => undefined }));

const { useFocus } = await import('../src/stores/focus');
const { IDLE_TIMER, startFocus, DEFAULT_FOCUS_SETTINGS } = await import('../src/lib/focusTimer');

const MIN = 60_000;
const T0 = Date.parse('2026-11-20T09:00:00Z');
const pending = () => JSON.parse(storage.get('ntk_focus_pending') ?? '[]') as { key: string }[];

describe('focus store saving', () => {
  beforeEach(() => {
    storage.clear();
    addFocus.mockReset();
    useFocus.setState({ timer: IDLE_TIMER, settings: DEFAULT_FOCUS_SETTINGS, pending: [], saveFailed: false, recordsVersion: 0 });
  });

  it('queues a finished pomodoro once and saves it once', async () => {
    addFocus.mockResolvedValue({ id: 'r1' });
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, T0, { taskId: 't1' }) });
    const events = useFocus.getState().advance(T0 + 25 * MIN);
    expect(events.map((e) => e.kind)).toEqual(['focusDone']);
    // A second tab completing the same phase queues nothing new.
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, T0, { taskId: 't1' }) });
    useFocus.getState().advance(T0 + 25 * MIN);
    expect(pending()).toHaveLength(1);

    await useFocus.getState().flush();
    expect(addFocus).toHaveBeenCalledTimes(1);
    expect(addFocus.mock.calls[0][0]).toMatchObject({ type: 0, duration: 1500, pauseDuration: 0, taskId: 't1' });
    expect(pending()).toEqual([]);
    expect(useFocus.getState().recordsVersion).toBe(1);

    // Already saved: queuing it again is a no-op.
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, T0, { taskId: 't1' }) });
    useFocus.getState().advance(T0 + 25 * MIN);
    await useFocus.getState().flush();
    expect(addFocus).toHaveBeenCalledTimes(1);
  });

  it('keeps records through network errors and drops ones the server rejects', async () => {
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, T0) });
    useFocus.getState().advance(T0 + 25 * MIN);
    addFocus.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await useFocus.getState().flush();
    expect(pending()).toHaveLength(1);
    expect(useFocus.getState().saveFailed).toBe(true);

    addFocus.mockRejectedValueOnce(new ApiError(400, 'bad'));
    await useFocus.getState().flush();
    expect(pending()).toEqual([]);
    expect(useFocus.getState().saveFailed).toBe(false);
  });

  it('saves without the task when the task is gone', async () => {
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, T0, { taskId: 'gone' }) });
    useFocus.getState().advance(T0 + 25 * MIN);
    addFocus.mockRejectedValueOnce(new ApiError(404, 'task not found')).mockResolvedValueOnce({ id: 'r2' });
    await useFocus.getState().flush();
    expect(addFocus).toHaveBeenCalledTimes(2);
    expect(addFocus.mock.calls[1][0]).not.toHaveProperty('taskId');
    expect(pending()).toEqual([]);
  });

  it('ends a short session without a record and links a task to a running one', () => {
    useFocus.setState({ timer: startFocus(IDLE_TIMER, DEFAULT_FOCUS_SETTINGS, Date.now() - 2 * MIN) });
    useFocus.getState().startForTask('t9');
    expect(useFocus.getState().timer).toMatchObject({ status: 'running', taskId: 't9' });
    useFocus.getState().finish();
    expect(useFocus.getState().timer.status).toBe('idle');
    expect(pending()).toEqual([]);
    // Persisted for the next reload.
    expect(JSON.parse(storage.get('ntk_focus_timer')!)).toMatchObject({ status: 'idle', taskId: 't9' });
  });
});
