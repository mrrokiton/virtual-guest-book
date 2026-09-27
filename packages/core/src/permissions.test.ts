import { describe, expect, it } from 'vitest';
import { canGuestDeleteMedia, roleCan } from './permissions';

describe('roleCan', () => {
  it('lets co-admins moderate but not delete the wedding or invite others', () => {
    expect(roleCan('co_admin', 'media.moderate')).toBe(true);
    expect(roleCan('co_admin', 'wedding.delete')).toBe(false);
    expect(roleCan('co_admin', 'wedding.invite')).toBe(false);
    expect(roleCan('co_admin', 'wedding.rotate_pin')).toBe(false);
  });

  it('gives owners every action', () => {
    expect(roleCan('owner', 'wedding.delete')).toBe(true);
    expect(roleCan('owner', 'wedding.invite')).toBe(true);
  });
});

describe('canGuestDeleteMedia', () => {
  it('only allows the uploading session', () => {
    expect(canGuestDeleteMedia({ guestSessionId: 's1' }, 's1')).toBe(true);
    expect(canGuestDeleteMedia({ guestSessionId: 's1' }, 's2')).toBe(false);
    expect(canGuestDeleteMedia({ guestSessionId: null }, 's1')).toBe(false);
  });
});
