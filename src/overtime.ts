import type { TimeEntry } from './clockify/types.js';
import { excusesTarget, type Absence } from './absences.js';
import { holidayMap, type GermanState } from './holidays.js';
import {
  addDays, eachDay, isoWeekOf, localDateKey, startOfLocalDay, weekdayOf,
  type DateKey,
} from './time.js';

const WEEKDAY_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

export interface OvertimeConfig {
  /** Seconds owed on a normal working day. */
  dailyTargetSeconds: number;
  /** Weekday numbers (0=Sun) that carry a target. */
  workingDays: Set<number>;
  timezone: string;
  holidayState: GermanState;
  /**
   * Company days off that are not public holidays, as 'MM-DD' -> name.
   * Ascora closes on Heiligabend and Silvester; the official workbook books
   * 0 HoursToWork for both.
   */
  closureDays: Map<string, string>;
  /**
   * Overtime does not carry from one calendar year into the next - the account
   * starts again at zero every 1 January. Only the first year in range picks up
   * `openingBalanceSeconds`.
   */
  resetAnnually: boolean;
  /** Balance carried in on the first day of the range, in seconds. */
  openingBalanceSeconds: number;
}

export interface DayRecord {
  date: DateKey;
  isoWeek: string;
  weekday: number;
  /** A contract working day, before absences and holidays are applied. */
  isWorkingDay: boolean;
  holiday: string | null;
  absences: Absence[];
  /** What the day would demand with no absences. */
  nominalTargetSeconds: number;
  /** What the day actually demands after absences. */
  targetSeconds: number;
  workedSeconds: number;
  /** worked minus target. Positive means overtime built up. */
  deltaSeconds: number;
  /** Running total including the opening balance. */
  balanceSeconds: number;
  /** True while a timer on this day is still running. */
  hasRunningEntry: boolean;
  entryIds: string[];
}

export interface Ledger {
  /** Completed days only - these are what the balance is built from. */
  days: DayRecord[];
  /**
   * Days still in progress (normally just today). Their hours are shown but
   * kept out of the balance: charging a full day's target at 09:00 would make
   * the balance swing by a day's worth every morning.
   */
  openDays: DayRecord[];
  config: OvertimeConfig;
  from: DateKey;
  to: DateKey;
  balanceSeconds: number;
  totals: {
    workedSeconds: number;
    targetSeconds: number;
    nominalTargetSeconds: number;
    vacationDays: number;
    sickDays: number;
    holidayDays: number;
    timeOffDays: number;
    daysWorked: number;
  };
}

export function parseWorkingDays(spec: string): Set<number> {
  const days = spec.split(/[,\s]+/).filter(Boolean).map((d) => {
    const idx = WEEKDAY_INDEX[d.slice(0, 3).toUpperCase()];
    if (idx === undefined) throw new Error('Unknown weekday in WORKING_DAYS: ' + d);
    return idx;
  });
  if (!days.length) throw new Error('WORKING_DAYS is empty');
  return new Set(days);
}

/**
 * Worked seconds per local calendar day. Entries spanning local midnight are
 * split so each day is credited only with the part that fell inside it.
 * Duration is computed from start/end, never from timeInterval.duration -
 * Clockify only reports that at minute precision.
 */
export function workedSecondsByDay(
  entries: TimeEntry[],
  timezone: string,
  now: Date = new Date(),
): { seconds: Map<DateKey, number>; entryIds: Map<DateKey, string[]>; running: Set<DateKey> } {
  const seconds = new Map<DateKey, number>();
  const entryIds = new Map<DateKey, string[]>();
  const running = new Set<DateKey>();

  for (const e of entries) {
    if (e.type === 'BREAK') continue;

    const start = new Date(e.timeInterval.start);
    const isRunning = e.timeInterval.end === null;
    const end = isRunning ? now : new Date(e.timeInterval.end as string);
    if (!(end > start)) continue;

    let cursor = start;
    while (cursor < end) {
      const day = localDateKey(cursor, timezone);
      const nextMidnight = startOfLocalDay(addDays(day, 1), timezone);
      const sliceEnd = nextMidnight < end ? nextMidnight : end;

      const secs = Math.round((sliceEnd.getTime() - cursor.getTime()) / 1000);
      if (secs > 0) {
        seconds.set(day, (seconds.get(day) ?? 0) + secs);
        const ids = entryIds.get(day) ?? [];
        if (!ids.includes(e.id)) ids.push(e.id);
        entryIds.set(day, ids);
        if (isRunning) running.add(day);
      }
      cursor = sliceEnd;
    }
  }

  return { seconds, entryIds, running };
}

