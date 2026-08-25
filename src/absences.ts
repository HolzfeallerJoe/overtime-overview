import type { DateKey } from './time.js';

/**
 * Absence kinds we care about for the overtime balance. Timerevision labels
 * get mapped onto these; anything unmapped lands on OTHER and is reported so
 * it can be classified explicitly.
 */
export type AbsenceKind =
  | 'VACATION'      // Urlaub
  | 'SICK'          // Krankheit
  | 'CHILD_SICK'    // Kind krank
  | 'TIME_OFF'      // Ueberstundenabbau / Gleitzeit
  | 'ATTENDANCE'    // Innovation Days, Project Meeting, Berufsschule
  | 'TRAINING'      // Fortbildung - same rule as ATTENDANCE
  | 'SPECIAL_LEAVE' // Sonderurlaub
  | 'HOLIDAY'       // public holiday or company closure, derived not fetched
  | 'OTHER';

export interface Absence {
  date: DateKey;
  kind: AbsenceKind;
  /** 1 = full day, 0.5 = half day. */
  fraction: number;
  /** Original label from the source system, kept for auditing. */
  label: string;
  source: 'timerevision' | 'holidays' | 'manual';
}

/**
 * Does this absence excuse the day's target hours?
 *
 * ATTENDANCE and TRAINING are obligations that are *worked*, not time away:
 * Berufsschule, innovation days, kickoffs, courses. They excuse the target only
 * when nothing at all was tracked that day - if Clockify holds hours for them,
 * those hours already stand and excusing the target too would double-count.
 *
 * This makes the rule self-maintaining: track the day and it counts normally,
 * forget to and you are not punished for it.
 */
export function excusesTarget(kind: AbsenceKind, workedSeconds: number): boolean {
  if (kind === 'ATTENDANCE' || kind === 'TRAINING') return workedSeconds === 0;
  return true;
}

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  VACATION: 'Urlaub',
  SICK: 'Krank',
  CHILD_SICK: 'Kind krank',
  TIME_OFF: 'Ueberstundenabbau',
  ATTENDANCE: 'Praesenztag',
  TRAINING: 'Fortbildung',
  SPECIAL_LEAVE: 'Sonderurlaub',
  HOLIDAY: 'Feiertag',
  OTHER: 'Sonstiges',
};
