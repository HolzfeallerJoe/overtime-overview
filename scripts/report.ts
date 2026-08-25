/**
 * Overtime report.
 *   npx tsx scripts/report.ts                  # summary + year table + months
 *   npx tsx scripts/report.ts --year 2024      # months of one year only
 *   npx tsx scripts/report.ts --days 30        # daily detail for the last 30 days
 *   npx tsx scripts/report.ts --from 2026-01-01 --to 2026-08-25
 *   npx tsx scripts/report.ts --json > out.json
 *   npx tsx scripts/report.ts --csv  > out.csv
 */
import { ClockifyClient } from '../src/clockify/client.js';
import { loadAbsences } from '../src/absenceStore.js';
import { loadConfig } from '../src/config.js';
import { buildLedger, byMonth, summarizeYears, type DayRecord, type Ledger } from '../src/overtime.js';
import { formatDuration, localDateKey, startOfLocalDay, toHours, addDays } from '../src/time.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes('--' + name);

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

function dayNote(d: DayRecord): string {
  const notes = d.absences.map((a) => (a.fraction === 1 ? a.label : `${a.label} (½)`));
  if (d.hasRunningEntry) notes.push('timer running');
  return notes.join(', ');
}

function printSummary(ledger: Ledger, absenceDays: number, syncedAt: string | null, manualCount: number): void {
  const { totals } = ledger;
  const sign = ledger.balanceSeconds >= 0 ? 'overtime' : 'undertime';

  const lastClosed = ledger.days[ledger.days.length - 1]?.date ?? ledger.from;

  const scope = ledger.config.resetAnnually ? `${lastClosed.slice(0, 4)} balance` : 'Overtime balance';

  console.log('');
  console.log(`  ${pad(scope, 18)} ${formatDuration(ledger.balanceSeconds, { sign: true, seconds: true })}  (${sign})`);
  console.log(`  Period             ${ledger.from} .. ${lastClosed}  (through the last completed day)`);

  for (const d of ledger.openDays) {
    const note = d.hasRunningEntry ? ', timer running' : '';
    console.log(`  Today (${d.date})  ${formatDuration(d.workedSeconds, { seconds: true })} so far of ` +
      `${formatDuration(d.targetSeconds)}${note} - not yet in the balance`);
  }

  console.log(`  Worked             ${formatDuration(totals.workedSeconds, { seconds: true })}  over ${totals.daysWorked} days`);
  console.log(`  Target             ${formatDuration(totals.targetSeconds)}  (${formatDuration(totals.nominalTargetSeconds)} before absences)`);
  console.log(`  Absences           ${totals.vacationDays} vacation · ${totals.sickDays} sick · ${totals.timeOffDays} time-off · ${totals.holidayDays} public holidays`);

  if (!absenceDays) {
    console.log('');
    console.log('  ! No absence data loaded - vacation and sick days are NOT excused,');
    console.log('    so every one of them counts as a full shortfall. The balances below are');
    console.log('    too low. Export your absences from Timerevision, then:');
    console.log('      npm run import -- Dominik_Renken.csv --write');
  } else {
    const src = syncedAt ? `imported ${syncedAt.slice(0, 10)}` : 'hand-maintained';
    const overrides = manualCount ? ` (+${manualCount} override${manualCount > 1 ? 's' : ''})` : '';
    console.log(`  Absence data       ${absenceDays} days, ${src}${overrides}`);
  }
  console.log('');
}

function printYears(ledger: Ledger): void {
  const years = summarizeYears(ledger);
  const reset = ledger.config.resetAnnually;

  // With an annual reset the year delta *is* the year balance, so there is no
  // second column to print.
  const balanceHead = reset ? 'Year balance' : 'Balance end';
  console.log(`  ${pad('Year', 8)}${padL('Worked', 11)}${padL('Target', 11)}${padL('Vacation', 10)}${padL(balanceHead, 14)}  Covers`);
  console.log('  ' + '-'.repeat(72));

  for (const y of years) {
    const covers = y.isPartial ? `${y.firstDate.slice(5)} .. ${y.lastDate.slice(5)}` : 'full year';
    console.log(
      '  ' + pad(String(y.year), 8) +
      padL(formatDuration(y.workedSeconds), 11) +
      padL(formatDuration(y.targetSeconds), 11) +
      padL(`${y.vacationDays} d`, 10) +
      padL(formatDuration(y.balanceSeconds, { sign: true }), 14) +
      '  ' + covers,
    );
  }

  if (reset) console.log('\n  Each year starts at zero - overtime does not carry over.');
  console.log('');
}

