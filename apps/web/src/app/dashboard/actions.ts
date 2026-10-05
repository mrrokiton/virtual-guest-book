'use server';

import { createHash } from 'node:crypto';
import {
  activate,
  adminCanEdit,
  addDays,
  computeSchedule,
  DEFAULT_UPLOAD_DAYS,
  DELETION_REMINDER_DAYS,
  DomainError,
  encryptSecret,
  EXPORT_SUPERSEDED,
  generatePin,
  generateSlug,
  generateToken,
  MAX_UPLOAD_DAYS,
  MUSIC_MODULE_KEY,
  mediaPurgeRequest,
  QUEUE_CONFIG,
  QUEUES,
  requestDeletion,
  restore,
  type AdminAction,
} from '@vgb/core';
import {
  acceptInvite,
  applyWeddingTransition,
  createInvite,
  createWedding,
  ensureTenantForUser,
  findInviteByTokenHash,
  getMembershipRole,
  getWeddingById,
  publishMediaEvent,
  revokeInvite,
  toLifecycle,
  updateWedding,
  weddingScope,
} from '@vgb/db';
import { emails } from '@vgb/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { warsawMidnight } from '@/lib/dates';
import { env } from '@/lib/env';
import { enqueue } from '@/lib/jobs';
import { checkWeddingAccess, requireUser, type WeddingAccess } from '@/lib/session';
import { db, mailer } from '@/lib/server';

const NOT_ALLOWED: ActionState = { error: 'Brak uprawnień do tej operacji.' };

async function withAccess(
  weddingId: unknown,
  action: AdminAction,
  fn: (a: WeddingAccess) => Promise<ActionState | void>,
): Promise<ActionState> {
  const access = await checkWeddingAccess(String(weddingId ?? ''), action);
  if (!access) return NOT_ALLOWED;
  try {
    const result = await fn(access);
    revalidatePath(`/dashboard/weddings/${access.wedding.id}`, 'layout');
    return result ?? { ok: 'Zapisano.' };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
}

const MAX_EVENT_DAYS_AHEAD = 3 * 365;

const weddingFields = z.object({
  name: z.string().trim().min(1, 'Podaj nazwę wesela.').max(120),
  eventDate: z.string().transform((v, ctx) => {
    const d = warsawMidnight(v);
    if (!d) ctx.addIssue({ code: 'custom', message: 'Podaj poprawną datę wesela.' });
    else if (d > addDays(new Date(), MAX_EVENT_DAYS_AHEAD)) {
      ctx.addIssue({ code: 'custom', message: 'Data wesela może być najwyżej 3 lata naprzód.' });
    }
    return d as Date;
  }),
  uploadDays: z.coerce.number().int().min(1).max(MAX_UPLOAD_DAYS).default(DEFAULT_UPLOAD_DAYS),
});

function firstIssue(error: z.ZodError): ActionState {
  return { error: error.issues[0]?.message ?? 'Nieprawidłowe dane.' };
}

export async function createWeddingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = weddingFields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { name, eventDate, uploadDays } = parsed.data;

  const tenantId = await ensureTenantForUser(db(), user.id, user.name);
  const plan = 'standard';
  const wedding = await createWedding(db(), {
    tenantId,
    createdByUserId: user.id,
    slug: generateSlug(),
    name,
    eventDate,
    uploadDays,
    plan,
    pinCiphertext: encryptSecret(generatePin(), env().PIN_ENCRYPTION_KEY),
    ...computeSchedule(eventDate, uploadDays, plan),
  });
  await weddingScope(db(), wedding.id).audit({
    actorType: 'user',
    actorId: user.id,
    action: 'wedding.created',
  });
  redirect(`/dashboard/weddings/${wedding.id}`);
}

