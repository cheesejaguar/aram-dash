'use strict';

const { app, Menu, shell, dialog, BrowserWindow } = require('electron');

const GITHUB_URL = 'https://github.com/cheesejaguar/the-aram-dashboard';
const RIOT_DOCS_URL = 'https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api';

function buildMenu(ctx) {
  const { getWindow, getConfig, applyWindow, openPath, relaunch } = ctx;
  const isMac = process.platform === 'darwin';

  const macAppMenu = isMac ? [{
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }] : [];

  const fileMenu = {
    label: '&File',
    submenu: [
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => openPath('/settings'),
      },
      {
        label: 'Open Dashboard',
        accelerator: 'CmdOrCtrl+D',
        click: () => openPath('/'),
      },
      { type: 'separator' },
      {
        label: 'Show Config File in Folder',
        click: () => {
          const settings = require('../settings');
          shell.showItemInFolder(settings.path());
        },
      },
      {
        label: 'Restart',
        click: () => relaunch(),
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const editMenu = {
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const cfg = getConfig();

  const viewMenu = {
    label: '&View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: !!cfg.window.alwaysOnTop,
        click: (item) => {
          applyWindow({ alwaysOnTop: item.checked });
        },
      },
      {
        label: 'Lock 16:9 Aspect Ratio',
        type: 'checkbox',
        checked: !!cfg.window.lockAspect,
        click: (item) => {
          applyWindow({ lockAspect: item.checked });
        },
      },
    ],
  };

  const windowMenu = {
    label: '&Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
          ]
        : [{ role: 'close' }]),
    ],
  };

  const helpMenu = {
    label: '&Help',
    role: 'help',
    submenu: [
      {
        label: 'About ARAM Mayhem Dashboard',
        click: () => {
          const focused = getWindow();
          dialog.showMessageBox(focused, {
            type: 'info',
            title: 'About',
            message: 'ARAM Mayhem Dashboard',
            detail:
              `Version ${app.getVersion()}\n` +
              `Electron ${process.versions.electron}\n` +
              `Chromium ${process.versions.chrome}\n` +
              `Node ${process.versions.node}\n\n` +
              'Realtime dashboard for League of Legends ARAM / ARAM Mayhem.',
            buttons: ['OK'],
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Open GitHub Repository',
        click: () => shell.openExternal(GITHUB_URL),
      },
      {
        label: 'Live Client API Documentation',
        click: () => shell.openExternal(RIOT_DOCS_URL),
      },
    ],
  };

  const template = [
    ...macAppMenu,
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];

  return Menu.buildFromTemplate(template);
}

function install(ctx) {
  const menu = buildMenu(ctx);
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { install, buildMenu };
