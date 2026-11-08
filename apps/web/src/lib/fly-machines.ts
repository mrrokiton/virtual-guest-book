import { env } from './env';

const STARTABLE = new Set(['stopped', 'suspended', 'created']);

export interface FlyMachineSnapshot {
  id: string;
  state: string;
  /** Non-empty when this machine is a standby for those ids. Standbys stay stopped. */
  config?: { standbys?: string[] };
}

/** Machines web should start. A standby lists the primary in `config.standbys` and is left alone. */
export function machinesToStart(machines: FlyMachineSnapshot[]): string[] {
  return machines
    .filter((m) => STARTABLE.has(m.state) && !(m.config?.standbys && m.config.standbys.length > 0))
    .map((m) => m.id);
}

export type StartResult = 'skipped' | 'started' | 'failed';

/** Starts stopped worker machines. No token: nothing to do, which keeps local and CI unchanged. */
export async function startWorkerMachines(): Promise<StartResult> {
  const { FLY_API_TOKEN: token, FLY_WORKER_APP: app } = env();
  if (!token) return 'skipped';
  const headers = { authorization: `Bearer ${token}` };
  let listed: Response;
  try {
    listed = await fetch(`https://api.machines.dev/v1/apps/${app}/machines`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn('[worker-start] list failed:', err instanceof Error ? err.message : err);
    return 'failed';
  }
  if (!listed.ok) {
    console.warn('[worker-start] list status %d', listed.status);
    return 'failed';
  }
  const machines = (await listed.json()) as FlyMachineSnapshot[];
  const ids = machinesToStart(Array.isArray(machines) ? machines : []);
  if (ids.length === 0) return 'skipped';
  let ok = true;
  for (const id of ids) {
    try {
      const started = await fetch(`https://api.machines.dev/v1/apps/${app}/machines/${id}/start`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!started.ok) {
        ok = false;
        console.warn('[worker-start] %s status %d', id, started.status);
      }
    } catch (err) {
      ok = false;
      console.warn('[worker-start] %s failed:', id, err instanceof Error ? err.message : err);
    }
  }
  return ok ? 'started' : 'failed';
}
