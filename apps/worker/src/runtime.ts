import { QUEUES, type QueueName } from '@vgb/core';
import type { UploadWindow } from '@vgb/db';
import type { Job, PgBoss, WorkOptions } from 'pg-boss';
import { AWAKE_CHECK_MS, decideMode, MAINTENANCE_MS, WAKE_HOLD_MS } from './activity';

export interface QueueWorker {
  name: QueueName;
  options: WorkOptions;
  handler: (jobs: Job<never>[]) => Promise<void>;
}

export type RuntimeState = 'asleep' | 'awake' | 'stopped';

export interface RuntimeDeps {
  boss: Pick<PgBoss, 'work' | 'offWork' | 'send' | 'supervise' | 'getQueueStats'>;
  listWindows: (now: Date) => Promise<UploadWindow[]>;
  workers: QueueWorker[];
  /** Off locally and in CI: the worker then never sleeps, exactly as before sleep mode existed. */
  sleepEnabled: boolean;
  now: () => Date;
}

/**
 * Owns when the worker talks to Postgres. Awake: queue workers poll, lifecycle-tick and pg-boss
 * maintenance run every 10 minutes. Asleep: nothing touches the database, so Neon can scale to
 * zero; a timer or a wake request brings it back. Mode changes run one at a time.
 */
export class WorkerRuntime {
  #state: RuntimeState = 'asleep';
  #wakeUntil: Date | null = null;
  #checkTimer: NodeJS.Timeout | null = null;
  #maintenanceTimer: NodeJS.Timeout | null = null;
  #busy: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RuntimeDeps) {}

  get state(): RuntimeState {
    return this.#state;
  }

  start(): Promise<void> {
    return this.#serial(() => this.#wakeUp('start'));
  }

  wake(reason: string): Promise<void> {
    const until = new Date(this.deps.now().getTime() + WAKE_HOLD_MS);
    if (!this.#wakeUntil || until > this.#wakeUntil) this.#wakeUntil = until;
    return this.#serial(async () => {
      if (this.#state === 'asleep') await this.#wakeUp(reason);
    });
  }

  /** Stops the timers; pg-boss stops the queue workers itself in `boss.stop()`. */
  async stop(): Promise<void> {
    this.#state = 'stopped';
    this.#clearTimers();
    await this.#busy;
  }

  #serial(fn: () => Promise<void>): Promise<void> {
    const run = this.#busy.then(() => (this.#state === 'stopped' ? undefined : fn()));
    this.#busy = run.catch((err) => console.error('[worker] mode change failed', err));
    return this.#busy;
  }

  #clearTimers() {
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    if (this.#maintenanceTimer) clearInterval(this.#maintenanceTimer);
    this.#checkTimer = null;
    this.#maintenanceTimer = null;
  }

  #schedule(ms: number, fn: () => Promise<void>) {
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => void this.#serial(fn), Math.max(0, ms));
  }

  async #wakeUp(reason: string) {
    this.#clearTimers();
    for (const w of this.deps.workers) await this.deps.boss.work(w.name, w.options, w.handler);
    this.#state = 'awake';
    console.info('[worker] awake (%s)', reason);
    await this.#maintain();
    this.#maintenanceTimer = setInterval(() => void this.#maintain(), MAINTENANCE_MS);
    if (this.deps.sleepEnabled) this.#schedule(AWAKE_CHECK_MS, () => this.#check());
  }

  async #maintain() {
    try {
      await this.deps.boss.send(QUEUES.lifecycleTick, {});
      await this.deps.boss.supervise();
    } catch (err) {
      console.error('[worker] maintenance failed', err);
    }
  }

  async #check() {
    if (this.#state !== 'awake') return;
    const now = this.deps.now();
    let decision;
    try {
      const [weddings, pendingJobs] = await Promise.all([
        this.deps.listWindows(now),
        this.#pendingJobs(),
      ]);
      decision = decideMode({ now, weddings, pendingJobs, wakeUntil: this.#wakeUntil });
    } catch (err) {
      console.error('[worker] activity check failed', err);
      this.#schedule(AWAKE_CHECK_MS, () => this.#check());
      return;
    }
    const delay = decision.nextCheckAt.getTime() - now.getTime();
    if (decision.mode === 'awake') {
      this.#schedule(delay, () => this.#check());
      return;
    }
    await this.#sleep(decision.nextCheckAt);
    this.#schedule(delay, () => this.#wakeUp('tick'));
  }

  async #sleep(until: Date) {
    this.#clearTimers();
    const names = new Set(this.deps.workers.map((w) => w.name));
    for (const name of names) await this.deps.boss.offWork(name, { wait: true });
    this.#state = 'asleep';
    console.info('[worker] asleep until %s', until.toISOString());
  }

  async #pendingJobs(): Promise<number> {
    let total = 0;
    for (const name of Object.values(QUEUES)) {
      const [stats] = await this.deps.boss.getQueueStats(name, { force: true });
      total += (stats?.readyCount ?? 0) + (stats?.activeCount ?? 0);
    }
    return total;
  }
}
