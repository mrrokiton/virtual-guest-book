import { and, count, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PlanId, WeddingLifecycle, WeddingRole, WeddingStatus } from '@vgb/core';
import type { Database } from './client';
import {
  media,
  platformAdmins,
  tenantMembers,
  tenants,
  user,
  weddingInvites,
  weddingMembers,
  weddings,
} from './schema';

export type Wedding = typeof weddings.$inferSelect;
export type WeddingPatch = Partial<Omit<typeof weddings.$inferInsert, 'id' | 'tenantId' | 'slug'>>;

export function toLifecycle(w: Wedding): WeddingLifecycle {
  return {
    status: w.status,
    statusBeforeDeletion: w.statusBeforeDeletion,
    plan: w.plan,
    readOnlyAt: w.readOnlyAt,
    archiveAt: w.archiveAt,
    purgeAt: w.purgeAt,
    blockedAt: w.blockedAt,
  };
}

export async function ensureTenantForUser(
  db: Database,
  userId: string,
  name: string,
): Promise<string> {
  const [existing] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId))
    .limit(1);
  if (existing) return existing.tenantId;

  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name }).returning({ id: tenants.id });
    await tx.insert(tenantMembers).values({ tenantId: tenant!.id, userId, role: 'owner' });
    return tenant!.id;
  });
}

export interface CreateWeddingInput {
  tenantId: string;
  createdByUserId: string;
  slug: string;
  name: string;
  eventDate: Date;
  uploadDays: number;
  plan: PlanId;
  readOnlyAt: Date;
  archiveAt: Date;
  pinCiphertext: string;
}

export async function createWedding(db: Database, input: CreateWeddingInput): Promise<Wedding> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(weddings).values(input).returning();
    await tx
      .insert(weddingMembers)
      .values({ weddingId: row!.id, userId: input.createdByUserId, role: 'owner' });
    return row!;
  });
}

export async function getWeddingById(db: Database, id: string): Promise<Wedding | null> {
  const [row] = await db.select().from(weddings).where(eq(weddings.id, id)).limit(1);
  return row ?? null;
}

export async function getWeddingBySlug(db: Database, slug: string): Promise<Wedding | null> {
  const [row] = await db.select().from(weddings).where(eq(weddings.slug, slug)).limit(1);
  return row ?? null;
}

export async function updateWedding(
  db: Database,
  id: string,
  patch: WeddingPatch,
): Promise<Wedding | null> {
  const [row] = await db
    .update(weddings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(weddings.id, id))
    .returning();
  return row ?? null;
}

/**
 * Moves a wedding to `transition.to` only if it is still in `from`, so concurrent lifecycle
 * ticks or double-clicked buttons cannot apply the same transition twice.
 */
export async function applyWeddingTransition(
  db: Database,
  id: string,
  from: WeddingStatus,
  transition: {
    to: WeddingStatus;
    purgeAt?: Date | null;
    statusBeforeDeletion?: WeddingStatus | null;
  },
): Promise<Wedding | null> {
  const patch: WeddingPatch = { status: transition.to, updatedAt: new Date() };
  if (transition.purgeAt !== undefined) patch.purgeAt = transition.purgeAt;
  if (transition.statusBeforeDeletion !== undefined)
    patch.statusBeforeDeletion = transition.statusBeforeDeletion;
  const [row] = await db
    .update(weddings)
    .set(patch)
    .where(and(eq(weddings.id, id), eq(weddings.status, from)))
    .returning();
  return row ?? null;
}

export async function deleteWeddingRow(db: Database, id: string): Promise<void> {
  await db.delete(weddings).where(eq(weddings.id, id));
}

