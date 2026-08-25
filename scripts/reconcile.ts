/**
 * Compares the computed ledger against the company's official workbook.
 *
 *   npx tsx scripts/reconcile.ts "C:/.../Dominik_working hours_2024.xlsx" [...more]
 *   npx tsx scripts/reconcile.ts <files> --days     # list every differing day
 *
 * The workbook is the source of truth. Anything this prints is a defect in our
 * numbers, not in theirs.
 */
import { ClockifyClient } from '../src/clockify/client.js';
import { loadAbsences } from '../src/absenceStore.js';
import { loadConfig } from '../src/config.js';
import { buildLedger, type DayRecord } from '../src/overtime.js';
import { addDays, formatDuration, startOfLocalDay } from '../src/time.js';
import { readOfficialYear, type OfficialDay } from '../src/worktime/workbook.js';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--'));
const showDays = argv.includes('--days');

const H = (hours: number) => formatDuration(Math.round(hours * 3600), { sign: true });
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

function compareTotals(label: string, official: number, ours: number): string {
  const diff = ours - official;
  const flag = Math.abs(diff) < 0.02 ? 'ok' : `off by ${H(diff)}`;
  return '  ' + pad(label, 22) + padL(official.toFixed(2), 12) + padL(ours.toFixed(2), 12) + '   ' + flag;
}

async function main(): Promise<void> {
  if (!files.length) throw new Error('Pass one or more "Dominik_working hours_YYYY.xlsx" files.');

  const cfg = loadConfig();
  const clockify = new ClockifyClient(cfg.clockify);
  const { absences } = loadAbsences();

  for (const file of files) {
    const official = readOfficialYear(file);
    const from = official.days[0].date;
    const to = official.days[official.days.length - 1].date;

    const entries = await clockify.getTimeEntries(
      startOfLocalDay(from, cfg.overtime.timezone).toISOString(),
      startOfLocalDay(addDays(to, 1), cfg.overtime.timezone).toISOString(),
    );
    const ledger = buildLedger({ entries, absences, config: cfg.overtime, from, to });
    const ours = new Map<string, DayRecord>(ledger.days.map((d) => [d.date, d]));

    // Their model: Difference = WorkingHours + VacationHours + IllHours - HoursToWork.
    let oNominal = 0, oWorked = 0, oVac = 0, oIll = 0;
    for (const d of official.days) {
      oNominal += d.hoursToWork; oWorked += d.workingHours;
      oVac += d.vacationHours; oIll += d.illHours;
    }

    let uNominal = 0, uWorked = 0, uExcused = 0;
    for (const d of ledger.days) {
      uNominal += d.nominalTargetSeconds / 3600;
      uWorked += d.workedSeconds / 3600;
      uExcused += (d.nominalTargetSeconds - d.targetSeconds) / 3600;
    }

    console.log(`\n${'='.repeat(74)}\n  ${official.year}   ${file.split(/[\\/]/).pop()}\n${'='.repeat(74)}`);
    console.log('  ' + pad('', 22) + padL('official', 12) + padL('ours', 12) + '   verdict');
    console.log('  ' + '-'.repeat(60));
    console.log(compareTotals('WorkingHours', oWorked, uWorked));
    console.log(compareTotals('Target after absences', oNominal - oVac - oIll, uNominal - uExcused));
    console.log(compareTotals('Balance for the year', official.totals.difference, ledger.balanceSeconds / 3600));
    console.log('');
    console.log('  Nominal and excused hours differ by design: the workbook removes public');
    console.log('  holidays from HoursToWork up front, we carry them and excuse them again.');
    console.log(compareTotals('  nominal (informational)', oNominal, uNominal));
    console.log(compareTotals('  excused (informational)', oVac + oIll, uExcused));

    // Where do the days actually disagree?
    const rows: Array<{ d: OfficialDay; u: DayRecord; dNom: number; dWork: number; dExc: number }> = [];
    for (const d of official.days) {
      const u = ours.get(d.date);
      if (!u) continue;
      const dNom = u.nominalTargetSeconds / 3600 - d.hoursToWork;
      const dWork = u.workedSeconds / 3600 - d.workingHours;
      const dExc = (u.nominalTargetSeconds - u.targetSeconds) / 3600 - (d.vacationHours + d.illHours);
      // A holiday we carry and then excuse nets to zero against their model.
      const cancels = Math.abs(dNom - dExc) < 0.02 && u.holiday !== null;
      if (cancels) continue;
      if (Math.abs(dNom) > 0.02 || Math.abs(dWork) > 0.02 || Math.abs(dExc) > 0.02) {
        rows.push({ d, u, dNom, dWork, dExc });
      }
    }

    const bucket = (r: (typeof rows)[number]): string => {
      if (Math.abs(r.dWork) > 0.02) return 'worked-hours mismatch';
      if (Math.abs(r.dNom) > 0.02 && Math.abs(r.dExc) < 0.02) return 'non-working-day mismatch';
      return 'absence mismatch';
    };

    const grouped = new Map<string, number>();
    for (const r of rows) grouped.set(bucket(r), (grouped.get(bucket(r)) ?? 0) + 1);

    console.log(`\n  ${rows.length} day(s) disagree:`);
    for (const [k, n] of [...grouped].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${k}`);
    }

    if (showDays && rows.length) {
      console.log(`\n  ${pad('Date', 12)}${padL('nominal', 10)}${padL('worked', 10)}${padL('excused', 10)}   official / ours`);
      console.log('  ' + '-'.repeat(84));
      for (const r of rows) {
        const notes = [
          r.u.holiday ? `holiday: ${r.u.holiday}` : '',
          r.u.absences.filter((a) => a.source !== 'holidays').map((a) => a.label).join(', '),
          r.d.vacationHours ? `sheet vac ${r.d.vacationHours}h` : '',
          r.d.illHours ? `sheet ill ${r.d.illHours}h` : '',
        ].filter(Boolean).join(' | ');
        console.log(
          '  ' + pad(r.d.date, 12) +
          padL(r.dNom ? H(r.dNom) : '-', 10) +
          padL(r.dWork ? H(r.dWork) : '-', 10) +
          padL(r.dExc ? H(r.dExc) : '-', 10) +
          '   ' + notes,
        );
      }
    }
    console.log('');
  }
}

main().catch((err) => { console.error('\n  ' + err.message + '\n'); process.exit(1); });