export async function updateWeddingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.edit', async ({ wedding, user }) => {
    if (!adminCanEdit(wedding)) {
      return { error: 'Tego wesela nie można już edytować.' };
    }
    const parsed = weddingFields
      .extend({
        headline: z.string().trim().max(200).optional(),
        accent: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .or(z.literal('')),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return firstIssue(parsed.error);
    const { name, eventDate, uploadDays, headline, accent } = parsed.data;
    const schedule = computeSchedule(eventDate, uploadDays, wedding.plan);

    const now = new Date();
    if (wedding.status !== 'draft' && schedule.archiveAt <= now) {
      return { error: 'Przy tej dacie galeria zostałaby od razu zarchiwizowana. Sprawdź datę.' };
    }
    let status = wedding.status;
    if (status === 'read_only' && now < schedule.readOnlyAt) status = 'active';

    const saved = await updateWedding(
      db(),
      wedding.id,
      {
        name,
        eventDate,
        uploadDays,
        status,
        ...schedule,
        theme: { headline: headline || undefined, accent: accent || undefined },
      },
      { expectedStatus: wedding.status },
    );
    if (!saved) return { error: 'Stan wesela się zmienił. Odśwież stronę.' };
    await weddingScope(db(), wedding.id).audit({
      actorType: 'user',
      actorId: user.id,
      action: 'wedding.updated',
    });
  });
}

export async function activateWeddingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.activate', async ({ wedding, user }) => {
    const t = activate(toLifecycle(wedding), new Date());
    if (!(await applyWeddingTransition(db(), wedding.id, 'draft', t))) {
      return { error: 'Stan wesela się zmienił. Odśwież stronę.' };
    }
    await weddingScope(db(), wedding.id).audit({
      actorType: 'user',
      actorId: user.id,
      action: 'wedding.activated',
    });
    return { ok: 'Wesele jest aktywne. Goście mogą już dodawać zdjęcia.' };
  });
}

export async function rotatePinAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.rotate_pin', async ({ wedding, user }) => {
    const scope = weddingScope(db(), wedding.id);
    await updateWedding(db(), wedding.id, {
      pinCiphertext: encryptSecret(generatePin(), env().PIN_ENCRYPTION_KEY),
      pinRotatedAt: new Date(),
    });
    const revoke = form.get('revokeSessions') === 'on';
    if (revoke) await scope.guestSessions.revokeAll();
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'wedding.pin_rotated',
      metadata: { revokedSessions: revoke },
    });
    return {
      ok: revoke
        ? 'Nowy PIN ustawiony, wszyscy goście muszą go podać ponownie.'
        : 'Nowy PIN ustawiony.',
    };
  });
}

export async function moderateMediaAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'media.moderate', async ({ wedding, user }) => {
    const ids = z.array(z.uuid()).min(1).max(200).safeParse(form.getAll('mediaId'));
    const op = z.enum(['hide', 'unhide', 'delete']).safeParse(form.get('op'));
    if (!ids.success || !op.success) return { error: 'Wybierz zdjęcia.' };

    const scope = weddingScope(db(), wedding.id);
    const now = new Date();
    const moves = {
      hide: { from: ['ready'], patch: { status: 'hidden', hiddenAt: now }, event: 'media.removed' },
      unhide: {
        from: ['hidden'],
        patch: { status: 'ready', hiddenAt: null },
        event: 'media.ready',
      },
      delete: {
        from: ['uploading', 'processing', 'ready', 'hidden', 'failed'],
        patch: { status: 'deleted', deletedAt: now },
        event: 'media.removed',
      },
    } as const;
    const move = moves[op.data];

    let changed = 0;
    for (const id of new Set(ids.data)) {
      const m = await scope.media.update(id, move.patch, { from: [...move.from] });
      if (!m) continue;
      changed++;
      await publishMediaEvent(db(), { type: move.event, weddingId: wedding.id, mediaId: m.id });
      if (op.data === 'delete') await enqueue(...mediaPurgeRequest(wedding.id, m.id));
      await scope.audit({
        actorType: 'user',
        actorId: user.id,
        action: `media.${op.data}`,
        targetType: 'media',
        targetId: m.id,
      });
    }
    const labels = { hide: 'Ukryto', unhide: 'Przywrócono', delete: 'Usunięto' };
    return { ok: `${labels[op.data]}: ${changed}.` };
  });
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function inviteCoAdminAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.invite', async ({ wedding, user }) => {
    const email = z.email().safeParse(
      String(form.get('email') ?? '')
        .trim()
        .toLowerCase(),
    );
    if (!email.success) return { error: 'Podaj poprawny adres e-mail.' };
    const token = generateToken();
    await createInvite(db(), {
      weddingId: wedding.id,
      email: email.data,
      tokenHash: hashToken(token),
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await mailer().send(
      emails.invite(email.data, {
        weddingName: wedding.name,
        inviterName: user.name,
        url: `${env().APP_URL}/invite/${token}`,
      }),
    );
    await weddingScope(db(), wedding.id).audit({
      actorType: 'user',
      actorId: user.id,
      action: 'member.invited',
      metadata: { email: email.data },
    });
    return { ok: `Wysłano zaproszenie do ${email.data}.` };
  });
}

