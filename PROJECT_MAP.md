# Project map

Last verified against the code: 2026-09-28.

This file is the architectural reference for AI coding agents. It describes what the repository implements today. Sections marked **Planned** are not in the code.

Product name in the UI: Wirtualna księga gości. npm package name: `virtual-guest-book`.

## Project overview

Guests scan a QR code, enter a wedding PIN, and upload photos and short videos without an account. Everyone with a valid guest session sees one live gallery. The couple manages the wedding in a dashboard: printable QR, moderation, co-admins, and a ZIP export. After the retention window, media is deleted automatically.

**Status.** MVP stages 0–11 from `tasks/todo.md` are implemented in code. Staging, production accounts, a completed k6 run, and a formal `/cso` review are not done. See [Known limitations](#known-limitations).

### Stack

| Layer           | Choice                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript, `strict`, Node `>=22` (Docker and CI use Node 24)                                               |
| Package manager | pnpm 12.6.0, workspace `apps/*`, `packages/*`, `packages/modules/*`                                         |
| Web             | Next.js 16 App Router, React 19, Tailwind CSS 4, small `components/ui` set                                  |
| Auth (couple)   | Better Auth: email + password (min 10, email verification required), magic link (no signup), password reset |
| Database        | PostgreSQL 17 locally, Drizzle ORM, migrations in `packages/db/drizzle`                                     |
| Queue           | pg-boss in the same Postgres database                                                                       |
| Object storage  | S3 API. MinIO locally, Cloudflare R2 in the production config                                               |
| Video           | `VIDEO_PROVIDER=local` (object in the bucket) or `cloudflare` (Cloudflare Stream)                           |
| Images          | `sharp` plus `heic-convert` in the worker                                                                   |
| Email           | Resend when `RESEND_API_KEY` is set, otherwise SMTP (`SMTP_URL`, Mailpit locally)                           |
| Errors          | Sentry when `SENTRY_DSN` is set (`apps/web/src/instrumentation.ts`, worker `src/index.ts`)                  |
| Tests           | Vitest (unit and PGlite), Playwright (`apps/web/e2e`), k6 script (`load/k6-wedding.js`)                     |
| Deploy config   | Fly.io, region `fra`: apps `vgb-web` and `vgb-worker`                                                       |

### Architecture

Modular monolith plus a worker. Domain rules live in `@vgb/core` and do not import Next, Drizzle, or AWS. Persistence goes through `@vgb/db`. Shared I/O (config, S3, video, email) lives in `@vgb/services`. Both apps read the repo-root `.env`.

```
Browser (guest or couple)
    |
    v
apps/web  Next.js  --server actions-->  Postgres (Drizzle)
    |  \                                  ^
    |   \-- presigned PUT --------------> |  R2 / MinIO
    |   \-- Stream direct upload -------> |  Cloudflare Stream (optional)
    |                                     |
    +-- pg-boss send ---------------------+
    +-- LISTEN vgb_media <--- NOTIFY -----+
                                          |
apps/worker  pg-boss jobs ---------------+
    |-- sharp / heic-convert / ZIP
    |-- delete objects and Stream videos
    +-- queue emails
```

Apps must not import `drizzle-orm` directly. ESLint enforces that in `apps/**` so queries stay inside `@vgb/db`, usually behind `weddingScope(db, weddingId)`.

## Directory structure

| Path                                    | Responsibility                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`                              | Next.js app: guest zone, dashboard, admin, legal pages, route handlers, SSE hub                   |
| `apps/web/src/app`                      | App Router pages and route handlers                                                               |
| `apps/web/src/app/w/[slug]`             | Guest photos at `/w/[slug]`. Suggestions at `/w/[slug]/music`. DJ entry at `/w/[slug]/dj/[token]` |
| `apps/web/src/app/dashboard`            | Couple panel and `actions.ts` server actions                                                      |
| `apps/web/src/app/admin`                | Platform admin list, block, and approve                                                           |
| `apps/web/src/app/(auth)`               | Login, register, forgot password, reset password                                                  |
| `apps/web/src/app/invite/[token]`       | Accept a co-admin invite                                                                          |
| `apps/web/src/app/(legal)`              | `/regulamin`, `/prywatnosc`                                                                       |
| `apps/web/src/app/api`                  | HTTP API (guest, files, health, Better Auth, Stream webhook, QR, ZIP redirect)                    |
| `apps/web/src/components/guest`         | PIN form, DJ entry, upload queue, live gallery, lightbox, music list and section nav              |
| `apps/web/src/components/ui`            | `button`, `input`, `card`                                                                         |
| `apps/web/src/lib`                      | Auth, guest cookie, session checks, jobs, realtime hub, env                                       |
| `apps/web/src/proxy.ts`                 | Request hook: CSP and `X-Robots-Tag` on guest, API, dashboard, and invite paths                   |
| `apps/web/scripts/create-superadmin.ts` | Grants `platform_admins` for an email                                                             |
| `apps/worker`                           | pg-boss process. Started with `tsx`, not a bundle (`sharp`)                                       |
| `apps/worker/src/jobs`                  | Photo processing, media purge, ZIP export, wedding purge, lifecycle, email                        |
| `packages/core`                         | Wedding state machine, plans, permissions, PIN/slug, media detection, music caps and queue order  |
| `packages/db`                           | Drizzle schema, migrations, `weddingScope`, rate limits, NOTIFY                                   |
| `packages/db/src/testing.ts`            | PGlite helper. Exported as `@vgb/db/testing`                                                      |
| `packages/services`                     | Zod env, S3 client, video providers, mailer and email templates                                   |
| `docs/runbook.md`                       | Production diagnosis and first-time setup. Polish                                                 |
| `tasks/todo.md`                         | Approved MVP plan and explicit deviations. Polish. Historical, not a live tracker                 |
| `tasks/music-suggestions.md`            | Plan for DJ music suggestions. Implemented                                                        |
| `load/k6-wedding.js`                    | Load script. Needs `BASE_URL` and `WEDDINGS="slug:PIN,..."`                                       |
| `docker-compose.yml`                    | Postgres 17, MinIO, MinIO bucket setup, Mailpit                                                   |
| `.github/workflows/ci.yml`              | `check` (format, lint, typecheck, test, build) then `e2e` on compose                              |

`pnpm-workspace.yaml` includes `packages/modules/*`. That directory does not exist. `wedding_modules` holds per-wedding flags. The implemented key is `music_requests` (`enabled`, `config.fairQueue`).

## Architecture relationships

| Piece             | Talks to                    | How                                                                                    |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| Guest browser     | `apps/web`                  | Pages plus `/api/w/[slug]/*`. Cookie `vgb_g_<weddingId without dashes>`                |
| Guest browser     | R2 or MinIO                 | Presigned `PUT` for photos and local videos                                            |
| Guest browser     | Cloudflare Stream           | `POST` multipart when `VIDEO_PROVIDER=cloudflare`                                      |
| Couple browser    | `apps/web`                  | Better Auth session cookie, server actions under `/dashboard`                          |
| `apps/web`        | Postgres                    | Drizzle pool max 10 in `apps/web/src/lib/server.ts`. Separate `pg.Client` for `LISTEN` |
| `apps/web`        | pg-boss                     | Producer only (`apps/web/src/lib/jobs.ts`)                                             |
| `apps/worker`     | Postgres                    | Drizzle pool max 8 in `apps/worker/src/context.ts`, plus pg-boss (`max: 6`)            |
| `apps/worker`     | R2 / MinIO                  | Read originals, write variants and ZIPs, delete prefixes                               |
| `apps/worker`     | Stream, Resend or SMTP      | Video state, MP4 for ZIP, outbound mail                                                |
| Cloudflare Stream | `POST /api/webhooks/stream` | Signed webhook. Route returns 404 unless provider is `cloudflare`                      |

Production shape in `docs/runbook.md` and `fly.toml`: Fly `vgb-web` (512 MB, min 1 machine, connection concurrency soft 800) and `vgb-worker` (1 GB). Worker deploy runs migrations (`release_command`) and must go out before web. Postgres is expected to be a direct Neon connection in Frankfurt: transaction-mode poolers break `LISTEN/NOTIFY` and pg-boss. The repo does not contain live credentials or a checked-in production deploy.

Local substitutes: Postgres and MinIO from `docker-compose.yml`, `VIDEO_PROVIDER=local`, Mailpit on `http://localhost:8025`.

## Data flow

### Couple

1. `authClient.signUp.email` creates a Better Auth user. `databaseHooks.user.create.after` calls `ensureTenantForUser` (tenant plus `tenant_members.role = owner`).
2. Email verification is required before password login. Magic link is sign-in only (`disableSignUp: true`, 10 minutes).
3. `createWeddingAction` inserts a `draft` wedding on plan `standard`, with a random slug, an AES-256-GCM PIN (`PIN_ENCRYPTION_KEY`), and `readOnlyAt` / `archiveAt` from `computeSchedule`.
4. A platform admin must set `approvedAt` (`approveWeddingAction`) before `activateWeddingAction` can move `draft` to `active`.
5. Dashboard pages: overview, print QR (`/print` and `GET /api/admin/weddings/[id]/qr`), settings, media moderation, team.
6. Co-admin invite: raw token emailed, SHA-256 hash stored, TTL 7 days, role `co_admin`. Accept at `/invite/[token]`.
7. Owner can schedule deletion (14-day grace, `DELETION_GRACE_DAYS`) and restore. Co-admin cannot (`wedding.delete` / `wedding.restore` are owner-only).

### Guest upload and gallery

1. `POST /api/w/[slug]/session` checks PIN with `constantTimeEqual` after `normalizePin`. Success creates `guest_sessions` and sets an HMAC cookie (`GUEST_SESSION_SECRET`, 180 days, `httpOnly`, `SameSite=Lax`).
2. `POST /api/w/[slug]/uploads` checks plan limits, inserts `media` as `uploading`, and returns a presigned PUT (photo or local video) or a Stream form upload. Quota counts `uploading`, `processing`, `ready`, and `hidden`. An `uploading` row stops counting after 1 hour (`UPLOAD_COUNTED_FOR_MS`). `failed` and `deleted` do not count.
3. The browser uploads the bytes, then `POST .../uploads/[mediaId]/complete`.
4. Photos move to `processing` and enqueue `photo-process`. The worker sniffs magic bytes (`detectMedia`), converts HEIC, strips EXIF, writes variants `thumb` (400 webp), `large` (1600 webp), and `full` (4096 jpeg), then publishes `media.ready`.
5. Cloudflare videos stay `processing` until the webhook calls `markVideoReady`. Local videos become `ready` in `/complete` after a 64-byte sniff, then `publishMediaEvent`.
6. Gallery: `GET /api/w/[slug]/media` calls `media.gallery` (status `ready` only) and returns cursor pages (`limit` default 30, max 60). Wedding members use the same ready-only feed. The dashboard media page uses `media.adminList` (everything except `deleted` and `uploading`). File bytes are never proxied. `GET .../file` defaults to `v=large`. `v=thumb|large|full` redirects to a 10-minute signed URL. `?v=play` returns JSON `{ type: 'iframe' | 'file', url }`. Stream playback tokens last 1 hour (`TOKEN_TTL_SECONDS` in `packages/services/src/video.ts`).
7. Live updates: `GET /api/w/[slug]/events` (SSE). `RealtimeHub` holds one `LISTEN vgb_media` per web process. Events are `media.ready`, `media.removed`, `music.changed`, and `resync`. The gallery merges media rows (`use-live-gallery.ts`). The music page refetches `GET /music` on `music.changed` (`use-live-music.ts`). After 3 EventSource failures the client polls every 10 s. Postgres reconnect sends `resync`. A page keeps one stream.

### Music suggestions

Off unless `wedding_modules.module_key = music_requests` is enabled. The couple toggles that and `config.fairQueue` in wedding settings (`wedding.edit`). They also create DJ links. Only the SHA-256 of the token is stored. The URL `/w/[slug]/dj/[token]` creates a `guest_sessions` row with `role = dj`. That session can upload like a guest and can set suggestion status. It does not get dashboard access. PIN rotation that revokes guest sessions also revokes DJ sessions. The link still works and creates a new one.

Guests add `track` or `genre` text while `guestCanUpload` is true. The list stays readable in `read_only`. Rows are soft-deleted. The share cap is `musicCreateCap` in `@vgb/core`: minimum 3, two above the per-author average, hard stop 40. Soft-deleted and already handled rows still count. There is also a pace limit of 8 creates per 10 minutes per session.

Photos stay on `/w/[slug]`. Suggestions are a separate page, `/w/[slug]/music`. The sticky header links **Zdjęcia** and **Utwory** only while the module is enabled. `/music` redirects to the gallery when the module is off. An already open music page that then gets 404 keeps the list and hides the form. The upload bar is mounted for both guest pages, so a queued photo keeps going when the guest opens tracks. DJ entry stays outside that group. Create, delete, status change, and a fair-queue rerank publish `music.changed` on `vgb_media`. That event carries only `weddingId`. The music page replaces `open`, `history`, and the caps from `GET /music` and leaves the form draft in place. Order still comes from `listOpen` and `listHistory`. The music page shows only the three most recently closed suggestions.

Fair queue off: open rows follow `created_at`. Fair queue on: the first 3 open rows keep their `queue_rank`. New rows are inserted only after that head. Rank is written on create and when the couple changes the setting, not on page refresh. Marking `played` or `skipped` hides the row from the queue and keeps its rank, so undo puts it back. Everyone sees `author_name` (or "Gość"). Session ids are not in the JSON.

### Lifecycle

`lifecycle-tick` is a pg-boss singleton, cron `*/10 * * * *`, also sent once at worker start.

`dueTransition` in `packages/core/src/wedding.ts`:

`active` (when `now >= readOnlyAt`) → `read_only` → (`now >= archiveAt`) `archived` → (after plan `archiveDays`) `pending_deletion` with `purgeAt = now + 14 days` → `wedding-purge`.

`purgeWedding` first sets status to `deleted` (so restore cannot race), deletes Stream videos and the `weddings/<id>/` prefix, writes `audit_log` action `wedding.purged`, then `deleteWeddingRow`. Cascade removes media, guest sessions, members, and exports. The audit row stays.

On `archived`, the worker creates an `exports` row and enqueues `wedding-export` with `notify: true`. Owners get `emails.exportReady`. On `deletion_scheduled`, owners get `emails.deletionScheduled`, and a reminder job is scheduled 3 days before `purgeAt` (`DELETION_REMINDER_DAYS`) when that time is still in the future.

The same tick fails uploads stuck in `uploading` for 24 hours, redrives photos stuck in `processing` for 60 minutes (max `MAX_PHOTO_REDRIVES` = 3), checks Stream state for stuck videos, and enqueues `media-purge` for rows deleted more than 1 hour ago.

Hard delete removes storage under `weddings/<weddingId>/` and Stream videos, then `deleteWeddingRow`. `audit_log` has no foreign key to `weddings`, so it can outlive the wedding.

## API documentation

JSON errors from `jsonError` are `{ error, ...extra }`. `DomainError` adds `code` and uses `httpStatusFor`:

| Code                | HTTP |
| ------------------- | ---- |
| `invalid_input`     | 400  |
| `unauthorized`      | 401  |
| `forbidden`         | 403  |
| `not_found`         | 404  |
| `invalid_state`     | 409  |
| `limit_exceeded`    | 413  |
| `unsupported_media` | 415  |
| `rate_limited`      | 429  |

Guest mutations (`session`, `uploads`, `complete`, `DELETE media`) reject a cross-site `Origin` (`crossOriginResponse`, 403). A missing `Origin` is allowed.

Unknown wedding access returns 404, not 403 (`checkWeddingAccess` / `requireWeddingAccess`), so ids cannot be probed.

### Better Auth

`GET` and `POST /api/auth/[...all]` delegate to Better Auth. The app calls `signUp.email`, `signIn.email`, `signIn.magicLink`, `requestPasswordReset`, `resetPassword`, and `signOut`. Session length is 30 days. Production rate limit is 30 requests per 60 seconds, stored in `rate_limits` with key prefix `auth:`, keyed by `fly-client-ip` when present.

There is no second auth system. Guest access is the HMAC cookie, not Better Auth.

### Guest routes

All under `/api/w/[slug]`. Slug must match `^[a-z2-7]{24}$`.

| Method and path                    | Auth                                                    | Behavior                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /session`                    | Public. Body `{ pin, displayName?, acceptTerms: true }` | 404 deleted or unknown, 403 draft, 410 closed or blocked. Wrong PIN: 401 `{ error, remaining }` until the lock, then 429 with `Retry-After`. Success: `{ ok: true }` and `Set-Cookie` |
| `POST /uploads`                    | Guest cookie. Wedding must allow upload                 | Body `{ contentType, size, durationSeconds?, retryOf? }`. Success is HTTP 200: `{ mediaId, upload: { method: 'PUT', url, headers } \| { method: 'POST_FORM', url } }`                 |
| `POST /uploads/[mediaId]/complete` | Guest who owns the row                                  | `{ status }` of `processing` or `ready`. 409 if bytes missing, 413 too large, 415 bad local video                                                                                     |
| `GET /media?cursor&limit`          | Guest while gallery is open, or a wedding member        | Ready items only. `{ items: GalleryItem[], nextCursor }`. `Cache-Control: private, no-store`                                                                                          |
| `GET /media/[mediaId]/file?v=`     | Same viewer rule. Hidden media only for wedding members | 302 to signed URL, or JSON playback for `v=play`                                                                                                                                      |
| `DELETE /media/[mediaId]`          | Guest who uploaded it (`guestSessionId` match)          | 204, status `deleted`, NOTIFY, enqueue `media-purge`, audit `media.guest_delete`                                                                                                      |
| `GET /events`                      | Guest cookie                                            | `text/event-stream`. Events `media.ready`, `media.removed`, `music.changed`, `resync`. 429 when caps hit                                                                              |
| `GET /music`                       | Guest cookie, module enabled                            | `{ open, history, capRemaining, atSafetyCap, isDj, canMutate }`. 404 if the module is off                                                                                             |
| `POST /music`                      | Guest cookie, upload window open                        | Body `{ kind: track\|genre, body }`. 201 entry. 413 share cap, 429 pace, 409 window closed                                                                                            |
| `DELETE /music/[id]`               | Author of the row                                       | 204 soft delete. 404 for someone else's row                                                                                                                                           |
| `POST /music/[id]/status`          | DJ session only                                         | Body `{ status: open\|played\|skipped }`. 403 for a normal guest                                                                                                                      |
| `POST /dj`                         | Public, like PIN                                        | Body `{ token, displayName?, acceptTerms: true }`. Sets the guest cookie on a `dj` session                                                                                            |

PIN limits (`session/route.ts`): 10 failures per device per wedding, then 15-minute lock from the last failure; 300 failures per wedding per 15 minutes; 100 successful new sessions per IP per wedding per 15 minutes. IP is HMAC'd (`ipKey`) and not stored raw. Upload limit: 150 starts per guest session per 10 minutes. Photo PUT URLs last 5 minutes. Local-video PUT URLs use the storage default of 15 minutes.

SSE caps are in-memory per web machine: 4 streams per guest session, 300 per wedding.

`GalleryItem`: `id`, `kind`, `status`, `uploaderName`, `createdAt`, `width`, `height`, `durationSeconds`, `thumbUrl`, `largeUrl`.

### Couple and platform routes

These require a Better Auth session plus a wedding role, except health and the Stream webhook.

| Method and path                       | Auth                     | Behavior                                                                                                                 |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                     | None                     | `{ ok: true }` or 503 `{ ok: false }` after `pingDatabase`                                                               |
| `GET /api/admin/weddings/[id]/qr`     | `wedding.view`           | PNG attachment of the guest URL                                                                                          |
| `GET /api/admin/weddings/[id]/export` | `export.download`        | 302 to a 15-minute ZIP URL, or 404 if the latest export is not `ready`                                                   |
| `POST /api/webhooks/stream`           | `webhook-signature` HMAC | 404 if video provider is not Cloudflare. 401 bad signature. 400 bad JSON. 202 ignored or already deleted. Otherwise `OK` |

Dashboard mutations are server actions in `apps/web/src/app/dashboard/actions.ts`, not REST. They return `ActionState` (`{ error }` or `{ ok }`). `withAccess` calls `checkWeddingAccess`.

| Action                                      | Permission                                                   |
| ------------------------------------------- | ------------------------------------------------------------ |
| `createWeddingAction`                       | Signed-in user (creates on their tenant)                     |
| `updateWeddingAction`                       | `wedding.edit`                                               |
| `activateWeddingAction`                     | `wedding.activate`                                           |
| `rotatePinAction`                           | `wedding.rotate_pin` (optional revoke of all guest sessions) |
| `moderateMediaAction`                       | `media.moderate` (`hide`, `unhide`, `delete`)                |
| `inviteCoAdminAction`, `revokeInviteAction` | `wedding.invite`                                             |
| `removeMemberAction`                        | `wedding.invite`                                             |
| `acceptInviteAction`                        | Signed-in user matching the invite email                     |
| `requestDeletionAction`                     | `wedding.delete`                                             |
| `restoreWeddingAction`                      | `wedding.restore`                                            |
| `requestExportAction`                       | `export.download`                                            |

Platform actions in `apps/web/src/app/admin/actions.ts`: `approveWeddingAction`, `setWeddingBlockedAction`. Caller must be in `platform_admins`. Blocking does not grant gallery access.

### Roles

`owner`: view, edit, activate, rotate PIN, invite, delete, restore, moderate, download export.

`co_admin`: view, edit, moderate, download export.

`platform_admins`: list accounts and weddings, approve, block. No gallery permission (`packages/core/src/permissions.ts`).

## Database schema

Source of truth: `packages/db/src/schema/app.ts` and `auth.ts`. Applied migrations: `0000_init`, `0001_wedding_approval`, `0002_export_size_bigint`, `0003_reprocess_attempts_notified_at`, `0004_music_suggestions`.

### Better Auth tables

`user`, `session`, `account`, `verification`. Names and columns follow Better Auth. `account` is why the product tenant is not called `accounts`.

### App tables

| Table               | Role                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_admins`   | PK `user_id` → `user.id`                                                                                                                    |
| `tenants`           | Paying customer. Weddings belong to one tenant (`ON DELETE RESTRICT`)                                                                       |
| `tenant_members`    | PK `(tenant_id, user_id)`, role typed as `owner`                                                                                            |
| `weddings`          | Unique `slug`. Status, schedule timestamps, encrypted PIN, theme JSON, approval, block                                                      |
| `wedding_members`   | PK `(wedding_id, user_id)`, role `owner` or `co_admin`                                                                                      |
| `wedding_invites`   | Token hash unique. `accepted_at`, `revoked_at`, `expires_at`                                                                                |
| `guest_sessions`    | Optional `display_name`, `role` `guest` or `dj`, optional `dj_link_id`, `terms_accepted_at`, `revoked_at`                                   |
| `wedding_dj_links`  | SHA-256 `token_hash`, optional label, `revoked_at`. Raw token is not stored                                                                 |
| `music_suggestions` | `kind` `track` or `genre`, `body`, `body_key`, status `open`/`played`/`skipped`, `queue_rank`, `author_name`, `details` jsonb, `deleted_at` |
| `media`             | One file. See statuses below. Partial unique index on `video_uid`                                                                           |
| `wedding_modules`   | PK `(wedding_id, module_key)`. `music_requests` is read by the guest page and settings                                                      |
| `exports`           | ZIP job row. `size_bytes` is bigint. `notified_at` added in `0003`                                                                          |
| `audit_log`         | `bigserial` id. `wedding_id` is not a foreign key                                                                                           |
| `rate_limits`       | PK `key`, `count`, `reset_at`                                                                                                               |

`pgboss` schema is created by pg-boss, not by Drizzle.

### Wedding status

`draft` → `active` → `read_only` → `archived` → `pending_deletion` → `deleted` (row removed by the purge job).

`status_before_deletion` stores the status to restore. `blocked_at` closes the guest view without changing `status`. `approved_at` is required before activation.

Schedule: uploads stay open for `uploadDays` (1–30, default 7) after `event_date`. Then the gallery stays readable for plan `galleryDays`, then archived for `archiveDays`.

### Media status

`uploading` → `processing` → `ready`. Failures become `failed`. Moderation sets `hidden` or `deleted`. `purged_at` is set after object deletion. Guest gallery shows `ready`. Wedding members can also open `hidden` files.

Kinds: `photo`, `video`. Storage keys: `weddings/<weddingId>/media/<mediaId>/<name>` via `mediaStorageKey`.

### Plans (code, not a table)

`packages/core/src/plans.ts`. New weddings are created as `standard`.

|                              | standard       | premium |
| ---------------------------- | -------------- | ------- |
| Max media                    | 1000           | 5000    |
| Max videos                   | 30             | 300     |
| Max video length             | 30 s           | 60 s    |
| Max photo / video bytes      | 25 MB / 200 MB | same    |
| Gallery days after read-only | 90             | 365     |
| Archive days                 | 30             | 30      |

Client and server allow `VIDEO_DURATION_TOLERANCE_S` (1.5 s) over the cap.

### Queues

Defined once in `packages/core/src/jobs.ts` (`QUEUE_CONFIG`).

| Queue               | Work                                                     |
| ------------------- | -------------------------------------------------------- |
| `photo-process`     | Variants, 5 retries                                      |
| `media-purge`       | Delete one object's storage, singleton per media id      |
| `wedding-export`    | Stream a ZIP to the bucket, 3 hour expire                |
| `wedding-purge`     | Delete the wedding prefix and row, singleton per wedding |
| `deletion-reminder` | Email if `purgeAt` is unchanged                          |
| `lifecycle-tick`    | Singleton cron every 10 minutes                          |
| `send-email`        | `mailer.send`                                            |

`EXPORT_SUPERSEDED` (`"superseded"`) marks an export the owner replaced. A late job must not revive it.

## Key components and modules

| Module                            | Depends on               | Does                                                                                         |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `@vgb/core`                       | Node `crypto` only       | State machine, plans, roles, PIN, slug, magic-byte detection, queue contracts, `DomainError` |
| `@vgb/db` `weddingScope`          | core, drizzle            | All media, guest session, member, module, export, and audit writes for one `wedding_id`      |
| `@vgb/db` `weddings.ts`           | drizzle                  | Create/update wedding, invites, lifecycle queries, platform-admin checks. Not scoped         |
| `@vgb/services`                   | AWS SDK, nodemailer, zod | `parseServerConfig`, `createStorage`, `createVideoProvider`, `createMailer`, `emails.*`      |
| `apps/web/src/lib/auth.ts`        | better-auth, db, mailer  | Couple auth and tenant bootstrap                                                             |
| `apps/web/src/lib/guest.ts`       | core, db                 | Guest cookie and `resolveViewer` / `resolveGuest`                                            |
| `apps/web/src/lib/realtime.ts`    | db, `pg`                 | SSE hub                                                                                      |
| `apps/web/src/components/guest/*` | web lib types            | Upload queue, gallery merge, live gallery, live music list, section nav                      |
| `apps/worker/src/index.ts`        | pg-boss, jobs            | Queue workers and graceful shutdown (60 s)                                                   |

Email templates in `emails`: `verifyEmail`, `resetPassword`, `magicLink`, `invite`, `exportReady`, `deletionScheduled`, `deletionReminder`.

## Development workflow

Requirements from `README.md`: Node 22+, pnpm 12, Docker for Postgres, MinIO, and Mailpit. `pnpm test` uses PGlite and does not need Docker.

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm dev
```

Web: `http://localhost:3000`. Mailpit: `http://localhost:8025`. MinIO API: `localhost:9000`, console `localhost:9001`.

```sh
pnpm --filter @vgb/web create-superadmin <email> <password>
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e    # needs compose, migrate, and a production build
pnpm db:generate # drizzle-kit after schema edits
```

`PIN_ENCRYPTION_KEY` is 32 random bytes, base64. The same value must be used by web and worker. Changing it makes existing PINs unreadable.

Deploy, when Fly apps and secrets exist (`docs/runbook.md`):

```sh
fly deploy . --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly deploy . --config apps/web/fly.toml --dockerfile apps/web/Dockerfile
```

CI on push and pull request to `main`: format check, lint, typecheck, test, build, then Playwright against compose. E2E env is inlined in `.github/workflows/ci.yml` (local MinIO credentials and a fixed test PIN key).

## Coding conventions

- Workspace packages are `@vgb/core`, `@vgb/db`, `@vgb/services`, `@vgb/web`, `@vgb/worker`. Apps import packages by name. Packages export TypeScript source, not a build step.
- Strict TypeScript from `tsconfig.base.json` (`noUncheckedIndexedAccess`, `noImplicitOverride`). `verbatimModuleSyntax` is off.
- Prettier: semicolons, single quotes, trailing commas, print width 100.
- ESLint: unused vars with `^_` ignored, inline type imports, `no-console` except `warn`, `error`, `info`.
- User-facing copy in the app is Polish. Domain errors carry Polish messages.
- Validation at the edge with Zod. Business rules throw `DomainError` from core.
- Mutations that touch one wedding go through `weddingScope`. Cross-wedding helpers (`getWeddingBySlug`, lifecycle scans, platform lists) stay in `weddings.ts` and `maintenance.ts`.
- Status changes on media and exports take a `from` list so concurrent workers do not revive a hidden or deleted row.
- Secrets stay in env. Do not commit `.env`. `.env.example` documents every key.
- Next config: `output: 'standalone'`, `poweredByHeader: false`, security headers in `next.config.ts`, CSP in `proxy.ts`.
- Guest and dashboard responses that must not be indexed set `X-Robots-Tag` in `proxy.ts`.

## Known limitations

Implemented behavior with a known gap:

- R2 upload size is checked after the PUT. Oversized objects are deleted at `/complete`. Abandoned `uploading` rows are failed after 24 hours.
- SSE caps are per machine, not global. Extra guests fall back to 10-second polling.
- Better Auth's own in-memory limiter is replaced by Postgres storage, but the comment in `tasks/todo.md` still records the original in-memory concern as accepted before that change. The code path is `customStorage` in `apps/web/src/lib/auth.ts`.
- `pnpm audit` finding called out in `docs/runbook.md`: moderate `esbuild` via `drizzle-kit`, dev-only.
- HEIC is implemented (`heic-convert`) but `tasks/todo.md` says there is no iPhone fixture, so HEIC was not verified end to end.
- `packages/modules/*` is in the workspace and has no packages. `wedding_modules` is used for `music_requests` only.
- Plan changes are not a product screen. The runbook uses SQL (`update weddings set plan = 'premium' ...`). Checkout does not exist.
- Local video mode stores the uploaded file and does not transcode duration. Duration is whatever the client sent at upload time.
- Mux is named in `tasks/todo.md` as a fallback. The code only has `local` and `cloudflare`.

### Planned, not implemented

From `tasks/todo.md` "Poza MVP" and open stage-11 items:

- Stripe or any payment flow.
- Voting on songs, live slideshow, AI moderation, custom domains, English UI, mobile app. Song requests for the DJ are implemented (`tasks/music-suggestions.md`).
- Staging and production bring-up (Neon, R2, Stream, domain, Sentry, backups). Config and runbook exist. No deploy has been recorded in this repo.
- Running `load/k6-wedding.js` against staging. The script is in the repo. Thresholds in the runbook: API p95 under 500 ms, no lost uploads.
- Formal gstack `/cso` review. A manual pass is recorded in `tasks/todo.md`.

`tasks/todo.md` also says E2E had not been run on a machine without Docker, and CI was unconfirmed until the first push. The workflow file is present. Do not treat that note as a current CI result.
