import { readSheet, serialToDate, type Grid } from '../xlsx.js';
import type { DateKey } from '../time.js';

/**
 * Reader for the company's "Dominik_working hours_YYYY.xlsx" sheet - the
 * authoritative record this project is checked against.
 *
 * Layout: a summary block at the top, then one block per month. Each block
 * opens with a header row whose cells are Excel date serials, followed by
 * labelled rows (HoursToWork / WorkingHours / IllHours / VacationHours /
 * MobileWorkHours / Difference) carrying one value per day column.
 */

export interface OfficialDay {
  date: DateKey;
  hoursToWork: number;
  workingHours: number;
  illHours: number;
  vacationHours: number;
  mobileWorkHours: number;
  /** The sheet's own delta for the day. */
  difference: number;
}

export interface OfficialYear {
  year: number;
  days: OfficialDay[];
  /** The totals block at the top of the sheet. */
  totals: {
    hoursToWork: number;
    workingHours: number;
    illHours: number;
    vacationHours: number;
    mobileWorkingHours: number;
    difference: number;
  };
  parttimeMultiplier: number;
}

const ROW_LABELS = [
  'HoursToWork', 'WorkingHours', 'IllHours', 'VacationHours', 'MobileWorkHours', 'Difference',
] as const;

type RowLabel = (typeof ROW_LABELS)[number];

/** Excel serials for real calendar dates land far above any plain hour count. */
const looksLikeDateSerial = (n: number): boolean => n > 40_000 && n < 60_000;

function labelOf(grid: Grid, row: number): string {
  return grid.get(row)?.[0]?.value?.trim() ?? '';
}

function summaryValue(grid: Grid, label: string): number {
  for (const [row, cells] of grid) {
    if (cells[0]?.value?.trim() === label && row < 10) return cells[1]?.num ?? 0;
  }
  return 0;
}

export function readOfficialYear(xlsxPath: string): OfficialYear {
  const grid = readSheet(xlsxPath);
  const byDate = new Map<DateKey, OfficialDay>();

  for (const [row, cells] of grid) {
    // A month header row: at least a handful of date serials across the row.
    const dateCols = cells
      .map((c, i) => (c?.num !== null && c?.num !== undefined && looksLikeDateSerial(c.num) ? i : -1))
      .filter((i) => i >= 0);
    if (dateCols.length < 20) continue;

    // Collect the labelled rows that follow, until the next month block.
    const rows = new Map<RowLabel, number>();
    for (let r = row + 1; r <= row + 8; r++) {
      const label = labelOf(grid, r);
      if ((ROW_LABELS as readonly string[]).includes(label)) rows.set(label as RowLabel, r);
    }
    if (!rows.has('HoursToWork') || !rows.has('WorkingHours')) continue;

    const at = (label: RowLabel, col: number): number => {
      const r = rows.get(label);
      return r === undefined ? 0 : grid.get(r)?.[col]?.num ?? 0;
    };

    for (const col of dateCols) {
      const date = serialToDate(cells[col]!.num!);
      byDate.set(date, {
        date,
        hoursToWork: at('HoursToWork', col),
        workingHours: at('WorkingHours', col),
        illHours: at('IllHours', col),
        vacationHours: at('VacationHours', col),
        mobileWorkHours: at('MobileWorkHours', col),
        difference: at('Difference', col),
      });
    }
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) throw new Error(`No month blocks found in ${xlsxPath}`);

  return {
    year: Number(days[0].date.slice(0, 4)),
    days,
    totals: {
      hoursToWork: summaryValue(grid, 'HoursToWork'),
      workingHours: summaryValue(grid, 'WorkingHours'),
      illHours: summaryValue(grid, 'IllHours'),
      vacationHours: summaryValue(grid, 'VacationHours'),
      mobileWorkingHours: grid.get(4)?.[4]?.num ?? 0,
      difference: summaryValue(grid, 'Difference'),
    },
    parttimeMultiplier: grid.get(1)?.[3]?.num ?? 1,
  };
}
