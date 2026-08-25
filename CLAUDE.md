# CLAUDE.md

Guidance for Claude Code when working in the Overtime project.

## What this is

A running overtime balance built from two sources:

- **Clockify** — worked time, via REST API v1. Fully working.
- **Timerevision** — vacation / sick / half days. Behind Keycloak + OTP; **not**
  automated. Data comes in by copy/paste through `scripts/import-absences.ts`.

Public holidays are computed locally, not fetched.

## Commands

```bash
cd C:\Users\Dominik\Projects\Private\AI_things\software\overtime-overview
npm run report                              # summary + year table + months by year
npm run report -- --year 2024               # months of one year only
npm run report -- --days 30                 # daily detail
npm run report -- --csv > out.csv           # export
npm run reconcile -- "<workbook>.xlsx"      # regression test vs the official record
npm run import -- Dominik_Renken.csv        # preview an absence import
npm run import -- Dominik_Renken.csv --write  # save to .cache/absences.json
npm run dashboard                           # -> www/index.html + out/overtime.html
start-server.bat / stop-server.bat           # serve www/ at localhost:8080
npx tsc --noEmit                            # typecheck
```

ESM project (`"type": "module"`) — relative imports need the `.js` extension.

## Hard-won Clockify facts

- **Milliseconds do not exist.** `timeInterval.start`/`end` are second-precision
  ISO strings, and the workspace has `trackTimeDownToSecond: false` with
  "round to nearest 1 minute". Seconds is the real ceiling; in practice most
  entries land on whole minutes.
- **Never use `timeInterval.duration`** for maths — Clockify emits it at MINUTE
  precision (`PT2H25M`). Always compute from `end - start`.
- **The Reports API is off limits.** `reports.api.clockify.me/v1/.../reports/detailed`
  returns `403 You don't have a permission for that action` — it needs admin,
  and this account is a regular member. Use `/api/v1` only.
- A running timer has `end: null` and `duration: null`; the ledger counts it up
  to "now" and flags the day with `hasRunningEntry`.
- Pagination: `page-size` maxes at 1000, `page` is 1-based, results come back
  newest-first, and the `start`/`end` filters take ISO UTC instants.
- History starts **2023-09-05** — there is nothing before that.
- `workspaceSettings.workCapacity` is `PT7H`, but the **actual contract is 8h/day**
  (confirmed by Dominik). Do not "fix" `DAILY_TARGET` back to the Clockify value.
- `workingDays` is MON–FRI, timezone Europe/Berlin, `overtimeCalculationPeriod` DAILY.
- Entries older than `lockTimeEntries` (monthly auto-lock) are read-only. Reads
  are unaffected.

## Architecture

- `src/clockify/` — API client + types
- `src/time.ts` — timezone/duration helpers, no dependencies
- `src/holidays.ts` — German public holidays by state (Easter algorithm)
- `src/absences.ts` — absence kinds; `excusesTarget()` decides what waives a target
- `src/absenceStore.ts` — merges synced absences with `absences.local.json`
- `src/timerevision/parse.ts` — forgiving parser for pasted absence exports
- `src/overtime.ts` — the ledger: worked vs target per day, running balance
- `src/dashboard/render.ts` — the page as an artifact fragment
- `src/dashboard/standalone.ts` — wraps that fragment into a full document
- `src/worktime/workbook.ts`, `src/xlsx.ts` — reader for the official xlsx
- `scripts/` — `report.ts`, `dashboard.ts`, `import-absences.ts`, `reconcile.ts`
- `server/serve.cjs` — dependency-free static server for `www/`, loopback only

## Two HTML outputs

`npm run dashboard` writes both from one render:

- `www/index.html` — standalone document (doctype/head/body + a light/dark/system
  toggle), served by `server/serve.cjs`.
- `out/overtime.html` — the bare fragment, for publishing as an Artifact. The
  Artifact host supplies the wrapper, so this file must **not** carry
  `<!doctype>`/`<html>`/`<head>`/`<body>` tags.

`standalone.ts` splits the fragment at the first `<main` — everything before it
is head material. Keep the fragment starting with `<title>` and ending its head
block before `<main>`.

