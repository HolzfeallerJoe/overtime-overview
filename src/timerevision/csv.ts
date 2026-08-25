import type { Absence, AbsenceKind } from '../absences.js';
import { addDays, weekdayOf, type DateKey } from '../time.js';

/**
 * Parser for the Timerevision per-person CSV export
 * (`Dates;Date Requested;Event;Days;Details;Status`).
 *
 * Only two event types actually excuse the daily target. The rest are location
 * or activity markers on days that were still worked, and Clockify already
 * holds the hours for them - excusing those would double-count.
 */
const EVENT_KINDS: Record<string, AbsenceKind | 'IGNORE'> = {
  'Holiday': 'VACATION',
  'Sickday': 'SICK',
  // Obligations that are worked rather than time away - Berufsschule, innovation
  // days, kickoffs. Recorded so an untracked one is not counted as a shortfall;
  // see excusesTarget(), which only honours them when Clockify is empty.
  'Innovation Days': 'ATTENDANCE',
  'Project Meeting': 'ATTENDANCE',
  // Home office: a location marker on an ordinary tracked day.
  'Not in the building': 'IGNORE',
  // Annual leave entitlement being granted; the date span is bookkeeping,
  // not time away.
  'Days Added': 'IGNORE',
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** '15 Sep 2023' -> '2023-09-15'. */
function parseDate(raw: string): DateKey | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const DATE_RE = /(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/g;

export interface CsvParseResult {
  absences: Absence[];
  /** Rows understood but deliberately not treated as absences. */
  ignored: Array<{ event: string; days: number }>;
  declined: number;
  skipped: string[];
  unknownEvents: string[];
}

export function parseTimerevisionCsv(text: string): CsvParseResult {
  const absences: Absence[] = [];
  const ignored: Array<{ event: string; days: number }> = [];
  const skipped: string[] = [];
  const unknownEvents = new Set<string>();
  let declined = 0;

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]?.toLowerCase() ?? '';
  const body = header.startsWith('dates;') ? lines.slice(1) : lines;

  for (const line of body) {
    const cols = line.split(';');
    if (cols.length < 6) { skipped.push(line); continue; }

    const [datesRaw, , eventRaw, daysRaw, detailsRaw, statusRaw] = cols;
    const event = eventRaw.trim();
    const status = statusRaw.trim();

    // Anything not approved never happened.
    if (status !== 'Approved') { declined++; continue; }

    const kind = EVENT_KINDS[event];
    if (kind === undefined) { unknownEvents.add(event); skipped.push(line); continue; }
    if (kind === 'IGNORE') { ignored.push({ event, days: Math.abs(Number(daysRaw) || 0) }); continue; }

    const dates = [...datesRaw.matchAll(DATE_RE)]
      .map((m) => parseDate(m[1]))
      .filter((d): d is DateKey => d !== null);
    if (!dates.length) { skipped.push(line); continue; }

    // "second part of the day, 4 hours" / a -0.5 day budget hit = half a day.
    const magnitude = Math.abs(Number(daysRaw) || 0);
    const isHalf = /part of the day|4 hours/i.test(datesRaw) || magnitude === 0.5;
    const fraction = isHalf ? 0.5 : 1;

    const from = dates[0];
    const to = dates.length > 1 ? dates[dates.length - 1] : from;
    if (to < from) { skipped.push(line); continue; }

    const label = detailsRaw.trim()
      ? `${event} (${detailsRaw.replace(/<br>/g, ' ').trim()})`
      : event;

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6) continue; // weekends owe nothing anyway
      absences.push({ date: d, kind, fraction, label, source: 'timerevision' });
    }
  }

  return { absences, ignored, declined, skipped, unknownEvents: [...unknownEvents] };
}

export const TIMEREVISION_EVENT_KINDS = EVENT_KINDS;
