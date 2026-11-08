import { nextIdleCheckAt } from '@vgb/core';
import { listOpenUploadWindows } from '@vgb/db';
import { env } from './env';
import { startWorkerMachines } from './fly-machines';
import { db } from './server';

const RETRY_MS = 60_000;

const g = globalThis as typeof globalThis & { __vgbWorkerKeepalive?: boolean };

/**
 * While the worker machine is stopped, this process is the only clock. It starts the machine at
 * least hourly so lifecycle still runs, and sooner when a wedding window opens.
 */
export function startWorkerKeepalive(): void {
  if (g.__vgbWorkerKeepalive || !env().FLY_API_TOKEN) return;
  g.__vgbWorkerKeepalive = true;

  const tick = async () => {
    let delay: number;
    try {
      const now = new Date();
      const windows = await listOpenUploadWindows(db(), now);
      delay = Math.max(RETRY_MS, nextIdleCheckAt(now, windows).getTime() - Date.now());
    } catch (err) {
      delay = RETRY_MS;
      console.warn('[worker-start] schedule failed:', err instanceof Error ? err.message : err);
    }
    const started = await startWorkerMachines();
    if (started === 'failed') delay = Math.min(delay, RETRY_MS);
    setTimeout(() => void tick(), delay);
  };
  void tick();
}
