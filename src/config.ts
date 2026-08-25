import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { GermanState } from './holidays.js';
import { parseDuration } from './time.js';
import { parseWorkingDays, type OvertimeConfig } from './overtime.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

loadEnv({ path: resolve(PROJECT_ROOT, '.env'), quiet: true });

const req = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing from .env (see example.env)`);
  return v;
};

/** '12-24:Heiligabend,12-31' -> Map { '12-24' => 'Heiligabend', '12-31' => 'Betriebsruhe' } */
function parseClosureDays(spec: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [day, name] = part.split(':');
    if (!/^\d{2}-\d{2}$/.test(day)) {
      throw new Error(`COMPANY_CLOSURE_DAYS entry must be MM-DD[:name], got "${part}"`);
    }
    out.set(day, name?.trim() || 'Betriebsruhe');
  }
  return out;
}

export interface AppConfig {
  clockify: { apiKey: string; workspaceId: string; userId: string };
  overtime: OvertimeConfig;
  balanceStart: string;
  timerevision: { baseUrl: string | null; username: string | null };
}

export function loadConfig(): AppConfig {
  return {
    clockify: {
      apiKey: req('CLOCKIFY_API_KEY'),
      workspaceId: req('CLOCKIFY_WORKSPACE_ID'),
      userId: req('CLOCKIFY_USER_ID'),
    },
    overtime: {
      dailyTargetSeconds: parseDuration(process.env.DAILY_TARGET ?? '7h'),
      workingDays: parseWorkingDays(process.env.WORKING_DAYS ?? 'MON,TUE,WED,THU,FRI'),
      timezone: process.env.TIMEZONE ?? 'Europe/Berlin',
      holidayState: (process.env.HOLIDAY_STATE ?? 'NI') as GermanState,
      closureDays: parseClosureDays(process.env.COMPANY_CLOSURE_DAYS ?? '12-24:Heiligabend,12-31:Silvester'),
      resetAnnually: (process.env.BALANCE_RESET ?? 'YEARLY').toUpperCase() !== 'NEVER',
      openingBalanceSeconds: parseDuration(process.env.BALANCE_OPENING ?? '0'),
    },
    balanceStart: process.env.BALANCE_START ?? '2023-09-05',
    timerevision: {
      baseUrl: process.env.TIMEREVISION_BASE_URL || null,
      username: process.env.TIMEREVISION_USERNAME || null,
    },
  };
}
