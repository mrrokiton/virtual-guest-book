import {
  and,
  asc,
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
  bingoSubmissions,
  bingoTasks,
  bingoValidators,
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
export type BingoTask = typeof bingoTasks.$inferSelect;
export type BingoValidator = typeof bingoValidators.$inferSelect;
export type BingoSubmission = typeof bingoSubmissions.$inferSelect;

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
  const bingoTaskWhere = (...conds: (SQL | undefined)[]) =>
    and(eq(bingoTasks.weddingId, weddingId), ...conds);
  const bingoSubmissionWhere = (...conds: (SQL | undefined)[]) =>
    and(eq(bingoSubmissions.weddingId, weddingId), ...conds);
  const notBingoMedia = sql`not exists (
    select 1 from ${bingoSubmissions}
    where ${bingoSubmissions.mediaId} = ${media.id}
  )`;

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
        return mediaPage(
          and(eq(media.status, 'ready'), notBingoMedia),
          opts.cursor,
          opts.limit ?? 30,
        );
      },

      /** What admins see: everything that still exists. */
      adminList(opts: { cursor?: string | null; limit?: number } = {}) {
        return mediaPage(
          and(notInArray(media.status, ['deleted', 'uploading']), notBingoMedia),
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
          .where(mediaIn(eq(media.status, 'ready'), notBingoMedia))
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

      async setDisplayName(id: string, displayName: string): Promise<GuestSession | null> {
        const [row] = await db
          .update(guestSessions)
          .set({ displayName, lastSeenAt: new Date() })
          .where(
            and(
              eq(guestSessions.weddingId, weddingId),
              eq(guestSessions.id, id),
              isNull(guestSessions.revokedAt),
            ),
          )
          .returning();
        return row ?? null;
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

    bingo: {
      tasks: {
        list(includeArchived = false) {
          return db
            .select()
            .from(bingoTasks)
            .where(bingoTaskWhere(includeArchived ? undefined : isNull(bingoTasks.archivedAt)))
            .orderBy(asc(bingoTasks.position), asc(bingoTasks.createdAt));
        },

        async create(body: string) {
          const [position] = await db
            .select({ next: sql<number>`coalesce(max(${bingoTasks.position}), -1) + 1` })
            .from(bingoTasks)
            .where(bingoTaskWhere(isNull(bingoTasks.archivedAt)));
          const [row] = await db
            .insert(bingoTasks)
            .values({ weddingId, body, position: Number(position?.next ?? 0) })
            .returning();
          return row!;
        },

        async update(id: string, body: string) {
          const [row] = await db
            .update(bingoTasks)
            .set({ body, updatedAt: new Date() })
            .where(bingoTaskWhere(eq(bingoTasks.id, id), isNull(bingoTasks.archivedAt)))
            .returning();
          return row ?? null;
        },

        async reorder(ids: string[]) {
          await db.transaction(async (tx) => {
            for (const [position, id] of ids.entries()) {
              await tx
                .update(bingoTasks)
                .set({ position, updatedAt: new Date() })
                .where(
                  and(
                    eq(bingoTasks.weddingId, weddingId),
                    eq(bingoTasks.id, id),
                    isNull(bingoTasks.archivedAt),
                  ),
                );
            }
          });
        },

        async remove(id: string) {
          return db.transaction(async (tx) => {
            const [used] = await tx
              .select({ n: count() })
              .from(bingoSubmissions)
              .where(
                and(eq(bingoSubmissions.weddingId, weddingId), eq(bingoSubmissions.taskId, id)),
              );
            if ((used?.n ?? 0) > 0) {
              const [row] = await tx
                .update(bingoTasks)
                .set({ archivedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(bingoTasks.weddingId, weddingId),
                    eq(bingoTasks.id, id),
                    isNull(bingoTasks.archivedAt),
                  ),
                )
                .returning();
              return row ? 'archived' : null;
            }
            const [row] = await tx
              .delete(bingoTasks)
              .where(and(eq(bingoTasks.weddingId, weddingId), eq(bingoTasks.id, id)))
              .returning();
            return row ? 'deleted' : null;
          });
        },
      },

      validators: {
        list() {
          return db
            .select()
            .from(bingoValidators)
            .where(eq(bingoValidators.weddingId, weddingId))
            .orderBy(asc(bingoValidators.position), asc(bingoValidators.createdAt));
        },

        async create(fullName: string, nickname: string | null) {
          const [position] = await db
            .select({ next: sql<number>`coalesce(max(${bingoValidators.position}), -1) + 1` })
            .from(bingoValidators)
            .where(eq(bingoValidators.weddingId, weddingId));
          const [row] = await db
            .insert(bingoValidators)
            .values({ weddingId, fullName, nickname, position: Number(position?.next ?? 0) })
            .returning();
          return row!;
        },

        async update(id: string, fullName: string, nickname: string | null) {
          const [row] = await db
            .update(bingoValidators)
            .set({ fullName, nickname, updatedAt: new Date() })
            .where(and(eq(bingoValidators.weddingId, weddingId), eq(bingoValidators.id, id)))
            .returning();
          return row ?? null;
        },

        async remove(id: string) {
          const [row] = await db
            .delete(bingoValidators)
            .where(and(eq(bingoValidators.weddingId, weddingId), eq(bingoValidators.id, id)))
            .returning();
          return row ?? null;
        },
      },

      async createUpload(values: {
        taskId: string;
        guestSessionId: string;
        replaceSubmissionId?: string | null;
        media: NewMedia;
      }) {
        return db.transaction(async (tx) => {
          let replacedMediaId: string | null = null;
          const [task] = await tx
            .select({ id: bingoTasks.id })
            .from(bingoTasks)
            .where(
              and(
                eq(bingoTasks.weddingId, weddingId),
                eq(bingoTasks.id, values.taskId),
                isNull(bingoTasks.archivedAt),
              ),
            )
            .limit(1);
          const [session] = await tx
            .select({ id: guestSessions.id })
            .from(guestSessions)
            .where(
              and(
                eq(guestSessions.weddingId, weddingId),
                eq(guestSessions.id, values.guestSessionId),
                isNull(guestSessions.revokedAt),
              ),
            )
            .limit(1);
          if (!task || !session) return null;

          if (values.replaceSubmissionId) {
            const [old] = await tx
              .update(bingoSubmissions)
              .set({ withdrawnAt: new Date() })
              .where(
                and(
                  eq(bingoSubmissions.weddingId, weddingId),
                  eq(bingoSubmissions.id, values.replaceSubmissionId),
                  eq(bingoSubmissions.taskId, values.taskId),
                  eq(bingoSubmissions.guestSessionId, values.guestSessionId),
                  isNull(bingoSubmissions.withdrawnAt),
                ),
              )
              .returning({ mediaId: bingoSubmissions.mediaId });
            if (!old) return null;
            replacedMediaId = old.mediaId;
            await tx
              .update(media)
              .set({ status: 'deleted', deletedAt: new Date() })
              .where(and(eq(media.weddingId, weddingId), eq(media.id, old.mediaId)));
          }

          const [createdMedia] = await tx
            .insert(media)
            .values({ ...values.media, weddingId, createdAt: new Date() })
            .returning();
          const [submission] = await tx
            .insert(bingoSubmissions)
            .values({
              weddingId,
              taskId: values.taskId,
              guestSessionId: values.guestSessionId,
              mediaId: createdMedia!.id,
            })
            .returning();
          return { media: createdMedia!, submission: submission!, replacedMediaId };
        });
      },

      async getSubmissionByMedia(mediaId: string) {
        const [row] = await db
          .select()
          .from(bingoSubmissions)
          .where(bingoSubmissionWhere(eq(bingoSubmissions.mediaId, mediaId)))
          .limit(1);
        return row ?? null;
      },

      async markSubmitted(mediaId: string) {
        const [row] = await db
          .update(bingoSubmissions)
          .set({ submittedAt: new Date() })
          .where(
            bingoSubmissionWhere(
              eq(bingoSubmissions.mediaId, mediaId),
              isNull(bingoSubmissions.withdrawnAt),
            ),
          )
          .returning();
        return row ?? null;
      },

      async withdrawOwned(mediaId: string, guestSessionId: string) {
        return db.transaction(async (tx) => {
          const [submission] = await tx
            .update(bingoSubmissions)
            .set({ withdrawnAt: new Date() })
            .where(
              and(
                eq(bingoSubmissions.weddingId, weddingId),
                eq(bingoSubmissions.mediaId, mediaId),
                eq(bingoSubmissions.guestSessionId, guestSessionId),
                isNull(bingoSubmissions.withdrawnAt),
              ),
            )
            .returning();
          if (!submission) return null;
          const [removed] = await tx
            .update(media)
            .set({ status: 'deleted', deletedAt: new Date() })
            .where(
              and(
                eq(media.weddingId, weddingId),
                eq(media.id, mediaId),
                eq(media.guestSessionId, guestSessionId),
                notInArray(media.status, ['deleted']),
              ),
            )
            .returning();
          if (!removed) throw new Error('Bingo media could not be withdrawn');
          return { submission, media: removed };
        });
      },

      async verify(
        submissionId: string,
        status: 'accepted' | 'rejected',
        userId: string,
        rejectionReason: string | null,
      ) {
        const [row] = await db
          .update(bingoSubmissions)
          .set({
            status,
            rejectionReason: status === 'rejected' ? rejectionReason : null,
            verifiedAt: new Date(),
            verifiedByUserId: userId,
          })
          .where(
            bingoSubmissionWhere(
              eq(bingoSubmissions.id, submissionId),
              isNull(bingoSubmissions.withdrawnAt),
              sql`exists (
                select 1 from ${media}
                where ${media.id} = ${bingoSubmissions.mediaId}
                  and ${media.weddingId} = ${weddingId}
                  and ${media.status} = 'ready'
              )`,
            ),
          )
          .returning();
        return row ?? null;
      },

      guestData(guestSessionId: string) {
        return Promise.all([
          this.tasks.list(false),
          this.validators.list(),
          db
            .select({
              submission: bingoSubmissions,
              media,
            })
            .from(bingoSubmissions)
            .innerJoin(
              media,
              and(
                eq(media.id, bingoSubmissions.mediaId),
                eq(media.weddingId, bingoSubmissions.weddingId),
              ),
            )
            .where(
              bingoSubmissionWhere(
                eq(bingoSubmissions.guestSessionId, guestSessionId),
                isNull(bingoSubmissions.withdrawnAt),
              ),
            ),
        ]).then(([tasks, validators, submissions]) => ({ tasks, validators, submissions }));
      },

      adminSubmissions() {
        return db
          .select({
            submission: bingoSubmissions,
            task: bingoTasks,
            media,
            guestName: guestSessions.displayName,
          })
          .from(bingoSubmissions)
          .innerJoin(
            bingoTasks,
            and(
              eq(bingoTasks.id, bingoSubmissions.taskId),
              eq(bingoTasks.weddingId, bingoSubmissions.weddingId),
            ),
          )
          .innerJoin(
            guestSessions,
            and(
              eq(guestSessions.id, bingoSubmissions.guestSessionId),
              eq(guestSessions.weddingId, bingoSubmissions.weddingId),
            ),
          )
          .innerJoin(
            media,
            and(
              eq(media.id, bingoSubmissions.mediaId),
              eq(media.weddingId, bingoSubmissions.weddingId),
            ),
          )
          .where(
            bingoSubmissionWhere(isNull(bingoSubmissions.withdrawnAt), eq(media.status, 'ready')),
          )
          .orderBy(desc(bingoSubmissions.createdAt));
      },

      listForExport() {
        return db
          .select({
            media,
            task: bingoTasks,
            submission: bingoSubmissions,
          })
          .from(bingoSubmissions)
          .innerJoin(
            bingoTasks,
            and(
              eq(bingoTasks.id, bingoSubmissions.taskId),
              eq(bingoTasks.weddingId, bingoSubmissions.weddingId),
            ),
          )
          .innerJoin(
            media,
            and(
              eq(media.id, bingoSubmissions.mediaId),
              eq(media.weddingId, bingoSubmissions.weddingId),
            ),
          )
          .where(
            bingoSubmissionWhere(
              isNull(bingoSubmissions.withdrawnAt),
              inArray(bingoSubmissions.status, ['pending', 'accepted']),
              eq(media.status, 'ready'),
            ),
          )
          .orderBy(asc(bingoTasks.position), asc(media.createdAt));
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
