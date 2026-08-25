import { byMonth, summarizeYears, type Ledger, type DayRecord } from '../overtime.js';
import { formatDuration } from '../time.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const prettyDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

/** '2026-08-24' -> '24 Aug' - for use where the year is already stated. */
const prettyDayMonth = (key: string): string => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
};

const prettyMonth = (key: string): string => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** Hours, compact, for axis ticks. */
const hLabel = (seconds: number): string => {
  const h = seconds / 3600;
  const rounded = Math.abs(h) >= 100 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}h`;
};

interface ChartGeometry {
  path: string;
  area: string;
  zeroY: number;
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string; anchor: string }>;
  /** Plotted position of every day, in the same order as the ledger. */
  points: Array<{ x: number; y: number }>;
  endX: number;
  endY: number;
}

const W = 1000, H = 340, PAD_L = 8, PAD_R = 8, PAD_T = 18, PAD_B = 26;

function buildChart(days: DayRecord[]): ChartGeometry {
  const values = days.map((d) => d.balanceSeconds);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  // Headroom on both ends so the zero line never sits flush against an edge
  // when the balance stays on one side of it.
  const pad = (rawMax - rawMin || 3600) * 0.08;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min;
  const plotH = H - PAD_T - PAD_B;
  const plotW = W - PAD_L - PAD_R;

  const x = (i: number) => PAD_L + (i / Math.max(1, days.length - 1)) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - min) / span) * plotH;

  const points = days.map((d, i) => ({ x: x(i), y: y(d.balanceSeconds) }));
  const zeroY = y(0);

  // The balance resets at the turn of the year, so the line is drawn as one
  // subpath per year. Joining them would draw a vertical stroke across the
  // reset that no day actually corresponds to.
  const segments: Array<{ from: number; to: number }> = [];
  let segStart = 0;
  for (let i = 1; i <= days.length; i++) {
    const boundary = i === days.length || days[i].date.slice(0, 4) !== days[i - 1].date.slice(0, 4);
    if (boundary) { segments.push({ from: segStart, to: i - 1 }); segStart = i; }
  }

  const coords = (i: number) => `${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;

  const path = segments
    .map((s) => 'M' + Array.from({ length: s.to - s.from + 1 }, (_, k) => coords(s.from + k)).join('L'))
    .join('');

  // Same shape closed down to the zero line; clip rects split it into the two arms.
  const area = segments.map((s) => {
    const line = Array.from({ length: s.to - s.from + 1 }, (_, k) => coords(s.from + k)).join('L');
    return `M${line}L${points[s.to].x.toFixed(1)},${zeroY.toFixed(1)}` +
      `L${points[s.from].x.toFixed(1)},${zeroY.toFixed(1)}Z`;
  }).join('');

  // Y ticks: round hour steps either side of zero. Zero gets the dashed rule
  // instead, so it is skipped here. The step adapts to the range so a balance
  // hovering near zero still gets readable gridlines.
  const wanted = span / 3600 / 4;
  const stepHours = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]
    .find((c) => c >= wanted) ?? 1000;
  const yTicks: Array<{ y: number; label: string }> = [];
  for (let h = Math.ceil(min / 3600 / stepHours) * stepHours; h * 3600 <= max; h += stepHours) {
    if (h !== 0) yTicks.push({ y: y(h * 3600), label: hLabel(h * 3600) });
  }

  // X ticks where the year rolls over. The first one hugs the left edge, so it
  // is left-anchored rather than centred on a point that is not there.
  const xTicks: Array<{ x: number; label: string; anchor: string }> = [];
  let lastYear = '';
  days.forEach((d, i) => {
    const year = d.date.slice(0, 4);
    if (year !== lastYear) {
      xTicks.push({ x: x(i), label: year, anchor: xTicks.length === 0 ? 'start' : 'middle' });
      lastYear = year;
    }
  });

  return {
    path, area, zeroY, yTicks, xTicks, points,
    endX: x(days.length - 1),
    endY: y(values[values.length - 1]),
  };
}