export async function revokeInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.invite', async ({ wedding }) => {
    const id = z.uuid().safeParse(form.get('inviteId'));
    if (!id.success) return { error: 'Nieprawidłowe zaproszenie.' };
    await revokeInvite(db(), wedding.id, id.data);
    return { ok: 'Zaproszenie anulowane.' };
  });
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.invite', async ({ wedding, user }) => {
    const userId = String(form.get('userId') ?? '');
    if ((await getMembershipRole(db(), wedding.id, userId)) !== 'co_admin') {
      return { error: 'Można usuwać tylko współadministratorów.' };
    }
    const scope = weddingScope(db(), wedding.id);
    await scope.members.remove(userId);
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'member.removed',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: 'Usunięto współadministratora.' };
  });
}

export async function acceptInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const invite = await findInviteByTokenHash(db(), hashToken(String(form.get('token') ?? '')));
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) {
    return { error: 'Zaproszenie wygasło lub zostało już wykorzystane.' };
  }
  if (invite.email !== user.email.toLowerCase()) {
    return { error: `To zaproszenie jest dla ${invite.email}. Zaloguj się na to konto.` };
  }
  const wedding = await getWeddingById(db(), invite.weddingId);
  if (!wedding || wedding.status === 'deleted') return { error: 'To wesele już nie istnieje.' };
  await acceptInvite(db(), invite, user.id);
  await weddingScope(db(), wedding.id).audit({
    actorType: 'user',
    actorId: user.id,
    action: 'member.joined',
  });
  redirect(`/dashboard/weddings/${wedding.id}`);
}

export async function requestDeletionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.delete', async ({ wedding, user }) => {
    if (String(form.get('confirm') ?? '').trim() !== wedding.name) {
      return { error: 'Wpisz dokładną nazwę wesela, aby potwierdzić.' };
    }
    const t = requestDeletion(toLifecycle(wedding), new Date());
    if (!(await applyWeddingTransition(db(), wedding.id, wedding.status, t))) {
      return { error: 'Stan wesela się zmienił. Odśwież stronę.' };
    }
    await weddingScope(db(), wedding.id).audit({
      actorType: 'user',
      actorId: user.id,
      action: 'wedding.deletion_requested',
      metadata: { purgeAt: t.purgeAt?.toISOString() },
    });
    await mailer().send(
      emails.deletionScheduled(user.email, {
        weddingName: wedding.name,
        purgeAt: t.purgeAt!,
        url: `${env().APP_URL}/dashboard/weddings/${wedding.id}`,
        automatic: false,
      }),
    );
    const remindAt = addDays(t.purgeAt!, -DELETION_REMINDER_DAYS);
    await enqueue(
      QUEUES.deletionReminder,
      { weddingId: wedding.id, purgeAt: t.purgeAt!.toISOString() },
      { startAfter: remindAt, singletonKey: `${wedding.id}:${t.purgeAt!.toISOString()}` },
    );
    return { ok: 'Wesele zostanie usunięte po okresie karencji. Możesz to jeszcze cofnąć.' };
  });
}

