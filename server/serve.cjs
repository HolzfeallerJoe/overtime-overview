// Static file server for the overtime dashboard, with live refresh.
// No dependencies - Node built-ins only. Serves ../www on http://localhost:PORT
//
//   node server/serve.cjs                      # port 8080, refresh every 5 min
//   PORT=9000 node server/serve.cjs            # any other port
//   REFRESH_MINUTES=15 node server/serve.cjs   # other interval, 0 = never
//
// The server regenerates www/index.html itself (scripts/dashboard.ts, which
// pulls Clockify) and tells open pages over Server-Sent Events. The page then
// fetches the new document and swaps its <main> in place - no reload, scroll
// position and theme survive.
//
//   GET  /events   SSE stream of the refresh state
//   POST /refresh  regenerate now

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const REFRESH_MINUTES = process.env.REFRESH_MINUTES === undefined ? 5 : Number(process.env.REFRESH_MINUTES);
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

const contentType = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
const clock = () => new Date().toLocaleTimeString('de-DE');

// ---------------------------------------------------------------------------
// Refresh state, shared with every open page

const state = {
  version: pageVersion(), // mtime of www/index.html, null while it does not exist
  refreshing: false,
  error: null,
  lastRunAt: null,
  everyMinutes: REFRESH_MINUTES > 0 ? REFRESH_MINUTES : null,
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
// Regeneration: run scripts/dashboard.ts in a child process

let running = null;

function refresh(reason) {
  if (running) return running;

  state.refreshing = true;
  broadcast();
  const started = Date.now();

  running = new Promise((resolve) => {
    let tsx;
    try {
      tsx = require.resolve('tsx/cli', { paths: [PROJECT] });
    } catch {
      return resolve({ ok: false, message: 'tsx is not installed - run npm install' });
    }

    const child = spawn(process.execPath, [tsx, 'scripts/dashboard.ts'], {
      cwd: PROJECT,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ ok: true });
      const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
      resolve({ ok: false, message: lines[lines.length - 1] || `exited with code ${code}` });
    });
  }).then((result) => {
    running = null;
    state.refreshing = false;
    state.lastRunAt = Date.now();
    state.error = result.ok ? null : result.message;
    state.version = pageVersion();
    broadcast();

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (result.ok) console.log(`  [${clock()}] refreshed (${reason}) in ${secs}s`);
    else console.error(`  [${clock()}] refresh failed (${reason}): ${result.message}`);
    return result;
  });

  return running;
}

/** True when the data on disk is older than one refresh interval. */
function stale() {
  if (!state.everyMinutes) return false;
  const last = Math.max(state.lastRunAt || 0, state.version || 0);
  return Date.now() - last >= state.everyMinutes * 60 * 1000;
}

// ---------------------------------------------------------------------------
// HTTP

// Only answer to our own name. Stops DNS rebinding from reading the page or
// triggering refreshes from some other site.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

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

  // Someone is looking again after a quiet spell: bring the numbers up to date.
  if (stale()) refresh('page opened');
}

function serveRefresh(req, res) {
  // Browsers send Origin on every POST; a page on any other site would carry its own.
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  refresh('requested');
  res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(state));
}

const server = http.createServer((req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
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

  if (urlPath === '/events' && req.method === 'GET') return serveEvents(req, res);
  if (urlPath === '/refresh') {
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end('Method not allowed');
    return serveRefresh(req, res);
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

// Bind to loopback only: this page contains personal working hours.
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log(`  Overtime dashboard: http://localhost:${PORT}/`);
  console.log(`  Serving:            ${ROOT}`);
  console.log(`  Live refresh:       ${state.everyMinutes ? `every ${state.everyMinutes} min while a page is open` : 'off (REFRESH_MINUTES=0)'}`);
  console.log('');
  console.log('  Stop with Ctrl+C, by closing this window, or via stop-server.bat.');
  console.log('');

  if (state.everyMinutes || state.version === null) refresh('startup');
});

if (state.everyMinutes) {
  // Only spend Clockify calls while somebody is watching; serveEvents catches
  // up as soon as a page connects again.
  setInterval(() => { if (clients.size > 0) refresh('scheduled'); }, state.everyMinutes * 60 * 1000).unref();
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
