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

  .theme-toggle {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 10;
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

  .theme-toggle:hover { color: var(--ink); }
  .theme-toggle:focus-visible { outline: 2px solid var(--pos); outline-offset: 2px; }
  .theme-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }

  /* Keep the button clear of the masthead on narrow screens. */
  @media (max-width: 640px) {
    .theme-toggle { position: static; margin: 14px 0 0 16px; box-shadow: none; }
  }

  @media print {
    .theme-toggle { display: none; }
    .panel { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
<button class="theme-toggle" id="theme-toggle" type="button" aria-live="polite">
  <svg viewBox="0 0 24 24" aria-hidden="true" id="theme-icon"></svg>
  <span id="theme-label">System</span>
</button>

${body}

<script>
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
</body>
</html>
`;
}
