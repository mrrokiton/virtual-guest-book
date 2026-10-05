import type {
  GuestSessionRole,
  MediaKind,
  MediaStatus,
  MusicKind,
  MusicStatus,
  PlanId,
  WeddingRole,
  WeddingStatus,
} from '@vgb/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const platformAdmins = pgTable('platform_admins', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

/** The paying customer (a couple today, a wedding planner later). Weddings belong to a tenant. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<'owner'>().notNull().default('owner'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    index('tenant_members_user_idx').on(t.userId),
  ],
);

export interface WeddingTheme {
  accent?: string;
  headline?: string;
}

export const weddings = pgTable(
  'weddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    eventDate: timestamp('event_date', { withTimezone: true }).notNull(),
    uploadDays: integer('upload_days').notNull(),
    plan: text('plan').$type<PlanId>().notNull().default('standard'),
    status: text('status').$type<WeddingStatus>().notNull().default('draft'),
    statusBeforeDeletion: text('status_before_deletion').$type<WeddingStatus>(),
    readOnlyAt: timestamp('read_only_at', { withTimezone: true }).notNull(),
    archiveAt: timestamp('archive_at', { withTimezone: true }).notNull(),
    purgeAt: timestamp('purge_at', { withTimezone: true }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockedReason: text('blocked_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    pinCiphertext: text('pin_ciphertext').notNull(),
    pinRotatedAt: timestamp('pin_rotated_at', { withTimezone: true }).notNull().defaultNow(),
    theme: jsonb('theme').$type<WeddingTheme>().notNull().default({}),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('weddings_slug_idx').on(t.slug),
    index('weddings_tenant_idx').on(t.tenantId),
    index('weddings_status_idx').on(t.status),
  ],
);

export const weddingMembers = pgTable(
  'wedding_members',
  {
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<WeddingRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.weddingId, t.userId] }),
    index('wedding_members_user_idx').on(t.userId),
  ],
);

export const weddingInvites = pgTable(
  'wedding_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<WeddingRole>().notNull().default('co_admin'),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wedding_invites_token_idx').on(t.tokenHash),
    index('wedding_invites_wedding_idx').on(t.weddingId),
  ],
);

export const weddingDjLinks = pgTable(
  'wedding_dj_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wedding_dj_links_token_idx').on(t.tokenHash),
    index('wedding_dj_links_wedding_idx').on(t.weddingId),
  ],
);

export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    role: text('role').$type<GuestSessionRole>().notNull().default('guest'),
    djLinkId: uuid('dj_link_id').references(() => weddingDjLinks.id, { onDelete: 'set null' }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('guest_sessions_wedding_idx').on(t.weddingId)],
);

export const musicSuggestions = pgTable(
  'music_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, {
      onDelete: 'set null',
    }),
    authorName: text('author_name'),
    kind: text('kind').$type<MusicKind>().notNull(),
    body: text('body').notNull(),
    bodyKey: text('body_key').notNull(),
    status: text('status').$type<MusicStatus>().notNull().default('open'),
    queueRank: integer('queue_rank'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index('music_suggestions_queue_idx').on(t.weddingId, t.deletedAt, t.status, t.queueRank),
    index('music_suggestions_session_idx').on(t.guestSessionId),
  ],
);

export interface PhotoVariantKeys {
  thumb?: string;
  large?: string;
  full?: string;
}

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, {
      onDelete: 'set null',
    }),
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    uploaderName: text('uploader_name'),
    kind: text('kind').$type<MediaKind>().notNull(),
    status: text('status').$type<MediaStatus>().notNull().default('uploading'),
    declaredContentType: text('declared_content_type').notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    sizeBytes: integer('size_bytes'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: real('duration_seconds'),
    originalKey: text('original_key'),
    variants: jsonb('variants').$type<PhotoVariantKeys>().notNull().default({}),
    videoProvider: text('video_provider').$type<'cloudflare' | 'local'>(),
    videoUid: text('video_uid'),
    failureReason: text('failure_reason'),
    reprocessAttempts: integer('reprocess_attempts').notNull().default(0),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    // Millisecond precision so (created_at, id) keyset cursors round-trip through JS Dates exactly.
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index('media_gallery_idx').on(t.weddingId, t.status, t.createdAt.desc(), t.id.desc()),
    index('media_session_idx').on(t.guestSessionId),
    uniqueIndex('media_video_uid_idx')
      .on(t.videoUid)
      .where(sql`${t.videoUid} is not null`),
  ],
);

/** Feature switch per wedding for future modules (song requests, voting, ...). */
export const weddingModules = pgTable(
  'wedding_modules',
  {
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.weddingId, t.moduleKey] })],
);

export const exports = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weddingId: uuid('wedding_id')
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    status: text('status')
      .$type<'pending' | 'running' | 'ready' | 'failed'>()
      .notNull()
      .default('pending'),
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    mediaCount: integer('media_count'),
    error: text('error'),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('exports_wedding_idx').on(t.weddingId, t.createdAt.desc())],
);

/** Kept after a wedding is purged, so no foreign key to weddings. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    weddingId: uuid('wedding_id'),
    actorType: text('actor_type').$type<'user' | 'guest' | 'system' | 'platform_admin'>().notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_wedding_idx').on(t.weddingId, t.createdAt.desc())],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});
