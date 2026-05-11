'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let serverInfo = null;

async function ensureServer() {
  if (serverInfo) return serverInfo;
  const { startServer } = require(path.join(__dirname, '..', 'server.js'));
  // Port 0 lets the OS pick a free port so multiple instances or a stuck
  // 3000 don't break startup. The dashboard always loads via the URL we
  // hand to BrowserWindow, so the exact port doesn't matter to the user.
  const port = parseInt(process.env.PORT || '3000', 10);
  try {
    serverInfo = await startServer(port);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      serverInfo = await startServer(0);
    } else {
      throw err;
    }
  }
  return serverInfo;
}

async function createWindow() {
  const { port } = await ensureServer();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0a0d14',
    autoHideMenuBar: true,
    title: 'ARAM Mayhem Dashboard',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://localhost:${port}/`);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => console.error(err));
  }
});

app.whenReady().then(createWindow).catch((err) => {
  console.error('Failed to launch ARAM Mayhem Dashboard:', err);
  app.quit();
});
