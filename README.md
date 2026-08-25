# overtime-overview

Flextime balance (*Gleitzeitkonto*) built from Clockify time entries and
Timerevision absences, as a terminal report and an HTML dashboard.

Reconciled against the company's official working-hours workbooks: **2024 and
2025 match to the minute, with zero differing days.**

Overtime does not carry from one year into the next — the account starts again at
zero every 1 January, so the headline figure is the **current year's** balance.

```
Year         Worked     Target  Vacation  Year balance  Covers
2023       544h 18m       544h       5 d          +18m  09-05 .. 12-31
2024      1768h 10m      1768h      29 d          +10m  full year
2025      1756h 36m      1756h      26 d          +36m  full year
2026      1180h 13m      1184h      14 d       -3h 47m  01-01 .. 08-24
```

---

## Quick start

```bash
npm install
cp example.env .env      # then fill in the Clockify keys
npm run dashboard        # build the page
start-server.bat         # serve it at http://localhost:8080
```

`start-server.bat` generates the page automatically if it is missing, so on a
fresh clone you can just run it.

---

## Scripts

Everything runs through `npm run <name>`. Extra flags need `--` first, e.g.
`npm run report -- --year 2024`.

| Command | What it does |
|---|---|
| `npm run report` | Terminal report: balance, per-year table, months grouped by year. |
| `npm run dashboard` | Builds the HTML dashboard into `www/` and `out/`. |
| `npm run import -- <file>` | Reads a Timerevision export into the absence cache. |
| `npm run reconcile -- <xlsx>` | Diffs the ledger against the official workbook. |
| `npm run serve` | Runs the static server in the foreground (Ctrl+C to stop). |
| `npm run typecheck` | `tsc --noEmit`. |
| `start-server.bat` | Starts the server in its own window and opens the browser. |
| `stop-server.bat` | Kills whatever is listening on port 8080. |

### `npm run report`

```bash
npm run report                      # everything
npm run report -- --year 2024       # list only one year's months
npm run report -- --days 30         # day-by-day for the last 30 days
npm run report -- --from 2026-01-01 --to 2026-06-30
npm run report -- --csv > out.csv   # one row per day
npm run report -- --json            # the full ledger
```

`--year` narrows what is *listed*. The balance column restarts at zero each
January, matching how the account actually works.

### `npm run dashboard`

Writes two files from one render:

- `www/index.html` — a complete standalone page for the local server, with a
  light/dark/system toggle.
- `out/overtime.html` — the same page as a fragment, for publishing as a Claude
  Artifact (the host supplies `<html>`/`<head>`/`<body>`).

Accepts `--from`, `--to` and `--out`.

### `npm run import -- <file>`

Reads absences. Two formats are detected automatically:

1. **The Timerevision CSV export** (`Dates;Date Requested;Event;Days;Details;Status`).
2. **A loose paste** — one date or range per line with a label, in `dd.mm.yyyy`
   or `yyyy-mm-dd`, with `halber Tag` / `0,5` / `½` for half days.

```bash
npm run import -- "C:/Users/Dominik/Downloads/Dominik_Renken.csv"           # preview
npm run import -- "C:/Users/Dominik/Downloads/Dominik_Renken.csv" --write   # save
```

It always prints how it classified every row, so nothing is silently dropped.

### `npm run reconcile -- <xlsx>`

Checks the numbers against `Dominik_working hours_YYYY.xlsx`, the company's own
record and the source of truth.

```bash
npm run reconcile -- "C:/Users/Dominik/Downloads/Dominik_working hours_2025.xlsx" --days
```

`--days` lists every differing day. Run it whenever a new year's workbook
arrives, and after any change to the ledger maths — it is the regression test.

One expected difference: `nominal` and `excused` read ~96h higher than the
workbook each year. The workbook strips public holidays out of `HoursToWork` up
front; this tool carries them and excuses them again. They cancel — compare
**WorkingHours**, **Target after absences** and **Balance**.

---

## Serving the dashboard

### Locally

`start-server.bat` runs `server/serve.cjs`, a dependency-free Node static server
bound to `127.0.0.1:8080`. Nothing to install, no admin rights, and the page
never leaves the machine — it contains your working hours.

```
start-server.bat     # start + open browser
stop-server.bat      # stop
```

To refresh: `npm run dashboard`, then reload the page. Set `PORT` to use a
different port (`set PORT=9000 && npm run serve`); `stop-server.bat` is hard-coded
to 8080.

---

## How the balance is computed

Per local calendar day:

```
nominalTarget = working day ? DAILY_TARGET : 0
excused       = absence fractions that excuse the target (capped at 1 day)
target        = nominalTarget × (1 − excused)
delta         = worked − target
balance      += delta
```

