import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { constantTimeEqual } from '@vgb/core';

/**
 * Private endpoint web calls after it enqueues a job, so a sleeping worker picks the job up in
 * seconds instead of at its next hourly tick. On Fly it is reachable only over the private network.
 */
export async function startWakeServer(opts: {
  port: number;
  token: string;
  onWake: () => void;
  host?: string;
}): Promise<Server> {
  const expected = `Bearer ${opts.token}`;
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/wake') {
      res.writeHead(404).end();
      return;
    }
    if (!constantTimeEqual(req.headers.authorization ?? '', expected)) {
      res.writeHead(401).end();
      return;
    }
    opts.onWake();
    res.writeHead(202).end();
  });
  server.listen(opts.port, opts.host ?? '::');
  await once(server, 'listening');
  return server;
}
