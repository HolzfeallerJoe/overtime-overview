/**
 * Imports absences into absences.local.json.
 *
 *   npx tsx scripts/import-absences.ts Dominik_Renken.csv           # preview
 *   npx tsx scripts/import-absences.ts Dominik_Renken.csv --write   # save
 *   npx tsx scripts/import-absences.ts paste.txt --write --replace
 *   cat paste.txt | npx tsx scripts/import-absences.ts -
 *
 * Two input shapes are recognised automatically:
 *
 *   1. The Timerevision CSV export
 *      (`Dates;Date Requested;Event;Days;Details;Status`).
 *   2. A loose copy/paste - one date or date range per line with a label.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ABSENCE_LABELS } from '../src/absences.js';
import { MANUAL_ABSENCE_PATH, saveAbsences } from '../src/absenceStore.js';
import { parseTimerevisionCsv } from '../src/timerevision/csv.js';
import { parseAbsenceText } from '../src/timerevision/parse.js';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes('--' + f);
const source = argv.find((a) => !a.startsWith('--'));

function readInput(): string {
  if (!source) {
    throw new Error(
      'Pass a file to import, or "-" to read stdin.\n' +
      '    npx tsx scripts/import-absences.ts Dominik_Renken.csv --write',
    );
  }
  if (source === '-') return readFileSync(0, 'utf8');
  if (!existsSync(source)) throw new Error(`No such file: ${source}`);
  return readFileSync(source, 'utf8');
}

function main(): void {
  const text = readInput();
  const isCsv = /^\s*Dates;/i.test(text);

  const result = isCsv ? parseTimerevisionCsv(text) : parseAbsenceText(text);
  const { absences, skipped } = result;

  console.log(`\n  Format: ${isCsv ? 'Timerevision CSV export' : 'loose text paste'}`);

  if (!absences.length) {
    console.error('\n  Nothing parsed. Lines seen but not understood:');
    for (const l of skipped.slice(0, 10)) console.error('    ' + l);
    process.exit(1);
  }

  const byKind = new Map<string, number>();
  for (const a of absences) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + a.fraction);

  const span = absences.map((a) => a.date).sort();
  console.log(`  Parsed ${absences.length} absence days from ${span[0]} to ${span[span.length - 1]}\n`);
  for (const [kind, days] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(days).padStart(6)} d  ${ABSENCE_LABELS[kind as keyof typeof ABSENCE_LABELS] ?? kind}`);
  }

  if (isCsv) {
    const csv = result as ReturnType<typeof parseTimerevisionCsv>;

    if (csv.ignored.length) {
      const counts = new Map<string, number>();
      for (const i of csv.ignored) counts.set(i.event, (counts.get(i.event) ?? 0) + 1);
      console.log('\n  Treated as WORKED days, not absences (Clockify already holds the hours):');
      for (const [event, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(n).padStart(6)} x  ${event}`);
      }
    }
    if (csv.declined) console.log(`\n  Skipped ${csv.declined} row(s) that were not Approved.`);
    if (csv.unknownEvents.length) {
      console.log('\n  ! Unrecognised event types - tell me how to treat these:');
      for (const e of csv.unknownEvents) console.log('      ' + e);
    }
  } else {
    const loose = result as ReturnType<typeof parseAbsenceText>;
    if (loose.unclassified.length) {
      console.log('\n  ! Fell through to "Sonstiges" - these still excuse the target,');
      console.log('    but tell me the right category and I will add a rule:');
      for (const l of loose.unclassified) console.log('      ' + l);
    }
  }

  if (skipped.length) {
    console.log(`\n  ! ${skipped.length} line(s) ignored:`);
    for (const l of skipped.slice(0, 8)) console.log('      ' + l);
  }

  if (existsSync(MANUAL_ABSENCE_PATH)) {
    const overrides = JSON.parse(readFileSync(MANUAL_ABSENCE_PATH, 'utf8')) as Array<{ date: string }>;
    if (overrides.length) {
      console.log(`\n  ${overrides.length} hand-maintained override(s) in absences.local.json will win`);
      console.log('    for their dates - they are not touched by this import.');
    }
  }

  if (!has('write')) {
    console.log('\n  Preview only. Re-run with --write to save.\n');
    return;
  }

  // The import owns the synced cache; absences.local.json stays hand-maintained
  // and takes precedence, so corrections survive re-importing.
  saveAbsences(absences, isCsv ? 'timerevision-csv' : 'text-paste');
  console.log(`\n  Wrote ${absences.length} absence days to .cache/absences.json`);
  console.log('  Now run: npm run report\n');
}

try { main(); } catch (e) { console.error('\n  ' + (e as Error).message + '\n'); process.exit(1); }
