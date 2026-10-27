'use strict';
// main.cjs's command table and its queue (2026-10-27 review): the names answered outside the main queue are one named set,
// DIRECT_COMMANDS, next to command(), and every one of them is a case label (a name that is not would fall to the default
// 「지원하지 않는 명령입니다」); widget:open is among them and its window work is serialized per widget (perWidget) instead of
// holding every other command for the 4-9 s its page takes to load — the Explorer-restart reopen, retryAttach and the reveals
// after a reload go the same way. Static checks over the source plus perWidget cut from it, as tests/card-r15.test.cjs does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
// One top-level function of main.cjs, to its closing brace (the braces in its strings and patterns pair up).
function mainFunction(name) {
  const at = Math.max(source.indexOf(`\nfunction ${name}(`), source.indexOf(`\nasync function ${name}(`));
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  let depth = 0; let i = source.indexOf('{', at);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(at + 1, i + 1);
}
const between = (from, to) => { const a = source.indexOf(from); assert.ok(a >= 0, from); const b = source.indexOf(to, a + from.length); assert.ok(b > a, to); return source.slice(a, b); };

const EXPECTED_DIRECT = ['window:main', 'window:minimize', 'window:maximize', 'window:close', 'widget:open', 'widget:close', 'widget:resize', 'widget:painted', 'widget:focus',
  'widget:glass-preview', 'update:check', 'update:download', 'update:install', 'update:open', 'note:save', 'account:connect', 'sync:run', 'auth:status', 'auth:cancel', 'app:quit'];

function directCommands() {
  const match = source.match(/\nconst DIRECT_COMMANDS = new Set\(\[([^\]]*)\]\);\n/);
  assert.ok(match, 'main.cjs names the commands that run outside the queue as DIRECT_COMMANDS');
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}
function caseLabels() {
  const body = mainFunction('command');
  return [...body.matchAll(/\n\s+case '([^']+)':/g)].map(m => m[1]);
}

test('every direct command is a case of command(); the set is the 18 of before plus widget:open and widget:glass-preview (2026-10-28), defined next to command()', () => {
  const direct = directCommands();
  const cases = caseLabels();
  assert.ok(cases.length >= 50, `command() has its cases (${cases.length})`);
  for (const name of direct) assert.ok(cases.includes(name), `${name} is a case of command()`);
  assert.deepEqual([...direct].sort(), [...EXPECTED_DIRECT].sort());
  assert.equal(new Set(direct).size, direct.length, 'no name twice');
  const definition = source.indexOf('\nconst DIRECT_COMMANDS = new Set(');
  const commandAt = source.indexOf('\nasync function command(commandName, payload, sourceWindow) {');
  assert.ok(definition > 0 && commandAt > definition && commandAt - definition < 2000, 'the set sits right above command(), not 900 lines away in the IPC handler');
  const comment = source.slice(source.lastIndexOf('\n}\n', definition), definition);
  assert.match(comment, /sign-in/, 'the comment names the long-running reason');
  assert.match(comment, /flushWindow/, 'the comment names the round-trip reason (note:save answers flushWindow)');
  assert.match(comment, /revealOnDesktop/, 'the comment names the round-trip reason (widget:painted answers revealOnDesktop)');
  const handler = between("ipcMain.handle('dayboard:invoke'", "ipcMain.on('dayboard:flushed'");
  assert.ok(handler.includes('if (DIRECT_COMMANDS.has(name)) return command(name, payload, sourceWindow);'), 'the IPC handler consults the set');
  assert.ok(handler.includes('return queued(() => command(name, payload, sourceWindow));'), 'everything else is queued');
  assert.equal(/\[\s*'window:main'/.test(handler), false, 'no inline list of names in the handler any more');
});

test('widget:open, the reopen after an Explorer restart, retryAttach and the reveals serialize per widget, off the main queue', () => {
  assert.ok(directCommands().includes('widget:open'));
  const open = between("    case 'widget:open': {", "    case 'widget:update': {");
  assert.ok(open.includes('perWidget(widget.id, () => openWidget(widget))'), 'widget:open runs openWidget through perWidget');
  assert.ok(open.indexOf('commit(state => {') < open.indexOf('perWidget('), 'the record is committed first, synchronously');
  const update = between("    case 'widget:update': {", "    case 'widget:resize': {");
  assert.ok(update.includes('perWidget(widget.id, () => placeWidget(win, widget.mode, widget.id))'), 'a mode change places the widget through the same per-widget line');
  const openWidget = mainFunction('openWidget');
  assert.equal(openWidget.includes('queued('), false, 'nothing in openWidget (reopen after Explorer restart, reveal after a reload) uses the main queue');
  assert.ok(openWidget.includes('perWidget(widget.id, () => openWidget(current))'), 'the Explorer-restart reopen is per widget');
  assert.ok(openWidget.includes('perWidget(widget.id, () => revealOnDesktop(win, { hide: true })'), 'the reveal after a reload is per widget');
  const retry = mainFunction('retryAttach');
  assert.ok(retry.includes('perWidget(widgetId, async () => {') && !retry.includes('queued('), 'retryAttach is per widget');
  const refresh = mainFunction('refreshBackdrops');
  assert.ok(refresh.includes('perWidget(id, () => revealOnDesktop(win, { hide: true })') && !refresh.includes('queued('), 'a card-fallback retry after a wallpaper change is per widget');
  assert.equal((source.match(/queued\(\(\) => command\('widget:open'/g) || []).length, 0, 'the tray and the smoke hold open widgets directly');
  assert.ok(source.includes('perWidget(widget.id, () => openWidget(widget)).catch(() => {});'), 'a restored note\'s widgets reopen per widget');
  const uses = source.match(/\bqueued\(\(\) =>/g) || [];
  assert.equal(uses.length, 1, `queued() is used by the IPC handler only (${uses.length})`);
});

test('perWidget runs one task at a time per id, lets other ids run alongside, survives a rejection and forgets idle ids', async () => {
  const context = { widgetQueues: new Map(), Promise };
  vm.createContext(context);
  vm.runInContext(mainFunction('perWidget'), context, { filename: 'main.cjs' });
  const perWidget = context.perWidget;
  const log = [];
  const gate = () => { let open; const wait = new Promise(resolve => { open = resolve; }); return { wait, open }; };
  const first = gate(), other = gate();
  const a1 = perWidget('a', async () => { log.push('a1 start'); await first.wait; log.push('a1 end'); return 'a1'; });
  const a2 = perWidget('a', async () => { log.push('a2 start'); return 'a2'; });
  const b1 = perWidget('b', async () => { log.push('b1 start'); await other.wait; log.push('b1 end'); return 'b1'; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(log, ['a1 start', 'b1 start'], 'a2 waits for a1; b1 does not');
  other.open(); await b1;
  assert.deepEqual(log, ['a1 start', 'b1 start', 'b1 end']);
  first.open();
  assert.deepEqual(await Promise.all([a1, a2]), ['a1', 'a2']);
  assert.deepEqual(log, ['a1 start', 'b1 start', 'b1 end', 'a1 end', 'a2 start']);
  // A failure is the caller's; the next task on that id still runs.
  await assert.rejects(perWidget('a', async () => { throw new Error('load failed'); }), /load failed/);
  assert.equal(await perWidget('a', async () => 'after'), 'after');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(context.widgetQueues.size, 0, 'idle ids are forgotten');
});
