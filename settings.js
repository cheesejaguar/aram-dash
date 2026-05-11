'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const defaults = Object.freeze({
  network: {
    port: 3000,
    riotHost: '127.0.0.1',
    riotPort: 2999,
  },
  dashboard: {
    pollLiveMs: 1000,
    pollOfflineMs: 2500,
    defaultModifier: 'aram',
    theme: 'dark',
  },
  window: {
    alwaysOnTop: false,
    fullscreen: false,
    lockAspect: false,
    zoom: 1.0,
    frameless: false,
    launchAtStartup: false,
    bounds: { x: null, y: null, width: 1600, height: 900 },
  },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function resolvePath() {
  if (process.env.ARAM_CONFIG_PATH) return process.env.ARAM_CONFIG_PATH;
  return path.join(__dirname, 'config.json');
}

function load(filePath = resolvePath()) {
  let raw = null;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[settings] could not read ${filePath}: ${err.message}`);
    }
    return deepClone(defaults);
  }
  try {
    const parsed = JSON.parse(raw);
    return deepMerge(deepClone(defaults), parsed);
  } catch (err) {
    console.warn(`[settings] invalid JSON in ${filePath}: ${err.message}`);
    return deepClone(defaults);
  }
}

function save(partial, filePath = resolvePath()) {
  const current = load(filePath);
  const next = deepMerge(current, partial);
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
  return next;
}

function reset(filePath = resolvePath()) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return deepClone(defaults);
}

function validate(partial) {
  // Light-touch validation: coerce known numeric fields, reject obvious junk.
  if (!isPlainObject(partial)) {
    return { ok: false, error: 'expected object' };
  }
  const out = {};
  if (partial.network) {
    const n = {};
    const src = partial.network;
    if ('port' in src) {
      const v = parseInt(src.port, 10);
      if (!Number.isFinite(v) || v < 1 || v > 65535) {
        return { ok: false, error: 'network.port out of range' };
      }
      n.port = v;
    }
    if ('riotHost' in src) {
      if (typeof src.riotHost !== 'string' || !src.riotHost.trim()) {
        return { ok: false, error: 'network.riotHost must be a non-empty string' };
      }
      n.riotHost = src.riotHost.trim();
    }
    if ('riotPort' in src) {
      const v = parseInt(src.riotPort, 10);
      if (!Number.isFinite(v) || v < 1 || v > 65535) {
        return { ok: false, error: 'network.riotPort out of range' };
      }
      n.riotPort = v;
    }
    out.network = n;
  }
  if (partial.dashboard) {
    const d = {};
    const src = partial.dashboard;
    if ('pollLiveMs' in src) {
      const v = parseInt(src.pollLiveMs, 10);
      if (!Number.isFinite(v) || v < 100 || v > 60000) {
        return { ok: false, error: 'dashboard.pollLiveMs out of range (100-60000)' };
      }
      d.pollLiveMs = v;
    }
    if ('pollOfflineMs' in src) {
      const v = parseInt(src.pollOfflineMs, 10);
      if (!Number.isFinite(v) || v < 250 || v > 60000) {
        return { ok: false, error: 'dashboard.pollOfflineMs out of range (250-60000)' };
      }
      d.pollOfflineMs = v;
    }
    if ('defaultModifier' in src) {
      if (typeof src.defaultModifier !== 'string') {
        return { ok: false, error: 'dashboard.defaultModifier must be string' };
      }
      d.defaultModifier = src.defaultModifier;
    }
    if ('theme' in src) {
      if (src.theme !== 'dark' && src.theme !== 'light') {
        return { ok: false, error: 'dashboard.theme must be dark or light' };
      }
      d.theme = src.theme;
    }
    out.dashboard = d;
  }
  if (partial.window) {
    const w = {};
    const src = partial.window;
    const bools = ['alwaysOnTop', 'fullscreen', 'lockAspect', 'frameless', 'launchAtStartup'];
    for (const k of bools) {
      if (k in src) {
        if (typeof src[k] !== 'boolean') {
          return { ok: false, error: `window.${k} must be boolean` };
        }
        w[k] = src[k];
      }
    }
    if ('zoom' in src) {
      const v = Number(src.zoom);
      if (!Number.isFinite(v) || v < 0.25 || v > 4) {
        return { ok: false, error: 'window.zoom out of range (0.25-4)' };
      }
      w.zoom = v;
    }
    if ('bounds' in src && isPlainObject(src.bounds)) {
      const b = {};
      for (const k of ['x', 'y', 'width', 'height']) {
        if (k in src.bounds) {
          const v = src.bounds[k];
          if (v === null) { b[k] = null; continue; }
          const n = parseInt(v, 10);
          if (!Number.isFinite(n)) {
            return { ok: false, error: `window.bounds.${k} must be number or null` };
          }
          b[k] = n;
        }
      }
      w.bounds = b;
    }
    out.window = w;
  }
  return { ok: true, value: out };
}

module.exports = {
  defaults,
  load,
  save,
  reset,
  validate,
  path: resolvePath,
  _deepMerge: deepMerge,
  _os: os, // exposed so consumers can detect platform without re-require
};
