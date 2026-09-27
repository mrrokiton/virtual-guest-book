export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (!iso || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}
