/**
 * Wraps the artifact fragment into a complete, self-contained HTML document.
 *
 * The fragment `renderDashboard()` produces has no <!doctype>/<html>/<head>/
 * <body> - the Artifact host supplies those. To serve the same page from a
 * plain web server we add them here, plus the one thing the host provides that
 * a bare page does not: a light/dark control. The stylesheet already reacts to
 * `data-theme` on the root element, so the toggle only has to set it.
 */

/** Everything before <main> is head material (title, font links, styles). */
function split(fragment: string): { head: string; body: string } {
  const at = fragment.indexOf('<main');
  if (at < 0) return { head: '', body: fragment };
  return { head: fragment.slice(0, at).trim(), body: fragment.slice(at).trim() };
}

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
    gap: 8px;
  }

  .theme-toggle, .live {
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
    cursor: pointer;
  }

  .theme-toggle:hover, .live:hover { color: var(--ink); }
  .theme-toggle:focus-visible, .live:focus-visible { outline: 2px solid var(--pos); outline-offset: 2px; }
  .theme-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }

  .live[hidden] { display: none; }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .live[data-state="live"] .live-dot { background: var(--pos); }
  .live[data-state="busy"] .live-dot { background: var(--pos); animation: live-pulse 1s ease-in-out infinite alternate; }
  .live[data-state="error"] .live-dot { background: var(--neg); }
  .live[data-state="busy"] { cursor: progress; }
  @keyframes live-pulse { to { opacity: 0.25; } }

  /* Briefly mark the sheet when fresh numbers land. */
  main.is-fresh { animation: sheet-fresh 0.6s ease-out; }
  @keyframes sheet-fresh { from { opacity: 0.55; } }

  /* Keep the buttons clear of the masthead on narrow screens. */
  @media (max-width: 640px) {
    .shell-controls { position: static; margin: 14px 0 0 16px; }
    .theme-toggle, .live { box-shadow: none; }
  }

  @media print {
    .shell-controls { display: none; }
    .panel { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="shell-controls">
  <button class="live" id="live" type="button" data-state="offline" hidden>
    <span class="live-dot" aria-hidden="true"></span>
    <span id="live-label" aria-live="polite">Connecting</span>
  </button>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-live="polite">
    <svg viewBox="0 0 24 24" aria-hidden="true" id="theme-icon"></svg>
    <span id="theme-label">System</span>
  </button>
</div>

${body}

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
  // Live refresh. server/serve.cjs regenerates this page on a timer and
  // announces each new version over /events; we fetch it and swap <main> in
  // place, then re-run the page's own scripts against the new markup.
  (function () {
    var btn = document.getElementById('live');
    var label = document.getElementById('live-label');
    if (!btn || location.protocol === 'file:' || !window.EventSource || !window.DOMParser) return;
    btn.hidden = false;

    var state = null;      // last message from the server
    var shown = null;      // version currently on screen
    var online = false;
    var swapping = false;

    function time(ms) {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function render() {
      var s, text, title;
      if (!online) {
        s = 'offline'; text = 'Offline'; title = 'Server not reachable - the numbers on screen stay as they are.';
      } else if (state.refreshing) {
        s = 'busy'; text = 'Updating'; title = 'Fetching the latest entries from Clockify.';
      } else if (state.error) {
        s = 'error'; text = 'Update failed'; title = state.error + '\\nClick to retry.';
      } else {
        s = 'live'; text = shown ? 'Updated ' + time(shown) : 'Live';
        title = 'Click to update now.' + (state.everyMinutes ? ' Updates every ' + state.everyMinutes + ' min.' : '');
      }
      btn.setAttribute('data-state', s);
      label.textContent = text;
      btn.title = title;
      btn.setAttribute('aria-label', text + '. ' + title);
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
</body>
</html>
`;
}
