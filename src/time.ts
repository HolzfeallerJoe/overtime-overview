/** Date/timezone helpers. No dependencies - Intl does the zone maths. */

export type DateKey = string; // 'YYYY-MM-DD' in the configured local zone

const partsOf = (d: Date, tz: string) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  // Intl renders midnight as hour 24 in some engines.
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
};

/** Offset of `tz` at instant `d`, in ms (positive east of UTC). */
export function tzOffsetMs(d: Date, tz: string): number {
  const { y, m, d: day, h, mi, s } = partsOf(d, tz);
  return Date.UTC(y, m - 1, day, h, mi, s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Local calendar day of an instant, e.g. '2026-08-25'. */
export function localDateKey(d: Date, tz: string): DateKey {
  const { y, m, d: day } = partsOf(d, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** UTC instant of local midnight starting `key`. DST-safe. */
export function startOfLocalDay(key: DateKey, tz: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = new Date(naive - tzOffsetMs(new Date(naive), tz));
  // One correction pass handles the DST transition days.
  guess = new Date(naive - tzOffsetMs(guess, tz));
  return guess;
}

export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both inclusive. */
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** 0 = Sunday … 6 = Saturday, for the local calendar day. */
export function weekdayOf(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO week identifier, e.g. '2026-W35'. */
export function isoWeekOf(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** '7h', '7.8h', '7h30m', '450m', 'PT7H30M' -> seconds. */
export function parseDuration(input: string): number {
  const s = input.trim().toUpperCase();
  if (!s) return 0;

  const iso = /^P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(s);
  if (iso) return (+(iso[1] ?? 0)) * 3600 + (+(iso[2] ?? 0)) * 60 + (+(iso[3] ?? 0));

  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^[+-]/, '');
  if (/^\d+(\.\d+)?$/.test(body)) return sign * Math.round(+body * 3600); // bare number = hours

  let total = 0, matched = false;
  for (const [, num, unit] of body.matchAll(/(\d+(?:\.\d+)?)\s*(H|M|S)/g)) {
    matched = true;
    total += +num * (unit === 'H' ? 3600 : unit === 'M' ? 60 : 1);
  }
  if (!matched) throw new Error(`Cannot parse duration: "${input}"`);
  return sign * Math.round(total);
}

/** Seconds -> '+7h 30m' / '-45m 12s'. */
export function formatDuration(seconds: number, opts: { seconds?: boolean; sign?: boolean } = {}): string {
  // Exactly zero carries no sign - "+0m" reads as a rounding artefact.
  const rounded = Math.round(seconds);
  const sign = rounded < 0 ? '-' : rounded > 0 && opts.sign ? '+' : '';
  const abs = Math.abs(Math.round(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;

  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || (!h && !opts.seconds)) parts.push(`${m}m`);
  if (opts.seconds && s) parts.push(`${s}s`);
  return sign + (parts.join(' ') || '0m');
}

/** Seconds -> decimal hours, rounded to 2 places (for CSV/export). */
export const toHours = (seconds: number): number => Math.round((seconds / 3600) * 100) / 100;
