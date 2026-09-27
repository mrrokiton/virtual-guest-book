import { createDb, createPool, type Database } from '@vgb/db';
import {
  createMailer,
  createVideoProvider,
  Storage,
  type Mailer,
  type VideoProvider,
} from '@vgb/services';
import { env } from './env';

interface Singletons {
  db?: Database;
  storage?: Storage;
  video?: VideoProvider;
  mailer?: Mailer;
}

// Survives dev hot reloads so we don't leak connection pools.
const g = globalThis as typeof globalThis & { __vgb?: Singletons };
const s: Singletons = (g.__vgb ??= {});

export function db(): Database {
  return (s.db ??= createDb(createPool(env().DATABASE_URL, 10)));
}

export function storage(): Storage {
  return (s.storage ??= new Storage(env()));
}

export function video(): VideoProvider {
  return (s.video ??= createVideoProvider(env(), storage()));
}

export function mailer(): Mailer {
  return (s.mailer ??= createMailer(env()));
}