export function buildLedger(opts: {
  entries: TimeEntry[];
  absences: Absence[];
  config: OvertimeConfig;
  from: DateKey;
  to: DateKey;
  now?: Date;
  /** First day that is still in progress; defaults to today in the config zone. */
  openFrom?: DateKey;
}): Ledger {
  const { entries, absences, config, from, to } = opts;
  const now = opts.now ?? new Date();
  const openFrom = opts.openFrom ?? localDateKey(now, config.timezone);

  const worked = workedSecondsByDay(entries, config.timezone, now);
  const holidays = holidayMap(Number(from.slice(0, 4)), Number(to.slice(0, 4)), config.holidayState);

  const byDate = new Map<DateKey, Absence[]>();
  for (const a of absences) {
    if (a.date < from || a.date > to) continue;
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  }

  const days: DayRecord[] = [];
  const openDays: DayRecord[] = [];
  let balance = config.openingBalanceSeconds;
  const totals = {
    workedSeconds: 0, targetSeconds: 0, nominalTargetSeconds: 0,
    vacationDays: 0, sickDays: 0, holidayDays: 0, timeOffDays: 0, daysWorked: 0,
  };

  let ledgerYear = from.slice(0, 4);

  for (const date of eachDay(from, to)) {
    // The account is settled at the turn of the year: nothing carries over.
    if (config.resetAnnually && date.slice(0, 4) !== ledgerYear) {
      ledgerYear = date.slice(0, 4);
      balance = 0;
    }

    const weekday = weekdayOf(date);
    // A company closure counts exactly like a public holiday: no target, and
    // no draw on the leave budget.
    const holiday = holidays.get(date) ?? config.closureDays.get(date.slice(5)) ?? null;
    const isWorkingDay = config.workingDays.has(weekday);
    const nominalTarget = isWorkingDay ? config.dailyTargetSeconds : 0;

    const dayAbsences = byDate.get(date) ?? [];
    if (holiday && isWorkingDay) {
      dayAbsences.push({ date, kind: 'HOLIDAY', fraction: 1, label: holiday, source: 'holidays' });
    }

    const workedSeconds = worked.seconds.get(date) ?? 0;

    // Absences excuse a fraction of the day; never more than the whole day.
    // Attendance obligations only excuse an entirely untracked day.
    const excused = Math.min(
      1,
      dayAbsences
        .filter((a) => excusesTarget(a.kind, workedSeconds))
        .reduce((sum, a) => sum + a.fraction, 0),
    );
    const target = Math.round(nominalTarget * (1 - excused));

    const delta = workedSeconds - target;
    const isOpen = date >= openFrom;

    if (isOpen) {
      openDays.push({
        date, isoWeek: isoWeekOf(date), weekday, isWorkingDay, holiday,
        absences: dayAbsences,
        nominalTargetSeconds: nominalTarget,
        targetSeconds: target,
        workedSeconds,
        deltaSeconds: delta,
        balanceSeconds: balance,
        hasRunningEntry: worked.running.has(date),
        entryIds: worked.entryIds.get(date) ?? [],
      });
      continue;
    }

    balance += delta;

    totals.workedSeconds += workedSeconds;
    totals.targetSeconds += target;
    totals.nominalTargetSeconds += nominalTarget;
    if (workedSeconds > 0) totals.daysWorked++;
    for (const a of dayAbsences) {
      if (a.kind === 'VACATION') totals.vacationDays += a.fraction;
      else if (a.kind === 'SICK' || a.kind === 'CHILD_SICK') totals.sickDays += a.fraction;
      else if (a.kind === 'HOLIDAY') totals.holidayDays += a.fraction;
      else if (a.kind === 'TIME_OFF') totals.timeOffDays += a.fraction;
    }

    days.push({
      date, isoWeek: isoWeekOf(date), weekday, isWorkingDay, holiday,
      absences: dayAbsences,
      nominalTargetSeconds: nominalTarget,
      targetSeconds: target,
      workedSeconds,
      deltaSeconds: delta,
      balanceSeconds: balance,
      hasRunningEntry: worked.running.has(date),
      entryIds: worked.entryIds.get(date) ?? [],
    });
  }

  return { days, openDays, config, from, to, balanceSeconds: balance, totals };
}

