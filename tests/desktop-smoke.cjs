'use strict';
// Run explicitly with Electron. Creates one temporary native test window only.
const { app, BrowserWindow, screen } = require('electron');
const { createDesktopManager } = require('../lib/desktop.cjs');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-native-test-')));
app.whenReady().then(async () => {
  const manager = createDesktopManager();
  const win = new BrowserWindow({ show: false, width: 320, height: 250, frame: false, skipTaskbar: true,
    transparent: true, backgroundColor: '#00000000', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="font:18px Segoe UI;background:#fffffff0;border-radius:20px;padding:24px;margin:0;height:200px"><b>Dayboard</b><p>바탕화면 위젯 검증 중</p></body></html>'));
  win.showInactive();
  const attached = manager.apply(win, 'desktop');
  const bounds = manager.getBounds(win, screen);
  const top = manager.apply(win, 'top');
  const attachedAgain = manager.apply(win, 'desktop');
  console.log(JSON.stringify({ attached, bounds, top, attachedAgain }));
  manager.detach(win);
  win.destroy();
  app.exit(attached.desktopStatus === 'attached' && top.desktopStatus === 'top' && attachedAgain.desktopStatus === 'attached' ? 0 : 1);
}).catch(error => { console.error(error.stack); app.exit(1); });
