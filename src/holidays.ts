import type { DateKey } from './time.js';

export type GermanState =
  | 'BW' | 'BY' | 'BE' | 'BB' | 'HB' | 'HH' | 'HE' | 'MV'
  | 'NI' | 'NW' | 'RP' | 'SL' | 'SN' | 'ST' | 'SH' | 'TH';

/** Anonymous Gregorian algorithm - Easter Sunday of `year`. */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const key = (d: Date): DateKey => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
const fixed = (y: number, m: number, d: number): DateKey =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Wednesday before 23 November (Buß- und Bettag, Saxony only). */
function bussUndBettag(year: number): DateKey {
  const d = new Date(Date.UTC(year, 10, 22));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() - 1);
  return key(d);
}

const REFORMATION: GermanState[] = ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'];
const FRONLEICHNAM: GermanState[] = ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'];
const ALLERHEILIGEN: GermanState[] = ['BW', 'BY', 'NW', 'RP', 'SL'];
const DREIKOENIG: GermanState[] = ['BW', 'BY', 'ST'];

/** Public holidays of `year` in `state`, as { 'YYYY-MM-DD': name }. */
export function germanHolidays(year: number, state: GermanState): Record<DateKey, string> {
  const easter = easterSunday(year);
  const h: Record<DateKey, string> = {
    [fixed(year, 1, 1)]: 'Neujahr',
    [key(shift(easter, -2))]: 'Karfreitag',
    [key(shift(easter, 1))]: 'Ostermontag',
    [fixed(year, 5, 1)]: 'Tag der Arbeit',
    [key(shift(easter, 39))]: 'Christi Himmelfahrt',
    [key(shift(easter, 50))]: 'Pfingstmontag',
    [fixed(year, 10, 3)]: 'Tag der Deutschen Einheit',
    [fixed(year, 12, 25)]: '1. Weihnachtstag',
    [fixed(year, 12, 26)]: '2. Weihnachtstag',
  };

  if (DREIKOENIG.includes(state)) h[fixed(year, 1, 6)] = 'Heilige Drei Könige';
  if (state === 'BE' || (state === 'MV' && year >= 2023)) h[fixed(year, 3, 8)] = 'Internationaler Frauentag';
  if (FRONLEICHNAM.includes(state)) h[key(shift(easter, 60))] = 'Fronleichnam';
  if (state === 'SL') h[fixed(year, 8, 15)] = 'Mariä Himmelfahrt';
  if (state === 'TH') h[fixed(year, 9, 20)] = 'Weltkindertag';
  if (REFORMATION.includes(state)) h[fixed(year, 10, 31)] = 'Reformationstag';
  if (ALLERHEILIGEN.includes(state)) h[fixed(year, 11, 1)] = 'Allerheiligen';
  if (state === 'SN') h[bussUndBettag(year)] = 'Buß- und Bettag';

  // 75 years since the end of WWII - one-off holiday in Berlin.
  if (state === 'BE' && year === 2020) h['2020-05-08'] = 'Tag der Befreiung';

  return h;
}

/** Merged holiday map covering [fromYear, toYear]. */
export function holidayMap(fromYear: number, toYear: number, state: GermanState): Map<DateKey, string> {
  const map = new Map<DateKey, string>();
  for (let y = fromYear; y <= toYear; y++) {
    for (const [k, name] of Object.entries(germanHolidays(y, state))) map.set(k, name);
  }
  return map;
}
