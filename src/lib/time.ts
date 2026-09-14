/**
 * Clock times as minutes from local midnight.
 *
 * Mealtimes are stored that way because every use of them is arithmetic
 * against a date, and a "13:00" string would have to be parsed before it could
 * be added to anything.
 */

/** 780 -> "13:00". Always two digits, so a column of them lines up. */
export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * "13:00", "1300", "13.00" or "13" -> 780. Null when it is not a time, so a
 * half-typed entry leaves the value alone rather than snapping to midnight.
 */
export function parseTime(input: string): number | null {
  const cleaned = input.trim().replace(/[.\s]/g, ':');
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(cleaned);
  if (!match) return null;

  const hours = Number(match[1]);
  const mins = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (hours > 23 || mins > 59) return null;

  return hours * 60 + mins;
}

/** Steps within the day rather than spilling into the next one: nudging
 *  breakfast back from 00:00 should land at 23:45, not on yesterday. */
export function stepMinutes(minutes: number, by: number): number {
  return (((minutes + by) % 1440) + 1440) % 1440;
}

/** The local Date for a given day at a given minute-of-day. */
export function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Minutes from midnight of an instant, in the viewer's own timezone. */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
