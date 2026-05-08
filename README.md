# ARAM Mayhem Dashboard

A 16:9 realtime dashboard for League of Legends ARAM / ARAM Mayhem, designed to be used as a **browser source in OBS**. It reads from Riot's in-game **Live Client Data API** at `https://127.0.0.1:2999` and renders score, kills, gold-equivalent stats, items, summoner spells, respawn timers, inhibitor status and an event feed.

## Requirements (Windows 11)

- League of Legends installed and running a game (the Live Client API is only available while you are in a match).
- [Node.js 18+](https://nodejs.org/en/download) (LTS recommended).

## Install & run

Open PowerShell in the project folder and run:

```powershell
npm install
npm start
```

The dashboard is then available at:

```
http://localhost:3000
```

## OBS setup

1. In OBS Studio, add a **Browser** source.
2. URL: `http://localhost:3000`
3. Width: `1920`, Height: `1080`
4. Tick **"Shutdown source when not visible"** if you want it to stop polling when hidden.

The dashboard auto-scales to whatever 16:9 size you give it, so you can also drop it into a 1280x720 source.

## How it works

- `server.js` is a tiny Express server that:
  - Serves the static dashboard from `public/`.
  - Proxies `/api/<endpoint>` to `https://127.0.0.1:2999/liveclientdata/<endpoint>`, ignoring the Riot client's self-signed certificate so the browser does not need to trust it manually.
  - Caches the latest Data Dragon version for champion / item / summoner-spell icons.
- `public/app.js` polls `/api/allgamedata` once per second and renders teams, score, items and a rolling event feed.
- When no game is in progress, a "Waiting for League client" card is shown.

## Configuration

Environment variables (optional):

- `PORT` — port for the dashboard (default `3000`)
- `RIOT_HOST` — hostname for the Live Client API (default `127.0.0.1`)
- `RIOT_PORT` — port for the Live Client API (default `2999`)

Example:

```powershell
$env:PORT=4000; npm start
```