export interface DashboardMeta {
  /** Absence day-records folded into the ledger. Zero means the balance is understated. */
  absenceDays: number;
  entryCount: number;
  generatedAt: Date;
}

export function renderDashboard(ledger: Ledger, meta: DashboardMeta): string {
  const g = buildChart(ledger.days);
  const months = byMonth(ledger);
  const { totals } = ledger;
  const positive = ledger.balanceSeconds >= 0;
  const targetH = ledger.config.dailyTargetSeconds / 3600;
  const maxMonthDelta = Math.max(...months.map((m) => Math.abs(m.deltaSeconds)), 1);

  // Only what a tooltip can land on needs to travel to the browser.
  const series = ledger.days.map((d, i) => ({
    d: d.date,
    b: Math.round(d.balanceSeconds),
    w: Math.round(d.workedSeconds),
    t: Math.round(d.targetSeconds),
    a: d.absences.map((x) => x.label).join(', ') || null,
    x: Number(g.points[i].x.toFixed(1)),
    y: Number(g.points[i].y.toFixed(1)),
  }));

  const lastClosed = ledger.days[ledger.days.length - 1]?.date ?? ledger.from;

  const openNote = ledger.openDays.map((d) => `
      <p class="open-day">
        <span class="open-dot${d.hasRunningEntry ? ' is-live' : ''}" aria-hidden="true"></span>
        Today, ${prettyDate(d.date)}: <strong>${formatDuration(d.workedSeconds)}</strong>
        of ${formatDuration(d.targetSeconds)}${d.hasRunningEntry ? ', timer running' : ''}
        &mdash; still open, so not counted above.
      </p>`).join('');

  const reset = ledger.config.resetAnnually;
  const years = summarizeYears(ledger);
  const maxYearDelta = Math.max(...years.map((y) => Math.abs(y.deltaSeconds)), 1);

  const yearCards = years.map((y) => {
    const up = y.deltaSeconds >= 0;
    const width = (Math.abs(y.deltaSeconds) / maxYearDelta) * 50;
    return `
      <article class="year">
        <header class="year-head">
          <h3>${y.year}</h3>
          <span class="year-span">${y.isPartial
            ? `${MONTH_NAMES[Number(y.firstDate.slice(5, 7)) - 1]}&ndash;${MONTH_NAMES[Number(y.lastDate.slice(5, 7)) - 1]}`
            : 'full year'}</span>
        </header>
        <p class="year-delta ${up ? 'up' : 'down'}">${formatDuration(y.deltaSeconds, { sign: true })}</p>
        <span class="bar-track year-bar">
          <span class="bar ${up ? 'bar-up' : 'bar-down'}" style="width:${width.toFixed(1)}%"></span>
        </span>
        <dl class="year-facts">
          <div><dt>Worked</dt><dd>${formatDuration(y.workedSeconds)}</dd></div>
          <div><dt>Target</dt><dd>${formatDuration(y.targetSeconds)}</dd></div>
          <div><dt>Vacation</dt><dd>${y.vacationDays} d</dd></div>
          <div><dt>Sick</dt><dd>${y.sickDays} d</dd></div>
          ${reset ? '' : `<div><dt>Carried in</dt><dd>${formatDuration(y.openingBalanceSeconds, { sign: true })}</dd></div>`}
        </dl>
      </article>`;
  }).join('');

  let lastYear = '';
  const monthRows = months.map((m) => {
    const up = m.deltaSeconds >= 0;
    const width = (Math.abs(m.deltaSeconds) / maxMonthDelta) * 50;
    const yearKey = m.key.slice(0, 4);
    const groupHead = yearKey === lastYear ? '' : `
        <tr class="year-row">
          <th scope="rowgroup" colspan="6">${yearKey}</th>
        </tr>`;
    lastYear = yearKey;
    return `${groupHead}
        <tr>
          <th scope="row">${prettyMonth(m.key)}</th>
          <td class="num">${formatDuration(m.workedSeconds)}</td>
          <td class="num">${formatDuration(m.targetSeconds)}</td>
          <td class="num ${up ? 'up' : 'down'}">${formatDuration(m.deltaSeconds, { sign: true })}</td>
          <td class="bar-cell">
            <span class="bar-track">
              <span class="bar ${up ? 'bar-up' : 'bar-down'}" style="width:${width.toFixed(1)}%"></span>
            </span>
          </td>
          <td class="num strong">${formatDuration(m.balanceSeconds, { sign: true })}</td>
        </tr>`;
  }).join('');

  const caveat = meta.absenceDays ? '' : `
  <aside class="caveat" role="note">
    <span class="caveat-mark" aria-hidden="true">!</span>
    <div>
      <strong>No absence data loaded.</strong>
      Vacation, sick days and time off are not excused yet, so each one counts as a full
      ${targetH}h shortfall. The real balance is <em>substantially higher</em> than the figure
      above &mdash; about ${targetH}h per absent day. Import a Timerevision export to fix this.
    </div>
  </aside>`;

  const tiles = [
    ['Time worked', formatDuration(totals.workedSeconds), `${totals.daysWorked} days with entries`],
    ['Target', formatDuration(totals.targetSeconds), `${formatDuration(totals.nominalTargetSeconds)} before absences`],
    ['Vacation', `${totals.vacationDays} d`, `${totals.sickDays} d sick &middot; ${totals.timeOffDays} d time off`],
    ['Public holidays', `${totals.holidayDays} d`, 'Niedersachsen, computed locally'],
  ].map(([label, value, note]) => `
      <div class="tile">
        <span class="eyebrow">${label}</span>
        <span class="tile-value">${value}</span>
        <span class="tile-note">${note}</span>
      </div>`).join('');

  const gridLines = g.yTicks
    .map((t) => `<line class="grid-line" x1="${PAD_L}" x2="${W - PAD_R}" y1="${t.y.toFixed(1)}" y2="${t.y.toFixed(1)}"/>`)
    .join('\n        ');
  const yTickText = g.yTicks
    .map((t) => `<text class="tick-text" x="${PAD_L + 2}" y="${(t.y - 5).toFixed(1)}">${t.label}</text>`)
    .join('\n        ');
  const xTickText = g.xTicks
    .map((t) => `<text class="tick-text" x="${t.x.toFixed(1)}" y="${H - 6}" text-anchor="${t.anchor}">${t.label}</text>`)
    .join('\n        ');

  return `<title>Gleitzeitkonto</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --plane: #f4f6f8;
    --surface: #fbfcfd;
    --ink: #101419;
    --ink-2: #56606c;
    --muted: #8a94a1;
    --grid: #e4e8ed;
    --rule: #d7dde4;
    --pos: #2a78d6;
    --neg: #e34948;
    --pos-fill: rgba(42, 120, 214, 0.15);
    --neg-fill: rgba(227, 73, 72, 0.15);
    --warn-ink: #7d5200;
    --warn-bg: #fcf3e2;
    --warn-rule: #e3c37c;
    --shadow: 0 1px 2px rgba(16, 20, 25, 0.05), 0 10px 28px rgba(16, 20, 25, 0.05);
    --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --plane: #0b0c0e;
      --surface: #16181b;
      --ink: #f2f4f7;
      --ink-2: #b9c1cb;
      --muted: #7e8894;
      --grid: #24282d;
      --rule: #2d323a;
      --pos: #3987e5;
      --neg: #e66767;
      --pos-fill: rgba(57, 135, 229, 0.20);
      --neg-fill: rgba(230, 103, 103, 0.20);
      --warn-ink: #f0c469;
      --warn-bg: #221c10;
      --warn-rule: #5f4a1d;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.45), 0 10px 28px rgba(0, 0, 0, 0.35);
    }
  }

  :root[data-theme="dark"] {
    --plane: #0b0c0e;
    --surface: #16181b;
    --ink: #f2f4f7;
    --ink-2: #b9c1cb;
    --muted: #7e8894;
    --grid: #24282d;
    --rule: #2d323a;
    --pos: #3987e5;
    --neg: #e66767;
    --pos-fill: rgba(57, 135, 229, 0.20);
    --neg-fill: rgba(230, 103, 103, 0.20);
    --warn-ink: #f0c469;
    --warn-bg: #221c10;
    --warn-rule: #5f4a1d;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.45), 0 10px 28px rgba(0, 0, 0, 0.35);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--plane);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .sheet {
    max-width: 1120px;
    margin: 0 auto;
    padding: clamp(24px, 5vw, 56px) clamp(16px, 4vw, 40px) 72px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 20px;
    border-bottom: 2px solid var(--ink);
  }

  .masthead h1 {
    margin: 2px 0 0;
    font-size: clamp(28px, 4vw, 38px);
    font-weight: 600;
    letter-spacing: -0.024em;
    text-wrap: balance;
  }

  .meta { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 0; }
  .meta div { display: flex; flex-direction: column; gap: 1px; }
  .meta dt {
    font-size: 11px; font-weight: 600; letter-spacing: 0.09em;
    text-transform: uppercase; color: var(--muted);
  }
  .meta dd {
    margin: 0; font-family: var(--mono); font-size: 13px;
    font-variant-numeric: tabular-nums; color: var(--ink-2);
  }

  .balance {
    display: grid;
    grid-template-columns: minmax(250px, 1fr) minmax(0, 1.3fr);
    gap: 28px;
    align-items: start;
  }

  .hero-figure { display: flex; flex-direction: column; gap: 2px; }

  .hero {
    margin: 0;
    font-family: var(--mono);
    font-size: clamp(44px, 8vw, 66px);
    font-weight: 500;
    line-height: 1.05;
    letter-spacing: -0.04em;
    color: var(--pos);
  }
  .hero.is-negative { color: var(--neg); }
  .hero-note { margin: 6px 0 0; color: var(--ink-2); max-width: 36ch; }
  .hero-note strong { font-weight: 600; color: var(--ink); }

  .open-day {
    margin: 10px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--grid);
    max-width: 40ch;
    font-size: 13px;
    color: var(--muted);
  }
  .open-day strong { font-weight: 600; color: var(--ink-2); }

  .open-dot {
    display: inline-block;
    width: 7px; height: 7px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .open-dot.is-live { background: var(--pos); }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: 3px;
    overflow: hidden;
  }

  .tile {
    display: flex; flex-direction: column; gap: 3px;
    padding: 14px 16px 16px;
    background: var(--surface);
  }

  .tile-value {
    font-family: var(--mono);
    font-size: 19px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .tile-note { font-size: 12px; color: var(--muted); }

  .caveat {
    display: flex;
    gap: 12px;
    padding: 14px 18px;
    background: var(--warn-bg);
    border: 1px solid var(--warn-rule);
    border-radius: 3px;
    color: var(--warn-ink);
    font-size: 14px;
    line-height: 1.5;
  }

  .caveat strong { color: var(--warn-ink); font-weight: 600; }
  .caveat em { font-style: normal; text-decoration: underline; text-underline-offset: 2px; }

  .caveat-mark {
    flex: none;
    width: 20px; height: 20px;
    margin-top: 2px;
    display: grid; place-items: center;
    border-radius: 50%;
    background: var(--warn-ink);
    color: var(--warn-bg);
    font-size: 13px; font-weight: 600;
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 3px;
    box-shadow: var(--shadow);
  }

  .panel-head {
    display: flex; flex-wrap: wrap;
    align-items: baseline; justify-content: space-between;
    gap: 8px;
    padding: 16px 20px 12px;
  }

  .panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.012em; }
  .panel-head p { margin: 0; font-size: 12.5px; color: var(--muted); }

  .chart-wrap { position: relative; padding: 0 20px 14px; }
  .chart-wrap svg { display: block; width: 100%; height: auto; overflow: visible; }

  .grid-line { stroke: var(--grid); stroke-width: 1; }
  .year-rule { stroke: var(--grid); stroke-width: 1; }
  .zero-line { stroke: var(--ink); stroke-width: 1.25; stroke-dasharray: 3 3; opacity: 0.5; }
  .balance-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .tick-text { font-family: var(--mono); font-size: 10.5px; fill: var(--muted); }
  .zero-label { fill: var(--ink-2); }

  .crosshair { stroke: var(--ink-2); stroke-width: 1; opacity: 0; }
  .cursor-dot { opacity: 0; }

  .tooltip {
    position: absolute;
    top: 0; left: 0;
    min-width: 178px;
    padding: 9px 12px 10px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 3px;
    box-shadow: var(--shadow);
    pointer-events: none;
    opacity: 0;
    transition: opacity 90ms ease;
    font-size: 12.5px;
  }

  .tooltip.is-on { opacity: 1; }
  .tooltip dl { display: grid; grid-template-columns: auto auto; gap: 1px 14px; margin: 6px 0 0; }
  .tooltip dt { color: var(--muted); }
  .tooltip dd {
    margin: 0; font-family: var(--mono);
    font-variant-numeric: tabular-nums; text-align: right;
  }
  .tt-date { font-weight: 600; letter-spacing: -0.01em; }
  .tt-absence {
    margin-top: 6px; padding-top: 6px;
    border-top: 1px solid var(--grid);
    color: var(--ink-2); font-size: 12px;
  }

  .years {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 1px;
    background: var(--rule);
    border-top: 1px solid var(--rule);
  }

  .year {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 20px 18px;
    background: var(--surface);
  }

  .year-head { display: flex; align-items: baseline; gap: 8px; }
  .year-head h3 {
    margin: 0;
    font-family: var(--mono);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .year-span {
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .year-delta {
    margin: 0;
    font-family: var(--mono);
    font-size: 26px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .year-bar { max-width: 150px; }

  .year-facts { display: grid; gap: 2px; margin: 2px 0 0; }
  .year-facts div { display: flex; justify-content: space-between; gap: 12px; }
  .year-facts dt { font-size: 12px; color: var(--muted); }
  .year-facts dd {
    margin: 0;
    font-family: var(--mono);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  .year-facts dd.strong { color: var(--ink); font-weight: 600; }

  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  caption { text-align: left; padding: 0 20px 12px; font-size: 12.5px; color: var(--muted); }

  thead th {
    padding: 8px 14px;
    border-bottom: 1px solid var(--rule);
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--muted);
    text-align: right; white-space: nowrap;
  }

  thead th:first-child { text-align: left; padding-left: 20px; }

  tbody th {
    padding: 7px 14px 7px 20px;
    text-align: left; font-weight: 500; white-space: nowrap;
    border-bottom: 1px solid var(--grid);
  }

  tbody td { padding: 7px 14px; border-bottom: 1px solid var(--grid); }

  .year-row th {
    padding: 14px 20px 5px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--ink-2);
    border-bottom: 1px solid var(--rule);
  }
  .year-row:first-child th { padding-top: 4px; }
  tbody tr.year-row:hover th { background: transparent; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover th, tbody tr:hover td { background: var(--plane); }

  .num {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    text-align: right; white-space: nowrap;
  }
  .num.strong { font-weight: 600; padding-right: 20px; }
  .up { color: var(--pos); }
  .down { color: var(--neg); }

  .bar-cell { width: 180px; }

  .bar-track {
    position: relative;
    display: block;
    height: 8px;
    background: linear-gradient(
      to right,
      transparent calc(50% - 0.5px), var(--rule) calc(50% - 0.5px),
      var(--rule) calc(50% + 0.5px), transparent calc(50% + 0.5px)
    );
  }

  .bar { position: absolute; top: 0; height: 8px; border-radius: 2px; }
  .bar-up { left: calc(50% + 1px); background: var(--pos); }
  .bar-down { right: calc(50% + 1px); background: var(--neg); }

  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }

  .colophon {
    display: flex; flex-wrap: wrap; gap: 4px 20px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--muted);
  }

  .colophon code { font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); }

  @media (max-width: 720px) {
    .balance { grid-template-columns: 1fr; }
    .bar-cell, thead th:nth-child(5) { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>

<main class="sheet">
  <header class="masthead">
    <div>
      <span class="eyebrow">Overtime ledger</span>
      <h1>Gleitzeitkonto</h1>
    </div>
    <dl class="meta">
      <div><dt>Period</dt><dd>${ledger.from} &rarr; ${lastClosed}</dd></div>
      <div><dt>Daily target</dt><dd>${targetH}h &middot; Mon&ndash;Fri</dd></div>
      <div><dt>Entries</dt><dd>${meta.entryCount.toLocaleString('en-US')}</dd></div>
    </dl>
  </header>

  <section class="balance">
    <div class="hero-figure">
      <span class="eyebrow">${reset
        ? `${lastClosed.slice(0, 4)} balance through ${prettyDayMonth(lastClosed)}`
        : `Balance through ${prettyDate(lastClosed)}`}</span>
      <p class="hero${positive ? '' : ' is-negative'}">${formatDuration(ledger.balanceSeconds, { sign: true })}</p>
      <p class="hero-note">
        <strong>${formatDuration(Math.abs(ledger.balanceSeconds))}</strong>
        ${positive ? 'ahead of' : 'behind'} contract
        ${reset ? `since 1 January ${lastClosed.slice(0, 4)}` : `over ${ledger.days.length.toLocaleString('en-US')} completed days`}.
        ${reset ? 'Overtime does not carry into the next year.' : ''}
      </p>
      ${openNote}
    </div>
    <div class="tiles">${tiles}
    </div>
  </section>
${caveat}
  <section class="panel">
    <div class="panel-head">
      <h2>Running balance</h2>
      <p>${reset ? "Hours above (blue) or below (red) the " + targetH + "h&nbsp;day, reset each 1 January" : "Cumulative hours above (blue) or below (red) the " + targetH + "h&nbsp;day"}</p>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Running overtime balance from ${ledger.from} to ${ledger.to}, ending at ${formatDuration(ledger.balanceSeconds, { sign: true })}.">
        <defs>
          <clipPath id="clip-above"><rect x="0" y="0" width="${W}" height="${g.zeroY.toFixed(1)}"/></clipPath>
          <clipPath id="clip-below"><rect x="0" y="${g.zeroY.toFixed(1)}" width="${W}" height="${(H - g.zeroY).toFixed(1)}"/></clipPath>
        </defs>

        ${gridLines}
        ${g.xTicks.slice(1).map((t) => `<line class="year-rule" x1="${t.x.toFixed(1)}" x2="${t.x.toFixed(1)}" y1="${PAD_T}" y2="${H - PAD_B}"/>`).join('\n        ')}

        <path d="${g.area}" fill="var(--pos-fill)" clip-path="url(#clip-above)"/>
        <path d="${g.area}" fill="var(--neg-fill)" clip-path="url(#clip-below)"/>

        <line class="zero-line" x1="${PAD_L}" x2="${W - PAD_R}" y1="${g.zeroY.toFixed(1)}" y2="${g.zeroY.toFixed(1)}"/>

        <path class="balance-line" d="${g.path}" stroke="var(--pos)" clip-path="url(#clip-above)"/>
        <path class="balance-line" d="${g.path}" stroke="var(--neg)" clip-path="url(#clip-below)"/>

        ${yTickText}
        ${xTickText}

        <line class="crosshair" id="crosshair" y1="${PAD_T}" y2="${H - PAD_B}"/>
        <circle class="cursor-dot" id="cursor-dot" r="4.5" fill="var(--surface)" stroke-width="2.5"/>

        <circle cx="${g.endX.toFixed(1)}" cy="${g.endY.toFixed(1)}" r="4.5"
                fill="var(--surface)" stroke="var(--${positive ? 'pos' : 'neg'})" stroke-width="2.5"/>

        <rect id="hit" x="${PAD_L}" y="${PAD_T}" width="${W - PAD_L - PAD_R}" height="${H - PAD_T - PAD_B}" fill="transparent"/>
      </svg>
      <div class="tooltip" id="tooltip" role="status" aria-live="polite"></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Year by year</h2>
      <p>${reset ? "Each year settles on its own" : "Each year on its own, plus the balance carried across"}</p>
    </div>
    <div class="years">${yearCards}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Month by month</h2>
      <p>Delta bars share one scale, anchored at zero</p>
    </div>
    <div class="table-scroll">
      <table>
        <caption>Worked and target hours per calendar month. ${reset ? "The balance column restarts at zero each January." : "The balance is carried forward."}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Worked</th>
            <th scope="col">Target</th>
            <th scope="col">Delta</th>
            <th scope="col"><span class="sr-only">Delta chart</span></th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>${monthRows}
        </tbody>
      </table>
    </div>
  </section>

  <footer class="colophon">
    <span>Worked time from Clockify, second precision</span>
    <span>Absences ${meta.absenceDays ? `${meta.absenceDays} days from Timerevision` : 'not loaded'}</span>
    <span>Public holidays computed locally</span>
    <span>Generated ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
  </footer>
</main>

<script>
  (function () {
    var days = ${JSON.stringify(series)};
    var W = ${W}, H = ${H}, PAD_L = ${PAD_L}, PAD_R = ${PAD_R};

    var svg = document.querySelector('.chart-wrap svg');
    var wrap = document.querySelector('.chart-wrap');
    var hit = document.getElementById('hit');
    var cross = document.getElementById('crosshair');
    var dot = document.getElementById('cursor-dot');
    var tip = document.getElementById('tooltip');
    if (!svg || !hit) return;

    function fmt(s) {
      var sign = s < 0 ? '-' : '';
      var a = Math.abs(s);
      var h = Math.floor(a / 3600);
      var m = Math.floor((a % 3600) / 60);
      return sign + (h ? h + 'h ' : '') + m + 'm';
    }
    function fmtSigned(s) { return (s >= 0 ? '+' : '') + fmt(s); }

    function show(point) {
      var box = svg.getBoundingClientRect();
      var px = ((point.clientX - box.left) / box.width) * W;
      var frac = (px - PAD_L) / (W - PAD_L - PAD_R);
      var i = Math.round(frac * (days.length - 1));
      i = Math.max(0, Math.min(days.length - 1, i));

      var d = days[i];
      if (!d) return;

      cross.setAttribute('x1', d.x);
      cross.setAttribute('x2', d.x);
      cross.style.opacity = '0.4';
      dot.setAttribute('cx', d.x);
      dot.setAttribute('cy', d.y);
      dot.setAttribute('stroke', d.b >= 0 ? 'var(--pos)' : 'var(--neg)');
      dot.style.opacity = '1';

      tip.innerHTML =
        '<div class="tt-date">' + d.d + '</div>' +
        '<dl>' +
        '<dt>Balance</dt><dd>' + fmtSigned(d.b) + '</dd>' +
        '<dt>Worked</dt><dd>' + fmt(d.w) + '</dd>' +
        '<dt>Target</dt><dd>' + fmt(d.t) + '</dd>' +
        '<dt>Day delta</dt><dd>' + fmtSigned(d.w - d.t) + '</dd>' +
        '</dl>' +
        (d.a ? '<div class="tt-absence">' + d.a + '</div>' : '');

      tip.classList.add('is-on');
      var left = (d.x / W) * box.width + 22;
      tip.style.left = Math.min(Math.max(8, left), box.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.max(6, (d.y / H) * box.height - 34) + 'px';
    }

    function hide() {
      cross.style.opacity = '0';
      dot.style.opacity = '0';
      tip.classList.remove('is-on');
    }

    hit.addEventListener('mousemove', show);
    hit.addEventListener('mouseleave', hide);
    wrap.addEventListener('touchmove', function (e) {
      if (e.touches[0]) show(e.touches[0]);
    }, { passive: true });
    wrap.addEventListener('touchend', hide);
  })();
</script>`;
}
