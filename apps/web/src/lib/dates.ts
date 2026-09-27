const TZ = 'Europe/Warsaw';

function offsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = name?.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const hours = Number(m[1]);
  return hours * 60 + Math.sign(hours) * Number(m[2] ?? 0);
}

/** `YYYY-MM-DD` as local midnight in Poland, returned as a UTC instant. */
export function warsawMidnight(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const utc = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(utc.getTime() - offsetMinutes(utc) * 60_000);
}

/** Instant -> `YYYY-MM-DD` in Poland (for date inputs). */
export function toWarsawDateInput(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
