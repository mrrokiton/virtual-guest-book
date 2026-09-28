import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { MediaStatus } from '@vgb/core';
import type { Database } from './client';
import { decodeCursor, encodeCursor } from './cursor';
import {
  auditLog,
  exports,
  guestSessions,
  media,
  weddingMembers,
  weddingModules,
  user,
} from './schema';

export type Media = typeof media.$inferSelect;
export type NewMedia = Omit<typeof media.$inferInsert, 'id' | 'weddingId' | 'createdAt'>;
export type GuestSession = typeof guestSessions.$inferSelect;
export type ExportRow = typeof exports.$inferSelect;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuditEntry {
  actorType: (typeof auditLog.$inferInsert)['actorType'];
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

const MAX_PAGE = 100;
const COUNTED_STATUSES: MediaStatus[] = ['uploading', 'processing', 'ready', 'hidden'];
const UPLOAD_COUNTED_FOR_MS = 60 * 60 * 1000;

/**
 * The only way application code reads or writes per-wedding rows. Every query built here is
 * constrained to `weddingId`, so a bug in a caller cannot leak another wedding's data.
 */
export function weddingScope(db: Database, weddingId: string) {
  const mediaIn = (...conds: (SQL | undefined)[]) => and(eq(media.weddingId, weddingId), ...conds);

  async function mediaPage(
    where: SQL | undefined,
    cursor: string | null | undefined,
    limit: number,
  ) {
    const size = Math.min(Math.max(limit, 1), MAX_PAGE);
    const c = decodeCursor(cursor);
    const rows = await db
      .select()
      .from(media)
      .where(
        mediaIn(
          where,
          c
            ? sql`(${media.createdAt}, ${media.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(media.createdAt), desc(media.id))
      .limit(size + 1);
    const items = rows.slice(0, size);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > size && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    } satisfies Page<Media>;
  }

  return {
    weddingId,

    media: {
      async create(values: NewMedia): Promise<Media> {
        const [row] = await db
          .insert(media)
          .values({ ...values, weddingId, createdAt: new Date() })
          .returning();
        return row!;
      },

      async get(id: string): Promise<Media | null> {
        const [row] = await db
          .select()
          .from(media)
          .where(mediaIn(eq(media.id, id)))
          .limit(1);
        return row ?? null;
      },

      async getByVideoUid(uid: string): Promise<Media | null> {
        const [row] = await db
          .select()
          .from(media)
          .where(mediaIn(eq(media.videoUid, uid)))
          .limit(1);
        return row ?? null;
      },

      /**
       * With `from`, the row changes only if it is still in one of those statuses (null otherwise),
       * so a late webhook or job cannot overwrite a moderator's or guest's newer decision.
       */
      async update(
        id: string,
        patch: Partial<NewMedia>,
        opts: { from?: MediaStatus[] } = {},
      ): Promise<Media | null> {
        const [row] = await db
          .update(media)
          .set(patch)
          .where(
            mediaIn(eq(media.id, id), opts.from ? inArray(media.status, opts.from) : undefined),
          )
          .returning();
        return row ?? null;
      },

      async updateMany(ids: string[], patch: Partial<NewMedia>): Promise<Media[]> {
        if (ids.length === 0) return [];
        return db
          .update(media)
          .set(patch)
          .where(mediaIn(inArray(media.id, ids)))
          .returning();
      },

      /** What guests see: processed and not moderated away. */
      gallery(opts: { cursor?: string | null; limit?: number } = {}) {
        return mediaPage(eq(media.status, 'ready'), opts.cursor, opts.limit ?? 30);
      },

      /** What admins see: everything that still exists. */
      adminList(opts: { cursor?: string | null; limit?: number } = {}) {
        return mediaPage(
          notInArray(media.status, ['deleted', 'uploading']),
          opts.cursor,
          opts.limit ?? 60,
        );
      },

      /** Uploads that never finished stop counting after a while so they cannot block the quota. */
      async usage(now = new Date()): Promise<{ total: number; videos: number }> {
        const abandonedBefore = new Date(now.getTime() - UPLOAD_COUNTED_FOR_MS);
        const rows = await db
          .select({ kind: media.kind, n: count() })
          .from(media)
          .where(
            mediaIn(
              inArray(media.status, COUNTED_STATUSES),
              or(ne(media.status, 'uploading'), gt(media.createdAt, abandonedBefore)),
            ),
          )
          .groupBy(media.kind);
        const total = rows.reduce((sum, r) => sum + r.n, 0);
        return { total, videos: rows.find((r) => r.kind === 'video')?.n ?? 0 };
      },

      listForExport(): Promise<Media[]> {
        return db
          .select()
          .from(media)
          .where(mediaIn(eq(media.status, 'ready')))
          .orderBy(media.createdAt);
      },

      listUnpurged(): Promise<Media[]> {
        return db
          .select()
          .from(media)
          .where(mediaIn(isNull(media.purgedAt)));
      },
    },

    guestSessions: {
      async create(values: { displayName: string | null }): Promise<GuestSession> {
        const [row] = await db
          .insert(guestSessions)
          .values({ weddingId, displayName: values.displayName, termsAcceptedAt: new Date() })
          .returning();
        return row!;
      },

      async getActive(id: string): Promise<GuestSession | null> {
        const [row] = await db
          .select()
          .from(guestSessions)
          .where(
            and(
              eq(guestSessions.weddingId, weddingId),
              eq(guestSessions.id, id),
              isNull(guestSessions.revokedAt),
            ),
          )
          .limit(1);
        return row ?? null;
      },

      async touch(id: string): Promise<void> {
        await db
          .update(guestSessions)
          .set({ lastSeenAt: new Date() })
          .where(and(eq(guestSessions.weddingId, weddingId), eq(guestSessions.id, id)));
      },

      async revokeAll(): Promise<void> {
        await db
          .update(guestSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(guestSessions.weddingId, weddingId), isNull(guestSessions.revokedAt)));
      },
    },

    members: {
      list() {
        return db
          .select({
            userId: weddingMembers.userId,
            role: weddingMembers.role,
            name: user.name,
            email: user.email,
          })
          .from(weddingMembers)
          .innerJoin(user, eq(user.id, weddingMembers.userId))
          .where(eq(weddingMembers.weddingId, weddingId))
          .orderBy(weddingMembers.createdAt);
      },

      async remove(userId: string): Promise<void> {
        await db
          .delete(weddingMembers)
          .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)));
      },
    },

    modules: {
      list() {
        return db.select().from(weddingModules).where(eq(weddingModules.weddingId, weddingId));
      },

      async isEnabled(moduleKey: string): Promise<boolean> {
        const [row] = await db
          .select({ enabled: weddingModules.enabled })
          .from(weddingModules)
          .where(
            and(eq(weddingModules.weddingId, weddingId), eq(weddingModules.moduleKey, moduleKey)),
          );
        return row?.enabled ?? false;
      },

      async set(
        moduleKey: string,
        enabled: boolean,
        config: Record<string, unknown> = {},
      ): Promise<void> {
        await db
          .insert(weddingModules)
          .values({ weddingId, moduleKey, enabled, config })
          .onConflictDoUpdate({
            target: [weddingModules.weddingId, weddingModules.moduleKey],
            set: { enabled, config, updatedAt: new Date() },
          });
      },
    },

    exports: {
      async create(requestedByUserId: string | null): Promise<ExportRow> {
        const [row] = await db.insert(exports).values({ weddingId, requestedByUserId }).returning();
        return row!;
      },

      async latest(): Promise<ExportRow | null> {
        const [row] = await db
          .select()
          .from(exports)
          .where(eq(exports.weddingId, weddingId))
          .orderBy(desc(exports.createdAt))
          .limit(1);
        return row ?? null;
      },

      async get(id: string): Promise<ExportRow | null> {
        const [row] = await db
          .select()
          .from(exports)
          .where(and(eq(exports.weddingId, weddingId), eq(exports.id, id)))
          .limit(1);
        return row ?? null;
      },

      async update(
        id: string,
        patch: Partial<typeof exports.$inferInsert>,
        opts: { from?: ExportRow['status'][] } = {},
      ): Promise<ExportRow | null> {
        const [row] = await db
          .update(exports)
          .set(patch)
          .where(
            and(
              eq(exports.weddingId, weddingId),
              eq(exports.id, id),
              opts.from ? inArray(exports.status, opts.from) : undefined,
            ),
          )
          .returning();
        return row ?? null;
      },
    },

    async audit(entry: AuditEntry): Promise<void> {
      await db.insert(auditLog).values({
        weddingId,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata ?? {},
      });
    },

    auditTrail(limit = 50) {
      return db
        .select()
        .from(auditLog)
        .where(eq(auditLog.weddingId, weddingId))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit);
    },
  };
}

export type WeddingScope = ReturnType<typeof weddingScope>;