export async function restoreWeddingAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.restore', async ({ wedding, user }) => {
    const t = restore(toLifecycle(wedding), new Date());
    if (!(await applyWeddingTransition(db(), wedding.id, 'pending_deletion', t))) {
      return { error: 'Stan wesela się zmienił. Odśwież stronę.' };
    }
    await weddingScope(db(), wedding.id).audit({
      actorType: 'user',
      actorId: user.id,
      action: 'wedding.restored',
    });
    return { ok: 'Usunięcie zostało anulowane.' };
  });
}

const exportJob = QUEUE_CONFIG[QUEUES.weddingExport];
/** Past every attempt pg-boss would make; a row still pending then was lost with its job. */
const EXPORT_GIVE_UP_MS =
  (exportJob.retryLimit + 1) * (exportJob.expireInSeconds + (exportJob.retryDelay ?? 0)) * 1000;

export async function requestExportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'export.download', async ({ wedding, user }) => {
    const scope = weddingScope(db(), wedding.id);
    const latest = await scope.exports.latest();
    if (latest && (latest.status === 'pending' || latest.status === 'running')) {
      if (Date.now() - latest.createdAt.getTime() < EXPORT_GIVE_UP_MS) {
        return { error: 'Paczka jest już przygotowywana.' };
      }
      await scope.exports.update(
        latest.id,
        { status: 'failed', error: EXPORT_SUPERSEDED },
        { from: ['pending', 'running'] },
      );
    }
    const row = await scope.exports.create(user.id);
    await enqueue(QUEUES.weddingExport, { weddingId: wedding.id, exportId: row.id, notify: true });
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'export.requested',
      targetType: 'export',
      targetId: row.id,
    });
    return { ok: 'Przygotowujemy paczkę ZIP. Wyślemy e-mail, gdy będzie gotowa.' };
  });
}

export async function setMusicModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.edit', async ({ wedding, user }) => {
    if (!adminCanEdit(toLifecycle(wedding))) {
      return { error: 'W tym stanie wesela nie można zmienić propozycji muzycznych.' };
    }
    const enabled = form.get('enabled') === 'on';
    const fairQueue = form.get('fairQueue') === 'on';
    const scope = weddingScope(db(), wedding.id);
    await scope.modules.set(MUSIC_MODULE_KEY, enabled, { fairQueue });
    await scope.music.rerank(fairQueue);
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'music.module',
      metadata: { enabled, fairQueue },
    });
    return {
      ok: enabled ? 'Propozycje muzyczne są włączone.' : 'Propozycje muzyczne są wyłączone.',
    };
  });
}

export async function createDjLinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.edit', async ({ wedding, user }) => {
    if (!adminCanEdit(toLifecycle(wedding))) {
      return { error: 'W tym stanie wesela nie można dodać linku DJ-a.' };
    }
    const label =
      String(form.get('label') ?? '')
        .trim()
        .slice(0, 80) || null;
    const token = generateToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const scope = weddingScope(db(), wedding.id);
    const link = await scope.djLinks.create({
      tokenHash,
      label,
      createdByUserId: user.id,
    });
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'dj_link.created',
      targetType: 'wedding_dj_link',
      targetId: link.id,
    });
    const url = `${env().APP_URL}/w/${wedding.slug}/dj/${token}`;
    return {
      ok: `Skopiuj link teraz. Później nie da się go odczytać: ${url}`,
    };
  });
}

export async function revokeDjLinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withAccess(form.get('weddingId'), 'wedding.edit', async ({ wedding, user }) => {
    const linkId = z.uuid().safeParse(form.get('linkId'));
    if (!linkId.success) return { error: 'Nieprawidłowy link.' };
    const scope = weddingScope(db(), wedding.id);
    const revoked = await scope.djLinks.revoke(linkId.data);
    if (!revoked) return { error: 'Ten link jest już odwołany.' };
    await scope.guestSessions.revokeForLink(linkId.data);
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'dj_link.revoked',
      targetType: 'wedding_dj_link',
      targetId: linkId.data,
    });
    return { ok: 'Link DJ-a został odwołany.' };
  });
}
