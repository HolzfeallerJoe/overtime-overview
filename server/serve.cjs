// Static file server for the overtime dashboard, with live refresh.
// No dependencies - Node built-ins only. Serves ../www on http://localhost:PORT
//
//   node server/serve.cjs                       # port 8080, refresh daily at midnight
//   PORT=9000 node server/serve.cjs             # any other port
//   REFRESH_AT=18:30 node server/serve.cjs      # other time of day, off = never
//   HOST=0.0.0.0 ALLOWED_HOSTS=homeserver ...   # reachable from the LAN (Docker)
//
// The server regenerates www/index.html itself (scripts/dashboard.ts, which
// pulls Clockify) on startup and once a day at REFRESH_AT in TIMEZONE, and
// tells open pages over Server-Sent Events. The page then
// fetches the new document and swaps its <main> in place - no reload, scroll
// position and theme survive.
//
//   GET  /events                SSE stream of the refresh state
//   POST /refresh               regenerate now
//   GET  /api/absences          imported absences + hand-maintained overrides
//   PUT  /api/absences/local    replace the overrides (absences.local.json)
//   POST /api/absences/import   preview a Timerevision export; ?write=1 saves it

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
// Loopback by default: this page contains personal working hours.
const HOST = process.env.HOST || '127.0.0.1';
const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';
const REFRESH_AT = parseRefreshAt(process.env.REFRESH_AT ?? '00:00');
const PROJECT = path.resolve(__dirname, '..');
const ROOT = path.join(PROJECT, 'www');
const DEFAULT_FILE = 'index.html';
const PAGE = path.join(ROOT, DEFAULT_FILE);
const RUN_TIMEOUT_MS = 2 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** '20:00' -> '20:00', '7:05' -> '07:05', 'off' / '' -> null. */
function parseRefreshAt(value) {
  const v = value.trim();
  if (/^(off|never|0)?$/i.test(v)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    console.error(`\n  REFRESH_AT must be HH:MM or "off", got "${value}".\n`);
    process.exit(1);
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const zoned = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Wall clock in TIMEZONE: { day: '2026-10-19', time: '20:00' }. */
function localNow() {
  const p = Object.fromEntries(zoned.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const contentType = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
const clock = () => new Date().toLocaleTimeString('de-DE');

// ---------------------------------------------------------------------------
// Refresh state, shared with every open page

const state = {
  version: pageVersion(), // mtime of www/index.html, null while it does not exist
  refreshing: false,
  error: null,
  lastRunAt: null,
  dailyAt: REFRESH_AT,
};

const clients = new Set();

function pageVersion() {
  try { return fs.statSync(PAGE).mtimeMs; } catch { return null; }
}

function broadcast() {
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(msg);
}

/** Picks up a new page however it got written - by us or by a manual `npm run dashboard`. */
function checkVersion() {
  const v = pageVersion();
  if (v !== state.version) {
    state.version = v;
    broadcast();
  }
}

// ---------------------------------------------------------------------------
// Child processes: the TypeScript scripts, run through tsx

/**
 * The line of a child's stderr worth showing. A crash ends in stack frames and
 * a "Node.js v22..." footer, so the last line says nothing; the error itself
 * ("Error: ...", "TypeError: ...") sits above them.
 */
function errorLine(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^at /.test(l) && !/^Node\.js v\d/.test(l) && !/^\^+$/.test(l));
  return lines.find((l) => /^(\w*Error|Error)\b|\bERR_|\bE[A-Z]{3,}\b/.test(l)) || lines[lines.length - 1];
}

/** Resolves to { ok, code, stdout, stderr, message } - never rejects. */
function runScript(args) {
  return new Promise((resolve) => {
    let tsx;
    try {
      tsx = require.resolve('tsx/cli', { paths: [PROJECT] });
    } catch {
      return resolve({ ok: false, stdout: '', stderr: '', message: 'tsx is not installed - run npm install' });
    }

    const child = spawn(process.execPath, [tsx, ...args], {
      cwd: PROJECT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, stdout, stderr, message: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0, stdout, stderr,
        message: code === 0 ? null : errorLine(stderr) || `exited with code ${code}`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Regeneration: run scripts/dashboard.ts

let running = null;
let rerun = null;

/**
 * Regenerates the page. A call during a run joins it - unless `again` is set:
 * the data changed after the run started, so it queues one more.
 */
function refresh(reason, again = false) {
  if (running) {
    if (again) rerun = reason;
    return running;
  }

  state.refreshing = true;
  broadcast();
  const started = Date.now();

  running = runScript(['scripts/dashboard.ts']).then((result) => {
    running = null;
    state.refreshing = false;
    state.lastRunAt = Date.now();
    state.error = result.ok ? null : result.message;
    state.version = pageVersion();
    broadcast();

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (result.ok) console.log(`  [${clock()}] refreshed (${reason}) in ${secs}s`);
    else {
      console.error(`  [${clock()}] refresh failed (${reason}): ${result.message}`);
      // The whole output, so `docker compose logs` has what the page cannot show.
      if (result.stderr.trim()) console.error(result.stderr.trim().split(/\r?\n/).slice(-40).map((l) => '    | ' + l).join('\n'));
    }

    if (rerun) {
      const next = rerun;
      rerun = null;
      refresh(next);
    }
    return result;
  });

  return running;
}

// ---------------------------------------------------------------------------
// Absences: the Timerevision import and the hand-maintained overrides.
// Same files src/absenceStore.ts reads; DATA_DIR moves them into the Docker
// volume.

const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : PROJECT;
const SYNCED = path.join(DATA, '.cache', 'absences.json');
const MANUAL = path.join(DATA, 'absences.local.json');
const MAX_UPLOAD = 5 * 1024 * 1024;
const DATA_FILES = ['.cache/absences.json', 'absences.local.json'];

/**
 * Docker: compose mounts the project folder read-only at SEED_DIR. A fresh
 * data volume is empty, so take the absence files from the folder; once the
 * volume has a file it is the truth (uploads and edits happen on the page),
 * and copying the folder over again never overwrites it.
 */
function seedData() {
  const seed = process.env.SEED_DIR;
  if (!seed) return;
  for (const rel of DATA_FILES) {
    const from = path.join(seed, rel);
    const to = path.join(DATA, rel);
    try {
      if (fs.existsSync(to) || !fs.statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      console.log(`  Took ${rel} from the project folder`);
    } catch (err) {
      console.error(`  Could not take ${rel} from the project folder: ${err.message}`);
    }
  }
}

// AbsenceKind in src/absences.ts, minus HOLIDAY - that one is derived, never entered.
const KINDS = new Set(['VACATION', 'SICK', 'CHILD_SICK', 'TIME_OFF', 'ATTENDANCE', 'TRAINING', 'SPECIAL_LEAVE', 'OTHER']);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Checks one override and keeps only the fields the ledger reads. */
function cleanOverride(a, i) {
  const where = `entry ${i + 1}`;
  if (!a || typeof a !== 'object') throw new Error(`${where} is not an object`);
  if (typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || isNaN(Date.parse(a.date))) {
    throw new Error(`${where}: date must be YYYY-MM-DD`);
  }
  if (!KINDS.has(a.kind)) throw new Error(`${where}: unknown kind "${a.kind}"`);
  if (typeof a.fraction !== 'number' || !(a.fraction >= 0 && a.fraction <= 1)) {
    throw new Error(`${where}: fraction must be between 0 and 1`);
  }
  const label = typeof a.label === 'string' ? a.label.trim().slice(0, 200) : '';
  return { date: a.date, kind: a.kind, fraction: a.fraction, label, source: 'manual' };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error(`Upload larger than ${limit / 1024 / 1024} MB`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function absencesPayload() {
  const synced = readJson(SYNCED, null);
  return {
    imported: synced?.absences ?? [],
    importedAt: synced?.syncedAt ?? null,
    importSource: synced?.source ?? null,
    overrides: readJson(MANUAL, []),
  };
}

async function saveOverrides(req, res) {
  let list;
  try {
    list = JSON.parse(await readBody(req, MAX_UPLOAD));
    if (!Array.isArray(list)) throw new Error('expected a JSON array');
    list = list.map(cleanOverride).sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }

  // Written in place rather than renamed over: a bind-mounted file cannot be replaced.
  fs.mkdirSync(path.dirname(MANUAL), { recursive: true });
  fs.writeFileSync(MANUAL, JSON.stringify(list, null, 2) + '\n');
  console.log(`  [${clock()}] saved ${list.length} absence override(s)`);
  refresh('absences edited', true);
  sendJson(res, 200, absencesPayload());
}

/** Runs scripts/import-absences.ts on the uploaded export: a preview, or with ?write=1 for real. */
async function importAbsences(req, res, write) {
  let text;
  try {
    text = await readBody(req, MAX_UPLOAD);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }
  if (!text.trim()) return sendJson(res, 400, { error: 'The file is empty.' });

  const tmp = path.join(os.tmpdir(), `overtime-import-${process.pid}-${Date.now()}.csv`);
  fs.writeFileSync(tmp, text);
  const result = await runScript(['scripts/import-absences.ts', tmp, ...(write ? ['--write'] : [])]);
  fs.rm(tmp, { force: true }, () => {});

  // The script talks to a terminal; drop its next-step hints.
  const output = (result.stdout + result.stderr)
    .split(/\r?\n/)
    .filter((l) => !/Now run:|Re-run with --write/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (result.ok && write) {
    console.log(`  [${clock()}] imported absences from an upload`);
    refresh('absences imported', true);
  }
  sendJson(res, result.ok ? 200 : 422, { ok: result.ok, written: result.ok && write, output, ...absencesPayload() });
}


// ---------------------------------------------------------------------------
// HTTP

// Only answer to names a DNS-rebinding attack cannot use, which stops some
// other site from reading the page or changing absences. Rebinding needs a
// publicly resolvable domain, so these are safe without configuration:
// IP literals, single-label names (homeserver) and LAN-only suffixes
// (homeserver.local, nas.fritz.box). ALLOWED_HOSTS adds anything else, e.g. a
// real domain behind a reverse proxy. Matched on the name alone, so a remapped
// Docker port still works.
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
);
const ANY_HOST = ALLOWED_HOSTS.has('*');
const LAN_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.internal', '.home.arpa', '.localdomain', '.fritz.box'];

function hostAllowed(host) {
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (ANY_HOST || ALLOWED_HOSTS.has(name)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name)) return true;
  if (/^[a-z0-9-]+$/.test(name)) return true;
  return LAN_SUFFIXES.some((s) => name.endsWith(s));
}

const PLACEHOLDER = (error) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="3"><title>Overtime</title></head>
<body style="font:15px system-ui,sans-serif;padding:40px;color:#444">
<p>${error ? 'Could not generate the dashboard: <code>' + error.replace(/</g, '&lt;') + '</code><br>Retrying on the next refresh.' : 'Generating the dashboard from Clockify &hellip;'}</p>
</body></html>`;

function serveEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`retry: 3000\ndata: ${JSON.stringify(state)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function originHost(origin) {
  try { return new URL(origin).host; } catch { return null; }
}

/** Browsers send Origin on every POST/PUT; a page on any other site would carry its own. */
function foreignOrigin(req) {
  return Boolean(req.headers.origin) && originHost(req.headers.origin) !== req.headers.host;
}

function serveRefresh(req, res) {
  refresh('requested');
  res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(state));
}

const server = http.createServer((req, res) => {
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && foreignOrigin(req)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const routes = {
    '/events': { GET: serveEvents },
    '/refresh': { POST: serveRefresh },
    '/api/absences': { GET: (q, s) => sendJson(s, 200, absencesPayload()) },
    '/api/absences/local': { PUT: saveOverrides },
    '/api/absences/import': { POST: (q, s) => importAbsences(q, s, /[?&]write=1\b/.test(q.url)) },
  };
  const route = routes[urlPath];
  if (route) {
    const handler = route[req.method];
    if (!handler) return res.writeHead(405, { Allow: Object.keys(route).join(', ') }).end('Method not allowed');
    return Promise.resolve(handler(req, res)).catch((err) => {
      console.error(`  [${clock()}] ${req.method} ${urlPath} failed: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    });
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/' + DEFAULT_FILE;

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Never serve outside www, whatever the request says.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (filePath === PAGE) {
        // First start: the page is being generated right now.
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3' });
        res.end(PLACEHOLDER(state.error));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 Not Found</h1><p><a href="/">Back to the dashboard</a></p>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      // The page is regenerated in place; never let a browser hold a stale copy.
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error('  Run stop-server.bat first, or start with a different PORT.\n');
    process.exit(1);
  }
  throw err;
});

seedData();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  Overtime dashboard: http://localhost:${PORT}/${HOST === '127.0.0.1' ? '' : ` (listening on ${HOST})`}`);
  console.log(`  Serving:            ${ROOT}`);
  console.log(`  Live refresh:       ${state.dailyAt ? `daily at ${state.dailyAt} (${TIMEZONE})` : 'off (REFRESH_AT=off)'}`);
  console.log('');
  if (process.platform === 'win32') {
    console.log('  Stop with Ctrl+C, by closing this window, or via stop-server.bat.');
    console.log('');
  }

  if (state.dailyAt || state.version === null) refresh('startup');
});

if (state.dailyAt) {
  // Once a day, at the first tick past REFRESH_AT. Starting after that time
  // counts as today's run - the startup refresh already covered it.
  const now = localNow();
  let lastDay = now.time >= state.dailyAt ? now.day : null;
  setInterval(() => {
    const { day, time } = localNow();
    if (time >= state.dailyAt && day !== lastDay) {
      lastDay = day;
      refresh('daily');
    }
  }, 30 * 1000).unref();
}

// A manual `npm run dashboard` should reach open pages too.
fs.watchFile(PAGE, { interval: 2000 }, () => { if (!running) checkVersion(); });

// Keep idle SSE connections from being dropped as dead.
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
  });
}
