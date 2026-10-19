/**
 * Wraps the artifact fragment into a complete, self-contained HTML document.
 *
 * The fragment `renderDashboard()` produces has no <!doctype>/<html>/<head>/
 * <body> - the Artifact host supplies those. To serve the same page from a
 * plain web server we add them here, plus what only makes sense with
 * server/serve.cjs behind the page:
 *
 *   - a light/dark control (the stylesheet already reacts to `data-theme`),
 *   - the refresh status and a Refresh button,
 *   - the Absences dialog: upload a Timerevision export, correct single days.
 *
 * Everything here lives outside <main>, so it survives the live swap.
 */
import { ABSENCE_LABELS, type AbsenceKind } from '../absences.js';

/** Everything before <main> is head material (title, font links, styles). */
function split(fragment: string): { head: string; body: string } {
  const at = fragment.indexOf('<main');
  if (at < 0) return { head: '', body: fragment };
  return { head: fragment.slice(0, at).trim(), body: fragment.slice(at).trim() };
}

/** Kinds offered in the editor. HOLIDAY is derived from the calendar, never entered. */
const KIND_OPTIONS = (Object.keys(ABSENCE_LABELS) as AbsenceKind[])
  .filter((k) => k !== 'HOLIDAY')
  .map((k) => [k, ABSENCE_LABELS[k]]);

