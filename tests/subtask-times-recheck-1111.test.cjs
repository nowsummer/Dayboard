'use strict';
// The recheck of 2026-11-11 of subtask times and alerts (after 9c3433a), each finding run here as it was found — every test failed on the code
// before its fix. Two PCs reading a step deleted and made again, and a phone's roll seen by two PCs, stand in tests/viewsync.test.cjs; a task put
// under another (nestTask) in tests/subtask-list.test.cjs; the widget's list in the smoke (subtask-time-alert).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const D = require('../renderer/domain.js');
const { validateState, initialState } = require('../lib/store.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { harness, read } = require('./r50-F-harness.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });
const when = x => [x?.dueDate || '', x?.dueTime || '', x?.alert ?? ''].join('|');

test('a step a read no longer has hands its id, never its date, time or alert, to one of its name that arrived — at To Do only', () => {
  const out = [];
  for (const provider of ['microsoft', 'google']) {
    const list = { id: 'l', accountId: 'acc', provider, remoteId: 'rl' };
    const state = { lists: [list], calendars: [], events: [], settings: {}, accounts: [], alertsFired: {},
      tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', completed: false, steps: [step('s1', { remoteId: 'st1', title: '초안', dueDate: '2026-12-20', dueTime: '15:00', alert: 30 }), step('s2', { remoteId: 'st2', title: '표' })] }] };
    // deleted on another PC and made again under its name (or moved there: To Do keeps no order, microsoft.cjs rewriteFrom)
    replaceAccountSnapshot(state, 'acc', { lists: [list], calendars: [], events: [], tasks: [{ id: 'x', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', completed: false,
      steps: [{ id: 'g2', remoteId: 'st2', title: '표', completed: false }, { id: 'fresh', remoteId: 'st9', title: '초안', completed: false }] }] }, provider);
    const got = state.tasks[0].steps.find(x => x.remoteId === 'st9');
    out.push([provider, got.id, when(got)].join(':'));
  }
  // Google moves a step under its own id (google.cjs tasks.move): one of its name under a new id is another step
  assert.equal(out.join(' / '), 'microsoft:s1:|| / google:fresh:||');
});

function moveHarness(tasks) {
  const undos = [];
  const h = harness({ stepTask: id => tasks.find(t => t.id === id), stepHeld: new Map(), stepHolds: (id, fn) => fn(), moveTaskRow() {}, stepsFolded: () => false, foldSteps() {},
    staleUndo: () => new Error('stale'), undoToast: (text, label, undo, redo) => undos.push({ text, undo, redo }) });
  h.context.state.lists = [{ id: 'local-inbox', provider: 'local' }];
  h.context.answer = (name, payload) => {
    if (name === 'task:update' && payload.step) { const t = tasks.find(x => x.id === payload.id); const steps = T.applyStep(t.steps || [], payload.step); if (steps.length) t.steps = steps; else delete t.steps; }
    return {};
  };
  h.loadApp('const listBy=', 'function stepOver(');
  h.undos = undos;
  return h;
}

test('a subtask dragged under a task that holds a step of its id (a move stopped half-way) comes there under a new id, and is not lost', async () => {
  const day = D.dayOffset(D.dateKey(), 2);
  // lib/taskmove.cjs moveCopy keeps the step ids: the copy a stopped move left stands beside its original
  const tasks = [{ id: 'p', listId: 'local-inbox', title: '원본', steps: [step('s', { title: '초안 보내기', dueDate: day, dueTime: '15:00', alert: 30 })] },
    { id: 'q', listId: 'local-inbox', title: '사본', steps: [step('s', { title: '초안 보내기', completed: true })] }];
  const show = () => tasks.map(t => t.id + ':' + (t.steps || []).map(x => x.title + (x.completed ? '✓' : '') + (x.dueTime ? ' ' + x.dueTime : '')).join(',')).join(' ');
  const h = moveHarness(tasks);
  h.eval("stepOver({task:'p',step:'s'},'q',null)"); await h.tick(8);
  assert.equal(show(), 'p: q:초안 보내기✓,초안 보내기 15:00', 'under the other task, its time with it');
  const put = h.calls.find(c => c.name === 'task:update' && c.payload.id === 'q').payload.step;
  assert.equal([put.id !== 's', typeof put.id === 'string' && put.id.length > 8, when(put)].join('|'), `true|true|${day}|15:00|30`);
  await h.undos[0].undo(); await h.tick(8);
  assert.equal(show(), 'p:초안 보내기 15:00 q:초안 보내기✓', '되돌리기: back, the other task\'s own step left as it was');
  // under a task without that id it keeps its own (2026-11-11 review: its alert's record goes by it)
  const plain = [{ id: 'p', listId: 'local-inbox', title: '원본', steps: [step('s', { dueDate: day })] }, { id: 'r', listId: 'local-inbox', title: '다른 일' }];
  const k = moveHarness(plain);
  k.eval("stepOver({task:'p',step:'s'},'r',null)"); await k.tick(8);
  assert.equal(plain[1].steps.map(x => x.id).join(), 's');
});

test('styles: a tasks widget\'s list 360px or narrower puts a chip with a time under its name, the × on the name\'s line, before r60-apple', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  const cut = css.indexOf('/* r60-apple');
  for (const rule of ['.widget-body .widget-tasks .task-steps{container:widget-steps/inline-size}', '@container widget-steps (max-width:360px){', '.widget-body .widget-tasks .task-step.timed{flex-wrap:wrap;',
    '.widget-body .widget-tasks .task-step.timed>.step-remove{order:1}', '.widget-body .widget-tasks .task-step.timed>.step-date{order:2;']) {
    const i = css.indexOf(rule);
    assert.equal(i > 0 && i < cut, true, rule);
  }
  const row = read('renderer/app.js').split(/\r?\n/).find(l => l.startsWith('function stepRow('));
  assert.equal(row.includes("class:'task-step'+(x.completed?' done':'')+(editing?' editing':'')+(D.dueAt(D.stepWhen(x))?' timed':''),'data-step-id':x.id"), true, 'the list\'s row says it has a time');
});

test('a task\'s date and an all-day event\'s day of 2026-02-31 (a file changed by hand) go at load, as a subtask\'s do', () => {
  const state = initialState();
  const base = { listId: 'local-inbox', notes: '', important: false, completed: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
  state.tasks.push({ ...base, id: 't', title: '없는 날', dueDate: '2026-02-31', dueTime: '15:00' }, { ...base, id: 'u', title: '윤날', dueDate: '2024-02-29', dueTime: '15:00' });
  const event = (id, start, end) => ({ id, calendarId: 'local-calendar', provider: 'local', title: id, allDay: true, start, end, location: '', notes: '' });
  state.events.push(event('e1', '2026-02-31', '2026-03-01'), event('e2', '2026-02-27', '2026-02-30'), event('e3', '2026-02-27', '2026-02-28'));
  validateState(state);
  const task = id => state.tasks.find(x => x.id === id);
  assert.equal([task('t').dueDate, task('t').dueTime ?? '', task('u').dueDate, task('u').dueTime].join('|'), '||2024-02-29|15:00', 'its time goes with it');
  assert.equal(state.events.filter(x => x.id.startsWith('e')).map(x => `${x.id}:${x.start}~${x.end}`).join(' '), 'e2:2026-02-27~2026-02-28 e3:2026-02-27~2026-02-28', 'an event on no day goes; an end on no day becomes the day after its start');
});