/** Months, with a rule and a carried-forward line at each year boundary. */
function printMonths(ledger: Ledger): void {
  console.log(`  ${pad('Month', 9)}${padL('Worked', 11)}${padL('Target', 11)}${padL('Delta', 11)}${padL('Balance', 12)}`);
  console.log('  ' + '-'.repeat(54));

  let currentYear = '';
  for (const m of byMonth(ledger)) {
    const year = m.key.slice(0, 4);
    if (year !== currentYear) {
      if (currentYear) console.log('');
      console.log(`  ${year}`);
      currentYear = year;
    }
    console.log(
      '  ' + pad('  ' + m.key.slice(5), 9) +
      padL(formatDuration(m.workedSeconds), 11) +
      padL(formatDuration(m.targetSeconds), 11) +
      padL(formatDuration(m.deltaSeconds, { sign: true }), 11) +
      padL(formatDuration(m.balanceSeconds, { sign: true }), 12),
    );
  }
  console.log('');
}

function printDays(days: DayRecord[]): void {
  console.log(`  ${pad('Date', 12)}${pad('', 4)}${padL('Worked', 10)}${padL('Target', 9)}${padL('Delta', 10)}${padL('Balance', 11)}  Note`);
  console.log('  ' + '-'.repeat(80));
  for (const d of days) {
    const idle = d.workedSeconds === 0 && d.targetSeconds === 0 && !d.absences.length;
    if (idle) continue;
    console.log(
      '  ' + pad(d.date, 12) + pad(WEEKDAY_NAMES[d.weekday], 4) +
      padL(formatDuration(d.workedSeconds, { seconds: true }), 10) +
      padL(formatDuration(d.targetSeconds), 9) +
      padL(formatDuration(d.deltaSeconds, { sign: true }), 10) +
      padL(formatDuration(d.balanceSeconds, { sign: true }), 11) +
      '  ' + dayNote(d),
    );
  }
  console.log('');
}

function toCsv(ledger: Ledger): string {
  const rows = [['date', 'weekday', 'worked_hours', 'target_hours', 'delta_hours', 'balance_hours', 'absence', 'holiday'].join(',')];
  for (const d of ledger.days) {
    rows.push([
      d.date,
      WEEKDAY_NAMES[d.weekday],
      toHours(d.workedSeconds),
      toHours(d.targetSeconds),
      toHours(d.deltaSeconds),
      toHours(d.balanceSeconds),
      `"${d.absences.filter((a) => a.source !== 'holidays').map((a) => a.label).join('; ')}"`,
      `"${d.holiday ?? ''}"`,
    ].join(','));
  }
  return rows.join('\n');
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clockify = new ClockifyClient(cfg.clockify);

  const today = localDateKey(new Date(), cfg.overtime.timezone);
  const from = flag('from') ?? cfg.balanceStart;
  const to = flag('to') ?? today;

  const entries = await clockify.getTimeEntries(
    startOfLocalDay(from, cfg.overtime.timezone).toISOString(),
    startOfLocalDay(addDays(to, 1), cfg.overtime.timezone).toISOString(),
  );

  const { absences, syncedAt, manualCount } = loadAbsences();
  const ledger = buildLedger({ entries, absences, config: cfg.overtime, from, to });

  if (has('json')) { console.log(JSON.stringify(ledger, null, 2)); return; }
  if (has('csv')) { console.log(toCsv(ledger)); return; }

  printSummary(ledger, absences.length, syncedAt, manualCount);
  printYears(ledger);

  // --year narrows what is listed, but the balance column stays cumulative
  // from the very first day - a year read in isolation would be misleading.
  const year = flag('year');
  const scoped: Ledger = year
    ? { ...ledger, days: ledger.days.filter((d) => d.date.startsWith(year)) }
    : ledger;

  if (year && !scoped.days.length) {
    console.log(`  No data for ${year}.\n`);
    return;
  }

  const nDays = flag('days');
  if (nDays) printDays(scoped.days.slice(-Number(nDays)));
  else printMonths(scoped);

  console.log(`  ${entries.length} Clockify entries · daily target ${formatDuration(cfg.overtime.dailyTargetSeconds)} · ${cfg.overtime.timezone}`);
  console.log('');
}

main().catch((err) => { console.error('\n  ' + err.message + '\n'); process.exit(1); });
