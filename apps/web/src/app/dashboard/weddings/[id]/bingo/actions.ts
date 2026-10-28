'use server';

import { adminCanEdit, BINGO_MODULE_KEY, type AdminAction } from '@vgb/core';
import { publishBingoChanged, weddingScope } from '@vgb/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { checkWeddingAccess, type WeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';

async function withBingoAccess(
  weddingId: unknown,
  action: AdminAction,
  fn: (access: WeddingAccess) => Promise<ActionState | void>,
): Promise<ActionState> {
  const access = await checkWeddingAccess(String(weddingId ?? ''), action);
  if (!access) return { error: 'Brak uprawnień do tej operacji.' };
  const result = await fn(access);
  revalidatePath(`/dashboard/weddings/${access.wedding.id}/bingo`);
  revalidatePath(`/w/${access.wedding.slug}/bingo`);
  return result ?? { ok: 'Zapisano.' };
}

const taskBody = z.string().trim().min(1, 'Podaj treść zadania.').max(300);
const person = z.object({
  fullName: z.string().trim().min(1, 'Podaj imię i nazwisko.').max(120),
  nickname: z.string().trim().max(80).optional(),
});

export async function setBingoModuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding, user }) => {
    if (!adminCanEdit(wedding)) return { error: 'W tym stanie wesela nie można zmienić Bingo.' };
    const scope = weddingScope(db(), wedding.id);
    const enabled = form.get('enabled') === 'on';
    if (enabled) {
      const [tasks, validators] = await Promise.all([
        scope.bingo.tasks.list(),
        scope.bingo.validators.list(),
      ]);
      if (!tasks.length || !validators.length) {
        return { error: 'Przed włączeniem dodaj co najmniej jedno zadanie i jedną osobę.' };
      }
    }
    await scope.modules.set(BINGO_MODULE_KEY, enabled);
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: 'bingo.module',
      metadata: { enabled },
    });
    await publishBingoChanged(db(), wedding.id);
    return { ok: enabled ? 'Bingo jest aktywne.' : 'Bingo zostało wyłączone.' };
  });
}

export async function saveBingoTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding, user }) => {
    if (!adminCanEdit(wedding)) return { error: 'W tym stanie nie można edytować zadań.' };
    const parsed = taskBody.safeParse(form.get('body'));
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe zadanie.' };
    const scope = weddingScope(db(), wedding.id);
    const taskId = z.uuid().safeParse(form.get('taskId'));
    const task = taskId.success
      ? await scope.bingo.tasks.update(taskId.data, parsed.data)
      : await scope.bingo.tasks.create(parsed.data);
    if (!task) return { error: 'Nie znaleziono zadania.' };
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: taskId.success ? 'bingo.task.updated' : 'bingo.task.created',
      targetType: 'bingo_task',
      targetId: task.id,
    });
    await publishBingoChanged(db(), wedding.id);
    return { ok: taskId.success ? 'Zadanie zaktualizowane.' : 'Zadanie dodane.' };
  });
}

export async function moveBingoTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding }) => {
    const taskId = z.uuid().safeParse(form.get('taskId'));
    const direction = z.enum(['up', 'down']).safeParse(form.get('direction'));
    if (!taskId.success || !direction.success) return { error: 'Nieprawidłowe zadanie.' };
    const scope = weddingScope(db(), wedding.id);
    const tasks = await scope.bingo.tasks.list();
    const index = tasks.findIndex((task) => task.id === taskId.data);
    const target = direction.data === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= tasks.length) return { ok: 'Kolejność bez zmian.' };
    [tasks[index], tasks[target]] = [tasks[target]!, tasks[index]!];
    await scope.bingo.tasks.reorder(tasks.map((task) => task.id));
    await publishBingoChanged(db(), wedding.id);
    return { ok: 'Kolejność zmieniona.' };
  });
}

export async function removeBingoTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding, user }) => {
    const taskId = z.uuid().safeParse(form.get('taskId'));
    if (!taskId.success) return { error: 'Nieprawidłowe zadanie.' };
    const scope = weddingScope(db(), wedding.id);
    const result = await scope.bingo.tasks.remove(taskId.data);
    if (!result) return { error: 'Nie znaleziono zadania.' };
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: result === 'archived' ? 'bingo.task.archived' : 'bingo.task.deleted',
      targetType: 'bingo_task',
      targetId: taskId.data,
    });
    await publishBingoChanged(db(), wedding.id);
    return { ok: result === 'archived' ? 'Zadanie zarchiwizowane.' : 'Zadanie usunięte.' };
  });
}

export async function saveBingoValidatorAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding }) => {
    const parsed = person.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' };
    const scope = weddingScope(db(), wedding.id);
    const id = z.uuid().safeParse(form.get('validatorId'));
    const row = id.success
      ? await scope.bingo.validators.update(
          id.data,
          parsed.data.fullName,
          parsed.data.nickname || null,
        )
      : await scope.bingo.validators.create(parsed.data.fullName, parsed.data.nickname || null);
    if (!row) return { error: 'Nie znaleziono osoby.' };
    await publishBingoChanged(db(), wedding.id);
    return { ok: id.success ? 'Dane osoby zaktualizowane.' : 'Osoba dodana.' };
  });
}

export async function removeBingoValidatorAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.manage', async ({ wedding }) => {
    const id = z.uuid().safeParse(form.get('validatorId'));
    if (!id.success) return { error: 'Nieprawidłowa osoba.' };
    if (!(await weddingScope(db(), wedding.id).bingo.validators.remove(id.data))) {
      return { error: 'Nie znaleziono osoby.' };
    }
    await publishBingoChanged(db(), wedding.id);
    return { ok: 'Osoba usunięta.' };
  });
}

export async function verifyBingoSubmissionAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  return withBingoAccess(form.get('weddingId'), 'bingo.verify', async ({ wedding, user }) => {
    const id = z.uuid().safeParse(form.get('submissionId'));
    const status = z.enum(['accepted', 'rejected']).safeParse(form.get('status'));
    if (!id.success || !status.success) return { error: 'Nieprawidłowe zgłoszenie.' };
    const reason = String(form.get('rejectionReason') ?? '').trim();
    if (status.data === 'rejected' && (reason.length < 1 || reason.length > 300)) {
      return { error: 'Podaj krótkie uzasadnienie odrzucenia.' };
    }
    const scope = weddingScope(db(), wedding.id);
    const row = await scope.bingo.verify(
      id.data,
      status.data,
      user.id,
      status.data === 'rejected' ? reason : null,
    );
    if (!row) return { error: 'Zdjęcie nie jest już gotowe do weryfikacji.' };
    await scope.audit({
      actorType: 'user',
      actorId: user.id,
      action: `bingo.submission.${status.data}`,
      targetType: 'bingo_submission',
      targetId: row.id,
      metadata: { reason: row.rejectionReason },
    });
    await publishBingoChanged(db(), wedding.id);
    return { ok: status.data === 'accepted' ? 'Zdjęcie zaakceptowane.' : 'Zdjęcie odrzucone.' };
  });
}
