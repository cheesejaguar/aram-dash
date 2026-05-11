'use strict';

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'tray.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildIcon() {
  const iconPath = resolveIconPath();
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath);
    // 16px is the conventional tray size on Windows and Linux; macOS auto-
    // resizes and prefers a template image, but a coloured icon still works.
    return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function create(ctx) {
  const { getWindow, getConfig, applyWindow, openPath, refreshMenu } = ctx;

  const tray = new Tray(buildIcon());
  tray.setToolTip('ARAM Mayhem Dashboard');

  function build() {
    const cfg = getConfig();
    const win = getWindow();
    const visible = win && !win.isDestroyed() && win.isVisible();
    const menu = Menu.buildFromTemplate([
      {
        label: visible ? 'Hide Window' : 'Show Window',
        click: () => {
          const w = getWindow();
          if (!w || w.isDestroyed()) return;
          if (w.isVisible()) w.hide();
          else { w.show(); w.focus(); }
        },
      },
      {
        label: 'Open Settings',
        click: () => openPath('/settings'),
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: !!cfg.window.alwaysOnTop,
        click: (item) => {
          applyWindow({ alwaysOnTop: item.checked });
          if (refreshMenu) refreshMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  }

  tray.on('click', () => {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isVisible()) {
      if (process.platform === 'darwin') w.focus();
      else w.hide();
    } else {
      w.show();
      w.focus();
    }
  });

  build();

  return { tray, rebuild: build };
}

module.exports = { create };
