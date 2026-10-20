/** Every wedding date in the product is a calendar day in Poland. */
export const WEDDING_TIME_ZONE = 'Europe/Warsaw';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function offsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: WEDDING_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = name?.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const hours = Number(m[1]);
  return hours * 60 + Math.sign(hours) * Number(m[2] ?? 0);
}

/** `YYYY-MM-DD` as local midnight in Poland, returned as a UTC instant. */
export function warsawMidnight(date: string): Date | null {
  if (!DATE_RE.test(date)) return null;
  const utc = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(utc.getTime() - offsetMinutes(utc) * 60_000);
}

/** Instant -> `YYYY-MM-DD` in Poland (for date inputs). */
export function toWarsawDateInput(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WEDDING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Midnight in Poland that starts the calendar day `days` after the day containing `d`. Counts
 * calendar days, so a DST change in between does not move the boundary by an hour.
 */
export function startOfWarsawDay(d: Date, days = 0): Date {
  const day = new Date(`${toWarsawDateInput(d)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return warsawMidnight(day.toISOString().slice(0, 10))!;
}
