import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startWakeServer } from './wake-server';

const token = 'x'.repeat(40);
const onWake = vi.fn();
let server: Awaited<ReturnType<typeof startWakeServer>>;
let url: string;

beforeAll(async () => {
  server = await startWakeServer({ port: 0, token, onWake, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe('wake server', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await fetch(`${url}/wake`, { method: 'POST' })).status).toBe(401);
    const wrong = await fetch(`${url}/wake`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'y'.repeat(40)}` },
    });
    expect(wrong.status).toBe(401);
    expect(onWake).not.toHaveBeenCalled();
  });

  it('wakes the worker with the right token', async () => {
    const res = await fetch(`${url}/wake`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(202);
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('answers 404 to anything else', async () => {
    expect((await fetch(`${url}/wake`)).status).toBe(404);
    expect((await fetch(`${url}/other`, { method: 'POST' })).status).toBe(404);
  });
});
