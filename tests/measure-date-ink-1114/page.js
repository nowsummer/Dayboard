// In the page: for every task row in a scope, where its title's first glyph and its second line's first glyph start (the pen, CSS px)
// and how far right of the pen their ink starts (the glyph's left side bearing at the element's own font, scaled from a canvas drawing
// below), plus the same bearing table for the characters a title or a date line may start with.
const canvas = document.createElement('canvas').getContext('2d');
const bearingCache = new Map();
// measureText's bounds come in 1/64 em steps (0.23px at 15px), too coarse here: the glyph is drawn at 500px and its first column with
// half coverage or more is found, 1/500 em (0.03px at 15px)
const big = document.createElement('canvas'); big.width = 1400; big.height = 760;
const g = big.getContext('2d', { willReadFrequently: true });
const PEN = 400, SIZE = 500;
const bearingEm = (ch, weight, style, family) => {
  g.clearRect(0, 0, big.width, big.height); g.font = `${style} ${weight} ${SIZE}px ${family}`; g.fillStyle = '#000'; g.textBaseline = 'alphabetic'; g.fillText(ch, PEN, 600);
  const d = g.getImageData(0, 0, big.width, big.height).data;
  for (let x = 0; x < big.width; x++) for (let y = 0; y < big.height; y++) if (d[(y * big.width + x) * 4 + 3] >= 128) return (x - PEN) / SIZE;
  return null;
};
const bearing = (ch, cs) => {
  const key = ch + '|' + cs.fontWeight + '|' + cs.fontStyle + '|' + cs.fontFamily;
  if (!bearingCache.has(key)) bearingCache.set(key, bearingEm(ch, cs.fontWeight, cs.fontStyle, cs.fontFamily));
  return bearingCache.get(key) * parseFloat(cs.fontSize); // CSS px right of the pen (negative: left of it), at the element's own size
};
const weightCheck = () => { const w = x => { g.font = `normal ${x} 100px Pretendard`; return +g.measureText('보고서 내일 11월').width.toFixed(2); }; return { 400: w(400), 450: w(450), 500: w(500) }; };
const lumOf = color => { const m = color.match(/[\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const firstLeaf = el => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => n.nodeType === 1 ? (n.localName === 'svg' || n.localName === 'i' ? NodeFilter.FILTER_ACCEPT : (getComputedStyle(n).display === 'none' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)) : (n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  return w.nextNode();
};
const line = el => {
  if (!el) return null;
  const leaf = firstLeaf(el);
  if (!leaf) return null;
  if (leaf.nodeType === 1) { const r = leaf.getBoundingClientRect(); return { kind: 'icon', start: r.left, ink: r.left, top: r.top, bottom: r.bottom, colorLum: lumOf(getComputedStyle(leaf).color) }; }
  const i = leaf.data.search(/\S/), ch = leaf.data[i];
  const range = document.createRange(); range.setStart(leaf, i); range.setEnd(leaf, i + 1);
  const r = range.getClientRects()[0];
  if (!r || r.width === 0) return null;
  const cs = getComputedStyle(leaf.parentElement);
  const z = leaf.parentElement.currentCSSZoom || 1; // a widget's content zooms by --wz (CSS zoom): its glyphs too
  const lsb = bearing(ch, cs) * z;
  return { kind: 'text', ch, start: +r.left.toFixed(3), lsb: +lsb.toFixed(3), ink: +(r.left + lsb).toFixed(3), top: r.top, bottom: r.bottom, font: `${cs.fontWeight} ${cs.fontSize}`, cssZoom: z, numeric: cs.fontVariantNumeric, spacing: cs.letterSpacing, colorLum: lumOf(cs.color), cls: leaf.parentElement.className };
};
const TITLE_CHARS = [...'이보세우장회병사할팀면메전정출운청결예계공기다마문발서수신연은일주준집책친택통학휴', 'R', 'M', 'T', 'A', 'B', 'S', '1', '2'];
const DATE_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '오', '어', '내', '월', '화', '수', '목', '금', '토', '일', '그', 'Y', 'T', 'N', 'D', 'J', 'F', 'M', 'A', 'S', 'O'];
function measure(scope) {
  const rows = [];
  let titleCs = null, metaCs = null;
  for (const row of document.querySelectorAll(scope + ' .task-row')) {
    const titleEl = row.querySelector('.task-title'), metaEl = row.querySelector('.task-text>.task-meta');
    const title = line(titleEl), meta = line(metaEl);
    if (!title) continue;
    if (title.kind === 'text') { const leaf = firstLeaf(titleEl); titleCs = titleCs || getComputedStyle(leaf.parentElement); }
    if (meta && meta.kind === 'text') { const leaf = firstLeaf(metaEl); metaCs = metaCs || getComputedStyle(leaf.parentElement); }
    rows.push({ id: row.dataset.taskId || '', step: row.classList.contains('day-step'), title, meta, diff: meta ? +(meta.ink - title.ink).toFixed(3) : null, penDiff: meta ? +(meta.start - title.start).toFixed(3) : null });
  }
  const table = cs => cs ? Object.fromEntries((cs === titleCs ? TITLE_CHARS : DATE_CHARS).map(ch => [ch, +bearing(ch, cs).toFixed(3)])) : null;
  return { view: innerWidth, weights: weightCheck(), padding: metaCs ? getComputedStyle(document.querySelector(scope + ' .task-text>.task-meta')).paddingLeft : null, rows, titleFont: titleCs && `${titleCs.fontWeight} ${titleCs.fontSize}`, metaFont: metaCs && `${metaCs.fontWeight} ${metaCs.fontSize}`, titleBearings: table(titleCs), metaBearings: table(metaCs) };
}