The local runner is a Node static server. Do not reach for nginx or Docker here:
neither is available on this machine and Dominik has ruled both out.

## Ledger semantics

Per local calendar day:

```
nominalTarget = isWorkingDay ? DAILY_TARGET : 0
excused       = sum of absence fractions that excuse the target (capped at 1)
target        = nominalTarget * (1 - excused)
delta         = worked - target
balance      += delta
```

A vacation or sick day sets the target to 0, so working on one is pure overtime.
ATTENDANCE and TRAINING excuse the target only when nothing was tracked that day,
so a tracked innovation day counts on its hours alone.

Entries crossing local midnight are split, so each day is credited only with its
own share.

## Years

**Overtime does not carry from one year into the next.** The account settles at
the turn of the year and starts again at zero every 1 January — confirmed by
Dominik, and consistent with the workbooks, which are standalone per year with no
carried-in row. `config.resetAnnually` (env `BALANCE_RESET`, default `YEARLY`)
drives this; `BALANCE_RESET=NEVER` gives one continuous total instead.

Consequences to keep in mind:

- `ledger.balanceSeconds` is the **current year's** balance, not a lifetime one.
  Label it with the year wherever it is shown.
- With the reset on, a year's `deltaSeconds` and `balanceSeconds` are equal, so
  never print both — that was a duplicated column once.
- `openingBalanceSeconds` on a `YearSummary` is 0 for every year but the first;
  the year cards drop the "Carried in" row entirely when resetting.
- The chart draws **one subpath per year**. Joining them would stroke a vertical
  line across the reset that corresponds to no real day.

