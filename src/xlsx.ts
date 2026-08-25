import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Just enough xlsx to read a value grid: unzip, resolve shared strings, walk
 * the cells. No formatting, no formulas, no dependencies beyond `unzip`.
 */

export interface Cell {
  ref: string;
  value: string;
  /** Numeric value when the cell holds a number. */
  num: number | null;
}

export type Grid = Map<number, Cell[]>;

const decodeEntities = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

/** 'AH12' -> 33 (zero-based column). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Excel serial -> 'YYYY-MM-DD'. The 1900 system counts from 1899-12-30 because
 * of the deliberate 1900-leap-year bug.
 */
export function serialToDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function readSheet(xlsxPath: string, sheetFile = 'xl/worksheets/sheet1.xml'): Grid {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  try {
    execFileSync('unzip', ['-o', '-q', xlsxPath, '-d', dir], { stdio: 'pipe' });

    let shared: string[] = [];
    try {
      const ss = readFileSync(join(dir, 'xl/sharedStrings.xml'), 'utf8');
      shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
      );
    } catch { /* a workbook with no strings is fine */ }

    const xml = readFileSync(join(dir, sheetFile), 'utf8');
    const grid: Grid = new Map();

    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: Cell[] = [];
      for (const cm of rm[2].matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)\/?>(?:([\s\S]*?)<\/c>)?/g)) {
        const [, ref, attrs = '', inner = ''] = cm;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];

        let value: string;
        if (type === 's') {
          value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? '';
        } else if (type === 'str' || type === 'inlineStr') {
          value = decodeEntities([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        } else {
          value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        }

        const num = value !== '' && !Number.isNaN(Number(value)) ? Number(value) : null;
        cells[columnIndex(ref)] = { ref, value: decodeEntities(value), num };
      }
      grid.set(Number(rm[1]), cells);
    }

    return grid;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
