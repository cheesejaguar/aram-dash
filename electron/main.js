'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Pin the config file inside the per-user app data dir so it survives
// reinstalls and matches OS conventions. Set before requiring settings so the
// shared module picks it up.
if (!process.env.ARAM_CONFIG_PATH) {
  process.env.ARAM_CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
}

const settings = require('..' + path.sep + 'settings');
const menuModule = require('./menu');
const trayModule = require('./tray');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let serverInfo = null;
let trayHandle = null;
let menuRef = null;
let saveBoundsTimer = null;

function getConfig() {
  return settings.load();
}

function resolveIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function ensureServer(cfg) {
  if (serverInfo) return serverInfo;
  const { startServer } = require(path.join(__dirname, '..', 'server.js'));
  const desiredPort = parseInt(process.env.PORT, 10) || cfg.network.port || 3000;
  try {
    serverInfo = await startServer(desiredPort);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`[main] port ${desiredPort} in use, falling back to OS-assigned port`);
      serverInfo = await startServer(0);
    } else {
      throw err;
    }
  }
  return serverInfo;
}

function clampBounds(bounds) {
  const { width, height } = bounds;
  const minW = 960, minH = 540;
  const w = Math.max(minW, width || 1600);
  const h = Math.max(minH, height || 900);
  if (bounds.x == null || bounds.y == null) {
    return { width: w, height: h };
  }
  // Make sure the saved (x,y) intersects a current display work area;
  // otherwise the window could spawn off-screen after a monitor unplug.
  const point = { x: bounds.x, y: bounds.y };
  const display = screen.getDisplayMatching({ x: point.x, y: point.y, width: w, height: h });
  const wa = display.workArea;
  const x = Math.min(Math.max(point.x, wa.x), wa.x + wa.width - 100);
  const y = Math.min(Math.max(point.y, wa.y), wa.y + wa.height - 100);
  return { x, y, width: w, height: h };
}

function persistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen() || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
  const b = mainWindow.getBounds();
  settings.save({ window: { bounds: { x: b.x, y: b.y, width: b.width, height: b.height } } });
}

function scheduleBoundsSave() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(persistBounds, 400);
}

function refreshMenu() {
  menuRef = menuModule.install({
    getWindow: () => mainWindow,
    getConfig,
    applyWindow,
    openPath,
    relaunch,
  });
  if (trayHandle) trayHandle.rebuild();
}

async function createWindow() {
  const cfg = getConfig();
  const { port } = await ensureServer(cfg);

  const bounds = clampBounds(cfg.window.bounds || {});

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#0a0d14',
    title: 'ARAM Mayhem Dashboard',
    icon: resolveIcon(),
    frame: !cfg.window.frameless,
    transparent: !!cfg.window.frameless,
    autoHideMenuBar: false,
    alwaysOnTop: !!cfg.window.alwaysOnTop,
    fullscreen: !!cfg.window.fullscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (cfg.window.lockAspect) mainWindow.setAspectRatio(16 / 9);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    try {
      mainWindow.webContents.setZoomFactor(cfg.window.zoom || 1);
    } catch {}
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);

  mainWindow.on('close', (e) => {
    // If the user closes the window but the tray is alive, hide instead of
    // quitting (familiar pattern for streaming companion apps). The "Quit"
    // tray menu item and File→Quit set app.isQuitting to bypass this.
    if (!app.isQuitting && trayHandle && process.platform !== 'darwin') {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    persistBounds();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('show', () => trayHandle && trayHandle.rebuild());
  mainWindow.on('hide', () => trayHandle && trayHandle.rebuild());

  await mainWindow.loadURL(`http://localhost:${port}/`);
}

function openPath(p) {
  if (!serverInfo) return;
  const url = `http://localhost:${serverInfo.port}${p}`;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().then(() => mainWindow.loadURL(url));
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.loadURL(url);
}

function applyWindow(opts) {
  if (!mainWindow || mainWindow.isDestroyed() || !opts) return;
  const partial = { window: {} };

  if ('alwaysOnTop' in opts) {
    mainWindow.setAlwaysOnTop(!!opts.alwaysOnTop);
    partial.window.alwaysOnTop = !!opts.alwaysOnTop;
  }
  if ('fullscreen' in opts) {
    mainWindow.setFullScreen(!!opts.fullscreen);
    partial.window.fullscreen = !!opts.fullscreen;
  }
  if ('lockAspect' in opts) {
    mainWindow.setAspectRatio(opts.lockAspect ? 16 / 9 : 0);
    partial.window.lockAspect = !!opts.lockAspect;
  }
  if ('zoom' in opts && Number.isFinite(opts.zoom)) {
    try { mainWindow.webContents.setZoomFactor(opts.zoom); } catch {}
    partial.window.zoom = opts.zoom;
  }
  if ('launchAtStartup' in opts && process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: !!opts.launchAtStartup });
    partial.window.launchAtStartup = !!opts.launchAtStartup;
  }
  // frameless is restart-required — persist but don't try to recreate live.
  if ('frameless' in opts) partial.window.frameless = !!opts.frameless;

  settings.save(partial);
  refreshMenu();
}

function relaunch() {
  app.isQuitting = true;
  app.relaunch();
  app.exit(0);
}

function registerIpc() {
  ipcMain.handle('apply-window', (_e, opts) => {
    applyWindow(opts || {});
    return { ok: true };
  });
  ipcMain.handle('relaunch', () => { relaunch(); });
  ipcMain.handle('quit', () => {
    app.isQuitting = true;
    app.quit();
  });
  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  });
  ipcMain.handle('open-settings', () => openPath('/settings'));
  ipcMain.handle('open-dashboard', () => openPath('/'));
  ipcMain.handle('confirm-restart', async (_e, keys) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Restart required',
      message: 'Some settings need a restart to take effect.',
      detail: (keys || []).join('\n') || 'Restart the app to apply the changes.',
    });
    return response === 0;
  });
  ipcMain.handle('get-version', () => app.getVersion());
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // On macOS apps typically stay alive until Cmd+Q; on other platforms with
  // a tray we keep the process alive so the tray icon remains. Without a
  // tray, quit normally.
  if (process.platform === 'darwin') return;
  if (!trayHandle) app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  persistBounds();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => console.error(err));
  } else if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});

app.whenReady().then(async () => {
  registerIpc();

  // Sync launch-at-startup with what the OS reports, so the settings UI shows
  // the real state even if the user toggled it elsewhere.
  if (process.platform !== 'linux') {
    const cfg = getConfig();
    const real = app.getLoginItemSettings();
    if (real.openAtLogin !== !!cfg.window.launchAtStartup) {
      settings.save({ window: { launchAtStartup: real.openAtLogin } });
    }
  }

  await createWindow();

  refreshMenu();

  try {
    trayHandle = trayModule.create({
      getWindow: () => mainWindow,
      getConfig,
      applyWindow,
      openPath,
      refreshMenu,
    });
  } catch (err) {
    console.warn('[main] tray unavailable:', err && err.message);
    trayHandle = null;
  }

  // Re-render menu/tray when the settings change via the API (e.g. someone
  // edited config.json directly, or a /settings POST happened without IPC).
  const { events } = require(path.join(__dirname, '..', 'server.js'));
  events.on('settings-changed', () => refreshMenu());
}).catch((err) => {
  console.error('Failed to launch ARAM Mayhem Dashboard:', err);
  app.quit();
});
