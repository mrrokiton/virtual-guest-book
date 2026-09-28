import { createHmac, createSign } from 'node:crypto';
import { constantTimeEqual, mediaStorageKey } from '@vgb/core';
import type { ServerConfig } from './config';
import type { Storage } from './storage';

export interface VideoRef {
  id: string;
  weddingId: string;
  videoUid: string | null;
  originalKey: string | null;
  declaredContentType: string;
}

export type VideoUpload =
  /** Browser POSTs multipart form data with a `file` field (Cloudflare Stream direct creator upload). */
  | { method: 'POST_FORM'; url: string; videoUid: string; originalKey: null }
  /** Browser PUTs the raw file with the given Content-Type (S3 presigned URL). */
  | { method: 'PUT'; url: string; videoUid: null; originalKey: string };

export type Playback = { type: 'iframe'; url: string } | { type: 'file'; url: string };

export type VideoState =
  | { state: 'pending' }
  | {
      state: 'ready';
      durationSeconds?: number;
      width?: number;
      height?: number;
    }
  | { state: 'failed'; reason: string };

export interface VideoProvider {
  readonly name: 'cloudflare' | 'local';
  /** Local videos are playable as soon as the upload lands; Stream needs a webhook first. */
  readonly readyOnUpload: boolean;
  createUpload(input: {
    weddingId: string;
    mediaId: string;
    contentType: string;
    maxDurationSeconds: number;
  }): Promise<VideoUpload>;
  playback(video: VideoRef): Promise<Playback | null>;
  thumbnailUrl(video: VideoRef): Promise<string | null>;
  /** A URL the worker can fetch the MP4 from (for ZIP exports). */
  downloadUrl(video: VideoRef): Promise<string | null>;
  enableDownload(video: VideoRef): Promise<void>;
  delete(video: VideoRef): Promise<void>;
  /** Processing state straight from the provider, for when its webhook never arrived. */
  state(video: VideoRef): Promise<VideoState>;
}

const TOKEN_TTL_SECONDS = 60 * 60;

class LocalVideoProvider implements VideoProvider {
  readonly name = 'local' as const;
  readonly readyOnUpload = true;

  constructor(private readonly storage: Storage) {}

  async createUpload(input: {
    weddingId: string;
    mediaId: string;
    contentType: string;
  }): Promise<VideoUpload> {
    const key = mediaStorageKey(input.weddingId, input.mediaId, 'video');
    return {
      method: 'PUT',
      url: await this.storage.presignPut(key, input.contentType),
      videoUid: null,
      originalKey: key,
    };
  }

  async playback(video: VideoRef): Promise<Playback | null> {
    return video.originalKey
      ? { type: 'file', url: await this.storage.presignGet(video.originalKey) }
      : null;
  }

  async thumbnailUrl(): Promise<string | null> {
    return null;
  }

  async downloadUrl(video: VideoRef): Promise<string | null> {
    return video.originalKey
      ? this.storage.presignGet(video.originalKey, { expiresIn: 3600 })
      : null;
  }

  async enableDownload(): Promise<void> {}

  async delete(video: VideoRef): Promise<void> {
    if (video.originalKey) await this.storage.delete(video.originalKey);
  }

  async state(video: VideoRef): Promise<VideoState> {
    return video.originalKey && (await this.storage.head(video.originalKey))
      ? { state: 'ready' }
      : { state: 'failed', reason: 'missing_original' };
  }
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

class CloudflareStreamProvider implements VideoProvider {
  readonly name = 'cloudflare' as const;
  readonly readyOnUpload = false;
  private readonly api: string;
  private readonly media: string;
  private readonly pem: string;

  constructor(private readonly cfg: ServerConfig) {
    this.api = `https://api.cloudflare.com/client/v4/accounts/${cfg.CLOUDFLARE_ACCOUNT_ID}/stream`;
    this.media = `https://customer-${cfg.CLOUDFLARE_STREAM_CUSTOMER_CODE}.cloudflarestream.com`;
    const raw = cfg.CLOUDFLARE_STREAM_SIGNING_KEY_PEM!;
    this.pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.CLOUDFLARE_STREAM_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (init.method === 'DELETE' && (res.ok || res.status === 404)) return undefined as T;
    const body = (await res.json()) as CloudflareEnvelope<T>;
    if (!res.ok || !body.success) {
      throw new Error(
        `Cloudflare Stream ${path} failed: ${body.errors?.map((e) => e.message).join(', ') || res.status}`,
      );
    }
    return body.result;
  }

