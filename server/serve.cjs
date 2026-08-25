// Static file server for the overtime dashboard.
// No dependencies - Node built-ins only. Serves ../www on http://localhost:PORT
//
//   node server/serve.cjs            # port 8080
//   PORT=9000 node server/serve.cjs  # any other port

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..', 'www');
const DEFAULT_FILE = 'index.html';

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

if (!fs.existsSync(path.join(ROOT, DEFAULT_FILE))) {
  console.error('\n  www/index.html does not exist yet.');
  console.error('  Generate it first:  npm run dashboard\n');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
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
  console.log('');
  console.log('  Regenerate with `npm run dashboard`, then reload the page.');
  console.log('  Stop with Ctrl+C, by closing this window, or via stop-server.bat.');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
