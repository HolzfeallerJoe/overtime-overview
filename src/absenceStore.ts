import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Absence } from './absences.js';
import { DATA_DIR } from './config.js';

const CACHE_DIR = resolve(DATA_DIR, '.cache');
const SYNCED = resolve(CACHE_DIR, 'absences.json');
const MANUAL = resolve(DATA_DIR, 'absences.local.json');

export interface AbsenceCache {
  syncedAt: string;
  source: string;
  absences: Absence[];
}

const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
};

/** Absences from the last Timerevision sync, plus any hand-maintained ones. */
export function loadAbsences(): { absences: Absence[]; syncedAt: string | null; manualCount: number } {
  const cache = readJson<AbsenceCache>(SYNCED);
  const manual = readJson<Absence[]>(MANUAL) ?? [];

  // Manual entries win over synced ones for the same date. A manual entry with
  // fraction 0 only exists to do that: it removes a wrongly imported day.
  const manualDates = new Set(manual.map((a) => a.date));
  const merged = [
    ...(cache?.absences ?? []).filter((a) => !manualDates.has(a.date)),
    ...manual.filter((a) => a.fraction > 0),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return { absences: merged, syncedAt: cache?.syncedAt ?? null, manualCount: manual.length };
}

export function saveAbsences(absences: Absence[], source: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const payload: AbsenceCache = { syncedAt: new Date().toISOString(), source, absences };
  writeFileSync(SYNCED, JSON.stringify(payload, null, 2));
}

export const MANUAL_ABSENCE_PATH = MANUAL;