**Zero-target days** are weekends, Lower Saxony public holidays, and 24 / 31
December (company closure). Verified against all 731 days of the 2024 and 2025
workbooks: every other weekday is exactly 8h, no exceptions.

**Absence kinds** and what they do:

| Timerevision event | Effect |
|---|---|
| `Holiday` | Vacation — always excuses the target. Negative `Days` is a leave-budget deduction. |
| `Sickday` | Always excuses the target. |
| `Innovation Days`, `Project Meeting` | Attendance days — excuse the target **only if Clockify holds nothing at all** for that day. |
| `Not in the building` | Home office. No effect: the hours are tracked as usual. |
| `Days Added` | The annual 25-day leave grant. Not an absence; the date range is bookkeeping. |

The attendance rule is what makes this self-maintaining: track the day and it
counts on its own hours, forget to and it is not held against you. It absorbs the
September 2023 Berufsschule days without hard-coding any dates, and provably
changes nothing in 2024/2025 where every such day carries ~8h.

**The year resets.** Overtime does not carry into the next year, so the balance
starts again at zero every 1 January and the headline figure is the current
year's. Set `BALANCE_RESET=NEVER` if you ever want one continuous total.

**Today is never counted.** The balance runs through the last completed day —
otherwise it would show a full day of phantom undertime every morning and creep
back up as you work. Today's hours appear separately, above the chart.

Working *on* a vacation or sick day is therefore pure overtime.

### Precision

Clockify stores second-level timestamps and the workspace rounds to the nearest
minute, so seconds is as fine as this gets — milliseconds are not available from
the API. Durations are always computed from `start`/`end`, never from
`timeInterval.duration`, which Clockify only reports at minute precision.

---

## Corrections

Two files feed the ledger, and precedence matters:

- `.cache/absences.json` — written by `npm run import`, overwritten every run.
- `absences.local.json` — hand-maintained, **wins per date**, survives re-imports.

It currently holds one correction: 2025-09-08 was a half sick day per the
workbook, but Timerevision records it as a full day with no way to tell.

```json
[
  {
    "date": "2025-09-08",
    "kind": "SICK",
    "fraction": 0.5,
    "label": "Sickday (half day per official workbook)",
    "source": "manual"
  }
]
```

---

## Configuration

`.env`, copied from `example.env`:

| Variable | Meaning |
|---|---|
| `CLOCKIFY_API_KEY` | Profile → Settings → API. |
| `CLOCKIFY_WORKSPACE_ID` | From `GET /workspaces`. |
| `CLOCKIFY_USER_ID` | From `GET /user`. |
| `DAILY_TARGET` | Hours owed on a working day. `8h`. |
| `WORKING_DAYS` | `MON,TUE,WED,THU,FRI` |
| `TIMEZONE` | `Europe/Berlin` |
| `BALANCE_START` | First day counted. `2023-09-05`. |
| `BALANCE_RESET` | `YEARLY` (default) resets the balance each 1 January; `NEVER` keeps one running total. |
| `BALANCE_OPENING` | Balance carried in on `BALANCE_START` itself. `0`, or e.g. `+12h30m`. |
| `HOLIDAY_STATE` | German state for public holidays. `NI`. |
| `COMPANY_CLOSURE_DAYS` | Non-holiday company days off. `12-24:Heiligabend,12-31:Silvester`. |

Clockify's own `workCapacity` says 7h/day. That is wrong for this contract —
the real figure is 8h, so don't "fix" `DAILY_TARGET` back to it.

---

## Layout

```
src/
  clockify/       API client + types (v1; the Reports API needs admin)
  timerevision/   csv.ts (official export) and parse.ts (loose paste)
  worktime/       reader for the company's xlsx workbook
  dashboard/      render.ts (fragment) + standalone.ts (full document)
  overtime.ts     the ledger: worked vs target per day, running balance
  absences.ts     absence kinds and what excuses a target
  absenceStore.ts merges the import cache with local overrides
  holidays.ts     German public holidays by state (Easter algorithm)
  time.ts         timezone and duration helpers, no dependencies
  xlsx.ts         minimal xlsx reader (shells out to unzip)
scripts/          report · dashboard · import-absences · reconcile
server/serve.cjs  static file server for www/
www/              generated standalone page (gitignored)
out/              generated artifact fragment (gitignored)
```

ESM project — relative imports need the `.js` extension.

## Privacy

`www/`, `out/`, `.cache/`, `absences.local.json` and `.env` are gitignored: they
hold your API key, your working hours and your absence history. The local server
binds to loopback only. Keep the Timerevision CSV and the workbooks out of the
repo — `*.csv` and `*.xlsx` are ignored too.