export interface PeriodSummary {
  key: string;
  workedSeconds: number;
  targetSeconds: number;
  deltaSeconds: number;
  /** Balance as of the end of this period. */
  balanceSeconds: number;
  days: DayRecord[];
}

function groupBy(days: DayRecord[], keyOf: (d: DayRecord) => string): PeriodSummary[] {
  const out = new Map<string, PeriodSummary>();
  for (const d of days) {
    const key = keyOf(d);
    const p = out.get(key) ?? {
      key, workedSeconds: 0, targetSeconds: 0, deltaSeconds: 0, balanceSeconds: 0, days: [],
    };
    p.workedSeconds += d.workedSeconds;
    p.targetSeconds += d.targetSeconds;
    p.deltaSeconds += d.deltaSeconds;
    p.balanceSeconds = d.balanceSeconds;
    p.days.push(d);
    out.set(key, p);
  }
  return [...out.values()];
}

export const byWeek = (l: Ledger): PeriodSummary[] => groupBy(l.days, (d) => d.isoWeek);
export const byMonth = (l: Ledger): PeriodSummary[] => groupBy(l.days, (d) => d.date.slice(0, 7));
export const byYear = (l: Ledger): PeriodSummary[] => groupBy(l.days, (d) => d.date.slice(0, 4));

export interface YearSummary extends PeriodSummary {
  year: number;
  firstDate: DateKey;
  lastDate: DateKey;
  /** The ledger covers only part of this calendar year. */
  isPartial: boolean;
  /** Balance carried into the year, before its own delta. */
  openingBalanceSeconds: number;
  vacationDays: number;
  sickDays: number;
  timeOffDays: number;
  holidayDays: number;
  daysWorked: number;
}

/** Per-calendar-year totals, with the balance carried in and out of each year. */
export function summarizeYears(ledger: Ledger): YearSummary[] {
  return byYear(ledger).map((p) => {
    const year = Number(p.key);
    const firstDate = p.days[0].date;
    const lastDate = p.days[p.days.length - 1].date;

    let vacationDays = 0, sickDays = 0, timeOffDays = 0, holidayDays = 0, daysWorked = 0;
    for (const d of p.days) {
      if (d.workedSeconds > 0) daysWorked++;
      for (const a of d.absences) {
        if (a.kind === 'VACATION') vacationDays += a.fraction;
        else if (a.kind === 'SICK' || a.kind === 'CHILD_SICK') sickDays += a.fraction;
        else if (a.kind === 'TIME_OFF') timeOffDays += a.fraction;
        else if (a.kind === 'HOLIDAY') holidayDays += a.fraction;
      }
    }

    return {
      ...p,
      year,
      firstDate,
      lastDate,
      isPartial: firstDate !== `${year}-01-01` || lastDate !== `${year}-12-31`,
      openingBalanceSeconds: p.balanceSeconds - p.deltaSeconds,
      vacationDays, sickDays, timeOffDays, holidayDays, daysWorked,
    };
  });
}
