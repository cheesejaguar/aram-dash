(() => {
  const electronAPI = window.electronAPI || null;
  const isElectron = !!electronAPI;

  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const configPath = $('configPath');
  const windowCard = $('windowCard');

  let current = null;
  let defaults = null;
  let saveTimer = null;
  let lastSavedAt = 0;

  const FIELDS = {
    'dashboard.pollLiveMs':       { el: 'pollLiveMs',       num: 'pollLiveMsNum', kind: 'number' },
    'dashboard.pollOfflineMs':    { el: 'pollOfflineMs',    num: 'pollOfflineMsNum', kind: 'number' },
    'dashboard.defaultModifier':  { el: 'defaultModifier',  kind: 'string' },
    'dashboard.theme':            { el: null,               kind: 'radio', name: 'theme' },
    'network.port':               { el: 'port',             kind: 'number' },
    'network.riotHost':           { el: 'riotHost',         kind: 'string' },
    'network.riotPort':           { el: 'riotPort',         kind: 'number' },
    'window.alwaysOnTop':         { el: 'alwaysOnTop',      kind: 'bool' },
    'window.fullscreen':          { el: 'fullscreen',       kind: 'bool' },
    'window.lockAspect':          { el: 'lockAspect',       kind: 'bool' },
    'window.frameless':           { el: 'frameless',        kind: 'bool' },
    'window.launchAtStartup':     { el: 'launchAtStartup',  kind: 'bool' },
    'window.zoom':                { el: 'zoom',             num: 'zoomNum', kind: 'number' },
  };

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  function readField(path) {
    const spec = FIELDS[path];
    if (!spec) return undefined;
    if (spec.kind === 'radio') {
      const checked = document.querySelector(`input[name="${spec.name}"]:checked`);
      return checked ? checked.value : undefined;
    }
    const el = $(spec.el);
    if (!el) return undefined;
    if (spec.kind === 'bool') return el.checked;
    if (spec.kind === 'number') {
      const v = parseFloat(el.value);
      return Number.isFinite(v) ? v : undefined;
    }
    return el.value;
  }

  function writeField(path, value) {
    const spec = FIELDS[path];
    if (!spec) return;
    if (spec.kind === 'radio') {
      const opt = document.querySelector(
        `input[name="${spec.name}"][value="${value}"]`
      );
      if (opt) opt.checked = true;
      return;
    }
    const el = $(spec.el);
    if (!el) return;
    if (spec.kind === 'bool') el.checked = !!value;
    else el.value = value == null ? '' : String(value);
    if (spec.num) {
      const num = $(spec.num);
      if (num) num.value = el.value;
    }
  }

  function buildPartialFromForm() {
    const out = {};
    for (const path of Object.keys(FIELDS)) {
      const v = readField(path);
      if (v !== undefined) setPath(out, path, v);
    }
    return out;
  }

  function diff(prev, next, prefix = '') {
    const changed = [];
    const keys = new Set([
      ...Object.keys(prev || {}),
      ...Object.keys(next || {}),
    ]);
    for (const k of keys) {
      const a = prev?.[k];
      const b = next?.[k];
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        changed.push(...diff(a, b, `${prefix}${k}.`));
      } else if (a !== b) {
        changed.push(prefix + k);
      }
    }
    return changed;
  }

  async function save({ reloadAfter = false } = {}) {
    const partial = buildPartialFromForm();
    setStatus('Saving…');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${body.error || res.status}`, 'error');
        return null;
      }
      const prev = current;
      current = body.config;
      lastSavedAt = Date.now();
      applyTheme(current.dashboard.theme);

      const restart = body.restartRequired || [];
      if (restart.length > 0) {
        setStatus(`Saved · restart required: ${restart.join(', ')}`, 'warn');
      } else {
        setStatus('Saved', 'ok');
      }

      // Push live-applicable window settings to the Electron main process.
      if (isElectron) {
        const windowChanged = diff(prev.window, current.window).filter(
          (k) => !k.startsWith('bounds')
        );
        if (windowChanged.length > 0) {
          electronAPI.applyWindow(current.window).catch(() => {});
        }
        if (restart.length > 0) {
          const ok = await electronAPI.confirmRestart(restart);
          if (ok) electronAPI.relaunch();
        }
      }

      if (reloadAfter && !restart.length) {
        // The dashboard re-fetches /api/settings on load, so a hard reload
        // is the simplest way to apply dashboard-side changes.
        // Only relevant when the user used "Save & reload" — debounced
        // auto-saves shouldn't navigate away.
      }

      return body;
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      return null;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 400);
  }

  function wireRangePair(rangeId, numId) {
    const r = $(rangeId);
    const n = $(numId);
    if (!r || !n) return;
    r.addEventListener('input', () => {
      n.value = r.value;
      scheduleSave();
    });
    n.addEventListener('input', () => {
      r.value = n.value;
      scheduleSave();
    });
  }

  function wireField(path) {
    const spec = FIELDS[path];
    if (!spec) return;
    if (spec.kind === 'radio') {
      document.querySelectorAll(`input[name="${spec.name}"]`).forEach((el) => {
        el.addEventListener('change', () => {
          applyTheme(readField(path));
          scheduleSave();
        });
      });
      return;
    }
    const el = $(spec.el);
    if (!el) return;
    const ev = spec.kind === 'bool' ? 'change' : 'input';
    if (!spec.num) {
      el.addEventListener(ev, scheduleSave);
    }
    // Range/number pairs are wired separately so the two inputs stay in sync.
  }

  async function loadModifiers() {
    try {
      const res = await fetch('/api/modifiers');
      const body = await res.json();
      const select = $('defaultModifier');
      select.innerHTML = '';
      for (const [key, info] of Object.entries(body.modifiers || {})) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${info.icon || ''} ${info.label}`.trim();
        select.appendChild(opt);
      }
    } catch {
      // ignore - dropdown will be empty
    }
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    const body = await res.json();
    current = body.config;
    defaults = body.defaults;
    configPath.textContent = `Config file: ${body.path}`;
    applyTheme(current.dashboard.theme);

    for (const path of Object.keys(FIELDS)) {
      writeField(path, getPath(current, path));
    }

    // Window section is only meaningful in the Electron app.
    if (isElectron) {
      windowCard.hidden = false;
      const platform = electronAPI.platform;
      const startupBox = $('launchAtStartup');
      const startupHint = $('launchAtStartupHint');
      if (platform === 'linux') {
        startupBox.disabled = true;
        startupBox.checked = false;
        startupHint.textContent = 'Not supported on Linux — set up an autostart .desktop entry manually.';
      }
    }
  }

  async function reset() {
    if (!confirm('Reset all settings to defaults?')) return;
    setStatus('Resetting…');
    const res = await fetch('/api/settings/reset', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) {
      setStatus(`Error: ${body.error || res.status}`, 'error');
      return;
    }
    current = body.config;
    for (const path of Object.keys(FIELDS)) {
      writeField(path, getPath(current, path));
    }
    applyTheme(current.dashboard.theme);
    setStatus('Reset to defaults', 'ok');
    if (isElectron) electronAPI.applyWindow(current.window).catch(() => {});
  }

  async function init() {
    await loadModifiers();
    await loadSettings();

    for (const path of Object.keys(FIELDS)) wireField(path);
    wireRangePair('pollLiveMs', 'pollLiveMsNum');
    wireRangePair('pollOfflineMs', 'pollOfflineMsNum');
    wireRangePair('zoom', 'zoomNum');

    $('saveBtn').addEventListener('click', async () => {
      const result = await save({ reloadAfter: true });
      if (result && (result.restartRequired || []).length === 0) {
        // Brief pause so the user sees the "Saved" pill, then send them back.
        setTimeout(() => { location.href = '/'; }, 350);
      }
    });
    $('resetBtn').addEventListener('click', reset);
  }

  init().catch((err) => setStatus(`Error: ${err.message}`, 'error'));
})();
