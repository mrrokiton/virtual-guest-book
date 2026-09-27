import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerDir = fileURLToPath(new URL('../../worker', import.meta.url));

/** Photo processing needs the worker; run it for the duration of the suite. */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_WORKER) return;
  const child: ChildProcess = spawn('pnpm', ['start'], {
    cwd: workerDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker did not start within 60s')), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[worker] ${chunk}`);
      if (chunk.toString().includes('[worker] started')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[worker] ${chunk}`));
    child.on('exit', (code) => reject(new Error(`Worker exited early with code ${code}`)));
  });

  return async () => {
    child.kill('SIGTERM');
  };
}
