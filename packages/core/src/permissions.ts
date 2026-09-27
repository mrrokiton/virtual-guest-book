export const WEDDING_ROLES = ['owner', 'co_admin'] as const;
export type WeddingRole = (typeof WEDDING_ROLES)[number];

export type AdminAction =
  | 'wedding.view'
  | 'wedding.edit'
  | 'wedding.activate'
  | 'wedding.rotate_pin'
  | 'wedding.invite'
  | 'wedding.delete'
  | 'wedding.restore'
  | 'media.moderate'
  | 'export.download';

const ROLE_ACTIONS: Record<WeddingRole, ReadonlySet<AdminAction>> = {
  owner: new Set<AdminAction>([
    'wedding.view',
    'wedding.edit',
    'wedding.activate',
    'wedding.rotate_pin',
    'wedding.invite',
    'wedding.delete',
    'wedding.restore',
    'media.moderate',
    'export.download',
  ]),
  co_admin: new Set<AdminAction>([
    'wedding.view',
    'wedding.edit',
    'media.moderate',
    'export.download',
  ]),
};

export function roleCan(role: WeddingRole, action: AdminAction): boolean {
  return ROLE_ACTIONS[role].has(action);
}

/**
 * Platform admins manage accounts and can block a wedding, but deliberately get no access to
 * wedding galleries: guests' photos stay visible only to the couple and their helpers.
 */
export type PlatformAction = 'platform.list' | 'platform.block_wedding';

export function canGuestDeleteMedia(
  media: { guestSessionId: string | null },
  guestSessionId: string,
): boolean {
  return media.guestSessionId !== null && media.guestSessionId === guestSessionId;
}