export function renderStandalone(fragment: string): string {
  const { head, body } = split(fragment);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
${head}
<style>
  /* The artifact host paints a ground behind the page; standing alone we own it. */
  html { background: var(--plane); }

  .shell-controls {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    background: var(--surface);
    color: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: 999px;
    box-shadow: var(--shadow);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
  }

  button.pill { cursor: pointer; }
  button.pill:hover { color: var(--ink); }
  button.pill:disabled { cursor: progress; color: var(--muted); }
  .pill:focus-visible, .btn:focus-visible { outline: 2px solid var(--pos); outline-offset: 2px; }
  .pill svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .pill[hidden] { display: none; }

  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .live[data-state="live"] .live-dot { background: var(--pos); }
  .live[data-state="busy"] .live-dot { background: var(--pos); animation: live-pulse 1s ease-in-out infinite alternate; }
  .live[data-state="error"] .live-dot { background: var(--neg); }
  @keyframes live-pulse { to { opacity: 0.25; } }

  #refresh[data-busy] svg { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Briefly mark the sheet when fresh numbers land. */
  main.is-fresh { animation: sheet-fresh 0.6s ease-out; }
  @keyframes sheet-fresh { from { opacity: 0.55; } }

  /* --- Absences dialog ------------------------------------------------ */

  .abs {
    width: min(920px, calc(100% - 32px));
    max-height: calc(100dvh - 48px);
    padding: 0;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 3px;
    box-shadow: var(--shadow);
    font-family: var(--sans);
    font-size: 14px;
  }
  .abs::backdrop { background: rgba(11, 12, 14, 0.5); }

  .abs-head {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 18px 22px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
  }
  .abs-head h2 { margin: 2px 0 0; font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
  .abs-head p { margin: 4px 0 0; max-width: 62ch; font-size: 13px; color: var(--ink-2); }

  .abs-block { padding: 18px 22px; border-bottom: 1px solid var(--grid); }
  .abs-block:last-of-type { border-bottom: 0; }
  .abs-block h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
  .abs-hint { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }

  .abs-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

  .abs input, .abs select {
    font: inherit; font-size: 13px;
    padding: 5px 8px;
    background: var(--plane); color: var(--ink);
    border: 1px solid var(--rule); border-radius: 3px;
    min-width: 0;
  }
  .abs input:focus-visible, .abs select:focus-visible { outline: 2px solid var(--pos); outline-offset: 1px; }
  .abs input[type="file"] { padding: 4px; max-width: 100%; }
  .abs input:disabled, .abs select:disabled { opacity: 0.55; }

  .btn {
    font: inherit; font-size: 12.5px; font-weight: 500;
    padding: 6px 12px;
    background: var(--surface); color: var(--ink-2);
    border: 1px solid var(--rule); border-radius: 3px;
    cursor: pointer; white-space: nowrap;
  }
  .btn:hover { color: var(--ink); border-color: var(--ink-2); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-primary { background: var(--pos); border-color: var(--pos); color: var(--surface); }
  .btn-primary:hover { color: var(--surface); border-color: var(--pos); filter: brightness(1.08); }
  .btn-quiet { padding: 3px 8px; border-color: transparent; background: transparent; }
  .btn-quiet:hover { border-color: var(--rule); }

  .abs-close { font-size: 18px; line-height: 1; padding: 4px 10px; }

  .abs-output {
    margin: 12px 0;
    padding: 10px 12px;
    max-height: 280px; overflow: auto;
    background: var(--plane);
    border: 1px solid var(--grid); border-radius: 3px;
    font-family: var(--mono); font-size: 12px; line-height: 1.5;
    white-space: pre; color: var(--ink-2);
  }
  .abs-output.is-error { border-color: var(--neg); }

  .abs-add {
    display: grid;
    grid-template-columns: auto auto auto minmax(120px, 1fr) auto;
    align-items: end; gap: 8px;
    margin-bottom: 16px;
  }
  .abs-add label, .abs-filter label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
  .abs-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px 18px; margin-bottom: 8px; }
  .abs-filter label.check { flex-direction: row; align-items: center; gap: 6px; padding-bottom: 6px; }
  .abs-count { margin-left: auto; padding-bottom: 6px; font-size: 12px; color: var(--muted); }

  .abs-table { overflow-x: auto; border-top: 1px solid var(--rule); }
  .abs table { font-size: 13px; }
  .abs thead th, .abs thead th:first-child { padding: 8px 8px; text-align: left; }
  .abs thead th:first-child, .abs tbody td:first-child { padding-left: 0; }
  .abs tbody td { padding: 5px 8px; vertical-align: middle; }
  .abs tbody td:last-child { text-align: right; padding-right: 0; white-space: nowrap; }
  .abs tbody tr:hover td { background: transparent; }
  .abs td input[type="text"] { width: 100%; min-width: 140px; }
  .abs-date { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .abs-weekday { color: var(--muted); }
  .abs tr.is-removed .abs-date, .abs tr.is-removed .abs-note { text-decoration: line-through; color: var(--muted); }
  .abs-empty { padding: 18px 0; color: var(--muted); }

  .tag {
    display: inline-block;
    padding: 1px 8px;
    border: 1px solid var(--rule); border-radius: 999px;
    font-size: 11px; font-weight: 500; white-space: nowrap;
    color: var(--ink-2);
  }
  .tag-edited, .tag-manual { color: var(--pos); border-color: var(--pos); }
  .tag-removed { color: var(--neg); border-color: var(--neg); }

  .abs-status {
    position: sticky; bottom: 0;
    margin: 0; padding: 10px 22px;
    min-height: 40px;
    background: var(--surface);
    border-top: 1px solid var(--rule);
    font-size: 12.5px; color: var(--ink-2);
  }
  .abs-status.is-error { color: var(--neg); }

  /* Keep the buttons clear of the masthead on narrow screens. */
  @media (max-width: 640px) {
    .shell-controls { position: static; margin: 14px 16px 0; }
    .pill { box-shadow: none; }
    .abs-add { grid-template-columns: 1fr 1fr; }
    .abs-add .grow, .abs-add button { grid-column: 1 / -1; }
  }

  @media print {
    .shell-controls, .abs { display: none; }
    .panel { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="shell-controls">
  <span class="pill live" id="live" data-state="offline" hidden>
    <span class="live-dot" aria-hidden="true"></span>
    <span id="live-label" aria-live="polite">Connecting</span>
  </span>
  <button class="pill" id="refresh" type="button" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>
    <span>Refresh</span>
  </button>
  <button class="pill" id="abs-open" type="button" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
    <span>Absences</span>
  </button>
  <button class="pill" id="theme-toggle" type="button" aria-live="polite">
    <svg viewBox="0 0 24 24" aria-hidden="true" id="theme-icon"></svg>
    <span id="theme-label">System</span>
  </button>
</div>

${body}

<dialog class="abs" id="abs" aria-labelledby="abs-title">
  <div class="abs-head">
    <div>
      <span class="eyebrow">Timerevision</span>
      <h2 id="abs-title">Absences</h2>
      <p>Vacation, sick and attendance days. Corrections made here win for their
      day and survive the next import.</p>
    </div>
    <button class="btn abs-close" id="abs-close" type="button" aria-label="Close">&times;</button>
  </div>

  <section class="abs-block">
    <h3>Import export</h3>
    <p class="abs-hint" id="abs-imported">Loading&hellip;</p>
    <div class="abs-row">
      <input type="file" id="abs-file" accept=".csv,.txt,text/csv,text/plain" aria-label="Timerevision export">
      <button class="btn" id="abs-preview" type="button" disabled>Preview</button>
    </div>
    <div id="abs-result" hidden>
      <div class="abs-output" id="abs-output" tabindex="0"></div>
      <div class="abs-row">
        <button class="btn btn-primary" id="abs-apply" type="button">Replace import</button>
        <button class="btn" id="abs-discard" type="button">Discard</button>
      </div>
    </div>
  </section>

  <section class="abs-block">
    <h3>Days</h3>
    <p class="abs-hint">Change a day's kind, length or note in place. Removing an
    imported day keeps it gone across re-imports until you restore it.</p>
    <form class="abs-add" id="abs-add">
      <label>Date<input type="date" name="date" required></label>
      <label>Kind<select name="kind" data-kinds></select></label>
      <label>Length<select name="fraction"><option value="1">Full day</option><option value="0.5">Half day</option></select></label>
      <label class="grow">Note<input type="text" name="label" placeholder="optional" maxlength="200"></label>
      <button class="btn btn-primary" type="submit">Add day</button>
    </form>
    <div class="abs-filter">
      <label>Year<select id="abs-year"></select></label>
      <label class="check"><input type="checkbox" id="abs-only"> Corrections only</label>
      <span class="abs-count" id="abs-count"></span>
    </div>
    <div class="abs-table">
      <table>
        <thead><tr><th>Date</th><th>Kind</th><th>Length</th><th>Note</th><th>Source</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="abs-rows"></tbody>
      </table>
    </div>
  </section>

  <p class="abs-status" id="abs-status" role="status"></p>
</dialog>

<script data-shell>
  (function () {
    var KEY = 'overtime-theme';
    var MODES = ['system', 'light', 'dark'];
    var ICONS = {
      system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/>',
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
      dark: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>'
    };
    var LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

    var btn = document.getElementById('theme-toggle');
    var icon = document.getElementById('theme-icon');
    var label = document.getElementById('theme-label');
    var mode = 'system';

    // Storage can throw outright in a private window or with site data blocked.
    try { if (MODES.indexOf(localStorage.getItem(KEY)) >= 0) mode = localStorage.getItem(KEY); } catch (e) {}

    function apply() {
      if (mode === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', mode);
      icon.innerHTML = ICONS[mode];
      label.textContent = LABELS[mode];
      btn.setAttribute('aria-label', 'Theme: ' + LABELS[mode] + '. Click to change.');
    }

    btn.addEventListener('click', function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch (e) {}
      apply();
    });

    apply();
  })();
</script>

<script data-shell>
  // Live refresh. server/serve.cjs regenerates this page once a day and on
  // request, and announces each new version over /events; we fetch it and swap
  // <main> in place, then re-run the page's own scripts against the new markup.
  (function () {
    var pill = document.getElementById('live');
    var label = document.getElementById('live-label');
    var btn = document.getElementById('refresh');
    if (!pill || location.protocol === 'file:' || !window.EventSource || !window.DOMParser) return;
    pill.hidden = false;
    btn.hidden = false;

    var state = null;      // last message from the server
    var shown = null;      // version currently on screen
    var online = false;
    var swapping = false;

    // Refreshes run daily, so anything older than today carries its weekday.
    function time(ms) {
      var d = new Date(ms);
      var opts = { hour: '2-digit', minute: '2-digit' };
      if (d.toDateString() !== new Date().toDateString()) opts.weekday = 'short';
      return d.toLocaleString([], opts);
    }

    function render() {
      var s, text, title;
      if (!online) {
        s = 'offline'; text = 'Offline'; title = 'Server not reachable - the numbers on screen stay as they are.';
      } else if (state.refreshing) {
        s = 'busy'; text = 'Updating'; title = 'Fetching the latest entries from Clockify.';
      } else if (state.error) {
        s = 'error'; text = 'Update failed'; title = state.error;
      } else {
        s = 'live'; text = shown ? 'Updated ' + time(shown) : 'Live';
        title = state.dailyAt ? 'Updates daily at ' + state.dailyAt + '.' : 'No automatic updates.';
      }
      pill.setAttribute('data-state', s);
      label.textContent = text;
      pill.title = title;

      var busy = online && state && state.refreshing;
      btn.disabled = !online || busy;
      if (busy) btn.setAttribute('data-busy', ''); else btn.removeAttribute('data-busy');
      btn.title = busy ? 'Updating...' : 'Fetch the latest entries from Clockify now.';
    }

    function swap() {
      if (swapping || !state || state.version === null || state.version === shown) return;
      swapping = true;
      var version = state.version;

      fetch('/index.html', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var next = doc.querySelector('main');
          var current = document.querySelector('main');
          if (!next || !current) throw new Error('no <main> in the new page');

          var fresh = document.importNode(next, true);
          fresh.classList.add('is-fresh');
          current.replaceWith(fresh);
          if (doc.title) document.title = doc.title;

          // Scripts arriving via DOMParser are inert; recreate them so the chart
          // binds to the new SVG and its new data.
          document.querySelectorAll('body > script:not([data-shell])').forEach(function (s) { s.remove(); });
          doc.querySelectorAll('body > script:not([data-shell])').forEach(function (s) {
            var run = document.createElement('script');
            run.textContent = s.textContent;
            document.body.appendChild(run);
          });

          shown = version;
        })
        .catch(function (err) { console.warn('Live refresh failed:', err); })
        .then(function () {
          swapping = false;
          render();
          if (state && state.version !== shown) setTimeout(swap, 1000);
        });
    }

    var events = new EventSource('/events');
    events.onopen = function () { online = true; };
    events.onerror = function () { online = false; render(); };
    events.onmessage = function (e) {
      online = true;
      state = JSON.parse(e.data);
      // The page was just loaded fresh, so the first version we hear about is
      // the one on screen. After a server restart a newer one triggers a swap.
      if (shown === null) shown = state.version;
      render();
      swap();
    };

    btn.addEventListener('click', function () {
      if (!online || (state && state.refreshing)) return;
      fetch('/refresh', { method: 'POST' }).catch(function () {});
    });
  })();
</script>

<script data-shell>
  // Absences: GET/PUT /api/absences*, see server/serve.cjs. The import lives in
  // .cache/absences.json, corrections in absences.local.json; a correction
  // replaces whatever the import says for its date, and fraction 0 removes it.
  (function () {
    var KINDS = ${JSON.stringify(KIND_OPTIONS)};
    var dialog = document.getElementById('abs');
    var openBtn = document.getElementById('abs-open');
    if (!dialog || location.protocol === 'file:' || !dialog.showModal) return;
    openBtn.hidden = false;

    var $ = function (id) { return document.getElementById(id); };
    var rowsEl = $('abs-rows');
    var statusEl = $('abs-status');
    var fileEl = $('abs-file');
    var yearEl = $('abs-year');
    var onlyEl = $('abs-only');
    var addForm = $('abs-add');

    var data = null;       // last payload from the server
    var pending = null;    // text of the file being previewed

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function kindLabel(k) {
      for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][1];
      return k;
    }

    function kindOptions(selected) {
      var known = KINDS.some(function (k) { return k[0] === selected; });
      var list = known || !selected ? KINDS : KINDS.concat([[selected, selected]]);
      return list.map(function (k) {
        return '<option value="' + k[0] + '"' + (k[0] === selected ? ' selected' : '') + '>' + esc(k[1]) + '</option>';
      }).join('');
    }

    function lengthOptions(fraction) {
      var opts = [[1, 'Full day'], [0.5, 'Half day']];
      if (fraction !== 1 && fraction !== 0.5 && fraction > 0) opts.push([fraction, fraction + ' day']);
      return opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === fraction ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('');
    }

    function prettyDate(key) {
      var d = new Date(key + 'T12:00:00');
      return {
        weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
        date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      };
    }

    function say(text, isError) {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('is-error', Boolean(isError));
    }

    function api(method, url, body, type) {
      var init = { method: method, headers: {} };
      if (body != null) { init.body = body; init.headers['Content-Type'] = type; }
      return fetch(url, init).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok && j.output == null) throw new Error(j.error || 'HTTP ' + r.status);
          return j;
        });
      });
    }

    // --- Model: one row per date -------------------------------------------

    function rows() {
      var byDate = {};
      function at(d) { return byDate[d] || (byDate[d] = { date: d, imp: null, loc: null }); }
      data.imported.forEach(function (a) { if (!at(a.date).imp) at(a.date).imp = a; });
      data.overrides.forEach(function (a) { if (!at(a.date).loc) at(a.date).loc = a; });

      return Object.keys(byDate).sort().reverse().map(function (d) {
        var r = byDate[d];
        if (!r.loc) r.state = 'imported';
        else if (r.loc.fraction === 0) r.state = 'removed';
        else r.state = r.imp ? 'edited' : 'manual';
        r.shown = r.state === 'imported' || r.state === 'removed' ? (r.imp || r.loc) : r.loc;
        return r;
      });
    }

    /** Replaces the corrections for one date (null drops them) and saves. */
    function setOverride(date, entry, message) {
      var next = data.overrides.filter(function (a) { return a.date !== date; });
      if (entry) next.push({ date: date, kind: entry.kind, fraction: entry.fraction, label: entry.label || '', source: 'manual' });
      say('Saving...');
      return api('PUT', '/api/absences/local', JSON.stringify(next), 'application/json')
        .then(function (j) {
          data = j;
          draw();
          say(message + ' The dashboard is updating.');
        })
        .catch(function (err) { say('Could not save: ' + err.message, true); draw(); });
    }

    // --- View ----------------------------------------------------------------

    var TAGS = {
      imported: '<span class="tag">Import</span>',
      edited: '<span class="tag tag-edited">Edited</span>',
      manual: '<span class="tag tag-manual">Manual</span>',
      removed: '<span class="tag tag-removed">Removed</span>'
    };
    var ACTIONS = {
      imported: ['remove', 'Remove'],
      edited: ['revert', 'Revert'],
      manual: ['delete', 'Delete'],
      removed: ['restore', 'Restore']
    };

    function drawYears(all) {
      var current = yearEl.value || String(new Date().getFullYear());
      var years = {};
      years[String(new Date().getFullYear())] = true;
      all.forEach(function (r) { years[r.date.slice(0, 4)] = true; });
      yearEl.innerHTML = Object.keys(years).sort().reverse().map(function (y) {
        return '<option' + (y === current ? ' selected' : '') + '>' + y + '</option>';
      }).join('') + '<option value="all"' + (current === 'all' ? ' selected' : '') + '>All years</option>';
    }

    function draw() {
      var imported = data.imported.length;
      $('abs-imported').textContent = data.importedAt
        ? 'Current import: ' + imported + ' days, loaded ' + new Date(data.importedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
          '. A new export replaces it; corrections stay.'
        : 'Nothing imported yet. Export the CSV from Timerevision and choose it here.';

      var all = rows();
      drawYears(all);
      var year = yearEl.value;
      var list = all.filter(function (r) {
        return (year === 'all' || r.date.slice(0, 4) === year) && (!onlyEl.checked || r.state !== 'imported');
      });

      var corrections = all.filter(function (r) { return r.state !== 'imported'; }).length;
      $('abs-count').textContent = list.length + ' day' + (list.length === 1 ? '' : 's') + ' shown, ' +
        corrections + ' correction' + (corrections === 1 ? '' : 's') + ' in total';

      if (!list.length) {
        rowsEl.innerHTML = '<tr><td colspan="6" class="abs-empty">No absences for this selection.</td></tr>';
        return;
      }

      rowsEl.innerHTML = list.map(function (r) {
        var a = r.shown;
        var off = r.state === 'removed' ? ' disabled' : '';
        var p = prettyDate(r.date);
        var act = ACTIONS[r.state];
        var was = r.state === 'edited' && r.imp
          ? ' title="Import says: ' + esc(kindLabel(r.imp.kind) + ', ' + (r.imp.fraction === 1 ? 'full day' : r.imp.fraction + ' day') + (r.imp.label ? ', ' + r.imp.label : '')) + '"'
          : '';
        return '<tr data-date="' + r.date + '" class="is-' + r.state + '">' +
          '<td class="abs-date"><span class="abs-weekday">' + p.weekday + '</span> ' + p.date + '</td>' +
          '<td><select data-field="kind" aria-label="Kind"' + off + '>' + kindOptions(a.kind) + '</select></td>' +
          '<td><select data-field="fraction" aria-label="Length"' + off + '>' + lengthOptions(a.fraction) + '</select></td>' +
          '<td class="abs-note"><input type="text" data-field="label" aria-label="Note" maxlength="200" value="' + esc(a.label) + '"' + off + '></td>' +
          '<td' + was + '>' + TAGS[r.state] + '</td>' +
          '<td><button class="btn btn-quiet" type="button" data-action="' + act[0] + '">' + act[1] + '</button></td>' +
          '</tr>';
      }).join('');
    }

    function rowOf(el) {
      var tr = el.closest('tr[data-date]');
      if (!tr) return null;
      var date = tr.getAttribute('data-date');
      return rows().filter(function (r) { return r.date === date; })[0] || null;
    }

    rowsEl.addEventListener('change', function (e) {
      var r = rowOf(e.target);
      if (!r) return;
      var tr = e.target.closest('tr');
      var entry = {
        kind: tr.querySelector('[data-field="kind"]').value,
        fraction: Number(tr.querySelector('[data-field="fraction"]').value),
        label: tr.querySelector('[data-field="label"]').value
      };
      setOverride(r.date, entry, prettyDate(r.date).date + ' saved.');
    });

    rowsEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-action]');
      var r = b && rowOf(b);
      if (!r) return;
      var when = prettyDate(r.date).date;
      var action = b.getAttribute('data-action');
      if (action === 'remove') {
        setOverride(r.date, { kind: r.imp.kind, fraction: 0, label: r.imp.label }, when + ' removed.');
      } else if (action === 'delete') {
        if (!confirm('Delete the absence on ' + when + '?')) return;
        setOverride(r.date, null, when + ' deleted.');
      } else {
        setOverride(r.date, null, when + ' is back to what the import says.');
      }
    });

    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = addForm.elements;
      var date = f.date.value;
      if (!date) return;
      var day = new Date(date + 'T12:00:00').getDay();
      var weekend = day === 0 || day === 6;
      setOverride(date, { kind: f.kind.value, fraction: Number(f.fraction.value), label: f.label.value.trim() },
        prettyDate(date).date + ' added.' + (weekend ? ' It is a weekend, so it does not change the balance.' : ''))
        .then(function () {
          f.label.value = '';
          yearEl.value = date.slice(0, 4);
          onlyEl.checked = false;
          draw();
        });
    });

    yearEl.addEventListener('change', draw);
    onlyEl.addEventListener('change', draw);
    addForm.querySelector('[data-kinds]').innerHTML = kindOptions('VACATION');

    // --- Import ----------------------------------------------------------------

    var resultEl = $('abs-result');
    var outputEl = $('abs-output');
    var previewBtn = $('abs-preview');
    var applyBtn = $('abs-apply');

    function resetImport() {
      pending = null;
      fileEl.value = '';
      previewBtn.disabled = true;
      resultEl.hidden = true;
    }

    fileEl.addEventListener('change', function () {
      previewBtn.disabled = !fileEl.files.length;
      resultEl.hidden = true;
    });

    previewBtn.addEventListener('click', function () {
      var file = fileEl.files[0];
      if (!file) return;
      previewBtn.disabled = true;
      say('Reading ' + file.name + '...');
      file.text()
        .then(function (text) {
          pending = text;
          return api('POST', '/api/absences/import', text, 'text/plain; charset=utf-8');
        })
        .then(function (j) {
          outputEl.textContent = j.output || '(no output)';
          outputEl.classList.toggle('is-error', !j.ok);
          resultEl.hidden = false;
          applyBtn.hidden = !j.ok;
          say(j.ok ? 'Preview only - nothing is saved until you replace the import.' : 'This file could not be read as an absence export.', !j.ok);
        })
        .catch(function (err) { say('Preview failed: ' + err.message, true); })
        .then(function () { previewBtn.disabled = !fileEl.files.length; });
    });

    applyBtn.addEventListener('click', function () {
      if (pending == null) return;
      applyBtn.disabled = true;
      say('Importing...');
      api('POST', '/api/absences/import?write=1', pending, 'text/plain; charset=utf-8')
        .then(function (j) {
          if (!j.ok) throw new Error((j.output || '').split('\\n').pop() || 'import failed');
          data = j;
          resetImport();
          draw();
          say('Imported ' + j.imported.length + ' days. The dashboard is updating.');
        })
        .catch(function (err) { say('Import failed: ' + err.message, true); })
        .then(function () { applyBtn.disabled = false; });
    });

    $('abs-discard').addEventListener('click', function () { resetImport(); say(''); });

    // --- Open / close ---------------------------------------------------------

    function load() {
      say('');
      rowsEl.innerHTML = '<tr><td colspan="6" class="abs-empty">Loading&hellip;</td></tr>';
      return api('GET', '/api/absences')
        .then(function (j) { data = j; draw(); })
        .catch(function (err) { say('Could not load absences: ' + err.message, true); });
    }

    openBtn.addEventListener('click', function () { dialog.showModal(); load(); });
    $('abs-close').addEventListener('click', function () { dialog.close(); });
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  })();
</script>
</body>
</html>
`;
}