`summarizeYears()` in `src/overtime.ts` is the year view: per-year worked, target,
delta, balance, absence counts and an `isPartial` flag. 2023 and 2026 are partial
by nature — 2023 starts 2023-09-05 (Dominik's start date) and the last year runs
to today. `--year` only narrows what is listed.

## Timerevision CSV

Behind Keycloak with username + password + OTP, so there is no API client —
Dominik exports a CSV and `scripts/import-absences.ts` reads it. The importer
auto-detects: a header starting `Dates;` routes to `src/timerevision/csv.ts`,
anything else to the loose text parser in `src/timerevision/parse.ts`.

Columns: `Dates;Date Requested;Event;Days;Details;Status`

Event mapping, verified against Clockify rather than assumed:

| Event | Rows | Avg Clockify hours | Kind |
|---|---|---|---|
| Not in the building | 176 | 7.81 | IGNORE — home office, an ordinary tracked day |
| Innovation Days | 143 | 7.60 | **ATTENDANCE** |
| Holiday | 49 | 0.61 | **VACATION** |
| Sickday | 6 | 0.65 | **SICK** |
| Project Meeting | 2 | 7.97 | **ATTENDANCE** |
| Days Added | 4 | — | IGNORE — leave entitlement grant, not an absence |

`VACATION` and `SICK` always excuse the target. `ATTENDANCE` (Berufsschule,
innovation days, kickoffs) excuses it **only when Clockify holds nothing at all
for that day** — see `excusesTarget()`. Track the day and it counts normally;
forget to and you are not penalised. Home office never excuses anything: those
hours are always tracked, and excusing them would double-count.

Details that matter:

- `Status` must be `Approved`; 19 rows are `Declined` and get dropped.
- `Days` is **negative** for Holiday (a leave-budget deduction) — use the
  absolute value.
- Half days appear two ways: the `Dates` text says
  `second part of the day,<br>4 hours`, **or** `Days` is `±0.5` while the text
  still reads "all day". Check both — 16 rows are `-0.5` but only 12 carry the
  text. Half-day Holidays average 4.01h in Clockify, confirming the rule.
- `Days Added` rows look like long ranges (`01 Jan 2024 - 05 Feb 2024 25 days`)
  but are bookkeeping for the annual 25-day entitlement, not time away. Never
  expand them.

The import moves the balance by roughly 625h, so never present a balance as final
while no absences are loaded. Both outputs warn when `absences.length`
is 0; keep that warning (it keys off the loaded absence count, *not* a sync
timestamp — that was a bug once).

## The official workbook is the source of truth

`Dominik_working hours_YYYY.xlsx` is the company's own record. `src/xlsx.ts` is a
dependency-free reader (shells out to `unzip`), `src/worktime/workbook.ts` parses
the sheet, and `scripts/reconcile.ts` diffs it against our ledger:

```bash
npx tsx scripts/reconcile.ts "C:/Users/Dominik/Downloads/Dominik_working hours_2024.xlsx" --days
```

**Both 2024 and 2025 reconcile to zero differing days.** Re-run this after any
change to the ledger maths — it is the regression test.

Their model is `Difference = WorkingHours + VacationHours + IllHours -
HoursToWork`, where `HoursToWork` already has public holidays removed. Ours
carries holidays in the nominal target and excuses them again, so `nominal` and
`excused` each read ~96h higher per year. That is by design and cancels; only
**WorkingHours**, **Target after absences** and **Balance** are meaningful
comparisons.

Two real defects it caught, both now fixed:

- **24 and 31 December are company closure days** (Heiligabend / Silvester) with
  `HoursToWork = 0`. They are not public holidays, so nothing derived them.
  `COMPANY_CLOSURE_DAYS` in `.env` handles them.
- **Sick days can be half days.** 2025-09-08 is 4h in the workbook, but the
  Timerevision CSV records `Sickday;0` with no half-day marker — it is simply not
  derivable from the CSV. It lives in `absences.local.json` as an override.

## Absence precedence

`.cache/absences.json` is owned by the importer (overwritten every run).
`absences.local.json` is hand-maintained and **wins per date**, so corrections
survive re-imports. Do not write imports into the local file — that was the
original wiring and it made overrides impossible.

## Rules that keep holding without recalculation

Both of these are general, derived from the workbooks, and need no per-year
maintenance:

1. **Zero-target days.** The workbook books `HoursToWork = 0` on exactly:
   weekends, NI public holidays, 24 Dec and 31 Dec. Every other weekday is 8h,
   with no half days and no exceptions — confirmed across all 731 days of 2024
   and 2025. `holidays.ts` plus `COMPANY_CLOSURE_DAYS` reproduce this exactly.
2. **Attendance days excuse only untracked days.** This absorbed the September
   2023 Berufsschule gap (7 untracked days, 56h) without hard-coding dates, and
   provably changes nothing in 2024/2025, where every such day carries ~8h.

## The open day

The final day is **not** charged its target while it is still running — the
report and dashboard would otherwise show a day's worth of phantom undertime
every morning. `buildLedger` splits `days` (completed, and what the balance is
built from) from `openDays` (today), and both outputs print today's hours
separately. `openFrom` defaults to today in the config zone; pass it explicitly
in tests.

## Dashboard

`src/dashboard/render.ts` emits artifact-ready HTML (no `<!doctype>`/`<html>`/
`<body>` wrapper — the Artifact host supplies those). Colors come from the
dataviz reference palette, validated against surfaces `#fbfcfd` / `#16181b`:
diverging blue `#2a78d6`/`#3987e5` for overtime, red `#e34948`/`#e66767` for
undertime. All three theme states are handled (bare `:root`, the
`prefers-color-scheme` media query guarded with `:not([data-theme="light"])`,
and `:root[data-theme="dark"]`).

To preview locally, wrap it before screenshotting:

```bash
CHROME="C:/Users/Dominik/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
{ printf '<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
  cat out/overtime.html; printf '</html>'; } > preview.html
"$CHROME" --headless --disable-gpu --window-size=1280,2400 --screenshot=shot.png "file:///$PWD/preview.html"
```

## Gotcha: heredocs

Writing the larger source files with `cat <<'EOF'` through the Bash tool failed
twice with ``unexpected EOF while looking for matching `'`` — once for a command
carrying two heredocs (~250 lines), once for `render.ts` (~700 lines). Small and
medium single heredocs are fine, and a bare apostrophe inside a quoted heredoc is
*not* the trigger (tested). Root cause unidentified; it is size- or
complexity-related. Use the Write tool for anything long.
