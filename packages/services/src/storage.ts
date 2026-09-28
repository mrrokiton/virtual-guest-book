import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ServerConfig } from './config';

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

export class ObjectTooLargeError extends Error {
  constructor(key: string, size: number) {
    super(`Object ${key} is ${size} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

/** S3-compatible object storage (Cloudflare R2 in production, MinIO locally). Bucket is private. */
export class Storage {
  private readonly client: S3Client;
  /** Presigned URLs are consumed by browsers, which may reach storage on a different host. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(cfg: ServerConfig) {
    const base = {
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: cfg.S3_ENDPOINT });
    this.presignClient = new S3Client({
      ...base,
      endpoint: cfg.S3_PUBLIC_ENDPOINT ?? cfg.S3_ENDPOINT,
    });
    this.bucket = cfg.S3_BUCKET;
  }

  presignPut(key: string, contentType: string, expiresIn = 15 * 60): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  presignGet(
    key: string,
    opts: { expiresIn?: number; downloadName?: string } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: opts.downloadName
          ? `attachment; filename="${opts.downloadName.replace(/[^\w.-]/g, '_')}"`
          : undefined,
      }),
      { expiresIn: opts.expiresIn ?? 10 * 60 },
    );
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        (err.$metadata.httpStatusCode === 404 || err.name === 'NotFound')
      ) {
        return null;
      }
      throw err;
    }
  }

  async getHead(key: string, bytes: number): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return res.Body ? res.Body.transformToByteArray() : new Uint8Array();
  }

  async getBuffer(key: string, opts: { maxBytes?: number } = {}): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    if (opts.maxBytes !== undefined && (res.ContentLength ?? 0) > opts.maxBytes) {
      (res.Body as Readable).destroy();
      throw new ObjectTooLargeError(key, res.ContentLength ?? 0);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    return res.Body as Readable;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Multipart upload of a stream of unknown length (used for ZIP exports). */
  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      partSize: 16 * 1024 * 1024,
      queueSize: 2,
    }).done();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length) {
        const res = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        // Partial failures still come back as HTTP 200.
        if (res.Errors?.length) {
          const first = res.Errors[0]!;
          throw new Error(
            `Failed to delete ${res.Errors.length} objects under ${prefix}: ${first.Key} ${first.Code}`,
          );
        }
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
