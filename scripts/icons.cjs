'use strict';
// Renders the Dayboard icon set with Chromium through a hidden Electron window.
// Every size comes from the one drawing, assets/icon.svg: it is rasterised once at
// 512 px and every .ico entry is a high-quality downscale of that bitmap, which is
// exactly how the renderer shows the in-app mark (<img src="icon.png" width=24>).
// The user chose that look over the hand-tuned pixel grid on 2026-10-20 ("the
// top-left mark is prettier; make the taskbar match it"). The taskbar still gets
// an entry at its own size (lib/windowicon.cjs), so the shell never resamples.
// Run:  npx electron scripts/icons.cjs                 → assets/icon.ico, icon.png, toast.png
//       npx electron scripts/icons.cjs --sheet <dir>   → comparison sheet (1x and 3x, dark and light)
//       npx electron scripts/icons.cjs --out <dir>     → write the icons elsewhere (trial builds)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
// 24/30/36/48 are the Windows 11 taskbar sizes at 100/125/150/200 %, 42/54/60
// cover 175/225/250 %, 20 is the Alt-Tab icon at 125 %; the rest are the classic
// shell sizes. 256 stays PNG-compressed as Windows expects.
const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 42, 48, 54, 60, 64, 96, 128, 256];
const MASTER = 512;

const PAGE = String.raw`
window.loadImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('image load failed'));
  image.src = source;
});
window.draw = function (image, size) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size, size);
  return canvas;
};
window.encode = function (canvas, raw) {
  if (!raw) return canvas.toDataURL('image/png');
  const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let text = ''; for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(text);
};
// Comparison sheet: each size at 1x on a navy taskbar strip and a light strip, then at 3x.
window.sheet = function (image, sizes) {
  const pad = 10, zoom = 3, label = 22;
  const row1 = sizes.reduce((w, s) => w + s + pad, pad), row3 = sizes.reduce((w, s) => w + s * zoom + pad, pad);
  const width = Math.max(row1, row3), tall = Math.max(...sizes);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = label + (tall + 2 * pad) * 2 + (tall * zoom + 2 * pad) * 2;
  const ctx = canvas.getContext('2d');
  const tiles = {}; for (const s of sizes) tiles[s] = window.draw(image, s);
  ctx.imageSmoothingEnabled = false;
  let y = 0;
  ctx.fillStyle = '#111'; ctx.fillRect(0, y, width, label);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(sizes.join('/') + ' px — 1x (navy, light) then 3x', pad, y + 16);
  y += label;
  for (const [bg, z] of [['#1c2340', 1], ['#eef3f9', 1], ['#1c2340', zoom], ['#eef3f9', zoom]]) {
    const h = tall * z + 2 * pad;
    ctx.fillStyle = bg; ctx.fillRect(0, y, width, h);
    let x = pad;
    for (const s of sizes) { ctx.drawImage(tiles[s], x, y + pad + (tall * z - s * z) / 2, s * z, s * z); x += s * z + pad; }
    y += h;
  }
  return canvas.toDataURL('image/png');
};
true; // executeJavaScript returns the completion value; a function would fail to serialise
`;

// Classic 32-bit BMP entry (XOR BGRA rows bottom-up + 1-bit AND mask derived
// from alpha): every Windows component decodes these, whereas PNG-compressed
// small entries are not read by some older paths. 256 px stays PNG as Windows expects.
function bmpEntry(size, rgba) {
  const rowMask = Math.ceil(size / 32) * 4;
  const xor = Buffer.alloc(size * size * 4);
  const and = Buffer.alloc(rowMask * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const src = (y * size + x) * 4; const row = size - 1 - y; const dst = (row * size + x) * 4;
    xor[dst] = rgba[src + 2]; xor[dst + 1] = rgba[src + 1]; xor[dst + 2] = rgba[src]; xor[dst + 3] = rgba[src + 3];
    if (rgba[src + 3] < 128) and[row * rowMask + (x >> 3)] |= 0x80 >> (x & 7);
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([header, xor, and]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = []; let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map(image => image.data)]);
}

// --flag <value>; a flag without a value is an error rather than a silent default.
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} 뒤에 값이 없습니다.`);
  return value;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const outDir = option('--out') || assets;
  const sheetDir = option('--sheet');
  const win = new BrowserWindow({ show: false, width: 600, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(PAGE);
  const svgSource = `data:image/svg+xml;base64,${Buffer.from(fs.readFileSync(path.join(assets, 'icon.svg'))).toString('base64')}`;
  const decode = (payload, raw) => Buffer.from(raw ? payload : payload.split(',')[1], 'base64');
  // Rasterise the SVG once at MASTER px, then keep that bitmap as the source for every size.
  await win.webContents.executeJavaScript(`window.loadImage(${JSON.stringify(svgSource)}).then(svg => {
    const master = window.draw(svg, ${MASTER});
    return window.loadImage(master.toDataURL('image/png')).then(image => { window.master = image; return true; });
  })`);
  async function render(size, raw) {
    return decode(await win.webContents.executeJavaScript(`window.encode(window.draw(window.master, ${size}), ${raw})`), raw);
  }
  if (sheetDir) {
    fs.mkdirSync(sheetDir, { recursive: true });
    const target = path.join(sheetDir, 'sheet.png');
    fs.writeFileSync(target, decode(await win.webContents.executeJavaScript(`window.sheet(window.master, ${JSON.stringify(ICO_SIZES.filter(size => size <= 64))})`)));
    console.log(`sheet written: ${target}`);
    app.exit(0); return;
  }
  // Render everything first, then write, so a failure leaves the old set intact.
  const images = [];
  for (const size of ICO_SIZES) {
    const raw = size < 256;
    const data = await render(size, raw);
    images.push({ size, data: raw ? bmpEntry(size, data) : data });
  }
  // toast.png: the Windows toast logo (48 dip, so 96 px covers 200 %). The in-app
  // mark scales icon.png down in the renderer, which is the same downscale as here.
  const files = { 'icon.ico': ico(images), 'icon.png': await render(MASTER, false), 'toast.png': await render(96, false) };
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), data);
  for (const stale of ['tray.png', 'brand-24.png', 'brand-30.png', 'brand-36.png', 'brand-48.png']) fs.rmSync(path.join(outDir, stale), { force: true });
  console.log(`icons written to ${outDir}: icon.ico (${ICO_SIZES.join('/')}), icon.png (${MASTER}), toast.png (96)`);
  app.exit(0);
}).catch(error => { console.error(error.stack || error.message); app.exit(1); });
