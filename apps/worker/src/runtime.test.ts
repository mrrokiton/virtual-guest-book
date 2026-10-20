import { QUEUES } from '@vgb/core';
import type { UploadWindow } from '@vgb/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AWAKE_CHECK_MS, MAINTENANCE_MS, SLEEP_TICK_MS, WAKE_HOLD_MS } from './activity';
import { WorkerRuntime, type RuntimeDeps } from './runtime';

function fakeBoss(pending: { count: number }) {
  return {
    work: vi.fn(async () => 'id'),
    offWork: vi.fn(async () => {}),
    send: vi.fn(async () => 'job'),
    supervise: vi.fn(async () => {}),
    getQueueStats: vi.fn(async (name: string) => [
      { name, readyCount: name === QUEUES.photoProcess ? pending.count : 0, activeCount: 0 },
    ]),
  };
}

function setup(opts: { sleepEnabled?: boolean; windows?: UploadWindow[] } = {}) {
  const pending = { count: 0 };
  const boss = fakeBoss(pending);
  const runtime = new WorkerRuntime({
    boss: boss as unknown as RuntimeDeps['boss'],
    listWindows: async () => opts.windows ?? [],
    workers: [
      { name: QUEUES.photoProcess, options: {}, handler: async () => {} },
      { name: QUEUES.lifecycleTick, options: {}, handler: async () => {} },
    ],
    sleepEnabled: opts.sleepEnabled ?? true,
    now: () => new Date(),
  });
  return { runtime, boss, pending };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-08-01T12:00:00Z') });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WorkerRuntime', () => {
  it('starts awake and runs the lifecycle and maintenance right away', async () => {
    const { runtime, boss } = setup();
    await runtime.start();
    expect(runtime.state).toBe('awake');
    expect(boss.work).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(QUEUES.lifecycleTick, {});
    expect(boss.supervise).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it('falls asleep when nothing needs it and stops every queue worker', async () => {
    const { runtime, boss } = setup();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');
    expect(boss.offWork).toHaveBeenCalledWith(QUEUES.photoProcess, { wait: true });
    expect(boss.offWork).toHaveBeenCalledWith(QUEUES.lifecycleTick, { wait: true });

    boss.send.mockClear();
    await vi.advanceTimersByTimeAsync(MAINTENANCE_MS);
    expect(boss.send).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it('stays awake while jobs are pending, then sleeps', async () => {
    const { runtime, pending } = setup();
    pending.count = 3;
    await runtime.start();
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('awake');
    pending.count = 0;
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');
    await runtime.stop();
  });

  it('wakes on its hourly tick to run the lifecycle, then sleeps again', async () => {
    const { runtime, boss } = setup();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    boss.send.mockClear();

    await vi.advanceTimersByTimeAsync(SLEEP_TICK_MS);
    expect(runtime.state).toBe('awake');
    expect(boss.send).toHaveBeenCalledWith(QUEUES.lifecycleTick, {});
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');
    await runtime.stop();
  });

  it('wakes on request and holds for the wake period', async () => {
    const { runtime } = setup();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');

    await runtime.wake('request');
    expect(runtime.state).toBe('awake');
    await vi.advanceTimersByTimeAsync(WAKE_HOLD_MS - AWAKE_CHECK_MS);
    expect(runtime.state).toBe('awake');
    await vi.advanceTimersByTimeAsync(2 * AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');
    await runtime.stop();
  });

  it('never sleeps without a wake token', async () => {
    const { runtime } = setup({ sleepEnabled: false });
    await runtime.start();
    await vi.advanceTimersByTimeAsync(SLEEP_TICK_MS);
    expect(runtime.state).toBe('awake');
    await runtime.stop();
  });

  it('keeps going after a failed activity check', async () => {
    const { runtime, boss } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    boss.getQueueStats.mockRejectedValueOnce(new Error('connection terminated'));
    await runtime.start();
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('awake');
    await vi.advanceTimersByTimeAsync(AWAKE_CHECK_MS);
    expect(runtime.state).toBe('asleep');
    await runtime.stop();
  });
});