  /** Signed playback token (RS256 JWT) so videos are only reachable through our authorization. */
  private token(uid: string, opts: { downloadable?: boolean } = {}): string {
    const header = { alg: 'RS256', kid: this.cfg.CLOUDFLARE_STREAM_SIGNING_KEY_ID };
    const payload = {
      sub: uid,
      kid: this.cfg.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      ...(opts.downloadable ? { downloadable: true } : {}),
    };
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${enc(header)}.${enc(payload)}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.pem)
      .toString('base64url');
    return `${unsigned}.${signature}`;
  }

  async createUpload(input: {
    weddingId: string;
    mediaId: string;
    maxDurationSeconds: number;
  }): Promise<VideoUpload> {
    const result = await this.call<{ uid: string; uploadURL: string }>('/direct_upload', {
      method: 'POST',
      body: JSON.stringify({
        maxDurationSeconds: input.maxDurationSeconds,
        requireSignedURLs: true,
        expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        meta: { weddingId: input.weddingId, mediaId: input.mediaId },
      }),
    });
    return { method: 'POST_FORM', url: result.uploadURL, videoUid: result.uid, originalKey: null };
  }

  async playback(video: VideoRef): Promise<Playback | null> {
    return video.videoUid
      ? { type: 'iframe', url: `${this.media}/${this.token(video.videoUid)}/iframe` }
      : null;
  }

  async thumbnailUrl(video: VideoRef): Promise<string | null> {
    return video.videoUid
      ? `${this.media}/${this.token(video.videoUid)}/thumbnails/thumbnail.jpg?height=400`
      : null;
  }

  async downloadUrl(video: VideoRef): Promise<string | null> {
    return video.videoUid
      ? `${this.media}/${this.token(video.videoUid, { downloadable: true })}/downloads/default.mp4`
      : null;
  }

  async enableDownload(video: VideoRef): Promise<void> {
    if (video.videoUid) await this.call(`/${video.videoUid}/downloads`, { method: 'POST' });
  }

  async delete(video: VideoRef): Promise<void> {
    if (video.videoUid) await this.call(`/${video.videoUid}`, { method: 'DELETE' });
  }

  async state(video: VideoRef): Promise<VideoState> {
    if (!video.videoUid) return { state: 'failed', reason: 'missing_video' };
    const res = await fetch(`${this.api}/${video.videoUid}`, {
      headers: { Authorization: `Bearer ${this.cfg.CLOUDFLARE_STREAM_API_TOKEN}` },
    });
    if (res.status === 404) return { state: 'failed', reason: 'missing_video' };
    const body = (await res.json()) as CloudflareEnvelope<Omit<StreamWebhook, 'meta'>>;
    if (!res.ok || !body.success) {
      throw new Error(
        `Cloudflare Stream state ${video.videoUid} failed: ${body.errors?.map((e) => e.message).join(', ') || res.status}`,
      );
    }
    const v = body.result;
    if (v.readyToStream && v.status.state === 'ready') {
      return {
        state: 'ready',
        durationSeconds: v.duration,
        width: v.input?.width,
        height: v.input?.height,
      };
    }
    if (v.status.state === 'error') {
      return {
        state: 'failed',
        reason: v.status.errorReasonCode ?? v.status.errorReasonText ?? 'stream_error',
      };
    }
    return { state: 'pending' };
  }
}

export function createVideoProvider(cfg: ServerConfig, storage: Storage): VideoProvider {
  return cfg.VIDEO_PROVIDER === 'cloudflare'
    ? new CloudflareStreamProvider(cfg)
    : new LocalVideoProvider(storage);
}

export interface StreamWebhook {
  uid: string;
  readyToStream: boolean;
  status: { state: string; errorReasonCode?: string; errorReasonText?: string };
  duration?: number;
  input?: { width?: number; height?: number };
  meta?: Record<string, string>;
}

/** Cloudflare `Webhook-Signature: time=<unix>,sig1=<hex hmac-sha256(secret, "<time>.<body>")>`. */
export function verifyStreamWebhook(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const time = Number(parts.time);
  if (!parts.sig1 || !Number.isFinite(time) || Math.abs(nowSeconds - time) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${parts.time}.${body}`).digest('hex');
  return constantTimeEqual(expected, parts.sig1);
}
