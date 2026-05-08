'use strict';

const PORT = process.env.PORT || 3000;
const url = `http://localhost:${PORT}`;

require('../server.js');

if (process.env.OPEN_BROWSER !== '0' && process.platform === 'win32') {
  setTimeout(() => {
    try {
      const { spawn } = require('child_process');
      spawn('cmd', ['/c', 'start', '""', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {
      // browser launch is best-effort; the server is already running
    }
  }, 1500);
}
