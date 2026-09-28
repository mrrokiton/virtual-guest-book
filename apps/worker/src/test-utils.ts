import { Readable } from 'node:stream';
import { computeSchedule, generateSlug, type PlanId } from '@vgb/core';
import { createWedding, ensureTenantForUser, type Database } from '@vgb/db';
import { createTestDb, insertTestUser } from '@vgb/db/testing';
import {
  ObjectTooLargeError,
  type EmailMessage,
  type ServerConfig,
  type Storage,
  type VideoProvider,
} from '@vgb/services';
import type { PgBoss } from 'pg-boss';
import { vi } from 'vitest';
import type { Context } from './context';

export class MemoryStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async putStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c as Uint8Array));
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
  }
  async getBuffer(key: string, opts: { maxBytes?: number } = {}) {
    const o = this.objects.get(key);
    if (!o) throw new Error(`NoSuchKey ${key}`);
    if (opts.maxBytes !== undefined && o.body.length > opts.maxBytes)
      throw new ObjectTooLargeError(key, o.body.length);
    return o.body;
  }
  async getStream(key: string) {
    return Readable.from(await this.getBuffer(key));
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, contentType: o.contentType } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async deletePrefix(prefix: string) {
    let n = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(prefix)) {
        this.objects.delete(k);
        n += 1;
      }
    }
    return n;
  }
}

export interface TestContext extends Context {
  sent: { queue: string; data: unknown; options?: unknown }[];
  mails: EmailMessage[];
  memory: MemoryStorage;
  setNow: (d: Date) => void;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const { db, close } = await createTestDb();
  let now = new Date();
  const sent: TestContext['sent'] = [];
  const mails: EmailMessage[] = [];
  const memory = new MemoryStorage();
  const video = {
    name: 'local',
    readyOnUpload: true,
    delete: vi.fn(async () => {}),
    downloadUrl: vi.fn(async () => null),
    enableDownload: vi.fn(async () => {}),
    state: vi.fn(async () => ({ state: 'pending' })),
  } as unknown as VideoProvider;

  return {
    cfg: { APP_URL: 'https://app.test' } as ServerConfig,
    db,
    storage: memory as unknown as Storage,
    video,
    mailer: { send: async (m: EmailMessage) => void mails.push(m) },
    boss: {
      send: async (queue: string, data: unknown, options?: unknown) => {
        sent.push({ queue, data, options });
        return 'job-id';
      },
    } as unknown as PgBoss,
    now: () => now,
    setNow: (d) => {
      now = d;
    },
    sent,
    mails,
    memory,
    close,
  };
}

export async function makeWedding(
  db: Database,
  opts: { eventDate: Date; plan?: PlanId; status?: 'draft' | 'active' },
) {
  const owner = await insertTestUser(db);
  const tenantId = await ensureTenantForUser(db, owner.id, 'Test');
  const plan = opts.plan ?? 'standard';
  const wedding = await createWedding(db, {
    tenantId,
    createdByUserId: owner.id,
    slug: generateSlug(),
    name: 'Ania i Tomek',
    eventDate: opts.eventDate,
    uploadDays: 7,
    plan,
    pinCiphertext: 'x',
    ...computeSchedule(opts.eventDate, 7, plan),
  });
  return { owner, wedding };
}
