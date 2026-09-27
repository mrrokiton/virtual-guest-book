import { roleCan, type AdminAction, type WeddingRole } from '@vgb/core';
import { getMembershipRole, getWeddingById, isPlatformAdmin, type Wedding } from '@vgb/db';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from './auth';
import { db } from './server';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Read headers before touching auth(): it marks the route dynamic, so `next build` never
  // prerenders a page that needs runtime secrets.
  const requestHeaders = await headers();
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export interface WeddingAccess {
  user: SessionUser;
  wedding: Wedding;
  role: WeddingRole;
}

/** Returns 404 (not 403) to non-members so wedding ids can't be probed. */
export async function requireWeddingAccess(
  weddingId: string,
  action: AdminAction,
): Promise<WeddingAccess> {
  const user = await requireUser();
  if (!isUuid(weddingId)) notFound();
  const [wedding, role] = await Promise.all([
    getWeddingById(db(), weddingId),
    getMembershipRole(db(), weddingId, user.id),
  ]);
  if (!wedding || !role || wedding.status === 'deleted') notFound();
  if (!roleCan(role, action)) notFound();
  return { user, wedding, role };
}

/** Same checks for route handlers and server actions, without navigation side effects. */
export async function checkWeddingAccess(
  weddingId: string,
  action: AdminAction,
): Promise<WeddingAccess | null> {
  const user = await getUser();
  if (!user || !isUuid(weddingId)) return null;
  const [wedding, role] = await Promise.all([
    getWeddingById(db(), weddingId),
    getMembershipRole(db(), weddingId, user.id),
  ]);
  if (!wedding || !role || wedding.status === 'deleted' || !roleCan(role, action)) return null;
  return { user, wedding, role };
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin(db(), user.id))) notFound();
  return user;
}
