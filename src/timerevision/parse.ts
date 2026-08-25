import type { Absence, AbsenceKind } from '../absences.js';
import { addDays, weekdayOf, type DateKey } from '../time.js';

/**
 * Maps the label text Timerevision uses onto our absence kinds. Matching is
 * case-insensitive and substring-based, longest pattern first, so
 * "Kind krank" beats "krank".
 */
const LABEL_PATTERNS: Array<[RegExp, AbsenceKind]> = [
  [/kind\s*krank|kinderkrank/i, 'CHILD_SICK'],
  [/sonderurlaub|special\s*leave|umzug|hochzeit|geburt/i, 'SPECIAL_LEAVE'],
  [/fortbildung|schulung|training|weiterbildung|konferenz/i, 'TRAINING'],
  [/ueberstund|überstund|gleitzeit|gleittag|zeitausgleich|abbau|freizeitausgleich/i, 'TIME_OFF'],
  [/urlaub|vacation|holiday\s*leave|pto/i, 'VACATION'],
  [/krank|sick|au\b|arbeitsunfaehig|arbeitsunfähig/i, 'SICK'],
  [/feiertag|public\s*holiday/i, 'HOLIDAY'],
];

export function classify(label: string): AbsenceKind {
  for (const [re, kind] of LABEL_PATTERNS) if (re.test(label)) return kind;
  return 'OTHER';
}

/** 0.5 if the text marks a half day, else 1. */
export function fractionOf(text: string): number {
  if (/halbe|half|\bhd\b|½|0[.,]5\s*(tag|day|d)?\b|\b50\s*%/i.test(text)) return 0.5;
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:std|stunden|hours|hrs|h)\b/i.exec(text);
  if (hours) {
    const h = Number(hours[1].replace(',', '.'));
    if (h > 0 && h < 8) return Math.min(1, Math.round((h / 8) * 2) / 2);
  }
  return 1;
}

/** '13.07.2026', '2026-07-13', '13.7.26', '07/13/2026' -> '2026-07-13'. */
export function normalizeDate(raw: string): DateKey | null {
  const s = raw.trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const DATE_RE = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})/g;

export interface ParseResult {
  absences: Absence[];
  /** Lines we could not make sense of, so nothing disappears silently. */
  skipped: string[];
  /** Labels that fell through to OTHER and deserve a rule. */
  unclassified: string[];
}

/**
 * Parses pasted Timerevision output. Handles one date per line, date ranges
 * ("13.07.2026 - 24.07.2026 Urlaub"), CSV, and tab-separated exports.
 * Weekend days inside a range are dropped - they carry no target anyway.
 */
export function parseAbsenceText(text: string): ParseResult {
  const absences: Absence[] = [];
  const skipped: string[] = [];
  const unclassified = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(datum|date|von|from|typ|type|art)\b/i.test(line) && !DATE_RE.test(line)) continue;

    const dates = [...line.matchAll(DATE_RE)].map((m) => normalizeDate(m[1])).filter(Boolean) as DateKey[];
    if (!dates.length) { skipped.push(line); continue; }

    // Whatever is left after stripping dates and separators is the label.
    const label = line
      .replace(DATE_RE, ' ')
      .replace(/[;,\t|]+/g, ' ')
      .replace(/\s*-\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Abwesenheit';

    const kind = classify(label);
    if (kind === 'OTHER') unclassified.add(label);
    const fraction = fractionOf(line);

    const from = dates[0];
    const to = dates.length > 1 ? dates[dates.length - 1] : from;
    if (to < from) { skipped.push(line); continue; }

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = weekdayOf(d);
      if (wd === 0 || wd === 6) continue;
      absences.push({ date: d, kind, fraction, label, source: 'timerevision' });
    }
  }

  return { absences, skipped, unclassified: [...unclassified] };
}
