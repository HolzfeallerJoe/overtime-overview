/**
 * Builds the HTML overtime dashboard.
 *
 *   npx tsx scripts/dashboard.ts                       # -> out/overtime.html
 *   npx tsx scripts/dashboard.ts --from 2026-01-01     # narrow the period
 *   npx tsx scripts/dashboard.ts --out somewhere.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ClockifyClient } from '../src/clockify/client.js';
import { loadAbsences } from '../src/absenceStore.js';
import { loadConfig, PROJECT_ROOT } from '../src/config.js';
import { renderDashboard } from '../src/dashboard/render.js';
import { renderStandalone } from '../src/dashboard/standalone.js';
import { buildLedger } from '../src/overtime.js';
import { addDays, formatDuration, localDateKey, startOfLocalDay } from '../src/time.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clockify = new ClockifyClient(cfg.clockify);

  const today = localDateKey(new Date(), cfg.overtime.timezone);
  const from = flag('from') ?? cfg.balanceStart;
  const to = flag('to') ?? today;
  const out = resolve(PROJECT_ROOT, flag('out') ?? 'out/overtime.html');

  const entries = await clockify.getTimeEntries(
    startOfLocalDay(from, cfg.overtime.timezone).toISOString(),
    startOfLocalDay(addDays(to, 1), cfg.overtime.timezone).toISOString(),
  );

  const { absences } = loadAbsences();
  const ledger = buildLedger({ entries, absences, config: cfg.overtime, from, to });

  const fragment = renderDashboard(ledger, {
    absenceDays: absences.length,
    entryCount: entries.length,
    generatedAt: new Date(),
  });

  // Two outputs from one render: the fragment the Artifact host wraps itself,
  // and a complete document for the local server.
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, fragment);

  const page = resolve(PROJECT_ROOT, 'www/index.html');
  const standalone = renderStandalone(fragment);
  mkdirSync(dirname(page), { recursive: true });
  writeFileSync(page, standalone);

  console.log(`\n  Balance ${formatDuration(ledger.balanceSeconds, { sign: true })} over ${ledger.days.length} completed days`);
  for (const d of ledger.openDays) {
    console.log(`  Today (${d.date}): ${formatDuration(d.workedSeconds)} so far, not counted`);
  }
  console.log(`\n  artifact fragment  ${out}  (${(fragment.length / 1024).toFixed(0)} KB)`);
  console.log(`  standalone page    ${page}  (${(standalone.length / 1024).toFixed(0)} KB)`);
  console.log('\n  Serve it with: start-server.bat\n');
}

main().catch((err) => { console.error('\n  ' + err.message + '\n'); process.exit(1); });
