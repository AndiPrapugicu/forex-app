/**
 * Wall-clock time in a named zone or at a fixed offset, without a date library.
 *
 * "Yesterday" is the user's yesterday (Europe/Bucharest), a chart's "12:00" is
 * in whatever offset the chart prints (TradingView: "UTC+3"), and a Treasury
 * auction closes at 13:00 New York time. All three become UTC here.
 */

/** A named IANA zone, or a fixed offset from UTC in minutes. */
export type Zone = string | number;

export interface LocalDay {
  y: number;
  /** 1–12. */
  m: number;
  d: number;
  /** 0 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Minutes the zone is ahead of UTC at that instant (+180 for Bucharest in summer). */
export function offsetMinutes(ms: number, zone: Zone): number {
  if (typeof zone === 'number') return zone;
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The calendar day it is in the zone at that instant. */
export function localDay(ms: number, zone: Zone): LocalDay {
  const shifted = new Date(ms + offsetMinutes(ms, zone) * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** That wall-clock moment in the zone, as epoch milliseconds. Days and hours may overflow (d = 0 is the day before). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, zone: Zone): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMinutes(guess, zone) * 60_000;
  // Around a DST change the offset at the guess and at the answer can differ.
  return guess - offsetMinutes(first, zone) * 60_000;
}

/** The day `delta` days from `day`, as a calendar date (no zone involved). */
export function addDays(day: LocalDay, delta: number): LocalDay {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** Midnight to midnight of that day in the zone. */
export function dayBounds(day: LocalDay, zone: Zone): { fromMs: number; toMs: number } {
  return { fromMs: zonedToUtc(day.y, day.m, day.d, 0, 0, zone), toMs: zonedToUtc(day.y, day.m, day.d + 1, 0, 0, zone) };
}

export const isoDay = (day: Pick<LocalDay, 'y' | 'm' | 'd'>) =>
  `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 08 Oct". */
export const dayLabel = (day: LocalDay) => `${WEEKDAY_NAMES[day.weekday]} ${String(day.d).padStart(2, '0')} ${MONTH_NAMES[day.m - 1]}`;

/** Month number from an English or Romanian name or abbreviation, or null. */
export function monthNumber(name: string): number | null {
  const n = name.toLowerCase().replace(/\.$/, '');
  const table: [RegExp, number][] = [
    [/^(jan|ian)/, 1],
    [/^feb/, 2],
    [/^mar(?!ț|t[ie])|^march|^martie/, 3],
    [/^(apr)/, 4],
    [/^(may|mai$)/, 5],
    [/^(jun|iun)/, 6],
    [/^(jul|iul)/, 7],
    [/^aug/, 8],
    [/^sep/, 9],
    [/^oct/, 10],
    [/^(nov|noi)/, 11],
    [/^dec/, 12],
  ];
  for (const [re, k] of table) if (re.test(n)) return k;
  return null;
}
