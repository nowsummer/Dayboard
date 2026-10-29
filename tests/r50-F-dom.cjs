'use strict';
// A small DOM for running the renderer's dialog, row and toolbar code under node:test (2026-10-28 Codex review, area F).
// Enough of the platform for app.js's h()/icon() builders and the selectors the renderer uses: elements with attributes,
// classList, dataset, style, focus/blur that move document.activeElement and fire focusin/focus/blur/focusout, events
// that bubble to the document (preventDefault/stopPropagation), querySelector(All)/closest/matches with tag, #id, .class,
// [attr], [attr=value], [attr^=value], :not(…), :scope and the descendant/child combinators. Layout is faked: every element
// that is not hidden has one client rect. Not a browser — the smoke (tests/ui-smoke.cjs) checks the real thing.
class Node {
  constructor(document) { this.ownerDocument = document; this.parentNode = null; this.childNodes = []; }
  get isConnected() { let n = this; while (n) { if (n === this.ownerDocument) return true; n = n.parentNode; } return false; }
  remove() { if (this.parentNode) { const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = null; } }
}
class Text extends Node {
  constructor(document, data) { super(document); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
const FOCUSABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'A']);
class EventImpl {
  constructor(type, init = {}) {
    this.type = type; this.bubbles = Boolean(init.bubbles); this.cancelable = init.cancelable !== false;
    this.defaultPrevented = false; this.stopped = false; this.target = null; this.currentTarget = null;
    for (const k of ['key', 'code', 'ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'isComposing', 'detail', 'clientX', 'clientY', 'relatedTarget', 'button', 'submitter']) if (k in init) this[k] = init[k];
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; this.immediate = true; }
}
class Element extends Node {
  constructor(document, tag, namespaceURI) {
    super(document); this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase(); this.namespaceURI = namespaceURI || null;
    this.attrs = new Map(); this.listeners = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.inert = false;
    this.selectionStart = 0; this.selectionEnd = 0; this.scrollTop = 0; this.scrollIntoViewCalls = 0;
    const self = this;
    this.style = { setProperty(p, v) { self.style[p] = String(v); }, getPropertyValue(p) { return self.style[p] || ''; }, removeProperty(p) { delete self.style[p]; } };
    this.classList = {
      add: (...c) => { const s = self.classes(); c.forEach(x => s.add(x)); self.setClasses(s); },
      remove: (...c) => { const s = self.classes(); c.forEach(x => s.delete(x)); self.setClasses(s); },
      contains: c => self.classes().has(c),
      toggle: (c, force) => { const s = self.classes(); const on = force === undefined ? !s.has(c) : Boolean(force); if (on) s.add(c); else s.delete(c); self.setClasses(s); return on; },
      get length() { return self.classes().size; },
      [Symbol.iterator]: function* () { yield* self.classes(); },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => typeof k === 'string' ? self.getAttribute('data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())) ?? undefined : undefined,
      set: (_, k, v) => { self.setAttribute('data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(v)); return true; },
      has: (_, k) => self.hasAttribute('data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())),
    });
  }
  classes() { return new Set((this.attrs.get('class') || '').split(/\s+/).filter(Boolean)); }
  setClasses(s) { this.attrs.set('class', [...s].join(' ')); }
  get className() { return this.attrs.get('class') || ''; }
  set className(v) { this.attrs.set('class', String(v)); }
  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.attrs.set('id', String(v)); }
  get type() { return this.attrs.get('type') ?? (this.tagName === 'INPUT' ? 'text' : this.tagName === 'BUTTON' ? 'submit' : ''); }
  set type(v) { this.attrs.set('type', String(v)); }
  get name() { return this.attrs.get('name') || ''; }
  get title() { return this.attrs.get('title') || ''; }
  set title(v) { this.attrs.set('title', String(v)); }
  get tabIndex() { const t = this.attrs.get('tabindex'); if (t !== undefined && t !== '') return Number(t); return FOCUSABLE.has(this.tagName) ? 0 : -1; }
  set tabIndex(v) { this.attrs.set('tabindex', String(v)); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextElementSibling() { if (!this.parentNode) return null; const s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; }
  get previousElementSibling() { if (!this.parentNode) return null; const s = this.parentNode.children; return s[s.indexOf(this) - 1] || null; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this.append(String(v)); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get isContentEditable() { return this.getAttribute('contenteditable') === 'true'; }
  adopt(x) { const node = x instanceof Node ? x : new Text(this.ownerDocument, x); node.remove(); node.parentNode = this; return node; }
  append(...kids) { for (const k of kids) this.childNodes.push(this.adopt(k)); }
  appendChild(k) { this.append(k); return k; }
  prepend(...kids) { this.childNodes.unshift(...kids.map(k => this.adopt(k))); }
  insertBefore(node, ref) { const n = this.adopt(node); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); return n; }
  replaceChildren(...kids) { for (const c of [...this.childNodes]) c.remove(); this.append(...kids.flat(Infinity).filter(k => k != null)); }
  setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
  getAttribute(k) { const v = this.attrs.get(String(k).toLowerCase()); return v === undefined ? null : v; }
  hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
  removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [{ width: 10, height: 10 }]; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }; }
  get offsetHeight() { return 10; } get clientHeight() { return 10; } get scrollHeight() { return 10; } get clientWidth() { return 10; } get scrollWidth() { return 10; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  select() { this.selectionStart = 0; this.selectionEnd = String(this.value).length; }
  scrollIntoView() { this.scrollIntoViewCalls++; }
  showPicker() {}
  requestSubmit(submitter) { this.dispatchEvent(new EventImpl('submit', { bubbles: true, submitter })); }
  click() { this.dispatchEvent(new EventImpl('click', { bubbles: true, detail: 1 })); }
  focus() {
    if (this.disabled || !this.isConnected) return;
    const doc = this.ownerDocument; const was = doc.activeElement;
    if (was === this) return;
    if (was && was !== doc.body) { doc.activeElement = doc.body; was.dispatchEvent(new EventImpl('blur', { relatedTarget: this })); was.dispatchEvent(new EventImpl('focusout', { bubbles: true, relatedTarget: this })); }
    doc.activeElement = this;
    this.dispatchEvent(new EventImpl('focus', { relatedTarget: was })); this.dispatchEvent(new EventImpl('focusin', { bubbles: true, relatedTarget: was }));
  }
  blur() { const doc = this.ownerDocument; if (doc.activeElement !== this) return; doc.activeElement = doc.body; this.dispatchEvent(new EventImpl('blur')); this.dispatchEvent(new EventImpl('focusout', { bubbles: true })); }
  addEventListener(type, fn, options) { const capture = options === true || Boolean(options && options.capture); const once = Boolean(options && options.once); if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push({ fn, capture, once }); }
  removeEventListener(type, fn, options) { const capture = options === true || Boolean(options && options.capture); const list = this.listeners.get(type); if (!list) return; const i = list.findIndex(l => l.fn === fn && l.capture === capture); if (i >= 0) list.splice(i, 1); }
  dispatchEvent(event) { return dispatch(this, event); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { const out = []; const list = parseSelectors(selector); const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 1) { if (list.some(s => matchComplex(c, s, this))) out.push(c); walk(c); } } }; walk(this); return out; }
  matches(selector) { return parseSelectors(selector).some(s => matchComplex(this, s, this)); }
  closest(selector) { let n = this; while (n && n.nodeType === 1) { if (n.matches(selector)) return n; n = n.parentNode; } return null; }
}
function dispatch(target, event) {
  event.target = target;
  const path = []; let n = target; while (n) { path.push(n); n = n.parentNode; }
  const call = (node, capture) => { const list = node.listeners?.get(event.type); if (!list) return; for (const l of [...list]) { if (l.capture !== capture) continue; if (l.once) list.splice(list.indexOf(l), 1); event.currentTarget = node; l.fn.call(node, event); if (event.immediate) return; } };
  for (let i = path.length - 1; i >= 0 && !event.stopped; i--) call(path[i], true);
  for (let i = 0; i < path.length && !event.stopped; i++) { call(path[i], false); if (!event.bubbles) break; }
  return !event.defaultPrevented;
}
// ---- selectors ----
const selectorCache = new Map();
function parseSelectors(text) {
  if (selectorCache.has(text)) return selectorCache.get(text);
  const list = splitTop(text, ',').map(parseComplex);
  selectorCache.set(text, list);
  return list;
}
function splitTop(text, sep) { const out = []; let depth = 0, inAttr = false, cur = ''; for (const ch of text) { if (ch === '[') inAttr = true; else if (ch === ']') inAttr = false; else if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === sep && !depth && !inAttr) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()).filter(Boolean); }
// compound (combinator compound)*; parts[i].comb is the combinator between parts[i-1] and parts[i] (' ' or '>').
function parseComplex(text) {
  const parts = []; let cur = '', depth = 0, inAttr = false, pending = ' ';
  const push = () => { if (cur.trim()) { parts.push({ comb: pending, compound: parseCompound(cur.trim()) }); cur = ''; pending = ' '; } };
  for (const ch of text) {
    if (ch === '[') inAttr = true; else if (ch === ']') inAttr = false; else if (ch === '(') depth++; else if (ch === ')') depth--;
    if (!depth && !inAttr && (ch === ' ' || ch === '>')) { push(); if (ch === '>') pending = '>'; continue; }
    cur += ch;
  }
  push();
  return parts;
}
function parseCompound(text) {
  const simple = []; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '#') { const m = /^#([\w-]+)/.exec(text.slice(i)); simple.push({ id: m[1] }); i += m[0].length; }
    else if (ch === '.') { const m = /^\.([\w-]+)/.exec(text.slice(i)); simple.push({ cls: m[1] }); i += m[0].length; }
    else if (ch === '[') { const end = text.indexOf(']', i); const body = text.slice(i + 1, end); const m = /^([\w-]+)(?:([~|^$*]?=)"?([^"]*?)"?)?$/.exec(body.trim()); simple.push({ attr: m[1], op: m[2] || null, val: m[3] === undefined ? null : m[3].replace(/^'|'$/g, '') }); i = end + 1; }
    else if (ch === ':') {
      if (text.startsWith(':not(', i)) { let depth = 0, j = i + 4; for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')') { depth--; if (!depth) break; } } simple.push({ not: splitTop(text.slice(i + 5, j), ',').map(parseCompound) }); i = j + 1; }
      else { const m = /^:([\w-]+)(?:\(([^)]*)\))?/.exec(text.slice(i)); simple.push({ pseudo: m[1], arg: m[2] }); i += m[0].length; }
    }
    else { const m = /^[\w-]+|^\*/.exec(text.slice(i)); simple.push({ tag: m[0] }); i += m[0].length; }
  }
  return simple;
}
function matchCompound(el, compound, scope) {
  return compound.every(s => {
    if (s.tag) return s.tag === '*' || el.localName === s.tag.toLowerCase();
    if (s.id) return el.id === s.id;
    if (s.cls) return el.classList.contains(s.cls);
    if (s.attr) { const v = el.getAttribute(s.attr); if (v === null) return false; if (!s.op) return true; if (s.op === '=') return v === s.val; if (s.op === '^=') return v.startsWith(s.val); if (s.op === '$=') return v.endsWith(s.val); if (s.op === '*=') return v.includes(s.val); if (s.op === '~=') return v.split(/\s+/).includes(s.val); return false; }
    if (s.not) return !s.not.some(c => matchCompound(el, c, scope));
    if (s.pseudo === 'scope') return el === scope;
    if (s.pseudo === 'first-child') return el.parentNode && el.parentNode.children[0] === el;
    if (s.pseudo === 'last-child') return el.parentNode && el.parentNode.children.at(-1) === el;
    if (s.pseudo === 'nth-child') return el.parentNode && el.parentNode.children.indexOf(el) + 1 === Number(s.arg);
    if (s.pseudo === 'checked') return Boolean(el.checked);
    if (s.pseudo === 'disabled') return Boolean(el.disabled);
    if (s.pseudo === 'focus') return el.ownerDocument.activeElement === el;
    return false;
  });
}
function matchComplex(el, parts, scope) {
  // right to left
  let index = parts.length - 1;
  if (!matchCompound(el, parts[index].compound, scope)) return false;
  const walk = (node, i) => {
    if (i < 0) return true;
    const comb = parts[i + 1].comb;
    if (comb === '>') { const p = node.parentNode; return Boolean(p && p.nodeType === 1 && matchCompound(p, parts[i].compound, scope) && walk(p, i - 1)); }
    let p = node.parentNode; while (p && p.nodeType === 1) { if (matchCompound(p, parts[i].compound, scope) && walk(p, i - 1)) return true; p = p.parentNode; }
    return false;
  };
  return walk(el, index - 1);
}
// ---- document ----
class Document extends Node {
  constructor() {
    super(null); this.ownerDocument = this; this.nodeType = 9; this.listeners = new Map(); this.hidden = false;
    this.documentElement = new Element(this, 'html'); this.documentElement.parentNode = this; this.childNodes.push(this.documentElement);
    this.head = new Element(this, 'head'); this.body = new Element(this, 'body'); this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, tag, ns); }
  createTextNode(text) { return new Text(this, text); }
  querySelector(s) { return this.documentElement.matches(s) ? this.documentElement : this.documentElement.querySelector(s); }
  querySelectorAll(s) { return this.documentElement.querySelectorAll(s); }
  getElementById(id) { return this.querySelector('#' + id); }
  addEventListener(...a) { Element.prototype.addEventListener.apply(this, a); }
  removeEventListener(...a) { Element.prototype.removeEventListener.apply(this, a); }
  dispatchEvent(event) { return dispatch(this, event); }
  hasFocus() { return true; }
  get title() { return ''; } set title(_) {}
}
// The globals a renderer script expects, ready for vm.createContext (callers add state, tr, run, …).
function createDom() {
  const document = new Document();
  const frames = [];
  const window = {
    document, addEventListener() {}, removeEventListener() {}, innerWidth: 1180, innerHeight: 800, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  const globals = {
    document, window, Node, Element, Event: EventImpl, KeyboardEvent: EventImpl, MouseEvent: EventImpl, FocusEvent: EventImpl, CustomEvent: EventImpl, PointerEvent: EventImpl,
    innerWidth: 1180, innerHeight: 800, navigator: { language: 'ko-KR' }, CSS: { escape: x => x }, performance,
    queueMicrotask, requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    matchMedia: window.matchMedia, getComputedStyle: window.getComputedStyle, console, Date, Promise, Set, Map, WeakMap, Intl, Math, JSON, Number, String, Array, Object, Boolean, Error, Symbol, Proxy, Reflect, crypto: globalThis.crypto, structuredClone,
  };
  const flushFrames = () => { for (const fn of frames.splice(0)) fn(); };
  return { document, window, globals, flushFrames };
}
module.exports = { createDom, Node, Element, Text, Document, EventImpl };
