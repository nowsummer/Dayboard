'use strict';
// Liquid Glass (2026-10-21 user request: 「그냥 투명/불투명 해지는 게 아니라 애플 iOS 27처럼 리퀴드 글라스」).
// The card is a slab of glass with a rounded bevel: the wallpaper behind it is bent at the rim (an SVG
// displacement map through backdrop-filter: url(#…)), the edge catches the light from above (a thin
// specular rim drawn once per size), and the tint is applied inside the filter before the saturation so
// the wallpaper's colours come through vivid instead of washed out. Loaded before app.js: app.js globals
// are read only inside functions. Desktop widgets have their wallpaper painted behind them (#backdrop);
// the gallery previews refract their stage. Without a backdrop (always on top) only the rim is drawn.
const GLASS_NS = 'http://www.w3.org/2000/svg';
const glassBuilt = new Map(); // filter name -> { key, tint }
const glassSpecCache = new Map(); // size key -> specular data URL
let glassDefs = null;
const glassOk = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#lg)');

// Inside distance d (CSS px, > 0 inside) and the outward normal of a W×H rectangle with corner radius R.
function lensEdge(x, y, W, H, R) {
  const hx = W / 2, hy = H / 2, px = x - hx, py = y - hy;
  const qx = Math.abs(px) - (hx - R), qy = Math.abs(py) - (hy - R);
  let d, nx, ny;
  if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1e-6; d = R - l; nx = qx / l; ny = qy / l; }
  else if (qx > qy) { d = R - qx; nx = 1; ny = 0; }
  else { d = R - qy; nx = 0; ny = 1; }
  return { d, nx: px < 0 ? -nx : nx, ny: py < 0 ? -ny : ny };
}
// How far a straight-down ray is bent through a convex squircle bevel of glass (n = 1.5), t = d / bevel width,
// normalised to 1 at its largest: strongest at the very edge, nothing on the flat middle.
const lensShift = (() => {
  const N = 512, out = new Float32Array(N + 1);
  let max = 0;
  for (let i = 0; i <= N; i++) {
    const u = 1 - i / N, base = 1 - u ** 4;
    if (i === N || base <= 0) { out[i] = 0; continue; }
    const theta = Math.atan(base ** -0.75 * u ** 3), phi = Math.asin(Math.sin(theta) / 1.5);
    out[i] = base ** 0.25 * Math.tan(theta - phi); max = Math.max(max, out[i]);
  }
  for (let i = 0; i <= N; i++) out[i] /= max;
  return t => t >= 1 ? 0 : out[Math.max(0, Math.round(t * N))];
})();
function lensCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Displacement map at CSS size: red/green = 0.5 + half the inward shift; the flat middle stays neutral.
function lensMap(W, H, R, bevel) {
  const c = lensCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), p = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = lensEdge(x + 0.5, y + 0.5, W, H, R), i = (y * W + x) * 4;
    let dx = 0, dy = 0;
    if (e.d > 0 && e.d < bevel) { const m = lensShift(e.d / bevel); dx = -e.nx * m; dy = -e.ny * m; }
    p[i] = Math.round(127.5 + 127 * dx); p[i + 1] = Math.round(127.5 + 127 * dy); p[i + 2] = 128; p[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
// Specular rim at device pixels, as on Apple's Liquid Glass: a thin highlight on the edge that faces the light (from almost
// straight above), fading away along the sides, with a fainter reflection on the far edge and a faint glow only where the edge
// is lit (2026-10-27 review: the old 0.25 floor and all-round glow drew a uniform white outline, plainest on dark wallpapers).
function lensSpecular(W, H, R, dpr) {
  const key = [W, H, R, dpr].join('x');
  if (glassSpecCache.has(key)) return glassSpecCache.get(key);
  const w = Math.round(W * dpr), h = Math.round(H * dpr);
  const c = lensCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), p = img.data;
  const lx = -0.17, ly = -0.985, line = 0.6, glow = 7;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const e = lensEdge((x + 0.5) / dpr, (y + 0.5) / dpr, W, H, R);
    if (e.d <= -1 / dpr || e.d > glow * 3) continue;
    const cover = Math.min(1, Math.max(0, e.d * dpr + 0.5));
    const k = e.nx * lx + e.ny * ly;
    const f = 0.04 + 0.96 * Math.max(0, k) ** 3 + 0.5 * Math.max(0, -k) ** 3;
    const edge = e.d < line ? 1 : Math.max(0, 1 - (e.d - line) * dpr);
    const soft = Math.exp(-Math.max(0, e.d) / (glow / 2.5));
    const a = cover * Math.min(1, f * (0.9 * edge + 0.14 * soft));
    if (a <= 0) continue;
    const i = (y * w + x) * 4; p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  if (glassSpecCache.size > 12) glassSpecCache.clear();
  glassSpecCache.set(key, url);
  return url;
}
function glassNode(tag, attrs, parent) {
  const n = document.createElementNS(GLASS_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}
// One filter per surface name, rebuilt only when the size changes: blur → bend at the rim → tint → saturate.
function glassFilter(name, W, H, R) {
  const id = 'lg-' + name, key = [W, H, R].join('x');
  const built = glassBuilt.get(name);
  if (built && built.key === key && document.getElementById(id)) return id;
  if (!glassDefs || !glassDefs.isConnected) {
    const svg = glassNode('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    glassDefs = glassNode('defs', {}, svg);
    document.body.appendChild(svg);
  }
  document.getElementById(id)?.remove();
  const bevel = Math.min(22, Math.round(R * 0.85));
  const f = glassNode('filter', { id, x: 0, y: 0, width: W, height: H, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, glassDefs);
  glassNode('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 8, edgeMode: 'duplicate', result: 'soft' }, f);
  glassNode('feImage', { href: lensMap(W, H, R, bevel), x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', result: 'lens' }, f);
  glassNode('feDisplacementMap', { in: 'soft', in2: 'lens', scale: bevel * 2.1, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }, f);
  const tint = glassNode('feComponentTransfer', { in: 'bent', result: 'tinted' }, f);
  for (const ch of ['feFuncR', 'feFuncG', 'feFuncB']) glassNode(ch, { type: 'linear', slope: 1, intercept: 0 }, tint);
  glassNode('feColorMatrix', { in: 'tinted', type: 'saturate', values: 1.8 }, f);
  glassBuilt.set(name, { key, tint: null });
  return id;
}
// Tint inside the filter: light glass lifts toward white by t, dark glass sinks toward slate by t.
function glassTune(name, p) {
  const f = document.getElementById('lg-' + name), built = glassBuilt.get(name);
  if (!f || !built) return;
  const sig = [p.dark, p.t, p.sat, p.blur].join('|');
  if (built.tint === sig) return;
  built.tint = sig;
  const slate = [0.145, 0.153, 0.18];
  f.querySelector('feGaussianBlur').setAttribute('stdDeviation', String(Math.max(0, p.blur / 2)));
  [...f.querySelectorAll('feComponentTransfer > *')].forEach((fn, i) => { fn.setAttribute('slope', String(1 - p.t)); fn.setAttribute('intercept', String(p.dark ? p.t * slate[i] : p.t)); });
  f.querySelector('feColorMatrix').setAttribute('values', String(p.sat / 100));
}
// Filter tint for a glass level over a wallpaper of luminance L (domain.js glassTint: a/da, blur, saturation).
function glassParams(level, L) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const g = DayboardDates.glassTint(level, typeof L === 'number' ? L : (dark ? 0.23 : 0.82));
  // Dark glass gets a gentler saturation: after a light tint a vivid blue clipped to flat pure blue behind grey text (review).
  return { dark, t: dark ? g.da : g.a, sat: dark ? g.dsat : g.sat, blur: g.blur };
}
// Puts the glass on one element (called after every render: the elements are new each time).
function glassMount(el, name, level, L) {
  if (!glassOk || !el || !el.isConnected) return false;
  const r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
  if (W < 40 || H < 40) return false;
  const R = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 26);
  const id = glassFilter(name, W, H, Math.min(R, W / 2, H / 2));
  glassTune(name, glassParams(level, L));
  el.classList.add('lg');
  el.style.setProperty('--lg-filter', `url(#${id})`);
  el.style.setProperty('--lg-spec', `url("${lensSpecular(W, H, Math.min(R, W / 2, H / 2), devicePixelRatio || 1)}")`);
  return true;
}
// The rim alone (always-on-top widgets have nothing behind them to bend).
function glassRim(el) {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
  if (W < 40 || H < 40) return;
  const R = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 26);
  el.classList.add('lg-rim');
  el.style.setProperty('--lg-spec', `url("${lensSpecular(W, H, Math.min(R, W / 2, H / 2), devicePixelRatio || 1)}")`);
}
function glassAfterRender() {
  if (typeof isWidget === 'undefined' || !state) return;
  if (isWidget) {
    const surface = document.querySelector('#app > .widget-surface');
    if (!surface) return;
    if (glassSolid()) return; // the opaque end: a plain card, no lens and no rim
    if (document.body.classList.contains('has-backdrop')) glassMount(surface, 'surface', glassLevel(), glassBasis());
    else glassRim(surface);
    return;
  }
  const gallery = document.querySelector('.widget-gallery');
  if (gallery) glassPreviews(gallery, glassLevel());
  else glassDropPreviews();
}
// The gallery's filters leave with it: three filters and their lens maps stayed in <defs> for the rest of the session
// (2026-10-26 performance review).
function glassDropPreviews() {
  for (const name of [...glassBuilt.keys()]) if (name.startsWith('preview-')) { document.getElementById('lg-' + name)?.remove(); glassBuilt.delete(name); }
}
function glassPreviews(gallery, level) {
  const solid = glassSolid(level);
  gallery.classList.toggle('solid', solid);
  for (const el of gallery.querySelectorAll('.widget-preview')) {
    const type = ['tasks', 'calendar', 'note'].find(t => el.classList.contains('preview-' + t)) || 'tasks';
    if (solid) { el.classList.remove('lg'); el.style.removeProperty('--lg-filter'); continue; }
    glassMount(el, 'preview-' + type, level, null);
  }
}
// While a card changes size (the widget's resize handle, a main-window edge drag) its filter and lens stretch to it on the
// next frame, so no band of bare wallpaper shows past the old size (2026-10-21 review); the bevel and rim are drawn again
// for the new size 60 ms after the last change.
function glassStretch() {
  const cards = typeof isWidget !== 'undefined' && isWidget
    ? [[document.querySelector('#app > .widget-surface.lg'), 'surface']]
    : [...document.querySelectorAll('.widget-preview.lg')].map(el => [el, 'preview-' + (['tasks', 'calendar', 'note'].find(t => el.classList.contains('preview-' + t)) || 'tasks')]);
  for (const [el, name] of cards) {
    const f = el && document.getElementById('lg-' + name);
    if (!f) continue;
    const r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
    if (W < 40 || H < 40) continue;
    for (const n of [f, f.querySelector('feImage')]) { n.setAttribute('width', String(W)); n.setAttribute('height', String(H)); }
  }
}
// A widget moved to a screen with another scale, or the window was resized: draw the rim and bevel again.
if (typeof window !== 'undefined') {
  let glassDpr = window.devicePixelRatio || 1, glassTimer = 0, glassFrame = 0;
  // 60 ms after the last step — and, while the widget's resize handle is held (app.js resizingWidget), not before the drag has
  // ended: a step slower than 60 ms rebuilt the lens and rim mid-drag (2026-10-27 review), so the timer waits and rebuilds once.
  const settle = () => {
    if (typeof resizingWidget !== 'undefined' && resizingWidget) { glassTimer = setTimeout(settle, 60); return; }
    glassDpr = window.devicePixelRatio || 1; try { glassAfterRender(); } catch {}
  };
  const again = () => {
    if (!glassFrame) glassFrame = requestAnimationFrame(() => { glassFrame = 0; try { glassStretch(); } catch {} });
    clearTimeout(glassTimer); glassTimer = setTimeout(settle, 60);
  };
  window.addEventListener('resize', again);
  const watchDpr = () => { const m = matchMedia(`(resolution: ${glassDpr}dppx)`); m.addEventListener('change', () => { again(); setTimeout(watchDpr, 100); }, { once: true }); };
  watchDpr();
}
