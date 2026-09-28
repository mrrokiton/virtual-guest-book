import { resolveGuest } from '@/lib/guest';
import { hub, type LiveEvent } from '@/lib/realtime';
import { jsonError } from '@/lib/request';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;
/** A few tabs per device is normal; hundreds from one PIN session is abuse. */
const MAX_STREAMS_PER_SESSION = 4;
/**
 * Per machine, so one wedding cannot take the whole Fly connection limit (soft 800). Guests
 * turned away here fall back to polling.
 */
const MAX_STREAMS_PER_WEDDING = 300;

const g = globalThis as typeof globalThis & {
  __vgbStreams?: Map<string, number>;
  __vgbWeddingStreams?: Map<string, number>;
};
const openStreams = (g.__vgbStreams ??= new Map());
const openWeddingStreams = (g.__vgbWeddingStreams ??= new Map());

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrement(counts: Map<string, number>, key: string) {
  const n = (counts.get(key) ?? 1) - 1;
  if (n <= 0) counts.delete(key);
  else counts.set(key, n);
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guest = await resolveGuest(slug);
  if (!guest) return jsonError(401, 'Brak dostępu.');
  const sessionId = guest.session.id;
  const weddingId = guest.wedding.id;
  if ((openStreams.get(sessionId) ?? 0) >= MAX_STREAMS_PER_SESSION) {
    return jsonError(429, 'Za dużo otwartych kart z galerią.');
  }
  if ((openWeddingStreams.get(weddingId) ?? 0) >= MAX_STREAMS_PER_WEDDING) {
    return jsonError(429, 'Za dużo osób ogląda teraz galerię na żywo.');
  }
  increment(openStreams, sessionId);
  increment(openWeddingStreams, weddingId);
  const release = () => {
    decrement(openStreams, sessionId);
    decrement(openWeddingStreams, weddingId);
  };

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: LiveEvent) =>
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

      write('retry: 3000\n\n');
      const unsubscribe = hub().subscribe(guest.wedding.id, slug, send);
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        release();
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
        cleanup = () => {};
      };
      req.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
