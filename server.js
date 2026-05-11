const express = require('express');
const https = require('https');
const path = require('path');
const { EventEmitter } = require('events');
const settings = require('./settings');

let cfg = settings.load();

if (process.env.PORT) cfg.network.port = parseInt(process.env.PORT, 10);
if (process.env.RIOT_HOST) cfg.network.riotHost = process.env.RIOT_HOST;
if (process.env.RIOT_PORT) cfg.network.riotPort = parseInt(process.env.RIOT_PORT, 10);

const events = new EventEmitter();

const insecureAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function riotGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: cfg.network.riotHost,
        port: cfg.network.riotPort,
        path: pathname,
        method: 'GET',
        agent: insecureAgent,
        timeout: 4000,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

let cachedVersion = null;
let cachedVersionAt = 0;
function getDdragonVersion() {
  const now = Date.now();
  if (cachedVersion && now - cachedVersionAt < 60 * 60 * 1000) {
    return Promise.resolve(cachedVersion);
  }
  return new Promise((resolve) => {
    https
      .get('https://ddragon.leagueoflegends.com/api/versions.json', (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const versions = JSON.parse(body);
            cachedVersion = versions[0];
            cachedVersionAt = now;
            resolve(cachedVersion);
          } catch {
            resolve(cachedVersion || '14.1.1');
          }
        });
      })
      .on('error', () => resolve(cachedVersion || '14.1.1'));
  });
}

let cachedItemCosts = null;
let cachedItemCostsAt = 0;
let cachedItemCostsVersion = null;
function getItemCosts() {
  const now = Date.now();
  const fresh = cachedItemCosts && now - cachedItemCostsAt < 60 * 60 * 1000;
  if (fresh) return Promise.resolve(cachedItemCosts);
  return getDdragonVersion().then(
    (v) =>
      new Promise((resolve) => {
        https
          .get(
            `https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/item.json`,
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  const out = {};
                  for (const [id, info] of Object.entries(data.data || {})) {
                    if (info && info.gold && typeof info.gold.total === 'number') {
                      out[id] = info.gold.total;
                    }
                  }
                  cachedItemCosts = out;
                  cachedItemCostsAt = now;
                  cachedItemCostsVersion = v;
                  resolve(out);
                } catch {
                  resolve(cachedItemCosts || {});
                }
              });
            }
          )
          .on('error', () => resolve(cachedItemCosts || {}));
      })
  );
}

// Mayhem modifier registry. Kept here (rather than in public/app.js alone) so
// the settings page can populate its dropdown without duplicating the list.
const MAYHEM_MODIFIERS = {
  aram:       { label: 'Classic ARAM',        sub: 'No Modifier',                icon: '❄' },
  urf:        { label: 'URF Mayhem',          sub: '80% CDR · No Mana',      icon: '⚡' },
  spellbook:  { label: 'Ultimate Spellbook',  sub: 'Random Ult Replaces D',      icon: '✨' },
  oneforall:  { label: 'One For All',         sub: 'Mirror Match',               icon: '🪩' },
  lowgrav:    { label: 'Low Gravity',         sub: 'Reduced Gravity',            icon: '🌙' },
  allchaos:   { label: 'All Chaos',           sub: 'Random Effects',             icon: '🎲' },
  arurf:      { label: 'AR URF',              sub: 'All Random URF',             icon: '⚡' },
  snowball:   { label: 'Snow Day',            sub: 'Snowballs Galore',           icon: '❄' },
  poke:       { label: 'Poke Mayhem',         sub: 'Ranged Buffed',              icon: '🏹' },
  pentakill:  { label: 'Pentakill Hunt',      sub: 'Bonus on Pentas',            icon: '⚔' },
};

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/api/version', async (_req, res) => {
  const v = await getDdragonVersion();
  res.json({ version: v });
});

app.get('/api/itemcosts', async (_req, res) => {
  const costs = await getItemCosts();
  res.json({ version: cachedItemCostsVersion, costs });
});

app.get('/api/modifiers', (_req, res) => {
  res.json({ modifiers: MAYHEM_MODIFIERS });
});

app.get('/api/settings', (_req, res) => {
  res.json({ config: cfg, defaults: settings.defaults, path: settings.path() });
});

// Keys that cannot be applied to a running server without restarting Node /
// recreating the BrowserWindow. The renderer uses this list to surface a
// "restart required" prompt.
const RESTART_KEYS = ['network.port', 'window.frameless'];

function diffRestartKeys(prev, next) {
  const out = [];
  for (const key of RESTART_KEYS) {
    const [a, b] = key.split('.');
    if (prev?.[a]?.[b] !== next?.[a]?.[b]) out.push(key);
  }
  return out;
}

app.post('/api/settings', (req, res) => {
  const { ok, error, value } = settings.validate(req.body || {});
  if (!ok) return res.status(400).json({ error });
  const prev = cfg;
  try {
    cfg = settings.save(value);
  } catch (err) {
    return res.status(500).json({ error: `failed to save: ${err.message}` });
  }
  const restartRequired = diffRestartKeys(prev, cfg);
  events.emit('settings-changed', { config: cfg, prev, restartRequired });
  res.json({ config: cfg, restartRequired });
});

app.post('/api/settings/reset', (_req, res) => {
  const prev = cfg;
  try {
    settings.reset();
    cfg = settings.load();
  } catch (err) {
    return res.status(500).json({ error: `failed to reset: ${err.message}` });
  }
  const restartRequired = diffRestartKeys(prev, cfg);
  events.emit('settings-changed', { config: cfg, prev, restartRequired });
  res.json({ config: cfg, restartRequired });
});

const proxied = [
  'allgamedata',
  'activeplayer',
  'activeplayername',
  'activeplayerabilities',
  'activeplayerrunes',
  'playerlist',
  'playerscores',
  'playersummonerspells',
  'playermainrunes',
  'playeritems',
  'eventdata',
  'gamestats',
];

for (const ep of proxied) {
  app.get(`/api/${ep}`, async (req, res) => {
    try {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const result = await riotGet(`/liveclientdata/${ep}${qs}`);
      res.status(result.status).type('application/json').send(result.body);
    } catch (err) {
      res.status(503).json({ error: 'live-client-unavailable', detail: String(err.message || err) });
    }
  });
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function startServer(port = cfg.network.port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`ARAM Mayhem dashboard:  http://localhost:${actualPort}`);
      console.log(`Proxying Riot Live Client API at https://${cfg.network.riotHost}:${cfg.network.riotPort}`);
      getItemCosts().catch(() => {});
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

function getConfig() {
  return cfg;
}

module.exports = { app, startServer, events, getConfig, MAYHEM_MODIFIERS };

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
