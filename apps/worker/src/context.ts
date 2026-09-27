import { createDb, createPool, type Database } from '@vgb/db';
import {
  createMailer,
  createVideoProvider,
  parseServerConfig,
  Storage,
  type Mailer,
  type ServerConfig,
  type VideoProvider,
} from '@vgb/services';
import type { PgBoss } from 'pg-boss';

export interface Context {
  cfg: ServerConfig;
  db: Database;
  storage: Storage;
  video: VideoProvider;
  mailer: Mailer;
  boss: PgBoss;
  now: () => Date;
}

export function createServices(env: NodeJS.ProcessEnv = process.env): Omit<Context, 'boss'> {
  const cfg = parseServerConfig(env);
  const storage = new Storage(cfg);
  return {
    cfg,
    db: createDb(createPool(cfg.DATABASE_URL, 8)),
    storage,
    video: createVideoProvider(cfg, storage),
    mailer: createMailer(cfg),
    now: () => new Date(),
  };
}

export function dashboardUrl(cfg: ServerConfig, weddingId: string): string {
  return `${cfg.APP_URL}/dashboard/weddings/${weddingId}`;
}
