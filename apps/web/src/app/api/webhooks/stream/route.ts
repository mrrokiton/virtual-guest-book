import { mediaPurgeRequest, PENDING_MEDIA_STATUSES } from '@vgb/core';
import { markMediaFailed, markVideoReady, weddingScope } from '@vgb/db';
import { verifyStreamWebhook, type StreamWebhook } from '@vgb/services';
import { env } from '@/lib/env';
import { isUuid } from '@/lib/session';
import { db, video } from '@/lib/server';
import { enqueue } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const cfg = env();
  if (cfg.VIDEO_PROVIDER !== 'cloudflare' || !cfg.CLOUDFLARE_STREAM_WEBHOOK_SECRET) {
    return new Response('Not found', { status: 404 });
  }
  const body = await req.text();
  if (
    !verifyStreamWebhook(
      cfg.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
      req.headers.get('webhook-signature'),
      body,
    )
  ) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: StreamWebhook;
  try {
    payload = JSON.parse(body) as StreamWebhook;
  } catch {
    return new Response('Bad payload', { status: 400 });
  }
  const weddingId = payload.meta?.weddingId;
  if (!weddingId || !isUuid(weddingId)) return new Response('Ignored', { status: 202 });

  const scope = weddingScope(db(), weddingId);
  const media = await scope.media.getByVideoUid(payload.uid);
  if (!media || media.status === 'deleted') {
    // Uploaded but already deleted on our side (or unknown): don't keep the video around.
    await video().delete({
      id: '',
      weddingId,
      videoUid: payload.uid,
      originalKey: null,
      declaredContentType: '',
    });
    return new Response('Gone', { status: 202 });
  }

  // Redeliveries and late webhooks must not revive hidden, failed or already-ready videos.
  if (!PENDING_MEDIA_STATUSES.includes(media.status)) return new Response('OK');

  if (payload.readyToStream && payload.status.state === 'ready') {
    // Before the status flips, so a retried webhook still finds the video pending.
    await video().enableDownload(media);
    await markVideoReady(
      db(),
      media,
      {
        durationSeconds: payload.duration,
        width: payload.input?.width,
        height: payload.input?.height,
      },
      new Date(),
    );
  } else if (payload.status.state === 'error') {
    const reason =
      payload.status.errorReasonCode ?? payload.status.errorReasonText ?? 'stream_error';
    if (await markMediaFailed(db(), media, reason)) {
      await enqueue(...mediaPurgeRequest(weddingId, media.id));
    }
  }
  return new Response('OK');
}