export async function getMembershipRole(
  db: Database,
  weddingId: string,
  userId: string,
): Promise<WeddingRole | null> {
  const [row] = await db
    .select({ role: weddingMembers.role })
    .from(weddingMembers)
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export function listWeddingsForUser(db: Database, userId: string) {
  return db
    .select({ wedding: weddings, role: weddingMembers.role })
    .from(weddingMembers)
    .innerJoin(weddings, eq(weddings.id, weddingMembers.weddingId))
    .where(and(eq(weddingMembers.userId, userId), sql`${weddings.status} <> 'deleted'`))
    .orderBy(desc(weddings.eventDate));
}

export function listOwnerEmails(db: Database, weddingId: string) {
  return db
    .select({ email: user.email, name: user.name })
    .from(weddingMembers)
    .innerJoin(user, eq(user.id, weddingMembers.userId))
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.role, 'owner')));
}

/** Candidates for a time-driven transition; the exact rule is decided by core `dueTransition`. */
export function listLifecycleCandidates(db: Database, now: Date): Promise<Wedding[]> {
  return db
    .select()
    .from(weddings)
    .where(
      or(
        and(eq(weddings.status, 'active'), lte(weddings.readOnlyAt, now)),
        and(eq(weddings.status, 'read_only'), lte(weddings.archiveAt, now)),
        eq(weddings.status, 'archived'),
        and(eq(weddings.status, 'pending_deletion'), lte(weddings.purgeAt, now)),
      ),
    );
}

export async function isPlatformAdmin(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return Boolean(row);
}

export async function grantPlatformAdmin(db: Database, userId: string): Promise<void> {
  await db.insert(platformAdmins).values({ userId }).onConflictDoNothing();
}

/** Platform overview without any gallery content. */
export async function listAllWeddings(db: Database, opts: { limit: number; offset: number }) {
  const rows = await db
    .select({
      id: weddings.id,
      name: weddings.name,
      status: weddings.status,
      plan: weddings.plan,
      eventDate: weddings.eventDate,
      blockedAt: weddings.blockedAt,
      tenantName: tenants.name,
      createdAt: weddings.createdAt,
    })
    .from(weddings)
    .innerJoin(tenants, eq(tenants.id, weddings.tenantId))
    .orderBy(desc(weddings.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({ weddingId: media.weddingId, n: count() })
        .from(media)
        .where(and(inArray(media.weddingId, ids), isNull(media.deletedAt)))
        .groupBy(media.weddingId)
    : [];
  const byId = new Map(counts.map((c) => [c.weddingId, c.n]));
  return rows.map((r) => ({ ...r, mediaCount: byId.get(r.id) ?? 0 }));
}

export function listTenants(db: Database) {
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      createdAt: tenants.createdAt,
      ownerEmail: user.email,
    })
    .from(tenants)
    .leftJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .leftJoin(user, eq(user.id, tenantMembers.userId))
    .orderBy(desc(tenants.createdAt));
}

export type Invite = typeof weddingInvites.$inferSelect;

export async function createInvite(
  db: Database,
  values: {
    weddingId: string;
    email: string;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  },
): Promise<Invite> {
  const [row] = await db
    .insert(weddingInvites)
    .values({ ...values, role: 'co_admin' })
    .returning();
  return row!;
}

export async function findInviteByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<Invite | null> {
  const [row] = await db
    .select()
    .from(weddingInvites)
    .where(eq(weddingInvites.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export function listPendingInvites(db: Database, weddingId: string) {
  return db
    .select()
    .from(weddingInvites)
    .where(
      and(
        eq(weddingInvites.weddingId, weddingId),
        isNull(weddingInvites.acceptedAt),
        isNull(weddingInvites.revokedAt),
        sql`${weddingInvites.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(weddingInvites.createdAt));
}

export async function revokeInvite(
  db: Database,
  weddingId: string,
  inviteId: string,
): Promise<void> {
  await db
    .update(weddingInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(weddingInvites.weddingId, weddingId), eq(weddingInvites.id, inviteId)));
}

export async function acceptInvite(db: Database, invite: Invite, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(weddingInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(weddingInvites.id, invite.id));
    await tx
      .insert(weddingMembers)
      .values({ weddingId: invite.weddingId, userId, role: invite.role })
      .onConflictDoNothing();
  });
}
