'use strict';
// Draws the Microsoft Store package's images from assets/icon.svg (run by scripts/store.cjs with Electron, like scripts/icons.cjs).
//   electron scripts/store-logos.cjs --out <folder> --listing <file.png> --profile <empty folder>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { logoFiles } = require('./store.cjs');

const option = name => { const at = process.argv.indexOf(name); if (at < 0 || !process.argv[at + 1]) throw new Error(`${name} 뒤에 값이 없습니다.`); return process.argv[at + 1]; };
const MASTER = 1024;
const PAGE = String.raw`
window.loadImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('image load failed'));
  image.src = source;
});
window.tile = function (image, width, height, icon) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, Math.round((width - icon) / 2), Math.round((height - icon) / 2), icon, icon);
  return canvas.toDataURL('image/png');
};
true;
`;

app.setPath('userData', option('--profile')); // inside scripts/store.cjs's temporary folder
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(PAGE);
  const svg = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg')).toString('base64')}`;
  await win.webContents.executeJavaScript(`window.loadImage(${JSON.stringify(svg)}).then(image => { const master = document.createElement('canvas'); master.width = ${MASTER}; master.height = ${MASTER}; const ctx = master.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, ${MASTER}, ${MASTER}); window.master = master; return true; })`);
  const draw = async (width, height, icon) => Buffer.from((await win.webContents.executeJavaScript(`window.tile(window.master, ${width}, ${height}, ${icon})`)).split(',')[1], 'base64');
  const folder = option('--out');
  fs.mkdirSync(folder, { recursive: true });
  for (const item of logoFiles()) fs.writeFileSync(path.join(folder, item.name), await draw(item.width, item.height, item.icon));
  fs.writeFileSync(option('--listing'), await draw(300, 300, 300)); // the 1:1 tile Partner Center asks for on the listing page
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
