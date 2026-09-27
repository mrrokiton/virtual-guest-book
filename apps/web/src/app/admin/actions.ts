'use server';

import { isPlatformAdmin, updateWedding, weddingScope } from '@vgb/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { getUser } from '@/lib/session';
import { db } from '@/lib/server';

export async function setWeddingBlockedAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user || !(await isPlatformAdmin(db(), user.id))) return { error: 'Brak uprawnień.' };
  const parsed = z
    .object({
      weddingId: z.uuid(),
      blocked: z.enum(['true', 'false']),
      reason: z.string().max(300).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'Nieprawidłowe dane.' };
  const block = parsed.data.blocked === 'true';
  await updateWedding(db(), parsed.data.weddingId, {
    blockedAt: block ? new Date() : null,
    blockedReason: block ? parsed.data.reason || null : null,
  });
  await weddingScope(db(), parsed.data.weddingId).audit({
    actorType: 'platform_admin',
    actorId: user.id,
    action: block ? 'wedding.blocked' : 'wedding.unblocked',
    metadata: { reason: parsed.data.reason },
  });
  revalidatePath('/admin');
  return { ok: block ? 'Zablokowano.' : 'Odblokowano.' };
}
