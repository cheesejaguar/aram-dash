const express = require('express');
const https = require('https');
const path = require('path');

const PORT = process.env.PORT || 3000;
const RIOT_HOST = process.env.RIOT_HOST || '127.0.0.1';
const RIOT_PORT = parseInt(process.env.RIOT_PORT || '2999', 10);

const insecureAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function riotGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: RIOT_HOST,
        port: RIOT_PORT,
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

const app = express();

app.get('/api/version', async (_req, res) => {
  const v = await getDdragonVersion();
  res.json({ version: v });
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

app.listen(PORT, () => {
  console.log(`ARAM Mayhem dashboard:  http://localhost:${PORT}`);
  console.log(`Proxying Riot Live Client API at https://${RIOT_HOST}:${RIOT_PORT}`);
});
