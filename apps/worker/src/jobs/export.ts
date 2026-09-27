import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  addDays,
  DELETION_GRACE_DAYS,
  planLimits,
  weddingStoragePrefix,
  type WeddingExportJob,
} from '@vgb/core';
import { getWeddingById, listOwnerEmails, weddingScope, type Media } from '@vgb/db';
import { emails } from '@vgb/services';
import { ZipArchive } from 'archiver';
import { dashboardUrl, type Context } from '../context';

const VIDEO_EXT: Record<string, string> = {
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function stamp(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
  return `${local.getFullYear()}-${pad(local.getMonth() + 1, 2)}-${pad(local.getDate(), 2)}_${pad(local.getHours(), 2)}${pad(local.getMinutes(), 2)}`;
}

function safeName(name: string | null): string {
  if (!name) return '';
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return cleaned ? `_${cleaned}` : '';
}

export function entryName(m: Media, index: number, total: number): string {
  const ext = m.kind === 'photo' ? 'jpg' : (VIDEO_EXT[m.declaredContentType] ?? 'mp4');
  const folder = m.kind === 'photo' ? 'zdjecia' : 'filmy';
  return `${folder}/${pad(index + 1, String(total).length)}_${stamp(m.createdAt)}${safeName(m.uploaderName)}.${ext}`;
}

export function exportKey(weddingId: string, exportId: string): string {
  return `${weddingStoragePrefix(weddingId)}exports/${exportId}.zip`;
}

async function openSource(ctx: Context, m: Media): Promise<Readable | null> {
  if (m.kind === 'photo') return m.variants.full ? ctx.storage.getStream(m.variants.full) : null;
  if (m.videoProvider === 'local')
    return m.originalKey ? ctx.storage.getStream(m.originalKey) : null;
  const url = await ctx.video.downloadUrl(m);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  return Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
}

/**
 * Streams every visible photo (full-size, EXIF-free) and video into a ZIP in storage. Files are
 * already compressed, so entries are stored rather than deflated; memory stays flat regardless
 * of gallery size.
 */
export async function exportWedding(ctx: Context, job: WeddingExportJob): Promise<void> {
  const scope = weddingScope(ctx.db, job.weddingId);
  const row = await scope.exports.get(job.exportId);
  if (!row || row.status === 'ready') return;
  const wedding = await getWeddingById(ctx.db, job.weddingId);
  if (!wedding || wedding.status === 'deleted') return;

  await scope.exports.update(row.id, { status: 'running', error: null });
  const items = await scope.media.listForExport();
  const key = exportKey(job.weddingId, row.id);

  const zip = new ZipArchive({ store: true });
  const body = new PassThrough();
  zip.pipe(body);
  const upload = ctx.storage.putStream(key, body, 'application/zip');
  const zipFailed = new Promise<never>((_, reject) => zip.on('error', reject));

  let included = 0;
  const skipped: string[] = [];
  try {
    const run = (async () => {
      for (const [i, m] of items.entries()) {
        const source = await openSource(ctx, m).catch(() => null);
        if (!source) {
          skipped.push(m.id);
          continue;
        }
        const done = new Promise<void>((resolve, reject) => {
          source.once('end', resolve);
          source.once('error', reject);
        });
        zip.append(source, { name: entryName(m, i, items.length), date: m.createdAt });
        await done;
        included += 1;
      }
      await zip.finalize();
      await upload;
    })();
    await Promise.race([run, zipFailed]);
  } catch (err) {
    zip.abort();
    body.destroy();
    await upload.catch(() => {});
    await scope.exports.update(row.id, {
      status: 'failed',
      error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
    });
    throw err;
  }

  const info = await ctx.storage.head(key);
  await scope.exports.update(row.id, {
    status: 'ready',
    objectKey: key,
    sizeBytes: info?.size ?? null,
    mediaCount: included,
    completedAt: ctx.now(),
    error: skipped.length
      ? `Pominięto ${skipped.length} plików, których nie udało się pobrać.`
      : null,
  });
  await scope.audit({
    actorType: 'system',
    action: 'export.ready',
    targetType: 'export',
    targetId: row.id,
    metadata: { included, skipped: skipped.length },
  });

  if (job.notify) {
    const availableUntil =
      wedding.purgeAt ??
      addDays(wedding.archiveAt, planLimits(wedding.plan).archiveDays + DELETION_GRACE_DAYS);
    const owners = await listOwnerEmails(ctx.db, wedding.id);
    await Promise.all(
      owners.map((o) =>
        ctx.mailer.send(
          emails.exportReady(o.email, {
            weddingName: wedding.name,
            url: `${dashboardUrl(ctx.cfg, wedding.id)}#export`,
            availableUntil,
          }),
        ),
      ),
    );
  }
}
