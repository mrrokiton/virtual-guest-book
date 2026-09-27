import { MEDIA_CHANNEL, parseMediaEvent, weddingScope, type MediaEvent } from '@vgb/db';
import pg from 'pg';
import { env } from './env';
import { db, video } from './server';
import { toGalleryItem, type GalleryItem } from './weddings';

export type LiveEvent =
  | { type: 'media.ready'; item: GalleryItem }
  | { type: 'media.removed'; id: string }
  | { type: 'resync' };

type Listener = (event: LiveEvent) => void;

interface Room {
  slug: string;
  listeners: Set<Listener>;
}

/**
 * One LISTEN connection per process fans Postgres notifications out to every open SSE stream.
 * Each event is resolved to a gallery item once, not once per subscriber.
 */
class RealtimeHub {
  private rooms = new Map<string, Room>();
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private everConnected = false;

  subscribe(weddingId: string, slug: string, listener: Listener): () => void {
    let room = this.rooms.get(weddingId);
    if (!room) {
      room = { slug, listeners: new Set() };
      this.rooms.set(weddingId, room);
    }
    room.listeners.add(listener);
    void this.ensureConnected();
    return () => {
      room.listeners.delete(listener);
      if (room.listeners.size === 0) this.rooms.delete(weddingId);
    };
  }

  get subscriberCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.listeners.size;
    return n;
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: env().DATABASE_URL });
    const lost = () => {
      if (this.client !== client) return;
      this.client = null;
      client.removeAllListeners();
      void client.end().catch(() => {});
      this.scheduleReconnect();
    };
    client.on('error', lost);
    client.on('end', lost);
    client.on('notification', (msg) => {
      if (msg.channel === MEDIA_CHANNEL) void this.dispatch(parseMediaEvent(msg.payload));
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${MEDIA_CHANNEL}`);
      this.client = client;
      // Notifications sent while we were disconnected are lost; let clients refetch.
      if (this.everConnected) this.broadcastAll({ type: 'resync' });
      this.everConnected = true;
    } catch (err) {
      console.error('[realtime] connect failed', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.rooms.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, 2000);
  }

  private broadcastAll(event: LiveEvent): void {
    for (const room of this.rooms.values()) for (const l of room.listeners) l(event);
  }

  private async dispatch(event: MediaEvent | null): Promise<void> {
    if (!event) return;
    const room = this.rooms.get(event.weddingId);
    if (!room) return;

    let live: LiveEvent;
    if (event.type === 'media.removed') {
      live = { type: 'media.removed', id: event.mediaId };
    } else {
      const media = await weddingScope(db(), event.weddingId).media.get(event.mediaId);
      if (!media || media.status !== 'ready') return;
      live = {
        type: 'media.ready',
        item: toGalleryItem(room.slug, media, video().name === 'cloudflare'),
      };
    }
    for (const l of room.listeners) l(live);
  }
}

const g = globalThis as typeof globalThis & { __vgbHub?: RealtimeHub };

export function hub(): RealtimeHub {
  return (g.__vgbHub ??= new RealtimeHub());
}
