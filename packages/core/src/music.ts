export const MUSIC_KINDS = ['track', 'genre'] as const;
export type MusicKind = (typeof MUSIC_KINDS)[number];

export const MUSIC_STATUSES = ['open', 'played', 'skipped'] as const;
export type MusicStatus = (typeof MUSIC_STATUSES)[number];

export const GUEST_SESSION_ROLES = ['guest', 'dj'] as const;
export type GuestSessionRole = (typeof GUEST_SESSION_ROLES)[number];

export const MUSIC_MODULE_KEY = 'music_requests';

/** Hard backstop per guest session. Normal use stays under the share cap. */
export const MUSIC_SAFETY_CAP = 40;
export const MUSIC_MIN_CAP = 3;
/** How far above the per-person average a session may sit. */
export const MUSIC_AVG_SLACK = 2;
export const MUSIC_BODY_MAX = 120;
/** Open rows that keep their order while the tail is re-ranked. */
export const MUSIC_FROZEN_HEAD = 3;
export const MUSIC_CREATE_LIMIT = 8;
export const MUSIC_CREATE_WINDOW_MS = 10 * 60 * 1000;

const RANK_GAP = 1000;

export function isMusicKind(value: string): value is MusicKind {
  return (MUSIC_KINDS as readonly string[]).includes(value);
}

export function isMusicStatus(value: string): value is MusicStatus {
  return (MUSIC_STATUSES as readonly string[]).includes(value);
}

/** Stored text is trimmed. The duplicate key also folds case and repeated spaces. */
export function normalizeMusicBody(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
}

export function musicBodyError(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return 'Wpisz propozycję.';
  if (trimmed.length > MUSIC_BODY_MAX) return `Propozycja może mieć do ${MUSIC_BODY_MAX} znaków.`;
  return null;
}

export interface MusicCapInput {
  /** Durable suggestions of the caller: open, played, skipped, and soft-deleted. */
  mine: number;
  /** Durable suggestions of the whole wedding, including `mine`. */
  totalDurable: number;
  /**
   * Sessions on this wedding whose durable count is already above zero.
   * Do not include the caller when `mine` is 0; the formula counts them itself.
   */
  authorCount: number;
}

/**
 * Share cap. A session may create while `mine < cap`.
 * Alone, the cap stays two ahead of that session until {@link MUSIC_SAFETY_CAP}.
 * Once other people have durable suggestions, nobody may sit more than
 * {@link MUSIC_AVG_SLACK} above the average.
 */
export function musicCreateCap(input: MusicCapInput): number {
  const participants = input.authorCount + (input.mine === 0 ? 1 : 0);
  const average = Math.floor(input.totalDurable / Math.max(1, participants));
  return Math.min(MUSIC_SAFETY_CAP, Math.max(MUSIC_MIN_CAP, average + MUSIC_AVG_SLACK));
}

export function canCreateMusicSuggestion(input: MusicCapInput): boolean {
  return input.mine < musicCreateCap(input);
}

export interface MusicQueueItem {
  id: string;
  sessionId: string;
  createdAt: Date;
  queueRank: number | null;
}

export interface MusicAuthorLoad {
  sessionId: string;
  /** Open suggestions, including one being inserted. */
  openCount: number;
  /** Played and skipped, not soft-deleted. */
  doneCount: number;
}

function byCreated(a: MusicQueueItem, b: MusicQueueItem): number {
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byRank(a: MusicQueueItem, b: MusicQueueItem): number {
  const ar = a.queueRank ?? Number.POSITIVE_INFINITY;
  const br = b.queueRank ?? Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  return byCreated(a, b);
}

function byScore(authors: Map<string, MusicAuthorLoad>) {
  return (a: MusicQueueItem, b: MusicQueueItem): number => {
    const loadA = authors.get(a.sessionId) ?? { openCount: 0, doneCount: 0 };
    const loadB = authors.get(b.sessionId) ?? { openCount: 0, doneCount: 0 };
    if (loadA.openCount !== loadB.openCount) return loadA.openCount - loadB.openCount;
    if (loadA.doneCount !== loadB.doneCount) return loadA.doneCount - loadB.doneCount;
    return byCreated(a, b);
  };
}

function withRanks(items: MusicQueueItem[], startAfter: number): MusicQueueItem[] {
  let last = startAfter;
  return items.map((item) => {
    last += RANK_GAP;
    return { ...item, queueRank: last };
  });
}

/**
 * Insert one open suggestion.
 * Fair queue freezes the first {@link MUSIC_FROZEN_HEAD} existing rows and
 * places the new row only in the tail. Short lists therefore stay in submission order.
 * Fair queue off appends by creation time across the whole list.
 */
export function insertMusicSuggestion(args: {
  fairQueue: boolean;
  open: MusicQueueItem[];
  insert: MusicQueueItem;
  authors: MusicAuthorLoad[];
}): MusicQueueItem[] {
  if (!args.fairQueue) {
    return withRanks([...args.open, { ...args.insert, queueRank: null }].sort(byCreated), 0);
  }

  const ordered = [...args.open].sort(byRank);
  const headCount = Math.min(MUSIC_FROZEN_HEAD, ordered.length);
  const head = ordered.slice(0, headCount);
  const tail = ordered.slice(headCount);
  const scoredTail = [...tail, { ...args.insert, queueRank: null }].sort(
    byScore(new Map(args.authors.map((a) => [a.sessionId, a]))),
  );

  const headRanks = head.every((item, i) => {
    const rank = item.queueRank;
    const prev = head[i - 1]?.queueRank ?? 0;
    return rank != null && rank > prev;
  });
  const keptHead = headRanks ? head.map((item) => ({ ...item })) : withRanks(head, 0);
  const lastHead = keptHead.at(-1)?.queueRank ?? 0;
  return [...keptHead, ...withRanks(scoredTail, lastHead)];
}

/** Turn fair ordering on: freeze the current head, score only the tail. */
export function enableFairQueue(
  open: MusicQueueItem[],
  authors: MusicAuthorLoad[],
): MusicQueueItem[] {
  const ordered = [...open].sort(byRank);
  const headCount = Math.min(MUSIC_FROZEN_HEAD, ordered.length);
  const head = ordered.slice(0, headCount);
  const tail = [...ordered.slice(headCount)].sort(
    byScore(new Map(authors.map((a) => [a.sessionId, a]))),
  );
  const headRanks = head.every((item, i) => {
    const rank = item.queueRank;
    const prev = head[i - 1]?.queueRank ?? 0;
    return rank != null && rank > prev;
  });
  const keptHead = headRanks ? head.map((item) => ({ ...item })) : withRanks(head, 0);
  const lastHead = keptHead.at(-1)?.queueRank ?? 0;
  return [...keptHead, ...withRanks(tail, lastHead)];
}

/** Turn fair ordering off. Every open row is submission order. */
export function disableFairQueue(open: MusicQueueItem[]): MusicQueueItem[] {
  return withRanks([...open].sort(byCreated), 0);
}

/** Read order. Rows that left the queue keep their rank, so this is stable across refreshes. */
export function compareMusicQueue(a: MusicQueueItem, b: MusicQueueItem): number {
  return byRank(a, b);
}
