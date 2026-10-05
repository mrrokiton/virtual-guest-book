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
import {
  disableFairQueue,
  enableFairQueue,
  insertMusicSuggestion,
  type GuestSessionRole,
  type MusicAuthorLoad,
  type MusicKind,
  type MusicQueueItem,
  type MusicStatus,
} from '@vgb/core';
import type { MediaStatus } from '@vgb/core';
import type { Database } from './client';
import { decodeCursor, encodeCursor } from './cursor';
import {
  auditLog,
  exports,
  guestSessions,
  media,
  musicSuggestions,
  weddingDjLinks,
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
export type MusicSuggestion = typeof musicSuggestions.$inferSelect;

function toQueueItem(row: MusicSuggestion): MusicQueueItem {
  return {
    id: row.id,
    sessionId: row.guestSessionId ?? row.id,
    createdAt: row.createdAt,
    queueRank: row.queueRank,
  };
}

function authorLoads(rows: MusicSuggestion[]): MusicAuthorLoad[] {
  const loads = new Map<string, MusicAuthorLoad>();
  for (const row of rows) {
    if (row.deletedAt || !row.guestSessionId) continue;
    const current = loads.get(row.guestSessionId) ?? {
      sessionId: row.guestSessionId,
      openCount: 0,
      doneCount: 0,
    };
    if (row.status === 'open') current.openCount += 1;
    else current.doneCount += 1;
    loads.set(row.guestSessionId, current);
  }
  return [...loads.values()];
}

async function writeMusicRanks(db: Database, weddingId: string, ranked: MusicQueueItem[]) {
  for (const item of ranked) {
    if (item.queueRank == null) continue;
    await db
      .update(musicSuggestions)
      .set({ queueRank: item.queueRank })
      .where(and(eq(musicSuggestions.weddingId, weddingId), eq(musicSuggestions.id, item.id)));
  }
}

export function weddingScope(db: Database, weddingId: string) {
  const mediaIn = (...conds: (SQL | undefined)[]) => and(eq(media.weddingId, weddingId), ...conds);
  const musicWhere = (...conds: (SQL | undefined)[]) =>
    and(eq(musicSuggestions.weddingId, weddingId), ...conds);

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
      async create(values: {
        displayName: string | null;
        role?: GuestSessionRole;
        djLinkId?: string | null;
      }): Promise<GuestSession> {
        const [row] = await db
          .insert(guestSessions)
          .values({
            weddingId,
            displayName: values.displayName,
            role: values.role ?? 'guest',
            djLinkId: values.djLinkId ?? null,
            termsAcceptedAt: new Date(),
          })
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

      async revokeForLink(linkId: string): Promise<void> {
        await db
          .update(guestSessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(guestSessions.weddingId, weddingId),
              eq(guestSessions.djLinkId, linkId),
              isNull(guestSessions.revokedAt),
            ),
          );
      },
    },

    djLinks: {
      async create(values: { tokenHash: string; label: string | null; createdByUserId: string }) {
        const [row] = await db
          .insert(weddingDjLinks)
          .values({ weddingId, ...values })
          .returning();
        return row!;
      },

      list() {
        return db
          .select()
          .from(weddingDjLinks)
          .where(eq(weddingDjLinks.weddingId, weddingId))
          .orderBy(desc(weddingDjLinks.createdAt));
      },

      async getActiveByTokenHash(tokenHash: string) {
        const [row] = await db
          .select()
          .from(weddingDjLinks)
          .where(
            and(
              eq(weddingDjLinks.weddingId, weddingId),
              eq(weddingDjLinks.tokenHash, tokenHash),
              isNull(weddingDjLinks.revokedAt),
            ),
          )
          .limit(1);
        return row ?? null;
      },

      async revoke(id: string) {
        const [row] = await db
          .update(weddingDjLinks)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(weddingDjLinks.weddingId, weddingId),
              eq(weddingDjLinks.id, id),
              isNull(weddingDjLinks.revokedAt),
            ),
          )
          .returning();
        return row ?? null;
      },
    },

    music: {
      listOpen() {
        return db
          .select()
          .from(musicSuggestions)
          .where(
            musicWhere(isNull(musicSuggestions.deletedAt), eq(musicSuggestions.status, 'open')),
          )
          .orderBy(musicSuggestions.queueRank, musicSuggestions.createdAt, musicSuggestions.id);
      },

      listHistory() {
        return db
          .select()
          .from(musicSuggestions)
          .where(
            musicWhere(
              isNull(musicSuggestions.deletedAt),
              inArray(musicSuggestions.status, ['played', 'skipped']),
            ),
          )
          .orderBy(desc(musicSuggestions.statusChangedAt), desc(musicSuggestions.id));
      },

      async get(id: string) {
        const [row] = await db
          .select()
          .from(musicSuggestions)
          .where(musicWhere(eq(musicSuggestions.id, id), isNull(musicSuggestions.deletedAt)))
          .limit(1);
        return row ?? null;
      },

      async hasActiveDuplicate(sessionId: string, kind: MusicKind, bodyKey: string) {
        const [row] = await db
          .select({ id: musicSuggestions.id })
          .from(musicSuggestions)
          .where(
            musicWhere(
              eq(musicSuggestions.guestSessionId, sessionId),
              eq(musicSuggestions.kind, kind),
              eq(musicSuggestions.bodyKey, bodyKey),
              isNull(musicSuggestions.deletedAt),
            ),
          )
          .limit(1);
        return Boolean(row);
      },

      async durableCapInput(sessionId: string) {
        const rows = await db
          .select({
            sessionId: musicSuggestions.guestSessionId,
            n: count(),
          })
          .from(musicSuggestions)
          .where(eq(musicSuggestions.weddingId, weddingId))
          .groupBy(musicSuggestions.guestSessionId);
        let total = 0;
        let mine = 0;
        let authorCount = 0;
        for (const row of rows) {
          total += row.n;
          if (row.n > 0) authorCount += 1;
          if (row.sessionId === sessionId) mine = row.n;
        }
        return { mine, totalDurable: total, authorCount };
      },

      async create(values: {
        guestSessionId: string;
        authorName: string | null;
        kind: MusicKind;
        body: string;
        bodyKey: string;
        fairQueue: boolean;
      }) {
        return db.transaction(async (tx) => {
          const trx = tx as unknown as Database;
          const [created] = await trx
            .insert(musicSuggestions)
            .values({
              weddingId,
              guestSessionId: values.guestSessionId,
              authorName: values.authorName,
              kind: values.kind,
              body: values.body,
              bodyKey: values.bodyKey,
              status: 'open',
            })
            .returning();
          const row = created!;
          const existing = await trx
            .select()
            .from(musicSuggestions)
            .where(
              and(eq(musicSuggestions.weddingId, weddingId), isNull(musicSuggestions.deletedAt)),
            );
          const open = existing.filter((item) => item.status === 'open' && item.id !== row.id);
          const ranked = insertMusicSuggestion({
            fairQueue: values.fairQueue,
            open: open.map(toQueueItem),
            insert: toQueueItem(row),
            authors: authorLoads(existing),
          });
          await writeMusicRanks(trx, weddingId, ranked);
          const placed = ranked.find((item) => item.id === row.id);
          return { ...row, queueRank: placed?.queueRank ?? row.queueRank };
        });
      },

      async setStatus(id: string, status: MusicStatus) {
        const [row] = await db
          .update(musicSuggestions)
          .set({
            status,
            statusChangedAt: status === 'open' ? null : new Date(),
          })
          .where(
            musicWhere(
              eq(musicSuggestions.id, id),
              isNull(musicSuggestions.deletedAt),
              ne(musicSuggestions.status, status),
            ),
          )
          .returning();
        return row ?? null;
      },

      async softDelete(id: string, sessionId: string) {
        const [row] = await db
          .update(musicSuggestions)
          .set({ deletedAt: new Date() })
          .where(
            musicWhere(
              eq(musicSuggestions.id, id),
              eq(musicSuggestions.guestSessionId, sessionId),
              isNull(musicSuggestions.deletedAt),
            ),
          )
          .returning();
        return row ?? null;
      },

      async rerank(fairQueue: boolean) {
        await db.transaction(async (tx) => {
          const trx = tx as unknown as Database;
          const existing = await trx
            .select()
            .from(musicSuggestions)
            .where(
              and(eq(musicSuggestions.weddingId, weddingId), isNull(musicSuggestions.deletedAt)),
            );
          const open = existing.filter((item) => item.status === 'open').map(toQueueItem);
          const ranked = fairQueue
            ? enableFairQueue(open, authorLoads(existing))
            : disableFairQueue(open);
          await writeMusicRanks(trx, weddingId, ranked);
        });
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
