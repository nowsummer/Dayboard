'use strict';
// A task moved between any two lists (owner 2026-11-04: 「a라는 목록에 있는 걸 끌어다가 b 목록으로 옮겨서 이동시키거나 혹은 a 목록에 있는
// 항목을 편집을 눌러서 목록을 변경시키는 기능을 넣어줘.」 — 「동기화된 계정에서도 즉각 수정되어야 해」): an account's task to this PC (pull), to
// another account list or To Do → To Do (copy), Google → the same Google account (gmove) — lib/taskmove.cjs and lib/sync.cjs moveTask,
// finishMove, repairMoves — against the real providers over the fake services of tests/taskmove-harness.cjs. The cases are the design's
// §7 (1–15), the critique's ten mandatory changes (M1–M10), the owner's decisions on what is asked once (local, shared, grepeat,
// gtime), the review's findings of the same day (S1, S2, S4, S5, R5), the second review's (B1–B4), the third's (C1–C5), the fourth's (E1–E4) and the final review's (K1, K2, W1, W3, D1–D3, G1) the final check's (H1, H2), the seventh check's (I1) and what came after the eighth (J1: a formatted note is compared whole). Every assert compares primitives (JSON text of plain values) — never a DOM node or a VM object.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store.cjs');
const M = require('../lib/taskmove.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');
const { untilDate, stableId } = require('../lib/providers/common.cjs');
const { parseRRule } = require('../renderer/domain.js');
const { laneOf, LOCAL, REMOTE } = require('../lib/lanes.cjs');
const validate = require('../lib/validate.cjs');
const { setup, GL, GL2, GX, ML, ML2, MX, FLAG, LISTS, HOMES } = require('./taskmove-harness.cjs');

const same = (actual, expected, ...message) => assert.equal(String(JSON.stringify(actual)), String(JSON.stringify(expected)), ...message);
const HERE = 'local-2'; // a list of this PC
// A task at a service, read here as a sync reads it.
async function atGoogle(h, list, fields, children) { const remote = h.svc.seedGoogle(list, fields, children); await h.seeded(); return { remote, task: h.byRemote(remote.id) }; }
async function atTodo(h, list, fields, extra) { const remote = h.svc.seedTodo(list, fields, extra); await h.seeded(); return { remote, task: h.byRemote(remote.id) }; }
const titles = items => items.map(item => item.title ?? item.displayName);
const ids = h => h.store.get().tasks.map(item => item.id);
const unique = h => new Set(ids(h)).size === ids(h).length;
const recordOf = (h, id) => h.store.get().taskMoves.find(item => item.id === id);
const outcomeOf = async run => { try { return await run(); } catch (error) { return { outcome: 'threw', message: error.message }; } };

// ---- 1, 2: to this PC (pull) ----

test('1 pull Google → this PC: asked once; a new id here, nothing of the service, steps without service ids, the flag kept; subtasks deleted before their task; the order and the record gone', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '장보기', notes: '메모', due: '2026-11-09T00:00:00.000Z' }, [{ title: '우유', status: 'completed' }, { title: '빵' }]);
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).important = true; state.settings.taskOrder = { [GL.id]: ['x', task.id, 'y'] }; });
  const before = h.svc.calls.length;
  const asked = await h.sync.moveTask(task.id, HERE);
  same([asked.outcome, asked.warns, asked.lines], ['confirm', ['local', 'gtime'], [M.warnText('local'), M.warnText('gtime')]]);
  same(h.svc.writes(before), [], 'nothing written before the user agrees');
  const children = h.svc.in(GL).filter(item => item.parent).map(item => item.id);
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, HERE, { accept: asked.warns });
  same([result.outcome, result.from, result.route, result.id === task.id], ['moved', GL.id, 'pull', false], 'a new id (critique B1)');
  const moved = h.get(result.id);
  same([moved.listId, moved.title, moved.notes, moved.dueDate, moved.important, moved.completed], [HERE, '장보기', '메모', '2026-11-09', true, false]);
  same(['accountId', 'remoteId', 'syncStatus', '_remoteStatus', 'repeatStart', 'repeatsElsewhere', 'stepsUnknown'].filter(key => key in moved), [], 'nothing of the service');
  same(moved.steps.map(step => [step.id, step.title, step.completed, 'remoteId' in step]), task.steps.map(step => [step.id, step.title, step.completed, false]), 'steps keep this PC\'s ids, without service ids');
  same(h.svc.writes(at), [...children.map(id => `DELETE /tasks/v1/lists/gl1/tasks/${id}`), `DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], 'subtasks first, then the task');
  same([h.svc.in(GL).length, h.get(task.id) === undefined, h.store.get().settings.taskOrder[GL.id], h.store.get().taskMoves.length], [0, true, ['x', 'y'], 0]);
});

test('2 pull To Do → this PC: a numbered repeat ends on the same last day; the reminder and its 「already rang」 stay; the checklist goes with the task', async t => {
  const h = setup(t);
  const recurrence = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-11-02', recurrenceTimeZone: 'UTC' } };
  const due = { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' };
  const { task } = await atTodo(h, ML, { title: '운동', dueDateTime: due, isReminderOn: true, reminderDateTime: due, recurrence }, { steps: [{ displayName: '스트레칭', isChecked: true }] });
  same([task.rrule, task.repeatStart], [microsoft.rruleFromGraph(recurrence), '2026-11-02']);
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).reminderFiredAt = '2026-11-09T00:00:01.000Z'; });
  const result = await h.sync.moveTask(task.id, 'local-inbox', { accept: ['local'] });
  same([result.outcome, result.route], ['moved', 'pull']);
  const moved = h.get(result.id);
  same([moved.rrule, moved.dueDate, moved.reminderAt, moved.reminderFiredAt], [microsoft.countEnded(task.rrule, '2026-11-02'), microsoft.dueDateFrom(due), '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:01.000Z']);
  assert.match(moved.rrule, /UNTIL=20261130/, 'five Mondays from 2 November end on the 30th, wherever the series is');
  same([h.svc.in(ML).length, h.svc.checklist.size, moved.steps.map(step => [step.title, step.completed])], [0, 0, [['스트레칭', true]]]);
});

// ---- 3: to another account list, and To Do → To Do (copy) ----

test('3 copy Google → To Do: asked about the date; made at To Do with the flag as importance, then the original deleted; a new id here', async t => {
  const h = setup(t);
  const { task } = await atGoogle(h, GL, { title: '보고서', notes: '초안', due: '2026-11-10T00:00:00.000Z' });
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).important = true; });
  const asked = await h.sync.moveTask(task.id, ML.id);
  same([asked.outcome, asked.warns], ['confirm', ['grepeat']]);
  const result = await h.sync.moveTask(task.id, ML.id, { accept: ['grepeat'] });
  same([result.outcome, result.route, result.from, result.id === task.id], ['moved', 'copy', GL.id, false]);
  const made = h.svc.in(ML)[0];
  same([made.title, made.body.content, made.importance, made.dueDateTime.dateTime.slice(0, 10)], ['보고서', '초안', 'high', '2026-11-10']);
  const moved = h.get(result.id);
  same([h.svc.in(GL).length, moved.listId, moved.accountId, moved.remoteId, moved.important, h.get(task.id) === undefined, h.store.get().taskMoves.length], [0, ML.id, 'acc-m', made.id, true, true, 0]);
});

test('3 copy To Do → Google: the checklist as subtasks in order with their ticks; To Do\'s importance kept here (Google has none); To Do deletes the task with its checklist', async t => {
  const h = setup(t);
  const { task } = await atTodo(h, ML, { title: '이사', importance: 'high' }, { steps: [{ displayName: '박스', isChecked: true }, { displayName: '테이프' }] });
  const result = await h.sync.moveTask(task.id, GL.id);
  same([result.outcome, result.route], ['moved', 'copy'], 'nothing To Do holds is lost: not asked');
  const parent = h.svc.in(GL).find(item => !item.parent);
  same([parent.title, h.svc.in(GL).filter(item => item.parent === parent.id).map(item => [item.title, item.status])], ['이사', [['박스', 'completed'], ['테이프', 'needsAction']]]);
  const moved = h.get(result.id);
  same([h.svc.in(ML).length, h.svc.checklist.size, moved.important, moved.steps.map(step => step.id)], [0, 0, true, task.steps.map(step => step.id)]);
});

test('a step\'s date goes with its task on every way out (Dayboard alone holds it; 2026-11-08 Codex full review F1)', async t => {
  const h = setup(t);
  const { task } = await atTodo(h, ML, { title: '이사' }, { steps: [{ displayName: '박스' }, { displayName: '테이프' }] });
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).steps[0].dueDate = '2026-11-20'; });
  const dates = id => h.get(id).steps.map(step => step.dueDate || '');
  const copied = await h.sync.moveTask(task.id, GL.id);
  same([copied.outcome, dates(copied.id)], ['moved', ['2026-11-20', '']], 'To Do → Google');
  const asked = await h.sync.moveTask(copied.id, HERE);
  const pulled = await h.sync.moveTask(copied.id, HERE, { accept: asked.warns });
  same([pulled.outcome, dates(pulled.id)], ['moved', ['2026-11-20', '']], 'Google → this PC');
  const step = date => ({ listId: 'l', steps: [{ id: 'a', title: '박스', completed: false, ...(date ? { dueDate: date } : {}) }] });
  same(M.moveFingerprint(step('2026-11-20')) === M.moveFingerprint(step('')), false, 'a date changed during a move is a change');
});

test('3 copy Google → another Google account: made there with its subtasks (never Google\'s own move), then the original\'s subtasks and the original deleted', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '여행' }, [{ title: '여권' }, { title: '충전기', status: 'completed' }]);
  const children = h.svc.in(GL).filter(item => item.parent).map(item => item.id);
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, GX.id);
  same([result.outcome, result.route, h.svc.calls.slice(at).some(call => call.line.endsWith('/move'))], ['moved', 'copy', false]);
  const parent = h.svc.in(GX).find(item => !item.parent);
  same([parent.title, h.svc.in(GX).filter(item => item.parent).map(item => [item.title, item.status])], ['여행', [['여권', 'needsAction'], ['충전기', 'completed']]]);
  same(h.svc.writes(at).filter(line => line.startsWith('DELETE')), [...children.map(id => `DELETE /tasks/v1/lists/gl1/tasks/${id}`), `DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`]);
  same([h.svc.in(GL).length, h.get(result.id).accountId], [0, 'acc-g2']);
});

test('3 copy To Do → To Do in one account: formatted notes, categories, status, start, the repeat and the mail links go as To Do holds them; the due date stays', async t => {
  const h = setup(t);
  const raw = {
    title: '정기 점검', body: { contentType: 'html', content: '<p><b>굵게</b> 메모</p>' }, categories: ['빨강'], status: 'inProgress', importance: 'high',
    startDateTime: { dateTime: '2026-11-01T00:00:00.0000000', timeZone: 'UTC' }, dueDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' },
    recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday' }, range: { type: 'noEnd', startDate: '2026-01-05', recurrenceTimeZone: 'UTC' } },
  };
  const link = { applicationName: 'Outlook', displayName: '메일', externalId: 'mail-1', webUrl: 'https://outlook.live.com/mail/1' };
  const { task } = await atTodo(h, ML, raw, { steps: [{ displayName: '하나' }], links: [link] });
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, ML2.id);
  same([result.outcome, result.route], ['moved', 'copy'], 'nothing is lost within To Do: not asked');
  const sent = h.svc.calls.slice(at).find(call => call.line === 'POST /v1.0/me/todo/lists/ml2/tasks').body;
  same([sent.body, sent.categories, sent.status, sent.startDateTime, sent.importance, sent.recurrence.pattern], [raw.body, raw.categories, raw.status, raw.startDateTime, raw.importance, raw.recurrence.pattern], 'byte-equal');
  same([sent.recurrence.range.startDate, sent.recurrence.range.type, sent.linkedResources], [task.dueDate, 'noEnd', [link]]);
  const made = h.svc.in(ML2)[0];
  same([microsoft.dueDateFrom(made.dueDateTime), task.dueDate, [...h.svc.linked.values()].filter(item => item.task === made.id).map(item => item.webUrl)], [task.dueDate, microsoft.dueDateFrom(raw.dueDateTime), [link.webUrl]], 'To Do takes the due date from the range\'s start: it stays where it was (critique A2)');
  same([h.svc.in(ML).length, titles([...h.svc.checklist.values()])], [0, ['하나']]);
});

test('3 copy To Do → To Do of another account: the mail links are not sent there, and the user was asked about them', async t => {
  const h = setup(t);
  const { task } = await atTodo(h, ML, { title: '메일 답장' }, { links: [{ applicationName: 'Outlook', displayName: '메일', externalId: 'mail-2', webUrl: 'https://outlook.live.com/mail/2' }] });
  const asked = await h.sync.moveTask(task.id, MX.id);
  same([asked.outcome, asked.warns], ['confirm', ['linked']]);
  const at = h.svc.calls.length;
  same((await h.sync.moveTask(task.id, MX.id, { accept: ['linked'] })).outcome, 'moved');
  same('linkedResources' in h.svc.calls.slice(at).find(call => call.line === 'POST /v1.0/me/todo/lists/mx1/tasks').body, false);
});

// ---- 4, 5: Google's own move ----

test('4 gmove: one POST …/move and nothing else written, never asked; the task here keeps its id and flag; Google\'s new id is taken; a repeating task is refused with nothing changed', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '회의 준비', due: '2026-11-12T00:00:00.000Z' });
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).important = true; state.settings.taskOrder = { [GL.id]: [task.id] }; });
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, GL2.id);
  same([result.outcome, result.id, result.from, result.route], ['moved', task.id, GL.id, 'gmove'], 'a dated task within one Google account is not asked about (owner decision 2)');
  same(h.svc.writes(at), [`POST /tasks/v1/lists/gl1/tasks/${remote.id}/move`]);
  same(h.svc.calls.slice(at).find(call => call.line.endsWith('/move')).query.destinationTasklist, 'gl2');
  const moved = h.get(task.id);
  same([moved.listId, moved.remoteId, moved.important, h.store.get().settings.taskOrder[GL.id], h.store.get().taskMoves.length], [GL2.id, remote.id, true, [], 0]);
  h.svc.options.keepsId = false;
  const second = await atGoogle(h, GL, { title: '새 id' });
  same((await h.sync.moveTask(second.task.id, GL2.id)).outcome, 'moved');
  const now = h.get(second.task.id);
  same([now.listId, now.remoteId !== second.remote.id, h.svc.tasks.get(now.remoteId)?.list], [GL2.id, true, 'gl2'], 'the id comes from Google\'s answer');
  h.svc.options.keepsId = true;
  const third = await atGoogle(h, GL, { title: '반복', recurring: true });
  const before = h.svc.calls.length;
  const refused = await h.sync.moveTask(third.task.id, GL2.id);
  same([refused.outcome, h.get(third.task.id).listId, h.svc.tasks.get(third.remote.id).list, h.store.get().taskMoves.length, h.svc.writes(before).length], ['refused', GL.id, 'gl1', 0, 1]);
  assert.match(refused.message, /반복하거나 할당받은 할 일/, 'Google\'s refusal in words that name both (critique C3)');
});

test('4 gmove whose answer never came: `unknown`, not sent again; the next sync settles it by reads alone — moved (switched here), not moved, moved under a new id', async t => {
  const h = setup(t);
  const [a, b, c] = ['가', '나', '다'].map(title => h.svc.seedGoogle(GL, { title }));
  await h.seeded();
  const [ta, tb, tc] = [a, b, c].map(item => h.byRemote(item.id));
  h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(ta.id, GL2.id)).outcome, 'unknown');
  same([h.get(ta.id).listId, recordOf(h, ta.id).phase, recordOf(h, ta.id).route], [GL.id, 'unknown', 'gmove']);
  const at = h.svc.calls.length;
  same([(await h.sync.moveTask(ta.id, GL2.id)).outcome, h.svc.calls.length], ['unknown', at], 'pressed again: nothing sent');
  h.svc.fail(/\/move$/, 'down');
  same((await h.sync.moveTask(tb.id, GL2.id)).outcome, 'unknown');
  h.svc.options.keepsId = false; h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(tc.id, GL2.id)).outcome, 'unknown');
  h.svc.options.keepsId = true;
  const writes = h.svc.calls.length;
  await h.seeded();
  same([h.svc.writes(writes), h.store.get().taskMoves.length], [[], 0], 'the sync only reads, and every record is settled');
  same([h.get(ta.id).listId, h.get(ta.id).remoteId], [GL2.id, a.id], 'moved: switched here under its own id');
  same(h.get(tb.id).listId, GL.id, 'not moved: where it was');
  const renamed = h.svc.in(GL2).find(item => item.title === '다');
  same([h.get(tc.id) === undefined, h.byRemote(renamed.id).listId], [true, GL2.id], 'moved under a new id: shown where Google has it');
});

test('5 subtasks added on the phone since the last sync: the fresh read sends the move the copy way, never Google\'s own move', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '정리' });
  h.svc.tasks.set('gt-phone', { id: 'gt-phone', list: 'gl1', parent: remote.id, title: '휴대폰에서 추가', status: 'needsAction', position: '99999999999999999999' });
  same(task.steps, undefined, 'not known here');
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, GL2.id);
  same([result.outcome, result.route, h.svc.calls.slice(at).some(call => call.line.endsWith('/move'))], ['moved', 'copy', false]);
  same([titles(h.svc.in(GL2)), h.svc.in(GL).length, h.get(result.id).steps.map(step => step.title)], [['정리', '휴대폰에서 추가'], 0, ['휴대폰에서 추가']]);
});

// ---- 6, 7: refused, or asked once ----

test('6 each reason a task stays, in words, with nothing written anywhere', async t => {
  const h = setup(t);
  const listOf = id => h.store.get().lists.find(item => item.id === id);
  const refuses = async (taskId, to, reason) => {
    const from = listOf(h.get(taskId).listId); const at = h.svc.calls.length;
    const result = await outcomeOf(() => h.sync.moveTask(taskId, to));
    same([['refused', 'threw'].includes(result.outcome), result.message], [true, M.reasonText(reason, listOf(to), from)], reason);
    same(h.svc.writes(at), [], `${reason}: nothing written`);
    same(h.get(taskId).listId, from.id, `${reason}: the task stays`);
  };
  const done = h.svc.seedGoogle(GL, { title: '끝', status: 'completed' });
  const flagged = h.svc.seedTodo(FLAG, { title: '메일 플래그' });
  const yearly = { pattern: { type: 'relativeYearly', interval: 1, daysOfWeek: ['monday'], index: 'second', month: 5 }, range: { type: 'noEnd', startDate: '2026-05-11' } };
  const elsewhere = h.svc.seedTodo(ML, { title: '연간', dueDateTime: { dateTime: '2026-05-11T00:00:00.0000000', timeZone: 'UTC' }, recurrence: yearly });
  const counted = h.svc.seedTodo(ML, { title: '연간 셈', dueDateTime: { dateTime: '2026-05-11T00:00:00.0000000', timeZone: 'UTC' }, recurrence: { ...yearly, range: { type: 'numbered', numberOfOccurrences: 3, startDate: '2026-05-11' } } });
  const weekly = h.svc.seedTodo(ML, { title: '주간', dueDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday' }, range: { type: 'noEnd', startDate: '2026-11-09' } } });
  const reminder = h.svc.seedTodo(ML, { title: '알림', isReminderOn: true, reminderDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' } });
  const long = h.svc.seedTodo(ML, { title: '긴 메모', body: { contentType: 'text', content: 'x'.repeat(M.GOOGLE_NOTES_MAX + 1) } });
  const assigned = h.svc.seedGoogle(GL, { title: '할당', assignmentInfo: { surfaceType: 'DOCUMENT' } });
  const files = h.svc.seedTodo(ML, { title: '첨부', hasAttachments: true });
  const many = h.svc.seedGoogle(GL, { title: '많음' }, Array.from({ length: 101 }, (_, index) => ({ title: `단계 ${index}` })));
  const unread = h.svc.seedTodo(ML, { title: '단계 모름' }, { steps: [{ displayName: '하나' }] });
  await h.seeded();
  const local = item => h.byRemote(item.id).id;
  same(h.byRemote(many.id).steps.length, 100, 'a sync keeps 100 of them');
  await refuses(local(done), GL2.id, 'done');
  await refuses(local(flagged), ML.id, 'flagged');
  await refuses(local(elsewhere), HERE, 'elsewhere');
  await refuses(local(elsewhere), GL.id, 'elsewhere');
  await refuses(local(counted), ML2.id, 'elsewhere'); // To Do → To Do: numbered and unreadable (critique A2)
  await refuses(local(weekly), GL.id, 'repeat');
  await refuses(local(reminder), GL.id, 'reminder');
  await refuses(local(long), GL.id, 'notes');
  await refuses(local(assigned), ML.id, 'assigned');
  await refuses(local(assigned), HERE, 'assigned');
  await refuses(local(files), GL.id, 'files');
  await refuses(local(files), HERE, 'files');
  await refuses(local(many), ML.id, 'steps');
  h.svc.options.refuseExpand = true; h.svc.options.refuseChecklist = true;
  await refuses(local(unread), GL.id, 'stepsUnknown');
  h.svc.options.refuseExpand = false; h.svc.options.refuseChecklist = false;
  // A 되돌리기 of this task still to settle, and To Do cannot be read now: it waits (sync.cjs repairUndos).
  h.store.mutate(state => { state.undoRepairs = [{ id: 'u1', accountId: 'acc-m', listId: ML.id, listRemote: 'ml1', remoteId: reminder.id, nextRemote: 'mt-next', at: new Date().toISOString() }]; });
  h.svc.fail(new RegExp(`^GET .*/tasks/${reminder.id}$`), 'down');
  await refuses(local(reminder), HERE, 'undo');
  // An account with tasks off, at either end.
  h.store.mutate(state => { state.undoRepairs = []; state.accounts.find(item => item.id === 'acc-m').syncTasks = false; });
  await refuses(local(weekly), HERE, 'syncoff');
  await refuses(local(many), ML.id, 'syncoff');
});

test('7 what cannot go along is asked once — nothing written until the user agrees, then the move goes through; the lines are the sheet\'s words', async t => {
  const h = setup(t);
  h.svc.addList(ML2, { shared: true });
  const cases = [
    ['local', () => h.svc.seedTodo(ML, { title: '이 PC로' }), HERE],
    ['shared', () => h.svc.seedTodo(ML2, { title: '공유 목록' }), ML.id],
    ['grepeat', () => h.svc.seedGoogle(GL, { title: '날짜', due: '2026-11-20T00:00:00.000Z' }), ML.id],
    ['gtime', () => h.svc.seedGoogle(GL, { title: '날짜와 단계', due: '2026-11-20T00:00:00.000Z' }, [{ title: '하나' }]), GX.id],
    ['links', () => h.svc.seedGoogle(GL, { title: '메일에서', links: [{ type: 'email', description: '메일', link: 'https://mail.google.com/mail/#all/1' }] }), ML.id],
    ['substeps', () => h.svc.seedGoogle(GL, { title: '단계 메모' }, [{ title: '하나', notes: '단계의 메모' }]), ML.id],
    ['rich', () => h.svc.seedTodo(ML, { title: '서식', body: { contentType: 'html', content: '<p><strong>굵게</strong></p>' } }), GL.id],
    ['categories', () => h.svc.seedTodo(ML, { title: '범주', categories: ['파랑'] }), GL.id],
    ['start', () => h.svc.seedTodo(ML, { title: '시작일', startDateTime: { dateTime: '2026-11-01T00:00:00.0000000', timeZone: 'UTC' } }), GL.id],
    ['status', () => h.svc.seedTodo(ML, { title: '진행 중', status: 'waitingOnOthers' }), GL.id],
    ['linked', () => h.svc.seedTodo(ML, { title: '메일 연결' }, { links: [{ applicationName: 'Outlook', displayName: '메일', webUrl: 'https://outlook.live.com/mail/3' }] }), GL.id],
  ];
  const seeded = cases.map(([key, seed, to]) => ({ key, remote: seed(), to }));
  await h.seeded();
  same(h.store.get().lists.find(item => item.id === ML2.id).shared, true, 'To Do\'s isShared is read with the lists');
  for (const { key, remote, to } of seeded) {
    const task = h.byRemote(remote.id); const at = h.svc.calls.length;
    const asked = await h.sync.moveTask(task.id, to);
    same([asked.outcome, asked.warns, asked.lines], ['confirm', key === 'local' ? ['local'] : [key], [M.warnText(key)]], key);
    same([h.svc.writes(at), h.get(task.id).listId], [[], task.listId], `${key}: nothing written`);
    same((await h.sync.moveTask(task.id, to, { accept: asked.warns })).outcome, 'moved', `${key}: agreed, it goes`);
  }
});

test('owner decisions of 2026-11-04: the lines of the sheet for this PC, a shared list and a dated Google task, in the owner\'s words', () => {
  same(['local', 'shared', 'grepeat', 'gtime'].map(M.warnText), ['이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.', '공유된 목록이라 옮기면 공유한 사람들 목록에서도 사라져요.', 'Google에서 정한 반복이나 시각은 옮겨지지 않아요.', 'Google에서 정한 시각은 옮겨지지 않아요.']);
  same(M.WARNS.every(key => M.warnText(key)), true, 'every key has its line');
  const dated = { facts: { dated: true, steps: 0 } };
  same([M.sourceCheck(dated, GL, GL2, 'gmove').warns, M.sourceCheck(dated, GL, GL2, 'copy').warns, M.sourceCheck({ facts: { dated: true, steps: 2 } }, GL, { id: HERE, provider: 'local' }, 'pull').warns], [[], ['grepeat'], ['local', 'gtime']], 'Google\'s own move never asks');
  same(M.sourceCheck({ facts: { links: 1 } }, GL, GL2, 'gmove').warns, [], 'Google\'s own move keeps the links (critique G4)');
});

// ---- 8, 9, 10: when something goes wrong ----

test('8 the copy refused, lost or stopped at a step: the original is never deleted; a resume finishes, then deletes', async t => {
  const h = setup(t);
  const one = h.svc.seedGoogle(GL, { title: '거절' }); const two = h.svc.seedGoogle(GL, { title: '유실' }); const three = h.svc.seedGoogle(GL, { title: '단계' }, [{ title: '가' }, { title: '나' }]);
  await h.seeded();
  const deletes = from => h.svc.writes(from).filter(line => line.startsWith('DELETE'));
  let at = h.svc.calls.length;
  h.svc.fail(/^POST .*\/ml1\/tasks$/, 'refuse');
  same((await h.sync.moveTask(h.byRemote(one.id).id, ML.id)).outcome, 'refused');
  same([deletes(at), h.svc.in(ML).length, h.store.get().taskMoves.length, h.byRemote(one.id).listId], [[], 0, 0, GL.id]);
  at = h.svc.calls.length;
  h.svc.fail(/^POST .*\/ml1\/tasks$/, 'lost');
  const lost = await h.sync.moveTask(h.byRemote(two.id).id, ML.id);
  same([lost.outcome, lost.message, deletes(at), recordOf(h, h.byRemote(two.id).id).phase, recordOf(h, h.byRemote(two.id).id).route], ['unknown', '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.', [], 'unknown', 'copy']);
  at = h.svc.calls.length;
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  const parentTask = h.byRemote(three.id).id;
  same((await h.sync.moveTask(parentTask, ML.id)).outcome, 'partial');
  same([deletes(at), recordOf(h, parentTask).phase, h.svc.in(GL).length], [[], 'made', 5], 'all three originals still there, subtasks too');
  const resumed = await h.sync.moveTask(parentTask, ML.id);
  same([resumed.outcome, h.svc.in(ML).filter(item => item.title === '단계').length, titles([...h.svc.checklist.values()])], ['moved', 1, ['가', '나']], 'the same task, no step twice');
  same([titles(h.svc.in(GL)), deletes(at).length], [['거절', '유실'], 3], 'only the one copied in full went');
});

test('9 the original edited on the phone while the copy was made: kept, nothing deleted; 「원래 목록에서 지우기」 deletes it once this PC shows it; 「둘 다 두기」 keeps both', async t => {
  const h = setup(t);
  const one = h.svc.seedGoogle(GL, { title: '고쳐질 것', notes: '처음' }); const two = h.svc.seedGoogle(GL, { title: '둘 다', notes: '처음' });
  await h.seeded();
  const first = h.byRemote(one.id);
  h.svc.during(() => { h.svc.tasks.get(one.id).notes = '휴대폰에서 고침'; });
  const at = h.svc.calls.length;
  const kept = await h.sync.moveTask(first.id, ML.id);
  same([kept.outcome, kept.why, kept.route, h.svc.writes(at).filter(line => line.startsWith('DELETE'))], ['kept', 'changed', 'copy', []]);
  same([recordOf(h, kept.id).phase, recordOf(h, kept.id).why, h.get(kept.id).listId], ['kept', 'changed', ML.id]);
  await h.seeded();
  const left = h.byRemote(one.id);
  same([left.notes, unique(h), h.store.publicState().taskMoves.find(item => item.id === kept.id).left], ['휴대폰에서 고침', true, left.id], 'the original is back here beside the copy');
  same(M.moveSummary([left], ML2, h.store.get().taskMoves).waiting, [left.id], 'the original waits on the move too');
  const finished = await h.sync.finishMove(left.id);
  same([finished.outcome, finished.id, h.svc.in(GL).filter(item => item.id === one.id).length, h.byRemote(one.id) === undefined, recordOf(h, kept.id)], ['moved', kept.id, 0, true, undefined], 'what this PC showed is what was deleted');
  h.svc.during(() => { h.svc.tasks.get(two.id).title = '휴대폰 제목'; });
  const both = await h.sync.moveTask(h.byRemote(two.id).id, ML.id);
  same(both.outcome, 'kept');
  h.sync.forgetMove(both.id);
  await h.seeded();
  same([h.store.get().taskMoves.length, h.byRemote(two.id).title, h.get(both.id).listId], [0, '휴대폰 제목', ML.id], 'both stay');
});

test('10 the original\'s delete refused: kept; lost: left-unknown — kept over a restart (leaving → left-unknown); the next sync forgets a deleted one and keeps one still there', async t => {
  const h = setup(t);
  const [a, b, c] = ['거절', '유실', '서버 오류'].map(title => h.svc.seedGoogle(GL, { title }));
  await h.seeded();
  h.svc.fail(/^DELETE /, 'refuse');
  const refused = await h.sync.moveTask(h.byRemote(a.id).id, ML.id);
  same([refused.outcome, refused.why, recordOf(h, refused.id).phase], ['kept', 'refused', 'kept']);
  let saved = null;
  h.svc.on(/^DELETE /, () => { saved = createStore(h.directory).get(); });
  h.svc.fail(/^DELETE /, 'lost');
  const lost = await h.sync.moveTask(h.byRemote(b.id).id, ML.id);
  same([lost.outcome, recordOf(h, lost.id).phase, saved.taskMoves.find(item => item.id === lost.id).phase], ['left-unknown', 'left-unknown', 'leaving']);
  const restarted = M.settleMovesAtStart(saved).taskMoves.find(item => item.id === lost.id);
  same([restarted.phase, restarted.route], ['left-unknown', 'copy'], 'a delete under way when Dayboard stopped');
  h.svc.fail(/^DELETE /, 'down');
  const down = await h.sync.moveTask(h.byRemote(c.id).id, ML.id);
  same(down.outcome, 'left-unknown');
  const writes = h.svc.calls.length;
  await h.seeded();
  same(h.svc.writes(writes), [], 'reads only');
  same([recordOf(h, lost.id), recordOf(h, down.id).phase, recordOf(h, down.id).why, recordOf(h, refused.id).phase, unique(h)], [undefined, 'kept', 'unknown', 'kept', true]);
});

// ---- 11: a save at every write point ----

test('11 Dayboard stopped at any write of a move finds every record at the next start, settled, and sends nothing again by itself', async t => {
  const h = setup(t);
  const saves = [];
  const watch = () => h.svc.watch(line => { saves.push({ line, state: createStore(h.directory).get() }); });
  const later = async (save, taskId, to) => {
    const settled = M.settleMovesAtStart(structuredClone(save.state));
    h.store.mutate(state => { state.tasks = settled.tasks; state.taskMoves = settled.taskMoves; });
    const at = h.svc.calls.length;
    const result = await outcomeOf(() => h.sync.moveTask(taskId, to));
    return { phases: settled.taskMoves.map(item => item.phase).join(','), outcome: result.outcome, posts: h.svc.calls.slice(at).filter(call => !call.line.startsWith('GET')).length };
  };
  // A copy with a subtask: the task made, its step made, the original's subtask and the original deleted.
  const copied = h.svc.seedGoogle(GL, { title: '복사' }, [{ title: '하위' }]);
  const pulled = h.svc.seedTodo(ML, { title: '가져오기' });
  const gmoved = h.svc.seedGoogle(GL, { title: '구글 이동' });
  await h.seeded();
  const copyTask = h.byRemote(copied.id).id; const pullTask = h.byRemote(pulled.id).id; const gmoveTask = h.byRemote(gmoved.id).id;
  watch();
  const copy = await h.sync.moveTask(copyTask, ML.id);
  const pull = await h.sync.moveTask(pullTask, HERE, { accept: ['local'] });
  const gmove = await h.sync.moveTask(gmoveTask, GL2.id);
  h.svc.watch(null);
  same([copy.outcome, pull.outcome, gmove.outcome], ['moved', 'moved', 'moved']);
  same(saves.map(save => save.line.split(' ')[0]), ['POST', 'POST', 'DELETE', 'DELETE', 'DELETE', 'POST']);
  const seen = [];
  seen.push(await later(saves[0], copyTask, ML.id)); // the task's create under way
  seen.push(await later(saves[1], copyTask, ML.id)); // its step's create under way
  seen.push(await later(saves[2], copy.id, GL2.id)); // the original's subtask being deleted
  seen.push(await later(saves[3], copy.id, ML.id)); // the original being deleted
  seen.push(await later(saves[4], pull.id, GL.id)); // the pulled one's original being deleted
  seen.push(await later(saves[5], gmoveTask, GL2.id)); // Google's own move under way
  same(seen.map(item => item.phases.split(',').filter(Boolean).pop()), ['unknown', 'unknown', 'left-unknown', 'left-unknown', 'left-unknown', 'unknown']);
  same(seen.map(item => item.outcome), ['unknown', 'unknown', 'waiting', 'moved', 'waiting', 'unknown']);
  same(seen.map(item => item.posts), [0, 0, 0, 0, 0, 0], 'nothing is sent again without the user');
});

// ---- 12, 13: ids and records ----

test('12 two tasks of one id never come about: a moved task has a new id, and a task new to this PC whose place gives an id already held derives a stable other one (Google and To Do)', async t => {
  const h = setup(t);
  // A pull whose delete was refused: the original comes back with the id its place gives; the pulled task has its own.
  const { remote, task } = await atGoogle(h, GL, { title: '거절된 삭제' });
  h.svc.fail(/^DELETE /, 'refuse');
  const pulled = await h.sync.moveTask(task.id, HERE, { accept: ['local'] });
  same(pulled.outcome, 'kept');
  await h.seeded();
  same([h.byRemote(remote.id).id, unique(h), h.get(pulled.id).listId], [task.id, true, HERE]);
  // The backstop: a task of this PC holding the id a sync would give a task new to it (an older move that kept its id).
  const stray = h.svc.seedGoogle(GL, { title: '새로 온 것' });
  const clash = stableId('google', 'acc-g', 'task', `gl1:${stray.id}`);
  h.store.mutate(state => { state.tasks.push({ id: clash, listId: 'local-inbox', title: '이 PC의 것', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }); });
  await h.seeded();
  const derived = h.byRemote(stray.id).id;
  same([derived !== clash, /^m[0-9a-f]{23}$/.test(derived), unique(h), h.get(clash).title], [true, true, true, '이 PC의 것']);
  await h.seeded();
  same(h.byRemote(stray.id).id, derived, 'the same id at the next sync');
  // To Do → To Do in one account, the original kept: both in one read, each its own id.
  const todo = await atTodo(h, ML, { title: '한 계정 안' });
  h.svc.fail(/^DELETE /, 'refuse');
  const copied = await h.sync.moveTask(todo.task.id, ML2.id);
  same(copied.outcome, 'kept');
  await h.seeded();
  same([unique(h), h.byRemote(todo.remote.id).id, h.get(copied.id).listId], [true, todo.task.id, ML2.id]);
  // And the backstop inside one account: a task matched in one list holds the id another list's new task would get.
  const other = h.svc.seedTodo(ML, { title: '같은 계정 새 것' });
  const otherId = stableId('microsoft', 'acc-m', 'task', `ml1:${other.id}`);
  h.store.mutate(state => { const moved = state.tasks.find(item => item.id === copied.id); moved.id = otherId; state.taskMoves = []; });
  await h.seeded();
  same([unique(h), h.get(otherId).listId, h.byRemote(other.id).id !== otherId], [true, ML2.id, true]);
  await h.seeded();
  same(unique(h), true);
});

test('13 records: a pull keeps no account and survives a save and a restart; a bad origin, an unknown phase, a copy without its origin are dropped', t => {
  const h = setup(t);
  const from = { listId: GL.id, accountId: 'acc-g', remoteId: 'gt9', seen: 'abc', facts: '[]', gone: ['gt10'] };
  h.store.mutate(state => {
    state.tasks.push({ id: 'pulled', listId: HERE, title: '가져옴', completed: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
    state.taskMoves = [
      { id: 'pulled', listId: HERE, at: 'x', phase: 'kept', route: 'pull', from, why: 'refused', accept: ['local'], token: 't' },
      { id: 'bad-from', listId: ML.id, accountId: 'acc-m', at: 'x', phase: 'kept', route: 'copy', from: { listId: GL.id, accountId: 'acc-g' } },
      { id: 'bad-phase', listId: ML.id, accountId: 'acc-m', at: 'x', phase: 'later', route: 'copy', from },
      { id: 'no-from', listId: ML.id, accountId: 'acc-m', at: 'x', phase: 'unknown', route: 'copy' },
      { id: 'pull-account', listId: HERE, accountId: 'acc-g', at: 'x', phase: 'kept', route: 'pull', from },
      { id: 'bad-accept', listId: ML.id, accountId: 'acc-m', at: 'x', phase: 'kept', route: 'copy', from, accept: ['everything'] },
    ];
  });
  same(h.store.get().taskMoves.map(item => item.id), ['pulled']);
  const reread = createStore(h.directory).get();
  same([reread.taskMoves.length, reread.taskMoves[0].route, 'accountId' in reread.taskMoves[0], reread.taskMoves[0].from.gone], [1, 'pull', false, ['gt10']]);
  same(M.settleMovesAtStart(reread).taskMoves.map(item => [item.id, item.phase]), [['pulled', 'kept']], 'its list of origin is still here');
  same(M.validMoves([{ id: 'p', listId: HERE, at: 'x', phase: 'sending', route: 'pull', from }]).length, 0, 'a pull is only ever leaving the original');
});

// ---- 14, 15: lanes and disconnect ----

test('14 lanes: a move from an account — to this PC or to another account — and 「원래 목록에서 지우기」 go with the accounts\' writes; the count and 「둘 다 두기」 stay local', async t => {
  const h = setup(t);
  const { task } = await atGoogle(h, GL, { title: '레인' });
  same([laneOf('task:transfer', { id: task.id, to: HERE }, h.store), laneOf('task:transfer', { id: task.id, to: ML.id }, h.store), laneOf('task:transfer', { id: task.id, to: GL2.id }, h.store)], [REMOTE, REMOTE, REMOTE]);
  same([laneOf('task:transfer-finish', { id: task.id }, h.store), laneOf('task:transfer-forget', { id: task.id }, h.store), laneOf('task:transfer-check', { to: HERE, ids: [task.id] }, h.store)], [REMOTE, LOCAL, LOCAL]);
});

test('15 disconnecting an account drops the moves to and from it; the others stay', async t => {
  const h = setup(t);
  const g = h.svc.seedGoogle(GL, { title: '구글에서' }); const m = h.svc.seedTodo(ML, { title: 'To Do에서' }); const o = h.svc.seedTodo(ML2, { title: '다른 To Do로' });
  await h.seeded();
  h.svc.fail(/^DELETE /, 'refuse');
  const fromGoogle = await h.sync.moveTask(h.byRemote(g.id).id, MX.id);
  h.svc.fail(/^DELETE /, 'refuse');
  const fromTodo = await h.sync.moveTask(h.byRemote(m.id).id, HERE, { accept: ['local'] });
  h.svc.fail(/^DELETE /, 'refuse');
  const toOther = await h.sync.moveTask(h.byRemote(o.id).id, MX.id);
  same([fromGoogle.outcome, fromTodo.outcome, toOther.outcome, h.store.get().taskMoves.length], ['kept', 'kept', 'kept', 3]);
  await h.sync.disconnect('acc-g');
  same(h.store.get().taskMoves.map(item => item.id), [fromTodo.id, toOther.id], 'the move from it goes');
  // 2026-11-04 review R5: a move whose source (acc-m) stays connected goes with the account it went to.
  await h.sync.disconnect('acc-m2');
  same(h.store.get().taskMoves.map(item => item.id), [fromTodo.id], 'a move to an account goes with it too, its source still connected');
  await h.sync.disconnect('acc-m');
  same(h.store.get().taskMoves.length, 0);
});

// ---- The critique's mandatory changes ----

test('M1 ids: the copy and the pull switch to a new id, so the original coming back in a sync never shares one with the moved task; every save goes through', async t => {
  const h = setup(t);
  const { remote, task } = await atTodo(h, ML, { title: '돌아올 원본' });
  h.svc.fail(/^DELETE /, 'refuse');
  const result = await h.sync.moveTask(task.id, GL.id);
  same([result.outcome, result.id !== task.id, h.get(task.id) === undefined], ['kept', true, true]);
  await h.seeded(); await h.seeded();
  same([unique(h), h.byRemote(remote.id).id, h.get(result.id).listId, h.store.get().accounts.every(item => item.status === 'connected')], [true, task.id, GL.id, true]);
});

test('M2 steps a failed write left only on this PC go along — to the copy and to this PC — unless one of that name arrived at the service since', async t => {
  const h = setup(t);
  const one = await atTodo(h, ML, { title: '단계 남김' }, { steps: [{ displayName: '보낸 단계' }] });
  h.store.mutate(state => { state.tasks.find(item => item.id === one.task.id).steps.push({ id: 'unsent', title: '안 보낸 단계', completed: false }); });
  const copied = await h.sync.moveTask(one.task.id, GL.id);
  same([copied.outcome, titles(h.svc.in(GL).filter(item => item.parent)), h.get(copied.id).steps.map(step => step.id).includes('unsent')], ['moved', ['보낸 단계', '안 보낸 단계'], true]);
  const two = await atGoogle(h, GL2, { title: '이 PC로 단계' }, [{ title: '이미 있음' }]);
  h.store.mutate(state => { const task = state.tasks.find(item => item.id === two.task.id); task.steps.push({ id: 'arrived', title: '도착함', completed: false }, { id: 'only-here', title: '여기만', completed: false }); });
  h.svc.tasks.set('gt-arrived', { id: 'gt-arrived', list: 'gl2', parent: two.remote.id, title: '도착함', status: 'needsAction', position: '99999999999999999998' });
  const pulled = await h.sync.moveTask(two.task.id, HERE, { accept: ['local'] });
  same([pulled.outcome, h.get(pulled.id).steps.map(step => [step.id === 'arrived' ? 'arrived' : step.id === 'only-here' ? 'only-here' : 'kept', step.title])], ['moved', [['kept', '이미 있음'], ['arrived', '도착함'], ['only-here', '여기만']]], 'the step that arrived keeps the unsent one\'s id; none twice');
});

test('M3 To Do → To Do: a repeat starts on the due date, a numbered one ends on its last day; a numbered repeat Dayboard cannot read stays', async t => {
  const h = setup(t);
  const recurrence = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' }, range: { type: 'numbered', numberOfOccurrences: 50, startDate: '2026-01-05', recurrenceTimeZone: 'UTC' } };
  const { task } = await atTodo(h, ML, { title: '50회', dueDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, recurrence });
  const at = h.svc.calls.length;
  same((await h.sync.moveTask(task.id, ML2.id)).outcome, 'moved');
  const range = h.svc.calls.slice(at).find(call => call.line === 'POST /v1.0/me/todo/lists/ml2/tasks').body.recurrence.range;
  const ended = parseRRule(microsoft.countEnded(task.rrule, '2026-01-05'));
  same([range.type, range.startDate, range.endDate, range.recurrenceTimeZone, 'numberOfOccurrences' in range], ['endDate', task.dueDate, untilDate(ended.until), 'UTC', false]);
  const made = h.svc.in(ML2)[0];
  same([microsoft.dueDateFrom(made.dueDateTime), made.recurrence.range.endDate], [task.dueDate, untilDate(ended.until)], 'still due on its day, ending on the 50th Monday from January, not counting 50 again from November');
});

test('M4 Google\'s own move counts only when its answer\'s selfLink and an exact read put it in the list it went to; a read that does not say where the task is moves nothing', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '어디 있나' });
  h.svc.options.moveStays = true; h.svc.options.getIgnoresList = true;
  const result = await h.sync.moveTask(task.id, GL2.id);
  same([result.outcome, h.get(task.id).listId, recordOf(h, task.id).phase], ['unknown', GL.id, 'unknown'], 'Google left it where it was although it answered');
  await h.seeded();
  same([h.get(task.id).listId, recordOf(h, task.id)], [GL.id, undefined], 'the repair\'s read by the other list\'s path is not taken as there');
  h.svc.options.moveStays = false; h.svc.options.getIgnoresList = false; h.svc.options.noSelfLink = true;
  const at = h.svc.calls.length;
  const unplaced = await h.sync.moveTask(task.id, GL2.id);
  same([unplaced.outcome, h.svc.writes(at), h.svc.tasks.get(remote.id).list], ['failed', [], 'gl1']);
  // Google took the move, and the read that would confirm it is refused (403): unconfirmed, never 「refused」 — the next sync switches it.
  h.svc.options.noSelfLink = false;
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${remote.id}$`), 'forbid');
  const unread = await h.sync.moveTask(task.id, GL2.id);
  same([unread.outcome, recordOf(h, task.id).phase, h.svc.tasks.get(remote.id).list], ['unknown', 'unknown', 'gl2']);
  await h.seeded();
  same([h.get(task.id).listId, recordOf(h, task.id)], [GL2.id, undefined]);
});

test('M5 a pull whose target list was deleted between the read and the switch: nothing switched, nothing deleted at the service', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '갈 곳 없음' });
  h.svc.on(/^GET \/tasks\/v1\/lists\/gl1\/tasks$/, () => h.store.mutate(state => { state.lists = state.lists.filter(item => item.id !== HERE); state.tasks = state.tasks.filter(item => item.listId !== HERE); }));
  const at = h.svc.calls.length;
  const result = await h.sync.moveTask(task.id, HERE, { accept: ['local'] });
  same([result.outcome, h.svc.writes(at), h.get(task.id).listId, h.svc.tasks.has(remote.id), h.store.get().taskMoves.length], ['changed', [], GL.id, true, 0]);
  same(result.message, '옮길 목록이 없어져 원래 목록의 할 일은 그대로 두었어요.', 'what happened, not 「원래 목록의 할 일이 방금 바뀌었어요」 (2026-11-04 third review)');
});

test('M6 「원래 목록에서 지우기」 is safe: not when the moved task is gone, not over what came since (an attachment refuses, a link asks), and over a delete that stopped part-way', async t => {
  const h = setup(t);
  // The moved copy deleted meanwhile: the record goes, the original stays (A5).
  const lone = await atGoogle(h, GL, { title: '혼자 남을 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(lone.task.id, ML.id);
  h.svc.tasks.delete(h.get(kept.id).remoteId);
  let at = h.svc.calls.length;
  same([(await h.sync.finishMove(kept.id)).outcome, h.svc.writes(at), recordOf(h, kept.id), h.svc.tasks.has(lone.remote.id)], ['changed', [], undefined, true]);
  // An attachment added to the To Do original while it was kept: refused, nothing deleted (A4).
  const filed = await atTodo(h, ML, { title: '첨부될 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const keptTodo = await h.sync.moveTask(filed.task.id, GL.id);
  h.svc.tasks.get(filed.remote.id).hasAttachments = true;
  at = h.svc.calls.length;
  const refused = await h.sync.finishMove(keptTodo.id);
  same([refused.outcome, refused.message, h.svc.writes(at), recordOf(h, keptTodo.id).phase], ['refused', '첨부 파일이 생겨 원래 목록의 할 일은 지우지 않았어요.', [], 'kept'], 'in the words of a delete kept — the task is moved already (final review W3)');
  // A link added to the Google original: asked again, then deleted.
  const linked = await atGoogle(h, GL, { title: '링크 생길 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const keptLink = await h.sync.moveTask(linked.task.id, ML.id);
  h.svc.tasks.get(linked.remote.id).links = [{ type: 'email', link: 'https://mail.google.com/mail/#all/9' }];
  await h.seeded();
  const asked = await h.sync.finishMove(keptLink.id);
  same([asked.outcome, asked.warns], ['confirm', ['links']]);
  same([(await h.sync.finishMove(keptLink.id, { accept: ['links'] })).outcome, h.svc.tasks.has(linked.remote.id), recordOf(h, keptLink.id)], ['moved', false, undefined], 'agreed to, the link no longer stops it');
  // A link added to a Google original whose move already asked about links: asked again (it is a new one), and anything else that came
  // unseen still stops the delete.
  const twice = await atGoogle(h, GL, { title: '링크 둘', links: [{ type: 'email', link: 'https://mail.google.com/mail/#all/10' }] });
  h.svc.fail(/^DELETE /, 'refuse');
  const keptTwice = await h.sync.moveTask(twice.task.id, ML.id, { accept: ['links'] });
  same([keptTwice.outcome, recordOf(h, keptTwice.id).accept], ['kept', ['links']]);
  h.svc.tasks.get(twice.remote.id).links.push({ type: 'email', link: 'https://mail.google.com/mail/#all/11' });
  await h.seeded();
  same((await h.sync.finishMove(keptTwice.id)).warns, ['links']);
  h.svc.tasks.get(twice.remote.id).assignmentInfo = { surfaceType: 'SPACE' };
  same((await h.sync.finishMove(keptTwice.id, { accept: ['links'] })).outcome, 'refused', 'assigned since: never deleted from here');
  // Three subtasks, the delete stopped at the second (A3): the one deleted is journaled, the next try deletes the rest.
  const parted = await atGoogle(h, GL, { title: '셋' }, [{ title: '하나' }, { title: '둘' }, { title: '셋째' }]);
  const children = h.svc.in(GL).filter(item => item.parent === parted.remote.id).map(item => item.id);
  h.svc.fail(new RegExp(`^DELETE .*/${children[1]}$`), 'down');
  const stopped = await h.sync.moveTask(parted.task.id, ML.id);
  same([stopped.outcome, recordOf(h, stopped.id).from.gone, h.svc.tasks.has(children[0])], ['left-unknown', [children[0]], false]);
  at = h.svc.calls.length;
  same((await h.sync.finishMove(stopped.id)).outcome, 'moved');
  same([h.svc.writes(at), h.svc.in(GL).filter(item => item.id === parted.remote.id || item.parent === parted.remote.id).length], [[`DELETE /tasks/v1/lists/gl1/tasks/${children[1]}`, `DELETE /tasks/v1/lists/gl1/tasks/${children[2]}`, `DELETE /tasks/v1/lists/gl1/tasks/${parted.remote.id}`], 0]);
});

test('M7 a resumed copy sends the phone\'s edit along, but keeps an original changed since the first try beside it (2026-11-04 review S1), and 다시 보내기 keeps the lines the user agreed to', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '재개' }, [{ title: '하나' }, { title: '둘' }]);
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask(task.id, ML.id)).outcome, 'partial');
  h.svc.tasks.get(remote.id).notes = '휴대폰 메모';
  const resumed = await h.sync.moveTask(task.id, ML.id);
  same([resumed.outcome, resumed.why, h.svc.in(ML)[0].body.content, h.svc.tasks.has(remote.id), recordOf(h, resumed.id).phase], ['kept', 'changed', '휴대폰 메모', true, 'kept'], 'the edit goes along; the original changed since the first try stays for the user (deleted after critique B3, review S1)');
  const dated = await atGoogle(h, GL, { title: '다시 보내기', due: '2026-11-21T00:00:00.000Z' });
  h.svc.fail(/^POST .*\/ml1\/tasks$/, 'lost');
  same((await h.sync.moveTask(dated.task.id, ML.id, { accept: ['grepeat'] })).outcome, 'unknown');
  same(recordOf(h, dated.task.id).accept, ['grepeat']);
  const resent = await h.sync.moveTask(dated.task.id, ML.id, { resend: true });
  same([resent.outcome, h.svc.in(ML).filter(item => item.title === '다시 보내기').length], ['moved', 2], 'not asked again (critique B2); the user chose to send it again after looking');
});

test('M8 the 되돌리기 of Google\'s own move is that move back — never a copy: with subtasks added meanwhile it does not happen', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '되돌리기' });
  same((await h.sync.moveTask(task.id, GL2.id)).route, 'gmove');
  const back = await h.sync.moveTask(task.id, GL.id, { undo: true });
  same([back.outcome, back.route, h.get(task.id).listId], ['moved', 'gmove', GL.id]);
  same((await h.sync.moveTask(task.id, GL2.id, { undo: true })).route, 'gmove', '다시 실행 too');
  h.svc.tasks.set('gt-sub', { id: 'gt-sub', list: 'gl2', parent: remote.id, title: '사이에 생긴 하위', status: 'needsAction', position: '99999999999999999997' });
  const at = h.svc.calls.length;
  const stale = await h.sync.moveTask(task.id, GL.id, { undo: true });
  same([stale.outcome, h.svc.writes(at), h.get(task.id).listId], ['changed', [], GL2.id]);
  same((await h.sync.moveTask(task.id, GL.id)).route, 'copy', 'asked as a move of its own, it goes the copy way');
});

test('M9 a second move of a task whose move is still under way or waiting never makes a second copy', async t => {
  const h = setup(t);
  const one = await atGoogle(h, GL, { title: '두 번 누름' });
  const both = await Promise.all([h.sync.moveTask(one.task.id, ML.id), h.sync.moveTask(one.task.id, ML.id)]);
  same([both.map(item => item.outcome), both[0].id === both[1].id, h.svc.in(ML).length], [['moved', 'moved'], true, 1], 'the second press answers as the first (the task has a new id now)');
  const two = await atGoogle(h, GL, { title: '응답 없음' });
  h.svc.fail(/^POST .*\/ml1\/tasks$/, 'lost');
  same((await h.sync.moveTask(two.task.id, ML.id)).outcome, 'unknown');
  const at = h.svc.calls.length;
  same([(await h.sync.moveTask(two.task.id, MX.id, { resend: true })).outcome, (await h.sync.moveTask(two.task.id, HERE, { accept: ['local'] })).outcome, h.svc.calls.length], ['waiting', 'waiting', at], 'settled first, then moved elsewhere');
  const three = await atGoogle(h, GL, { title: '절반' }, [{ title: '가' }, { title: '나' }]);
  h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask(three.task.id, ML.id)).outcome, 'partial');
  same((await h.sync.moveTask(three.task.id, GX.id)).outcome, 'waiting', 'a copy made for another list waits for the user');
  same(M.moveSummary([h.get(three.task.id)], GX, h.store.get().taskMoves).waiting, [three.task.id]);
});

// 2026-11-09 사용자 결정 (review F41): a copy made there while the task changed here is on record, so moving it again never makes a second one.
test('M9b a copy whose task changed here while on its way stays on record: moving it again carries on with the copy made there', async t => {
  const h = setup(t);
  const { task } = await atTodo(h, ML, { title: '원래 제목' });
  h.svc.during(() => h.store.mutate(state => { state.tasks.find(item => item.id === task.id).title = '고친 제목'; }));
  const first = await h.sync.moveTask(task.id, GL.id);
  same([first.outcome, first.message], ['changed', '옮기는 동안 바뀌어 원래 목록에도 남겨 뒀어요. 다시 옮기면 바뀐 내용만 이어 보내요.']);
  const parents = () => h.svc.in(GL).filter(item => !item.parent);
  same([parents().length, recordOf(h, task.id)?.phase, recordOf(h, task.id)?.route, recordOf(h, task.id)?.remoteId === parents()[0]?.id, h.get(task.id)?.listId], [1, 'made', 'copy', true, ML.id]);
  const again = await h.sync.moveTask(task.id, GL.id);
  same([again.outcome, parents().length, h.svc.in(ML).length, h.store.get().taskMoves.length], ['moved', 1, 0, 0], 'one copy there, the original gone');
  assert.ok(unique(h));
});

test('M10 To Do\'s links to mail that cannot be read count as there: the move asks, even within one account, and sends none', async t => {
  const h = setup(t);
  const { task } = await atTodo(h, ML, { title: '링크 못 읽음' }, { links: [{ applicationName: 'Outlook', webUrl: 'https://outlook.live.com/mail/4' }] });
  h.svc.options.refuseLinked = true;
  const asked = await h.sync.moveTask(task.id, ML2.id);
  same([asked.outcome, asked.warns], ['confirm', ['linked']]);
  const at = h.svc.calls.length;
  same((await h.sync.moveTask(task.id, ML2.id, { accept: ['linked'] })).outcome, 'moved');
  same('linkedResources' in h.svc.calls.slice(at).find(call => call.line === 'POST /v1.0/me/todo/lists/ml2/tasks').body, false);
});

// ---- The review of 2026-11-04 (S1, S2, S4, S5) ----

test('S1 a resumed copy whose original changed since its first try (a category added, the due date moved on the phone) is finished but keeps the original for the user; unchanged, it is deleted as before', async t => {
  const h = setup(t);
  // To Do → To Do with two steps, stopped after the first (a 429 on the second): the task is at ML2, the record `made`.
  const stopped = async title => {
    const { remote, task } = await atTodo(h, ML, { title, dueDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' } }, { steps: [{ displayName: '하나' }, { displayName: '둘' }] });
    h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
    same([(await h.sync.moveTask(task.id, ML2.id)).outcome, recordOf(h, task.id).phase], ['partial', 'made'], title);
    return { remote, task };
  };
  const deletes = from => h.svc.writes(from).filter(line => line.startsWith('DELETE'));
  const tagged = await stopped('범주 생김');
  h.svc.tasks.get(tagged.remote.id).categories = ['파랑'];
  let at = h.svc.calls.length;
  const kept = await h.sync.moveTask(tagged.task.id, ML2.id);
  const copy = h.svc.in(ML2).find(item => item.title === '범주 생김');
  same([kept.outcome, kept.why, kept.message, deletes(at), h.svc.tasks.has(tagged.remote.id), recordOf(h, kept.id).phase, recordOf(h, kept.id).why], ['kept', 'changed', '옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.', [], true, 'kept', 'changed'], 'a category added on the phone: the original stays');
  same([h.get(kept.id).listId, titles([...h.svc.checklist.values()].filter(item => item.task === copy.id))], [ML2.id, ['하나', '둘']], 'the switch and the rest of the steps are done');
  await h.seeded();
  same((await h.sync.finishMove(kept.id)).warns, ['categories'], 'the category the copy does not have is asked before the delete (second review B3)');
  const moved = await stopped('날짜 바뀜');
  h.svc.tasks.get(moved.remote.id).dueDateTime = { dateTime: '2026-11-16T00:00:00.0000000', timeZone: 'UTC' };
  at = h.svc.calls.length;
  const keptToo = await h.sync.moveTask(moved.task.id, ML2.id);
  same([keptToo.outcome, keptToo.why, deletes(at), h.svc.tasks.has(moved.remote.id)], ['kept', 'changed', [], true], 'the due date moved on the phone: the original stays');
  await h.seeded();
  same([(await h.sync.finishMove(keptToo.id)).outcome, h.svc.tasks.has(moved.remote.id)], ['moved', false], 'once this PC shows it, 「원래 목록에서 지우기」 deletes it');
  const plain = await stopped('그대로');
  at = h.svc.calls.length;
  const resumed = await h.sync.moveTask(plain.task.id, ML2.id);
  same([resumed.outcome, deletes(at), h.svc.tasks.has(plain.remote.id), h.svc.in(ML2).filter(item => item.title === '그대로').length], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${plain.remote.id}`], false, 1], 'unchanged: deleted as before, the task made once');
});

test('S2 「원래 목록에서 지우기」: a fact that went away since the move never stops the delete — a category agreed to, then removed on the phone; one added still asks', async t => {
  const h = setup(t);
  const { remote, task } = await atTodo(h, ML, { title: '범주 있음', categories: ['파랑'] });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, GL.id, { accept: ['categories'] });
  same([kept.outcome, kept.why, recordOf(h, kept.id).accept], ['kept', 'refused', ['categories']]);
  h.svc.tasks.get(remote.id).categories = ['파랑', '빨강'];
  await h.seeded();
  let at = h.svc.calls.length;
  const asked = await h.sync.finishMove(kept.id);
  same([asked.outcome, asked.warns, h.svc.writes(at)], ['confirm', ['categories'], []], 'one more category: asked again');
  h.svc.tasks.get(remote.id).categories = [];
  await h.seeded();
  at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], false, undefined], 'none left: nothing can be lost, the original goes');
});

test('S4 a Google subtask title longer than the target holds is never cut by a move: refused to To Do and to this PC, nothing written; another Google account takes it whole', async t => {
  const h = setup(t);
  const long = '가'.repeat(400);
  const { remote, task } = await atGoogle(h, GL, { title: '긴 하위 할 일' }, [{ title: long }, { title: '짧음' }]);
  same(task.steps.map(step => step.title.length), [255, 2], 'a sync shows 255 characters of it, as before');
  for (const to of [ML.id, HERE]) {
    const at = h.svc.calls.length;
    const result = await h.sync.moveTask(task.id, to, { accept: ['local'] });
    same([result.outcome, result.message, h.svc.writes(at), h.get(task.id).listId], ['refused', M.reasonText('stepTitle'), [], GL.id], to);
  }
  same(M.reasonText('stepTitle'), '하위 할 일의 제목이 너무 길어 옮길 수 없어요.');
  const moved = await h.sync.moveTask(task.id, GX.id);
  same([moved.outcome, h.svc.in(GX).filter(item => item.parent).map(item => item.title === long || item.title), h.svc.tasks.has(remote.id)], ['moved', [true, '짧음'], false], 'Google holds 1,024 characters: the whole title goes');
  const edge = await atGoogle(h, GL, { title: '딱 맞음' }, [{ title: 'a'.repeat(255) }]);
  same([(await h.sync.moveTask(edge.task.id, ML.id)).outcome, [...h.svc.checklist.values()].map(item => item.displayName.length)], ['moved', [255]], '255 characters fit To Do');
});

test('S5 되돌리기 right after a move asks nothing about the place, but asks about what was added to the copy since — a category on the phone', async t => {
  const h = setup(t);
  h.add({ id: 'p2', title: '범주 생길 것' });
  const pushed = await h.sync.moveTask('p2', ML.id);
  same([pushed.outcome, pushed.route], ['moved', 'push']);
  h.svc.tasks.get(h.get('p2').remoteId).categories = ['파랑'];
  const at = h.svc.calls.length;
  const asked = await h.sync.moveTask('p2', pushed.from, { undo: true });
  same([asked.outcome, asked.warns, asked.lines, h.svc.writes(at), h.get('p2').listId], ['confirm', ['categories'], [M.warnText('categories')], [], ML.id], 'this PC (local) is not asked again; the category is');
  const back = await h.sync.moveTask('p2', pushed.from, { undo: true, accept: asked.warns });
  same([back.outcome, back.route, h.get(back.id).listId, h.svc.in(ML).length], ['moved', 'pull', 'local-inbox', 0]);
  same([M.PLACE_WARNS, M.PLACE_WARNS.every(key => M.WARNS.includes(key))], [['local', 'shared', 'grepeat', 'gtime'], true]);
});

// ---- The second review of 2026-11-04 (B1–B4) ----

test('B1 Google → another Google account with a subtask title over 255: whole there, here as a sync shows it — its steps save, the next sync shows no change, and its 되돌리기 brings it back whole', async t => {
  const h = setup(t);
  const long = '가'.repeat(400);
  const { task } = await atGoogle(h, GL, { title: '긴 하위 할 일' }, [{ title: long }, { title: '짧음' }]);
  const moved = await h.sync.moveTask(task.id, GX.id);
  same([moved.outcome, moved.route], ['moved', 'copy']);
  const here = h.get(moved.id);
  same([here.steps.map(step => step.title.length), here.steps[0].title === long.slice(0, 255), h.svc.in(GX).filter(item => item.parent).map(item => item.title.length)], [[255, 2], true, [400, 2]], 'the whole title there, 255 characters here');
  // The edit dialog sends every step (main.cjs task:update → lib/validate.cjs taskSteps): none is too long now.
  same(validate.taskSteps(here.steps, here.steps).map(step => [step.id, step.title, Boolean(step.remoteId)]), here.steps.map(step => [step.id, step.title, true]));
  const steps = JSON.stringify(here.steps);
  await h.seeded();
  same(JSON.stringify(h.get(moved.id).steps), steps, 'a sync shows the same steps, so the screen still finds the task as it arrived');
  const back = await h.sync.moveTask(moved.id, moved.from, { undo: true });
  same([back.outcome, back.route, h.get(back.id).listId, h.get(back.id).steps.map(step => step.title.length), h.svc.in(GL).filter(item => item.parent).map(item => item.title === long || item.title), h.svc.in(GX).length], ['moved', 'copy', GL.id, [255, 2], [true, '짧음'], 0], 'back from the copy there with the whole title');
  // A tick here goes as an edit: the title is not sent again, so Google keeps all of it.
  const now = h.get(back.id);
  await h.sync.mutateTask('update', { ...now, steps: validate.taskSteps(now.steps.map((step, at) => ({ ...step, completed: at === 0 })), now.steps), updatedAt: '2026-11-05T00:00:00.000Z' }, GL);
  same(h.svc.in(GL).filter(item => item.parent).map(item => [item.title === long || item.title, item.status]), [[true, 'completed'], ['짧음', 'needsAction']]);
});

test('B2 「원래 목록에서 지우기」 of a Google original with a subtask title over 255 compares it as this PC shows it: the phone edit, once shown here, lets it go', async t => {
  const h = setup(t);
  const long = '나'.repeat(400);
  const { remote, task } = await atGoogle(h, GL, { title: '지울 원본', notes: '처음' }, [{ title: long }]);
  const child = h.svc.in(GL).find(item => item.parent).id;
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, GX.id);
  same([kept.outcome, kept.why, h.svc.tasks.has(remote.id), h.svc.tasks.has(child)], ['kept', 'refused', true, true]);
  h.svc.tasks.get(remote.id).notes = '휴대폰에서 고침';
  await h.seeded();
  same([h.byRemote(remote.id).notes, h.byRemote(remote.id).steps[0].title.length], ['휴대폰에서 고침', 255], 'this PC shows the edit, and 255 characters of the subtask');
  const at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, h.svc.writes(at), h.svc.in(GL).length, recordOf(h, kept.id), h.svc.in(GX).filter(item => item.parent).map(item => item.title.length)], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${child}`, `DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], 0, undefined, [400]]);
});

test('B3 「원래 목록에서 지우기」 asks what grew beside the original that its move never asks about — a category after a resumed To Do → To Do copy — instead of answering changed for good; agreed, the original goes once; one this PC does not show as it is still answers changed', async t => {
  const h = setup(t);
  const { remote, task } = await atTodo(h, ML, { title: '범주 생김' }, { steps: [{ displayName: '하나' }, { displayName: '둘' }] });
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same([(await h.sync.moveTask(task.id, ML2.id)).outcome, recordOf(h, task.id).phase], ['partial', 'made']);
  h.svc.tasks.get(remote.id).categories = ['파랑'];
  const kept = await h.sync.moveTask(task.id, ML2.id);
  same([kept.outcome, kept.why, h.svc.tasks.has(remote.id)], ['kept', 'changed', true]);
  h.svc.tasks.get(remote.id).title = '범주 생김 (휴대폰)';
  let at = h.svc.calls.length;
  const unseen = await h.sync.finishMove(kept.id);
  same([unseen.outcome, unseen.message, h.svc.writes(at)], ['changed', '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.', []], 'the phone edit not shown here yet: changed, as before');
  await h.seeded();
  at = h.svc.calls.length;
  const asked = await h.sync.finishMove(kept.id);
  same([asked.outcome, asked.warns, asked.lines, h.svc.writes(at), recordOf(h, kept.id).phase], ['confirm', ['categories'], [M.warnText('categories')], [], 'kept'], 'asked in the words of a move, nothing written');
  at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id, { accept: asked.warns });
  same([finished.outcome, finished.id, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id), h.get(kept.id).listId], ['moved', kept.id, [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], false, undefined, ML2.id]);
  // Across accounts the move asks about the links: what grew comes in the same sheet as that question (the screen sends back the keys of
  // the last sheet only).
  const linked = await atTodo(h, ML, { title: '링크와 범주' }, { links: [{ applicationName: 'Outlook', webUrl: 'https://outlook.live.com/mail/1' }] });
  h.svc.during(() => { h.svc.tasks.get(linked.remote.id).categories = ['빨강']; h.svc.linked.set('lr-phone', { id: 'lr-phone', task: linked.remote.id, applicationName: 'Outlook', webUrl: 'https://outlook.live.com/mail/2' }); });
  const both = await h.sync.moveTask(linked.task.id, MX.id, { accept: ['linked'] });
  same([both.outcome, both.why], ['kept', 'changed']);
  await h.seeded();
  const sheet = await h.sync.finishMove(both.id);
  same([sheet.outcome, sheet.warns], ['confirm', ['linked', 'categories']]);
  at = h.svc.calls.length;
  same([(await h.sync.finishMove(both.id, { accept: sheet.warns })).outcome, h.svc.writes(at)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${linked.remote.id}`]]);
});

test('B4 an unknown from an account says it in main words, never a service or network error: pressed again, a 다시 보내기 whose check cannot read, a copy gone there, Google own move', async t => {
  const h = setup(t);
  const LOST = '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.';
  const { remote, task } = await atGoogle(h, GL, { title: '응답 없음' }, [{ title: '하나' }, { title: '둘' }]);
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'lost');
  const first = await h.sync.moveTask(task.id, ML.id);
  const made = recordOf(h, task.id).remoteId;
  same([first.outcome, first.message, recordOf(h, task.id).phase, Boolean(made)], ['unknown', LOST, 'unknown', true]);
  let at = h.svc.calls.length;
  same([(await h.sync.moveTask(task.id, ML.id)).message, h.svc.calls.length], [LOST, at], 'pressed again: nothing sent');
  const record = JSON.stringify(recordOf(h, task.id));
  h.svc.fail(new RegExp(`^GET /v1\\.0/me/todo/lists/ml1/tasks/${made}$`), 'down');
  at = h.svc.calls.length;
  const unread = await h.sync.moveTask(task.id, ML.id, { resend: true });
  same([unread.outcome, unread.message, h.svc.writes(at), JSON.stringify(recordOf(h, task.id)) === record], ['unknown', LOST, [], true], 'not the service words (HTTP 503)');
  same([h.get(task.id).listId, h.svc.tasks.has(remote.id), h.svc.in(GL).filter(item => item.parent).length], [GL.id, true, 2], 'and true: the original is still in its list, the task here too');
  h.svc.tasks.delete(made);
  const MISSING = '옮길 목록에서 이전에 만든 할 일을 찾지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.';
  const gone = await h.sync.moveTask(task.id, ML.id, { resend: true });
  same([gone.outcome, gone.message, recordOf(h, task.id).review, h.svc.tasks.has(remote.id)], ['unknown', MISSING, 'missing', true], 'the copy gone there: not 「이 PC의 원본」');
  same((await h.sync.moveTask(task.id, ML.id, { resend: true })).message, MISSING);
  same(M.reviewText('missing', { provider: 'local' }), M.reviewText('missing'), 'from this PC the words stay');
  const own = await atGoogle(h, GL, { title: 'Google 이동' });
  h.svc.fail(/\/move$/, 'lost');
  const GMOVE = 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.';
  same((await h.sync.moveTask(own.task.id, GL2.id)).message, GMOVE);
  at = h.svc.calls.length;
  same([(await h.sync.moveTask(own.task.id, GL2.id)).message, h.svc.calls.length], [GMOVE, at], 'Google may have moved it already: never 「원래 목록의 할 일은 남겨 뒀어요」');
});

// ---- The third review (2026-11-04, C1–C5) ----

// 「할 일」 of one account on or off, as the account screen sets it (main.cjs account:update); the next sync takes its lists off this PC or
// brings them back.
const tasksSync = (h, accountId, on) => h.store.mutate(state => { state.accounts.find(item => item.id === accountId).syncTasks = on; });
const restart = h => h.store.mutate(M.settleMovesAtStart); // what main.cjs does at start
const listed = (h, list) => h.store.get().lists.some(item => item.id === list.id);
const C3_WORDS = '원래 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.';
// A change where this PC does not look: past the 255 characters of a subtask title it shows, or in what a copy carries that it never shows
// (2026-11-04 final review D1).
const UNSHOWN_WORDS = '원래 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.';
// acc-g2 and acc-m2 with the list each always has, so GX or MX deleted at the service is a list really gone (2026-11-04 fourth review E1).
const WITH_HOMES = { lists: [...LISTS, ...HOMES] };

test('C1 a push to an account whose 할 일 sync is off keeps its record over a restart — made and unknown; turned on again, it resumes and the answer that never came still waits; a list really gone still drops it', async t => {
  const h = setup(t, WITH_HOMES);
  h.add({ id: 'p-made', title: '단계 남음', steps: [{ id: 's1', title: '하나', completed: false }, { id: 's2', title: '둘', completed: false }] });
  h.add({ id: 'p-lost', title: '답 없음' });
  h.add({ id: 'p-gone', title: '목록 사라짐', steps: [{ id: 's3', title: '셋', completed: false }, { id: 's4', title: '넷', completed: false }] });
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask('p-made', ML.id)).outcome, 'partial');
  h.svc.fail(/^POST .*\/ml1\/tasks$/, 'lost');
  same((await h.sync.moveTask('p-lost', ML.id)).outcome, 'unknown');
  h.svc.fail(/^POST .*\/gx1\/tasks$/, 'pass'); h.svc.fail(/^POST .*\/gx1\/tasks$/, 'pass'); h.svc.fail(/^POST .*\/gx1\/tasks$/, 'busy'); // the task, its first subtask, then no more
  same((await h.sync.moveTask('p-gone', GX.id)).outcome, 'partial');
  same(['p-made', 'p-lost', 'p-gone'].map(id => recordOf(h, id).phase), ['made', 'unknown', 'made']);
  tasksSync(h, 'acc-m', false);
  h.svc.lists.delete(GX.remoteId); // deleted on the phone, with the copy made there: acc-g2 still syncs its tasks (and keeps its default list)
  await h.seeded();
  same([listed(h, ML), listed(h, GX)], [false, false], 'both lists are off this PC');
  restart(h);
  same(h.store.get().taskMoves.map(item => [item.id, item.phase]), [['p-made', 'made'], ['p-lost', 'unknown']], 'out of sight is not gone; really gone is');
  same(h.store.publicState().taskMoves.map(item => [item.id, item.accountId]), [['p-made', 'acc-m'], ['p-lost', 'acc-m']], 'the screen sees which account to turn on');
  tasksSync(h, 'acc-m', true);
  await h.seeded();
  const at = h.svc.calls.length;
  const waiting = await h.sync.moveTask('p-lost', ML.id);
  same([waiting.outcome, h.svc.calls.length - at, recordOf(h, 'p-lost').phase], ['unknown', 0, 'unknown'], 'never sent again by itself');
  const resumed = await h.sync.moveTask('p-made', ML.id);
  same([resumed.outcome, h.svc.in(ML).filter(item => item.title === '단계 남음').length, titles([...h.svc.checklist.values()]), h.get('p-made').listId, recordOf(h, 'p-made')], ['moved', 1, ['하나', '둘'], ML.id, undefined], 'the same task there, the missing step sent');
  same([h.store.get().tasks.filter(item => item.title === '단계 남음').length, unique(h)], [1, true], 'one task here, no copy beside it');
});

test('C1 a move from an account whose 할 일 sync is off keeps its record over a restart — before its switch, a pull kept, Google\'s own move unanswered; turned on again, each settles through the usual way; a list really gone still drops it', async t => {
  const h = setup(t, WITH_HOMES);
  // Before its switch: a task this PC sent to Google (so its id here is not the one its place gives), copied to To Do with a step to go.
  h.add({ id: 'g-own', title: '구글에서 갈 것', steps: [{ id: 's1', title: '가', completed: false }, { id: 's2', title: '나', completed: false }] });
  same((await h.sync.moveTask('g-own', GL.id)).outcome, 'moved');
  const original = h.get('g-own').remoteId;
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same([(await h.sync.moveTask('g-own', ML.id)).outcome, recordOf(h, 'g-own').phase], ['partial', 'made']);
  // A pull whose delete was refused.
  const pullSource = await atGoogle(h, GL2, { title: '가져온 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const pulled = await h.sync.moveTask(pullSource.task.id, HERE, { accept: ['local'] });
  same([pulled.outcome, pulled.why], ['kept', 'refused']);
  // Really gone: a copy from the other Google account whose list was deleted there (that account still syncs its tasks).
  const elsewhere = await atGoogle(h, GX, { title: '사라질 목록' }, [{ title: '하나' }, { title: '둘' }]);
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask(elsewhere.task.id, MX.id)).outcome, 'partial');
  // Google's own move whose answer never came (its first read, at the sync that turns 할 일 off, fails too).
  const own = await atGoogle(h, GL, { title: 'Google 이동' });
  h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(own.task.id, GL2.id)).outcome, 'unknown');
  tasksSync(h, 'acc-g', false);
  h.svc.lists.delete(GX.remoteId);
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${own.remote.id}$`), 'down');
  await h.seeded(); await h.seeded();
  same([listed(h, GL), listed(h, GL2), h.get('g-own'), recordOf(h, own.task.id)?.phase], [false, false, undefined, 'unknown'], 'its lists off this PC; Google\'s own move still waits for a read');
  const at = h.svc.calls.length;
  same([(await outcomeOf(() => h.sync.finishMove(pulled.id))).message, h.svc.calls.length - at, recordOf(h, pulled.id).phase], [M.reasonText('syncoff'), 0, 'kept'], 'said why, the record kept');
  restart(h);
  same(h.store.get().taskMoves.map(item => item.id).sort(), ['g-own', pulled.id, own.task.id].sort(), 'out of sight is not gone; really gone is');
  same(h.store.publicState().taskMoves.map(item => [item.route, item.accountId, item.fromAccountId]).sort(), [['copy', 'acc-m', 'acc-g'], ['gmove', 'acc-g', 'acc-g'], ['pull', '', 'acc-g']]);
  tasksSync(h, 'acc-g', true);
  await h.seeded();
  same([h.get('g-own')?.remoteId, h.get('g-own')?.listId], [original, GL.id], 'the original back under the id its move knows');
  const resumed = await h.sync.moveTask('g-own', ML.id);
  same([resumed.outcome, resumed.route, h.svc.tasks.has(original), h.svc.in(ML).filter(item => item.title === '구글에서 갈 것').length, titles([...h.svc.checklist.values()]).filter(title => ['가', '나'].includes(title))], ['moved', 'copy', false, 1, ['가', '나']], 'the copy finished, then the original deleted');
  const finished = await h.sync.finishMove(pulled.id);
  same([finished.outcome, h.svc.tasks.has(pullSource.remote.id), h.get(pulled.id).listId, recordOf(h, pulled.id)], ['moved', false, HERE, undefined]);
  await h.seeded();
  same([recordOf(h, own.task.id), h.store.get().tasks.filter(item => item.remoteId === own.remote.id).map(item => item.listId), unique(h)], [undefined, [GL2.id], true], 'Google\'s own move settled by reads: the task where Google has it, once');
});

test('C1 a copy whose target account\'s 할 일 sync is off keeps its record over a restart: 「원래 목록에서 지우기」 says why and keeps it; turned on again, it deletes the original; a list really gone still drops it', async t => {
  const h = setup(t, WITH_HOMES);
  const { remote, task } = await atGoogle(h, GL, { title: 'To Do로 간 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, ML.id);
  same([kept.outcome, kept.why], ['kept', 'refused']);
  const gone = await atGoogle(h, GL, { title: '목록이 지워질 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const keptGone = await h.sync.moveTask(gone.task.id, MX.id);
  same(keptGone.outcome, 'kept');
  tasksSync(h, 'acc-m', false);
  h.svc.lists.delete(MX.remoteId);
  await h.seeded();
  same([h.get(kept.id), listed(h, ML), listed(h, MX), h.get(keptGone.id)], [undefined, false, false, undefined], 'the copies are off this PC');
  let at = h.svc.calls.length;
  same([(await outcomeOf(() => h.sync.finishMove(kept.id))).message, h.svc.writes(at), recordOf(h, kept.id)?.phase], [M.reasonText('syncoff'), [], 'kept'], 'never 「옮긴 할 일을 찾지 못해…」: the record stays');
  restart(h);
  same(h.store.get().taskMoves.map(item => item.id), [kept.id], 'out of sight is not gone; really gone is');
  tasksSync(h, 'acc-m', true);
  await h.seeded();
  same([h.get(kept.id)?.listId, unique(h)], [ML.id, true], 'the copy back under the id its move knows');
  at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id), h.get(kept.id).listId], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], false, undefined, ML.id]);
});

test('C2 the screen sees the account each move goes to and comes from, as state.accounts names them (\'\' for this PC): push, pull, copy and Google\'s own move', async t => {
  const h = setup(t);
  h.add({ id: 'pushed', title: '이 PC에서' });
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'lost');
  same((await h.sync.moveTask('pushed', GL.id)).outcome, 'unknown');
  const fromTodo = await atTodo(h, ML, { title: 'To Do에서' });
  h.svc.fail(/^DELETE /, 'refuse');
  same((await h.sync.moveTask(fromTodo.task.id, HERE, { accept: ['local'] })).outcome, 'kept');
  const fromGoogle = await atGoogle(h, GL, { title: '다른 계정으로' });
  h.svc.fail(/^DELETE /, 'refuse');
  same((await h.sync.moveTask(fromGoogle.task.id, MX.id)).outcome, 'kept');
  const own = await atGoogle(h, GL, { title: 'Google 안에서' });
  h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(own.task.id, GL2.id)).outcome, 'unknown');
  const view = h.store.publicState();
  same(view.taskMoves.map(item => [item.route, item.accountId, item.fromAccountId]), [['push', 'acc-g', ''], ['pull', '', 'acc-m'], ['copy', 'acc-m2', 'acc-g'], ['gmove', 'acc-g', 'acc-g']]);
  const known = new Set(view.accounts.map(item => item.id));
  same(view.taskMoves.flatMap(item => [item.accountId, item.fromAccountId]).filter(Boolean).every(id => known.has(id)), true);
});

test('C3 「원래 목록에서 지우기」 never deletes a changed original whose subtask title is longer than this PC shows unless the part it does not show is as the move read it, nor one whose stored facts cannot be read: the words point to 「둘 다 두기」', async t => {
  const h = setup(t);
  const long = '나'.repeat(400);
  const { remote, task } = await atGoogle(h, GL, { title: '긴 하위 할 일', notes: '처음' }, [{ title: long }]);
  const child = h.svc.in(GL).find(item => item.parent).id;
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, GX.id);
  same([kept.outcome, kept.why], ['kept', 'refused']);
  h.svc.tasks.get(child).title = '나'.repeat(300) + '휴대폰' + '나'.repeat(97); // edited on the phone past what this PC shows
  await h.seeded();
  same(h.byRemote(remote.id).steps[0].title === long.slice(0, 255), true, 'this PC shows the same 255 characters');
  let at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, finished.message, h.svc.writes(at), recordOf(h, kept.id).phase, h.svc.tasks.get(child).title.includes('휴대폰'), h.svc.in(GX).filter(item => item.parent).map(item => item.title === long)], ['changed', UNSHOWN_WORDS, [], 'kept', true, [true]], 'nothing deleted: the phone edit is only in the original, past what this PC shows (final review: said so)');
  same((await h.sync.finishMove(kept.id)).message, UNSHOWN_WORDS, 'the same each time: no retry helps');
  h.sync.forgetMove(kept.id);
  same([h.store.get().taskMoves.length, h.svc.tasks.has(remote.id), h.svc.in(GX).length], [0, true, 2], '「둘 다 두기」 keeps both');
  // An edit within what this PC shows: once a sync shows it here, the part past it is as the move read it — the original goes (B2).
  const front = await atGoogle(h, GL, { title: '앞부분 고침' }, [{ title: long }]);
  const frontChild = h.svc.in(GL).find(item => item.parent === front.remote.id).id;
  h.svc.fail(/^DELETE /, 'refuse');
  const keptFront = await h.sync.moveTask(front.task.id, GX.id);
  same(keptFront.outcome, 'kept');
  h.svc.tasks.get(frontChild).title = '휴대폰' + long.slice(3);
  same((await h.sync.finishMove(keptFront.id)).message, '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.', 'not shown here yet: a sync shows it, so a retry helps');
  await h.seeded();
  at = h.svc.calls.length;
  same([(await h.sync.finishMove(keptFront.id)).outcome, h.svc.writes(at)], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${frontChild}`, `DELETE /tasks/v1/lists/gl1/tasks/${front.remote.id}`]]);
  // Stored facts that cannot be read (only a damaged record has them): nothing can show what came beside the original since.
  const plain = await atGoogle(h, GL, { title: '읽을 수 없는 기록' });
  h.svc.fail(/^DELETE /, 'refuse');
  const keptPlain = await h.sync.moveTask(plain.task.id, ML.id);
  h.store.mutate(state => { state.taskMoves.find(item => item.id === keptPlain.id).from.facts = 'not json'; });
  h.svc.tasks.get(plain.remote.id).notes = '휴대폰에서 고침';
  await h.seeded();
  at = h.svc.calls.length;
  const unreadable = await h.sync.finishMove(keptPlain.id);
  same([unreadable.outcome, unreadable.message, h.svc.writes(at), recordOf(h, keptPlain.id).phase, h.svc.tasks.has(plain.remote.id)], ['changed', C3_WORDS, [], 'kept', true]);
  same(M.faceWhole({ steps: [{ remoteId: 'a', title: long }] }, undefined), false, 'a record kept before tails proves nothing by the face');
});

test('C4 「원래 목록에서 지우기」 asks every question it needs in each sheet: a fact that changes between two sheets never makes the screen\'s three sheets end on a question', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '자꾸 바뀌는 원본' }, [{ title: '하위' }]);
  const child = h.svc.in(GL).find(item => item.parent).id;
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, ML.id);
  same([kept.outcome, kept.why], ['kept', 'refused']);
  await h.seeded();
  h.svc.tasks.get(remote.id).links = [{ type: 'email', link: 'https://mail.google.com/mail/#all/20' }];
  const first = await h.sync.finishMove(kept.id);
  same([first.outcome, first.warns], ['confirm', ['links']]);
  h.svc.tasks.get(child).notes = '휴대폰 메모'; // between the two sheets
  const second = await h.sync.finishMove(kept.id, { accept: first.warns });
  same([second.outcome, second.warns, second.lines], ['confirm', ['links', 'substeps'], [M.warnText('links'), M.warnText('substeps')]], 'the first sheet\'s question again, with the new one');
  const at = h.svc.calls.length;
  const done = await h.sync.finishMove(kept.id, { accept: second.warns });
  same([done.outcome, h.svc.writes(at), recordOf(h, kept.id)], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${child}`, `DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], undefined]);
});

test('C5 a task of this PC deleted from another window while it is pushed: main says the task is gone here and the copy stays there — not 「이 PC에도 남겨 뒀어요」; one edited meanwhile still stays here', async t => {
  const h = setup(t);
  h.add({ id: 'w-del', title: '위젯에서 지울 것' });
  h.svc.during(() => { h.store.mutate(state => { state.tasks = state.tasks.filter(item => item.id !== 'w-del'); }); }); // the widget's task:delete
  const deleted = await h.sync.moveTask('w-del', GL.id);
  same([deleted.outcome, deleted.deleted, deleted.message, h.get('w-del') === undefined, titles(h.svc.in(GL)), h.store.get().taskMoves.length], ['changed', true, '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.', true, ['위젯에서 지울 것'], 0], 'deleted tells the screen the task is gone here (2026-11-04 fourth review E4)');
  await h.seeded();
  same(h.store.get().tasks.filter(item => item.listId === GL.id).map(item => item.title), ['위젯에서 지울 것'], 'the copy shows in the list it went to');
  h.add({ id: 'w-edit', title: '위젯에서 고칠 것' });
  h.svc.during(() => { h.store.mutate(state => { state.tasks.find(item => item.id === 'w-edit').title = '고친 제목'; }); });
  const edited = await h.sync.moveTask('w-edit', GL.id);
  same([edited.outcome, edited.deleted, edited.message, h.get('w-edit').listId, h.get('w-edit').title], ['changed', undefined, '옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요. 다시 옮기면 바뀐 내용만 이어 보내요.', 'local-inbox', '고친 제목'], 'on record since 2026-11-09 (F41)');
});

// ---- The fourth review (2026-11-04, E1–E4) ----

const C5_WORDS = '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.';
const UNKNOWN_DELETED = '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.';
const moveList = h => h.store.get().taskMoves.map(item => [item.id, item.phase]);

test('E1 a push to an account whose 할 일 was turned on again keeps its record over a restart until a sync reads that account — before it and after one that failed; read, the move resumes with no copy beside the original; a list really gone while its account syncs and has another still drops it', async t => {
  const h = setup(t, WITH_HOMES);
  h.add({ id: 'p-made', title: '단계 남음', steps: [{ id: 's1', title: '하나', completed: false }, { id: 's2', title: '둘', completed: false }] });
  h.add({ id: 'p-gone', title: '목록 사라짐', steps: [{ id: 's3', title: '셋', completed: false }, { id: 's4', title: '넷', completed: false }] });
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask('p-made', ML.id)).outcome, 'partial');
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask('p-gone', MX.id)).outcome, 'partial');
  tasksSync(h, 'acc-m', false);
  await h.seeded();
  restart(h);
  same(moveList(h), [['p-made', 'made'], ['p-gone', 'made']], '할 일 off: out of sight');
  tasksSync(h, 'acc-m', true);
  restart(h); // Dayboard closed before the sync that reads acc-m again
  same([listed(h, ML), moveList(h)], [false, [['p-made', 'made'], ['p-gone', 'made']]], 'on, not read yet: still out of sight, not gone');
  h.svc.lists.delete(MX.remoteId); // deleted on the phone, with the copy made there: acc-m2 keeps its Tasks list and syncs
  h.svc.fail(/^GET \/v1\.0\/me\/todo\/lists$/, 'down'); // the sync that would read acc-m fails (offline)
  same((await outcomeOf(() => h.seeded())).outcome, 'threw');
  same([listed(h, ML), listed(h, MX)], [false, false]);
  restart(h);
  same(moveList(h), [['p-made', 'made']], 'a failed sync read nothing: still out of sight; a list really gone is gone');
  same(h.store.publicState().taskMoves.map(item => [item.id, item.accountId]), [['p-made', 'acc-m']]);
  await h.seeded();
  same([listed(h, ML), recordOf(h, 'p-made')?.phase], [true, 'made'], 'read at last: the move waits for the user as before');
  const resumed = await h.sync.moveTask('p-made', ML.id);
  const there = h.svc.in(ML).filter(item => item.title === '단계 남음');
  same([resumed.outcome, there.length, titles([...h.svc.checklist.values()].filter(item => item.task === there[0]?.id)), h.get('p-made').listId, recordOf(h, 'p-made')], ['moved', 1, ['하나', '둘'], ML.id, undefined], 'the same task there, the missing step sent');
  same([h.store.get().tasks.filter(item => item.title === '단계 남음').length, unique(h)], [1, true], 'one task here, no copy beside it');
});

test('E1 moves from an account whose 할 일 was turned on again keep their records over a restart until a sync reads it — a pull and a copy kept, Google\'s own move unanswered; 「원래 목록에서 지우기」 meanwhile keeps them too; read, each settles the usual way, once', async t => {
  const h = setup(t, WITH_HOMES);
  const pullSource = await atGoogle(h, GL2, { title: '가져온 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const pulled = await h.sync.moveTask(pullSource.task.id, HERE, { accept: ['local'] });
  const copySource = await atGoogle(h, GL, { title: 'To Do로 간 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const copied = await h.sync.moveTask(copySource.task.id, ML.id);
  const own = await atGoogle(h, GL, { title: 'Google 이동' });
  h.svc.fail(/\/move$/, 'lost');
  same([pulled.outcome, copied.outcome, (await h.sync.moveTask(own.task.id, GL2.id)).outcome], ['kept', 'kept', 'unknown']);
  const all = [pulled.id, copied.id, own.task.id].sort();
  const records = () => h.store.get().taskMoves.map(item => item.id).sort();
  tasksSync(h, 'acc-g', false);
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${own.remote.id}$`), 'down'); // Google's own move is not settled by the sync that turns 할 일 off
  await h.seeded(); await h.seeded();
  restart(h);
  same(records(), all, '할 일 off: out of sight');
  tasksSync(h, 'acc-g', true);
  restart(h); // Dayboard closed before the sync that reads acc-g again
  same([listed(h, GL), records()], [false, all], 'on, not read yet: still out of sight, not gone');
  h.svc.fail(/^GET \/tasks\/v1\/users\/@me\/lists$/, 'down'); // that sync fails (offline)
  same((await outcomeOf(() => h.seeded())).outcome, 'threw');
  restart(h);
  same([listed(h, GL), records()], [false, all], 'a failed sync read nothing');
  const at = h.svc.calls.length;
  const early = await h.sync.finishMove(pulled.id);
  same([early.outcome, early.message, h.svc.calls.length - at, records()], ['gone', '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.', 0, all], 'before the read: said so, nothing asked of the service, the record kept');
  await h.seeded();
  same([listed(h, GL), records()], [true, all], 'read: each waits for the user as before');
  const finishedPull = await h.sync.finishMove(pulled.id);
  const finishedCopy = await h.sync.finishMove(copied.id);
  same([finishedPull.outcome, finishedCopy.outcome, h.svc.tasks.has(pullSource.remote.id), h.svc.tasks.has(copySource.remote.id)], ['moved', 'moved', false, false], 'both originals deleted');
  await h.seeded();
  same([records(), h.store.get().tasks.filter(item => item.remoteId === own.remote.id).map(item => item.listId)], [[], [GL2.id]], 'Google\'s own move settled by reads: the task where Google has it');
  same([['가져온 것', 'To Do로 간 것', 'Google 이동'].map(title => h.store.get().tasks.filter(item => item.title === title).length), unique(h)], [[1, 1, 1], true], 'no copy beside an original');
});

test('E1 「원래 목록에서 지우기」 of a copy whose target account was turned on again but not read since says so and keeps the move — never 「옮긴 할 일을 찾지 못해…」; read at last, it deletes the original', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: 'To Do로 간 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, ML.id);
  same([kept.outcome, kept.why], ['kept', 'refused']);
  tasksSync(h, 'acc-m', false);
  await h.seeded();
  tasksSync(h, 'acc-m', true);
  let at = h.svc.calls.length;
  const early = await outcomeOf(() => h.sync.finishMove(kept.id));
  same([early.outcome, early.message, h.svc.calls.length - at, recordOf(h, kept.id)?.phase], ['threw', '옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.', 0, 'kept'], 'nothing asked of the service, the record kept');
  restart(h);
  same(recordOf(h, kept.id)?.phase, 'kept');
  await h.seeded();
  same([h.get(kept.id)?.listId, unique(h)], [ML.id, true], 'the copy back under the id its move knows');
  at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id), h.store.get().tasks.filter(item => item.title === 'To Do로 간 것').length], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], false, undefined, 1]);
});

test('E1 Google\'s own move whose two lists were both deleted at Google while its account syncs and has another list: nothing is left to settle, so a sync drops it — only an account with no list here at all waits', async t => {
  const GL3 = { id: stableId('google', 'acc-g', 'list', 'gl3'), remoteId: 'gl3', accountId: 'acc-g', provider: 'google', name: '기본', kind: 'none' };
  const h = setup(t, { lists: [...LISTS, GL3] });
  const own = await atGoogle(h, GL, { title: 'Google 이동' });
  h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(own.task.id, GL2.id)).outcome, 'unknown');
  h.svc.lists.delete(GL.remoteId); h.svc.lists.delete(GL2.remoteId);
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${own.remote.id}$`), 'down'); // the sync that takes both lists off reads nothing for it
  await h.seeded();
  same([listed(h, GL), listed(h, GL2), listed(h, GL3), recordOf(h, own.task.id)?.phase], [false, false, true, 'unknown']);
  await h.seeded();
  same([recordOf(h, own.task.id), unique(h)], [undefined, true], 'the next sync drops it');
});

test('E2 a delete that stopped after one of two subtasks longer than this PC shows keeps what it does not show of the one left: a notes edit on the phone, once shown here, lets 「원래 목록에서 지우기」 delete the rest', async t => {
  const h = setup(t);
  const first = '가'.repeat(400); const second = '나'.repeat(400);
  const { remote, task } = await atGoogle(h, GL, { title: '긴 하위 할 일 둘', notes: '처음' }, [{ title: first }, { title: second }]);
  const [one, two] = h.svc.in(GL).filter(item => item.parent === remote.id).sort((a, b) => a.position.localeCompare(b.position)).map(item => item.id);
  h.svc.fail(/^DELETE /, 'pass'); h.svc.fail(/^DELETE /, 'refuse'); // the first subtask goes, the second is refused
  const kept = await h.sync.moveTask(task.id, GX.id);
  same([kept.outcome, kept.why, h.svc.tasks.has(one), h.svc.tasks.has(two), recordOf(h, kept.id).from.gone], ['kept', 'refused', false, true, [one]]);
  same(recordOf(h, kept.id).from.tails, M.tailsOf({ steps: [{ remoteId: two, title: second }] }), 'what this PC does not show, of the subtask left');
  h.svc.tasks.get(remote.id).notes = '휴대폰에서 고침';
  await h.seeded();
  const at = h.svc.calls.length;
  const finished = await h.sync.finishMove(kept.id);
  same([finished.outcome, h.svc.writes(at), recordOf(h, kept.id)], ['moved', [`DELETE /tasks/v1/lists/gl1/tasks/${two}`, `DELETE /tasks/v1/lists/gl1/tasks/${remote.id}`], undefined], 'never 「…다 비교할 수 없어…」: the part not shown is as the move read it');
  same(h.svc.in(GX).filter(item => item.parent).map(item => item.title.length), [400, 400], 'the copy has both subtasks whole');
});

test('E3 a push whose task here is deleted while its request is out keeps no record when the request stops part-way or gets no answer: changed + deleted when the task made there stays, unknown + deleted when that is not known (fifth review), and words that are true there', async t => {
  const h = setup(t);
  const deleteHere = id => () => { h.store.mutate(state => { state.tasks = state.tasks.filter(item => item.id !== id); }); }; // a widget's task:delete
  // Stopped part-way: the task is made at To Do, its second step is not.
  h.add({ id: 'w-part', title: '단계 남음', steps: [{ id: 's1', title: '하나', completed: false }, { id: 's2', title: '둘', completed: false }] });
  h.svc.during(deleteHere('w-part'));
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  const part = await h.sync.moveTask('w-part', ML.id);
  same([part.outcome, part.deleted, part.message, h.get('w-part'), h.store.get().taskMoves.length], ['changed', true, C5_WORDS, undefined, 0]);
  // Carrying on with a task made before, deleted here while the rest goes and that gets no answer: no record either.
  h.add({ id: 'w-made', title: '이어 보낼 것', steps: [{ id: 's3', title: '셋', completed: false }, { id: 's4', title: '넷', completed: false }] });
  h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
  same((await h.sync.moveTask('w-made', ML.id)).outcome, 'partial');
  h.svc.during(deleteHere('w-made'));
  h.svc.fail(/checklistItems$/, 'lost');
  const resumed = await h.sync.moveTask('w-made', ML.id);
  same([resumed.outcome, resumed.deleted, resumed.message, h.get('w-made'), h.store.get().taskMoves.length], ['changed', true, C5_WORDS, undefined, 0]);
  // No answer to the task itself: made after all, or not made.
  h.add({ id: 'w-lost', title: '답 없음' });
  h.svc.during(deleteHere('w-lost'));
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'lost');
  const lost = await h.sync.moveTask('w-lost', GL.id);
  h.add({ id: 'w-down', title: '서비스 멈춤' });
  h.svc.during(deleteHere('w-down'));
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'down');
  const down = await h.sync.moveTask('w-down', GL.id);
  same([lost.outcome, lost.deleted, lost.message, down.outcome, down.deleted, down.message, h.store.get().taskMoves.length], ['unknown', true, UNKNOWN_DELETED, 'unknown', true, UNKNOWN_DELETED, 0], 'what is there is not known: the screen does not count it as made there');
  await h.seeded();
  same([titles(h.store.get().tasks.filter(item => item.listId === GL.id)), h.store.get().tasks.filter(item => item.listId === ML.id).map(item => [item.title, titles(item.steps || [])]).sort()], [['답 없음'], [['단계 남음', ['하나']], ['이어 보낼 것', ['셋', '넷']]]], 'the next sync shows what the accounts have: the tasks made there, and whether the one without an answer was made');
  same([['w-part', 'w-made', 'w-lost', 'w-down'].map(id => h.get(id) === undefined), unique(h)], [[true, true, true, true], true], 'nothing comes back here');
  // Refused: nothing was made there, and the service's words say so.
  h.add({ id: 'w-refused', title: '거절됨' });
  h.svc.during(deleteHere('w-refused'));
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'refuse');
  const refused = await h.sync.moveTask('w-refused', GL.id);
  same([refused.outcome, refused.deleted, refused.message, h.store.get().taskMoves.length, h.svc.in(GL).some(item => item.title === '거절됨')], ['refused', true, 'Bad request (HTTP 400)', 0, false], 'deleted too: the screen counts it gone from here, not still here (final review K1)');
  h.add({ id: 'w-refused-here', title: '거절, 여기 남음' });
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'busy');
  const throttled = await h.sync.moveTask('w-refused-here', GL.id);
  same([throttled.outcome, throttled.deleted, h.get('w-refused-here').listId], ['refused', undefined, 'local-inbox'], 'still here: no `deleted`');
  // Still here, the answers are as before.
  h.add({ id: 'w-stays', title: '여기 남음' });
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'down');
  const stays = await h.sync.moveTask('w-stays', GL.id);
  same([stays.outcome, stays.deleted, recordOf(h, 'w-stays')?.phase], ['unknown', undefined, 'unknown']);
});

test('fifth review: a push carried on whose task here is deleted while its read or its write is out keeps no record and sends nothing more — changed + deleted when the task made there is known to stay, unknown + deleted when it is not', async t => {
  const h = setup(t);
  const deleteHere = id => () => { h.store.mutate(state => { state.tasks = state.tasks.filter(item => item.id !== id); }); }; // a widget's task:delete
  // A push to To Do stopped part-way: the task is made there with its first step, the record is 'made'.
  const madeOf = async id => {
    h.add({ id, title: id, steps: [{ id: `${id}-1`, title: '하나', completed: false }, { id: `${id}-2`, title: '둘', completed: false }] });
    h.svc.fail(/checklistItems$/, 'pass'); h.svc.fail(/checklistItems$/, 'busy');
    same((await h.sync.moveTask(id, ML.id)).outcome, 'partial');
    return recordOf(h, id).remoteId;
  };
  const read = remoteId => new RegExp(`^GET /v1\\.0/me/todo/lists/${ML.remoteId}/tasks/${remoteId}$`);
  const after = (id, answer, at) => [answer.outcome, answer.deleted, answer.message, h.get(id), recordOf(h, id), h.svc.writes(at)];

  // The read of the task made there fails, and the task here is deleted meanwhile: what is there is not known.
  const down = await madeOf('r-down');
  h.svc.on(read(down), deleteHere('r-down')); h.svc.fail(read(down), 'down');
  let at = h.svc.calls.length;
  same(after('r-down', await h.sync.moveTask('r-down', ML.id), at), ['unknown', true, UNKNOWN_DELETED, undefined, undefined, []]);

  // The read finds the task made there, and the task here is deleted meanwhile: it stays there, nothing more is sent to it.
  const there = await madeOf('r-there');
  h.svc.on(read(there), deleteHere('r-there'));
  at = h.svc.calls.length;
  same(after('r-there', await h.sync.moveTask('r-there', ML.id), at), ['changed', true, C5_WORDS, undefined, undefined, []]);
  same(h.svc.in(ML).filter(item => item.title === 'r-there').length, 1, 'the task made there stays');

  // The task made there was deleted at To Do, and the task here is deleted while that read is out.
  const missing = await madeOf('r-missing');
  h.svc.tasks.delete(missing);
  h.svc.on(read(missing), deleteHere('r-missing'));
  at = h.svc.calls.length;
  same(after('r-missing', await h.sync.moveTask('r-missing', ML.id), at), ['unknown', true, UNKNOWN_DELETED, undefined, undefined, []]);

  // The read finds it, the rest is sent, To Do answers the write gone (deleted there meanwhile), and the task here is deleted meanwhile.
  await madeOf('r-gone');
  h.svc.during(deleteHere('r-gone')); h.svc.fail(/checklistItems$/, 'gone');
  const gone = await h.sync.moveTask('r-gone', ML.id);
  same([gone.outcome, gone.deleted, gone.message, h.get('r-gone'), recordOf(h, 'r-gone')], ['unknown', true, UNKNOWN_DELETED, undefined, undefined], 'not 「…남아 있어요」: the copy there answered gone');
  same(h.store.get().taskMoves.length, 0, 'no record is left for any of them');
});

// ---- What the screen sees ----

test('the screen\'s view of a move: its route, phase (sending its own), the list it came from, the original shown here and why it was kept; the count names the reason in words', async t => {
  const h = setup(t);
  const { task } = await atGoogle(h, GL, { title: '보이는 것' });
  let during = null;
  h.svc.during(() => { during = h.store.publicState().taskMoves; });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, ML.id);
  same(during, [{ id: task.id, listId: ML.id, accountId: 'acc-m', fromAccountId: 'acc-g', route: 'copy', phase: 'sending', from: GL.id }], 'nothing is offered while the request is out');
  await h.seeded();
  same(h.store.publicState().taskMoves, [{ id: kept.id, listId: ML.id, accountId: 'acc-m', fromAccountId: 'acc-g', route: 'copy', phase: 'kept', from: GL.id, left: task.id, why: 'refused' }]);
  const listOf = id => h.store.get().lists.find(item => item.id === id);
  const reminder = await atTodo(h, ML2, { title: '알림 있음', isReminderOn: true, reminderDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' } });
  const summary = M.moveSummary([h.get(reminder.task.id)], GL, h.store.get().taskMoves, listOf);
  same([summary.skipped, summary.why.reminder], [{ reminder: 1 }, 'Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.'], 'from an account it stays in its own list');
  same(M.moveSummary([h.get(reminder.task.id)], { id: HERE, provider: 'local' }, [], listOf).movable, [reminder.task.id], 'to this PC it may go (asked first)');
});

// ---- Settling, undoing and leaving things as they are ----

test('E2 / final review D2: a Google move whose answer never came and whose repair could not read, then a sync that reads the task where Google put it under its own id: the task here keeps its id and its flag (this PC\'s only), and the move is settled; one Google gave a new id is not guessed — it shows as a new task and the next repair forgets the move', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '읽기 실패' });
  h.store.mutate(state => { state.tasks.find(item => item.id === task.id).important = true; state.settings.taskOrder = { [GL.id]: ['x', task.id] }; });
  h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(task.id, GL2.id)).outcome, 'unknown');
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${remote.id}$`), 'down');
  let writes = h.svc.calls.length;
  await h.seeded();
  const moved = h.byRemote(remote.id);
  same([moved.id, moved.listId, moved.important, moved.createdAt, recordOf(h, task.id), h.store.get().settings.taskOrder[GL.id], h.svc.writes(writes), unique(h)], [task.id, GL2.id, true, task.createdAt, undefined, ['x'], [], true], 'the read failed; the snapshot shows it where Google put it: the same task here, as Google\'s answer would have left it');
  writes = h.svc.calls.length;
  await h.seeded();
  same([h.store.get().taskMoves.length, h.get(task.id).listId, h.get(task.id).important, h.svc.writes(writes), unique(h)], [0, GL2.id, true, [], true], 'nothing left to settle');
  // Google gave the moved task a new id: nothing says it is the same one (a title proves nothing), so it shows as a new task.
  const other = await atGoogle(h, GL, { title: '새 id로 옮겨짐' });
  h.store.mutate(state => { state.tasks.find(item => item.id === other.task.id).important = true; });
  h.svc.options.keepsId = false; h.svc.fail(/\/move$/, 'lost');
  same((await h.sync.moveTask(other.task.id, GL2.id)).outcome, 'unknown');
  h.svc.options.keepsId = true;
  h.svc.fail(new RegExp(`^GET /tasks/v1/lists/gl2/tasks/${other.remote.id}$`), 'down');
  await h.seeded();
  const renamed = h.svc.in(GL2).find(item => item.title === '새 id로 옮겨짐');
  same([recordOf(h, other.task.id).phase, h.get(other.task.id) === undefined, h.byRemote(renamed.id).listId, h.byRemote(renamed.id).important], ['unknown', true, GL2.id, false], 'shown where Google has it; the move waits for its own read');
  await h.seeded();
  same([recordOf(h, other.task.id), unique(h)], [undefined, true], 'the next repair finds nothing under the old id and only forgets');
});

test('되돌리기 of each kind of move is the move back by the same safe way (owner 2026-11-04 「Apple처럼」): a pull back by a push, a push back by a pull that asks nothing (it only puts back what the move just made — 2026-11-04), a copy back by a copy', async t => {
  const h = setup(t);
  const a = await atGoogle(h, GL, { title: '되돌릴 가져오기' });
  const pulled = await h.sync.moveTask(a.task.id, HERE, { accept: ['local'] });
  const back = await h.sync.moveTask(pulled.id, pulled.from, { undo: true });
  same([back.outcome, back.route, back.id, h.get(pulled.id).listId, titles(h.svc.in(GL))], ['moved', 'push', pulled.id, GL.id, ['되돌릴 가져오기']]);
  h.add({ id: 'p1', title: '되돌릴 보내기' });
  const pushed = await h.sync.moveTask('p1', GL.id);
  const undone = await h.sync.moveTask('p1', pushed.from, { undo: true });
  same([undone.outcome, undone.route, h.get(undone.id).listId, titles(h.svc.in(GL))], ['moved', 'pull', 'local-inbox', ['되돌릴 가져오기']], 'no sheet: the copy it takes back was made by that move');
  // The same move to this PC that is not that 되돌리기 asks as any move to this PC does.
  const again = await h.sync.moveTask(undone.id, GL.id);
  const plain = await h.sync.moveTask(again.id, 'local-inbox');
  same([plain.outcome, plain.warns], ['confirm', ['local']]);
  same([(await h.sync.moveTask(again.id, 'local-inbox', { accept: ['local'] })).outcome, titles(h.svc.in(GL))], ['moved', ['되돌릴 가져오기']]);
  const c = await atTodo(h, ML, { title: '되돌릴 복사' });
  const copied = await h.sync.moveTask(c.task.id, GL.id);
  const returned = await h.sync.moveTask(copied.id, copied.from, { undo: true });
  same([returned.outcome, returned.route, h.get(returned.id).listId, titles(h.svc.in(GL)), titles(h.svc.in(ML))], ['moved', 'copy', ML.id, ['되돌릴 가져오기'], ['되돌릴 복사']]);
  // Moved on since (here between this PC's lists): its 되돌리기 leaves it as it is, nothing read or written.
  const d = await atGoogle(h, GL2, { title: '옮겨 간 뒤' });
  const away = await h.sync.moveTask(d.task.id, HERE, { accept: ['local'] });
  h.store.mutate(state => { state.tasks.find(item => item.id === away.id).listId = 'local-inbox'; });
  const at = h.svc.calls.length;
  same([(await h.sync.moveTask(away.id, away.from, { undo: true })).outcome, h.svc.calls.length, h.get(away.id).listId], ['changed', at, 'local-inbox']);
});

test('a pulled task kept beside its original follows this PC\'s lists (critique E1), and 「원래 목록에서 지우기」 deletes the original from there', async t => {
  const h = setup(t);
  const { remote, task } = await atTodo(h, ML, { title: '옮겨 다닐 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const pulled = await h.sync.moveTask(task.id, HERE, { accept: ['local'] });
  same([pulled.outcome, recordOf(h, pulled.id).route, 'accountId' in recordOf(h, pulled.id)], ['kept', 'pull', false]);
  h.store.mutate(state => { state.tasks.find(item => item.id === pulled.id).listId = 'local-inbox'; });
  const settled = M.settleMovesAtStart(h.store.get());
  same(settled.taskMoves.map(item => [item.id, item.listId, item.phase]), [[pulled.id, 'local-inbox', 'kept']], 'kept, and the record follows the task');
  h.store.mutate(state => { state.taskMoves = settled.taskMoves; });
  const at = h.svc.calls.length;
  const finished = await h.sync.finishMove(pulled.id);
  same([finished.outcome, finished.route, h.svc.writes(at), h.svc.tasks.has(remote.id), h.store.get().taskMoves.length], ['moved', 'pull', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], false, 0]);
});

test('「둘 다 두기」 from the original\'s own row forgets the move too: both stay where they are', async t => {
  const h = setup(t);
  const { remote, task } = await atGoogle(h, GL, { title: '둘 다 둘 것' });
  h.svc.fail(/^DELETE /, 'refuse');
  const kept = await h.sync.moveTask(task.id, ML.id);
  await h.seeded();
  const left = h.byRemote(remote.id);
  same(left.id, task.id);
  h.sync.forgetMove(left.id);
  same([h.store.get().taskMoves.length, h.get(left.id).listId, h.get(kept.id).listId, h.svc.tasks.has(remote.id)], [0, GL.id, ML.id, true]);
  await h.seeded();
  same([unique(h), h.get(left.id).listId, h.get(kept.id).listId], [true, GL.id, ML.id]);
});

test('what a move reads: To Do\'s formatting (a heuristic over its HTML) and the list Google\'s selfLink names', () => {
  same(['<p>한 줄<br>둘째 줄</p>', '<b>굵게</b>', '<span style="color:red">빨강</span>', '<a href="https://x">링크</a>', '<ul><li>하나</li></ul>', '<span>그냥</span><body><br>'].map(content => microsoft.richBody({ contentType: 'html', content })), [false, true, true, true, true, false]);
  same(microsoft.richBody({ contentType: 'text', content: '<b>글자</b>' }), false, 'plain text is never formatted');
  same([google.selfList({ selfLink: 'https://www.googleapis.com/tasks/v1/lists/L%201/tasks/T1' }), google.selfList({}), google.selfList({ selfLink: 'https://example.com/x' })], ['L 1', '', '']);
  same([M.routeOf({ provider: 'local' }, GL), M.routeOf(GL, { provider: 'local' }), M.routeOf(GL, ML), M.routeOf(GL, GL2), M.routeOf({ provider: 'local' }, { provider: 'local' }), M.routeOf(FLAG, { provider: 'local' }), M.routeOf(GL, FLAG)], ['push', 'pull', 'copy', 'copy', null, 'pull', null], 'Google\'s own move is chosen after the read; the flagged list is never a target');
});

// ---- The final review of 2026-11-04 (K1, K2, W1, W3, D1–D3, G1; K1 and D2 above, in E3 and E2) ----

test('final review D1: 「원래 목록에서 지우기」 of a To Do → To Do copy never deletes an original whose fields the copy carried but this PC never shows changed since — the start date, the status, a category swapped, bold made italic —, nor a pull\'s whose counted repeat starts elsewhere; one changed only where this PC shows it, once a sync shows it, still goes; a start date added is asked as before', async t => {
  const h = setup(t);
  const raw = { body: { contentType: 'html', content: '<p><b>굵게</b> 메모</p>' }, categories: ['빨강'], status: 'inProgress', startDateTime: { dateTime: '2026-11-01T00:00:00.0000000', timeZone: 'UTC' } };
  const keptOf = async (title, fields = raw, to = ML2, accept = []) => {
    const { remote, task } = await atTodo(h, ML, { title, ...structuredClone(fields) });
    h.svc.fail(/^DELETE /, 'busy');
    const kept = await h.sync.moveTask(task.id, to.id, { accept });
    same([kept.outcome, kept.why, typeof recordOf(h, kept.id).from.carried], ['kept', 'refused', 'string'], title);
    return { remote, kept };
  };
  for (const [title, edit] of [
    ['시작 날짜 바뀜', item => { item.startDateTime = { dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'UTC' }; }],
    ['진행 상태 바뀜', item => { item.status = 'waitingOnOthers'; }],
    ['범주 바뀜', item => { item.categories = ['파랑']; }],
    ['서식 바뀜', item => { item.body = { contentType: 'html', content: '<p><i>굵게</i> 메모</p>' }; }],
  ]) {
    const { remote, kept } = await keptOf(title);
    edit(h.svc.tasks.get(remote.id));
    await h.seeded();
    const at = h.svc.calls.length;
    const finished = await h.sync.finishMove(kept.id);
    same([finished.outcome, finished.message, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id).phase], ['changed', UNSHOWN_WORDS, [], true, 'kept'], `${title}: nothing deleted, nothing asked`);
    same([(await h.sync.finishMove(kept.id, { accept: ['rich', 'categories', 'start', 'status'] })).outcome, h.svc.tasks.has(remote.id)], ['changed', true], `${title}: no answer lets it go`);
    const copy = h.svc.in(ML2).find(item => item.title === title);
    same([copy.status, copy.startDateTime.dateTime, copy.categories, copy.body.content], [raw.status, raw.startDateTime.dateTime, raw.categories, raw.body.content], `${title}: the copy holds the old values, so the phone edit is only in the original`);
  }
  // Only what this PC shows changed (the title, the plain words of a note): once a sync shows it here, the original goes as before.
  const shown = await keptOf('제목만 바뀜');
  h.svc.tasks.get(shown.remote.id).title = '제목만 바뀜 (휴대폰)';
  const plain = await keptOf('메모만 바뀜', { body: { contentType: 'text', content: '처음' } });
  h.svc.tasks.get(plain.remote.id).body = { contentType: 'text', content: '휴대폰에서 고침' };
  await h.seeded();
  for (const { remote, kept } of [shown, plain]) {
    const at = h.svc.calls.length;
    same([(await h.sync.finishMove(kept.id)).outcome, h.svc.writes(at), recordOf(h, kept.id)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], undefined]);
  }
  // A start date added since (none was carried): asked in the move's words, as a category added is (second review B3); agreed, it goes.
  const added = await keptOf('시작 날짜 생김', {});
  h.svc.tasks.get(added.remote.id).startDateTime = { dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'UTC' };
  await h.seeded();
  const asked = await h.sync.finishMove(added.kept.id);
  same([asked.outcome, asked.warns], ['confirm', ['start']]);
  same([(await h.sync.finishMove(added.kept.id, { accept: asked.warns })).outcome, h.svc.tasks.has(added.remote.id)], ['moved', false]);
  // A pull of a counted repeat: this PC's copy ends on the last day counted from the series' start, which this PC never shows.
  const recurrence = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-11-02', recurrenceTimeZone: 'UTC' } };
  const counted = await keptOf('횟수 반복', { dueDateTime: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, recurrence }, { id: HERE }, ['local']);
  h.svc.tasks.get(counted.remote.id).recurrence.range.startDate = '2026-10-26';
  await h.seeded();
  const at = h.svc.calls.length;
  same([(await h.sync.finishMove(counted.kept.id)).message, h.svc.writes(at), h.svc.tasks.has(counted.remote.id)], [UNSHOWN_WORDS, [], true], 'five Mondays from another start end on another day');
});

test('final review D1: a record that kept nothing of what its copy carries (made before it was kept) is never deleted over a change: it cannot be compared; unchanged, it still goes', async t => {
  const h = setup(t);
  const { remote, task } = await atTodo(h, ML, { title: '오래된 기록' });
  h.svc.fail(/^DELETE /, 'busy');
  const kept = await h.sync.moveTask(task.id, ML2.id);
  h.store.mutate(state => { delete state.taskMoves.find(item => item.id === kept.id).from.carried; });
  let at = h.svc.calls.length;
  same([(await h.sync.finishMove(kept.id)).outcome, h.svc.writes(at)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`]], 'as the move read it: nothing changed');
  const other = await atTodo(h, ML, { title: '오래된 기록 둘' });
  h.svc.fail(/^DELETE /, 'busy');
  const keptToo = await h.sync.moveTask(other.task.id, ML2.id);
  h.store.mutate(state => { delete state.taskMoves.find(item => item.id === keptToo.id).from.carried; });
  h.svc.tasks.get(other.remote.id).title = '휴대폰 제목';
  await h.seeded();
  at = h.svc.calls.length;
  const finished = await h.sync.finishMove(keptToo.id);
  same([finished.outcome, finished.message, h.svc.writes(at), recordOf(h, keptToo.id).phase], ['changed', C3_WORDS, [], 'kept']);
});

test('final review D3: a Google original whose delete stopped after some of its subtasks went says only its subtasks went — the task\'s own delete refused or unanswered, or stopped at a later subtask; with none gone the words are as before', async t => {
  const h = setup(t);
  const withKids = async title => { const { remote, task } = await atGoogle(h, GL, { title }, [{ title: '하나' }, { title: '둘' }]); return { remote, task, kids: h.svc.in(GL).filter(item => item.parent === remote.id).map(item => item.id) }; };
  const ONLY = '옮겼지만 원래 목록에서 하위 할 일만 지웠어요.';
  const left = item => [h.svc.tasks.has(item.remote.id), item.kids.filter(id => h.svc.tasks.has(id)).length];
  const a = await withKids('부모 거절');
  h.svc.fail(new RegExp(`^DELETE .*/${a.remote.id}$`), 'busy');
  const refused = await h.sync.moveTask(a.task.id, ML.id);
  same([refused.outcome, refused.why, refused.message, left(a)], ['kept', 'refused', ONLY, [true, 0]], 'the task stays at Google without its subtasks');
  const b = await withKids('부모 응답 없음');
  h.svc.fail(new RegExp(`^DELETE .*/${b.remote.id}$`), 'down');
  const unknown = await h.sync.moveTask(b.task.id, ML.id);
  same([unknown.outcome, unknown.message, left(b)], ['left-unknown', `${ONLY} 할 일이 지워졌는지는 확인하지 못했어요.`, [true, 0]]);
  const c = await withKids('둘째 거절');
  h.svc.fail(new RegExp(`^DELETE .*/${c.kids[1]}$`), 'refuse');
  const second = await h.sync.moveTask(c.task.id, ML.id);
  same([second.outcome, second.message, left(c)], ['kept', ONLY, [true, 1]], 'stopped at a subtask: the task itself was never reached');
  const d = await withKids('둘째 응답 없음');
  h.svc.fail(new RegExp(`^DELETE .*/${d.kids[1]}$`), 'down');
  same([(await h.sync.moveTask(d.task.id, ML.id)).message, left(d)], [ONLY, [true, 1]]);
  // None gone: the words of before.
  const e = await withKids('첫째 거절');
  h.svc.fail(new RegExp(`^DELETE .*/${e.kids[0]}$`), 'refuse');
  same([(await h.sync.moveTask(e.task.id, ML.id)).message, left(e)], ['옮겼지만 원래 목록에서 지우지 못했어요.', [true, 2]]);
  const f = await atGoogle(h, GL, { title: '하위 없음' });
  h.svc.fail(/^DELETE /, 'down');
  same((await h.sync.moveTask(f.task.id, ML.id)).message, '옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요.');
  // 「원래 목록에서 지우기」 refused again at the task: its subtasks went before, and that is still what is true.
  h.svc.fail(new RegExp(`^DELETE .*/${a.remote.id}$`), 'busy');
  const again = await h.sync.finishMove(refused.id);
  same([again.outcome, again.message, recordOf(h, refused.id).phase], ['kept', ONLY, 'kept']);
});

test('final review W3: 「원래 목록에서 지우기」 kept by what the original holds now says so in the words of a delete — never a move\'s 「옮길 수 없어요」; nothing written, the move kept', async t => {
  const h = setup(t);
  const keptOf = async (seed, to) => { const { remote, task } = await seed(); h.svc.fail(/^DELETE /, 'refuse'); const kept = await h.sync.moveTask(task.id, to.id); same(kept.outcome, 'kept'); return { remote, kept }; };
  const cases = [
    ['files', () => atTodo(h, ML, { title: '첨부 생김' }), GL, remote => { h.svc.tasks.get(remote.id).hasAttachments = true; }, '첨부 파일이 생겨 원래 목록의 할 일은 지우지 않았어요.'],
    ['steps', () => atTodo(h, ML, { title: '단계 많아짐' }), GL, remote => { for (let i = 0; i < 101; i++) h.svc.checklist.set(`mc-many-${i}`, { id: `mc-many-${i}`, task: remote.id, displayName: `단계 ${i}`, isChecked: false }); }, '하위 할 일이 100개를 넘어 원래 목록의 할 일은 지우지 않았어요.'],
    ['stepsUnknown', () => atTodo(h, ML, { title: '단계 못 읽음' }), GL, () => { h.svc.options.refuseExpand = true; h.svc.options.refuseChecklist = true; }, '하위 할 일을 읽지 못해 원래 목록의 할 일은 지우지 않았어요. 잠시 뒤 다시 해 주세요.'],
    ['assigned', () => atGoogle(h, GL, { title: '할당됨' }), ML, remote => { h.svc.tasks.get(remote.id).assignmentInfo = { surfaceType: 'DOCUMENT' }; }, '원래 목록의 할 일이 바뀌어 지우지 않았어요. 두 목록을 확인해 주세요.'],
  ];
  for (const [reason, seed, to, edit, words] of cases) {
    const { remote, kept } = await keptOf(seed, to);
    edit(remote);
    const at = h.svc.calls.length;
    const refused = await h.sync.finishMove(kept.id);
    same([refused.outcome, refused.message, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id).phase], ['refused', words, [], true, 'kept'], reason);
    Object.assign(h.svc.options, { refuseExpand: false, refuseChecklist: false });
  }
  same([M.leaveText('files') !== M.reasonText('files', GL, ML), M.leaveText('elsewhere')], [true, '원래 목록의 할 일이 바뀌어 지우지 않았어요. 두 목록을 확인해 주세요.'], 'a move keeps its own words');
});

test('final review W1: every write of a move\'s record is broadcast — a push and a copy whose answer never came show 「sending」 while out and 「unknown」 right after, so the screen offers their review at once', async t => {
  let h = null; let watched = ''; const seen = [];
  h = setup(t, { onChange: () => { const record = h.store.publicState().taskMoves.find(item => item.id === watched); seen.push(record ? record.phase : '-'); } });
  h.add({ id: 'w1', title: '답 없음' });
  watched = 'w1';
  h.svc.fail(/^POST .*\/gl1\/tasks$/, 'lost');
  const lost = await h.sync.moveTask('w1', GL.id);
  same([lost.outcome, seen.includes('sending'), seen.at(-1), h.store.publicState().taskMoves.find(item => item.id === 'w1').phase], ['unknown', true, 'unknown', 'unknown']);
  const { task } = await atGoogle(h, GL2, { title: '복사 답 없음' });
  watched = task.id; seen.length = 0;
  h.svc.fail(/^POST \/v1\.0\/me\/todo\/lists\/ml1\/tasks$/, 'lost');
  const copied = await h.sync.moveTask(task.id, ML.id);
  same([copied.outcome, seen.includes('sending'), seen.at(-1)], ['unknown', true, 'unknown']);
});

test('final review K2: a first push stopped at a step because the task made there was deleted there, while its task here is deleted too, says what is there is not known — never that it stays', async t => {
  const h = setup(t);
  h.add({ id: 'k2', title: '단계에서 멈춤', steps: [{ id: 'k2-1', title: '하나', completed: false }] });
  h.svc.during(() => { h.store.mutate(state => { state.tasks = state.tasks.filter(item => item.id !== 'k2'); }); });
  h.svc.fail(/checklistItems$/, 'gone');
  const answer = await h.sync.moveTask('k2', ML.id);
  same([answer.outcome, answer.deleted, answer.message, h.get('k2'), h.store.get().taskMoves.length], ['unknown', true, UNKNOWN_DELETED, undefined, 0]);
});

test('final review G1: the count names apart the moves whose result is not known (unsure) from the ones waiting with a known result — a push made for another list, an original kept, being deleted or whose delete got no answer', () => {
  const base = { title: '', notes: '', dueDate: '', reminderAt: '', rrule: '', important: false };
  const from = remoteId => ({ listId: GL.id, accountId: 'acc-g', remoteId });
  const ids = ['made', 'kept', 'leaving', 'left', 'unknown', 'sending', 'missing', 'legacy', 'free'];
  const records = [
    { id: 'made', listId: GL2.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'x1', base, steps: [] },
    { id: 'kept', listId: HERE, at: 'x', route: 'pull', phase: 'kept', why: 'refused', from: from('r1') },
    { id: 'leaving', listId: HERE, at: 'x', route: 'pull', phase: 'leaving', from: from('r2') },
    { id: 'left', listId: HERE, at: 'x', route: 'pull', phase: 'left-unknown', from: from('r3') },
    { id: 'unknown', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'unknown' },
    { id: 'sending', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'sending' },
    { id: 'missing', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'unknown', review: 'missing', remoteId: 'x2', base, steps: [] },
    { id: 'legacy', listId: GL2.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'x3' },
  ];
  const lists = [{ id: HERE, provider: 'local' }, GL, GL2];
  const summary = M.moveSummary(ids.map(id => ({ id, listId: HERE, title: id })), GL, records, id => lists.find(list => list.id === id));
  same([summary.waiting, summary.unsure, summary.movable], [ids.slice(0, 8), ['unknown', 'sending', 'missing', 'legacy'], ['free']]);
});

// ---- The final check of 2026-11-04 (H1, H2) ----

test('final check H1 (contract d): the screen\'s view of a move says when a delete that stopped took some of the original\'s subtasks — kept or unanswered, before and after a sync shows the original; with none gone it says nothing', async t => {
  const h = setup(t);
  const view = id => h.store.publicState().taskMoves.find(item => item.id === id);
  const withKids = async title => atGoogle(h, GL, { title }, [{ title: '하나' }, { title: '둘' }]);
  const a = await withKids('부모 거절');
  h.svc.fail(new RegExp(`^DELETE .*/${a.remote.id}$`), 'busy');
  const kept = await h.sync.moveTask(a.task.id, ML.id);
  const b = await withKids('부모 응답 없음');
  h.svc.fail(new RegExp(`^DELETE .*/${b.remote.id}$`), 'down');
  const unknown = await h.sync.moveTask(b.task.id, ML.id);
  same([view(unknown.id).phase, view(unknown.id).stripped], ['left-unknown', true], 'unanswered: still without its subtasks');
  const c = await withKids('첫째 거절');
  const first = h.svc.in(GL).find(item => item.parent === c.remote.id).id;
  h.svc.fail(new RegExp(`^DELETE .*/${first}$`), 'refuse');
  const whole = await h.sync.moveTask(c.task.id, ML.id);
  const d = await atGoogle(h, GL, { title: '하위 없음' });
  h.svc.fail(/^DELETE /, 'busy');
  const none = await h.sync.moveTask(d.task.id, ML.id);
  const shape = () => [kept, unknown, whole, none].map(item => [view(item.id).phase, view(item.id).stripped === true, 'stripped' in view(item.id)]);
  same(shape(), [['kept', true, true], ['kept', true, true], ['kept', false, false], ['kept', false, false]], 'a sync found the unanswered one still there: kept, and still without its subtasks');
  same([view(kept.id).left === h.byRemote(a.remote.id).id, h.store.get().taskMoves.find(item => item.id === kept.id).from.gone.length], [true, 2]);
});

test('final check H2: 「원래 목록에서 지우기」 of a To Do → To Do copy goes by the face where the face shows the change, once a sync shows it — the flag set from or taken off a low importance, a repeat that newly counts (also a pull\'s) —; a formatted note\'s words changed (eighth check J1: its HTML changed, not compared in full), a change of formatting alone, a low importance set or taken away while the flag is off, a count started on another day and a hidden part taken away (a category, the formatting, the status, the start date — unlike review S2, the copy keeps them) still keep the original for good', async t => {
  const h = setup(t);
  const keptOf = async (title, fields, to = ML2, accept = []) => {
    const { remote, task } = await atTodo(h, ML, { title, ...structuredClone(fields) });
    h.svc.fail(/^DELETE /, 'busy');
    const kept = await h.sync.moveTask(task.id, to.id, { accept });
    same([kept.outcome, kept.why], ['kept', 'refused'], title);
    return { remote, kept, title };
  };
  const bold = { body: { contentType: 'html', content: '<p><b>굵게</b> 메모</p>' } };
  const html = content => item => { item.body = { contentType: 'html', content }; };
  const due = { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' };
  const pattern = { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' };
  const weekly = { dueDateTime: due, recurrence: { pattern, range: { type: 'noEnd', startDate: '2026-11-09', recurrenceTimeZone: 'UTC' } } };
  const counted = { dueDateTime: due, recurrence: { pattern, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-11-09', recurrenceTimeZone: 'UTC' } } };
  const toCount = item => { item.recurrence = { pattern, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-11-09', recurrenceTimeZone: 'UTC' } }; };
  const goes = [
    await keptOf('낮음에서 높음', { importance: 'low' }),
    await keptOf('높음에서 낮음', { importance: 'high' }),
    await keptOf('횟수 생김', weekly),
    await keptOf('횟수 생김 (이 PC로)', weekly, { id: HERE }, ['local']),
  ];
  const edits = [item => { item.importance = 'high'; }, item => { item.importance = 'low'; }, toCount, toCount];
  // A text edit or a line added in a formatted note: whether its formatting changed beside the words is not known (eighth check J1).
  const partial = [
    [await keptOf('서식 메모 글자만 고침', bold), html('<p><b>굵게</b> 메모 고침</p>')],
    [await keptOf('서식 메모 줄 추가', bold), html('<p><b>굵게</b> 메모</p><p>둘째 줄</p>')],
  ];
  const keeps = [
    [await keptOf('굵게에서 기울임', bold), html('<p><i>굵게</i> 메모</p>')],
    [await keptOf('굵게 범위 바뀜', bold), html('<p><b>굵게 메</b>모</p>')],
    [await keptOf('서식 지움', bold), html('<p>굵게 메모</p>')],
    [await keptOf('보통에서 낮음', {}), item => { item.importance = 'low'; }],
    [await keptOf('낮음에서 보통', { importance: 'low' }), item => { item.importance = 'normal'; }],
    [await keptOf('횟수 시작 바뀜', counted), item => { item.recurrence.range.startDate = '2026-11-02'; }],
    [await keptOf('범주 지움', { categories: ['빨강'] }), item => { item.categories = []; }],
    [await keptOf('진행 상태 되돌림', { status: 'inProgress' }), item => { item.status = 'notStarted'; }],
    [await keptOf('시작 날짜 지움', { startDateTime: { dateTime: '2026-11-01T00:00:00.0000000', timeZone: 'UTC' } }), item => { delete item.startDateTime; }],
  ];
  goes.forEach((item, at) => edits[at](h.svc.tasks.get(item.remote.id)));
  for (const [item, edit] of [...partial, ...keeps]) edit(h.svc.tasks.get(item.remote.id));
  await h.seeded();
  for (const { remote, kept, title } of goes) {
    const at = h.svc.calls.length;
    same([(await h.sync.finishMove(kept.id)).outcome, h.svc.writes(at), recordOf(h, kept.id)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], undefined], `${title}: shown here, so the user's to judge`);
  }
  for (const [words, list] of [[C3_WORDS, partial], [UNSHOWN_WORDS, keeps]]) for (const [{ remote, kept, title }] of list) {
    const at = h.svc.calls.length;
    const finished = await h.sync.finishMove(kept.id);
    same([finished.outcome, finished.message, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id).phase], ['changed', words, [], true, 'kept'], `${title}: kept, nothing written`);
  }
});

test('final check H2: what a To Do → To Do copy carries is compared where this PC does not look — a formatted note by its whole HTML, its words beside it (eighth check J1), a low importance while the flag is off on both sides, the yearly day and a count\'s start while the repeat is yearly or counted on both, a repeat Dayboard cannot read always', () => {
  const ml = { provider: 'microsoft', accountId: 'acc-m' }; const here = { provider: 'local' };
  const changed = (before, now, to = ml) => M.carriedChanged(M.carriedOf(before, ml, to), now, ml, to);
  const note = (content, notes) => ({ task: { title: 'x', notes }, graph: { body: { contentType: 'html', content } }, facts: { rich: microsoft.richBody({ contentType: 'html', content }) } });
  const bold = note('<p><b>굵게</b> 메모</p>', '굵게 메모');
  same([
    changed(bold, note('<p><b>굵게</b> 메모 고침</p>', '굵게 메모 고침')),
    changed(bold, note('<p><b>굵게</b> 메모</p><p>둘째 줄</p>', '굵게 메모\n둘째 줄')),
    changed(bold, note('<p><i>굵게</i> 메모</p>', '굵게 메모')),
    changed(bold, note('<p><b>굵게 메</b>모</p>', '굵게 메모')),
    changed(bold, note('<p>굵게 메모</p>', '굵게 메모')),
    changed(note('<p>굵게 메모</p>', '굵게 메모'), bold),
    changed(note('<p>처음</p>', '처음'), note('<p>고침</p>', '고침')),
  ], [['notes', 'words'], ['notes', 'words'], ['notes'], ['notes'], ['notes'], ['notes'], []], 'a formatted note\'s HTML changed is \'notes\', its words too beside it; a plain note\'s words are the face\'s');
  const weight = importance => ({ task: { title: 'x' }, graph: { importance }, facts: {} });
  same([['low', 'high'], ['high', 'low'], ['high', 'normal'], ['normal', 'low'], ['low', 'normal']].map(([a, b]) => changed(weight(a), weight(b))), [[], [], [], ['importance'], ['importance']], 'the flag shows high; low against normal does not show');
  const weekly = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-11-09' } };
  const counted = startDate => ({ pattern: weekly.pattern, range: { type: 'numbered', numberOfOccurrences: 5, startDate } });
  const yearly = (month, dayOfMonth) => ({ pattern: { type: 'absoluteYearly', interval: 1, month, dayOfMonth }, range: { type: 'noEnd', startDate: '2026-03-15' } });
  const unread = day => ({ pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['monday', day], index: 'first' }, range: { type: 'noEnd', startDate: '2026-11-02' } });
  const ruled = recurrence => { const rrule = microsoft.rruleFromGraph(recurrence); return { task: { title: 'x', dueDate: '2026-11-09', repeatStart: recurrence.range.startDate, ...(rrule ? { rrule } : { repeatsElsewhere: true }) }, graph: { recurrence }, facts: {} }; };
  same([unread('friday'), counted('2026-11-09'), yearly(3, 15)].map(item => Boolean(ruled(item).task.rrule)), [false, true, true]);
  same([
    changed(ruled(weekly), ruled(yearly(3, 15))), changed(ruled(yearly(3, 15)), ruled(weekly)), changed(ruled(yearly(3, 15)), ruled(yearly(4, 1))),
    changed(ruled(weekly), ruled(counted('2026-11-09'))), changed(ruled(counted('2026-11-09')), ruled(weekly)), changed(ruled(counted('2026-11-09')), ruled(counted('2026-11-02'))),
    changed(ruled(unread('friday')), ruled(unread('tuesday'))), changed(ruled(unread('friday')), ruled(weekly)), changed(ruled(weekly), ruled(unread('friday'))),
  ], [[], [], ['yearly'], [], [], ['repeatStart'], ['repeat'], ['repeat'], ['repeat']], 'the face shows a repeat that became yearly or counted, or stopped being one');
  same([changed(ruled(weekly), ruled(counted('2026-11-09')), here), changed(ruled(counted('2026-11-09')), ruled(counted('2026-11-02')), here), changed(ruled(counted('2026-11-09')), ruled(weekly), here)], [[], ['counted'], []], 'a pull: a count\'s start only while counted on both');
});

// ---- The seventh check of 2026-11-04 (I1) and what came after the eighth (J1) ----

// The seventh check's digest of a formatted note's shape, and the eighth's of what stands inside formatting, each left formatting that
// moved beside a word typed unseen (the eighth check: 「2개」 bolded elsewhere with 「, 잼」 typed, a picture moved with ' d' typed — both
// deleted). A formatted note is now compared whole (J1): any change of its HTML, and its words beside it.
// The note as To Do's HTML gives it, its words as a sync reads them (microsoft.cjs plainBody).
const noteRead = content => ({ task: { title: 'x', notes: microsoft.normalizeTask({ id: 'r', title: 'x', body: { contentType: 'html', content } }, { id: 'l', accountId: 'acc-m', remoteId: 'L' }).notes }, graph: { body: { contentType: 'html', content } }, facts: { rich: microsoft.richBody({ contentType: 'html', content }) } });

test('eighth check J1: a formatted note — at the move or now — changed in any way is \'notes\', with \'words\' when its words changed too: formatting moved to other words or a picture moved among them in the same edit as a word typed, a word typed outside formatting, a line added, the formatting cleared with a word typed; the formatting alone changed is \'notes\' alone; a plain note\'s words stay the face\'s', () => {
  const ml = { provider: 'microsoft', accountId: 'acc-m' };
  const changed = (before, now) => M.carriedChanged(M.carriedOf(noteRead(before), ml, ml), noteRead(now), ml, ml);
  const milk = '<p>우유 <b>2개</b>, 빵 2개</p>'; const bold = '<p>x <b>굵게</b> 메모</p>'; const page = body => `<html><head><meta charset="utf-8"><style>p{margin:0}</style></head><body dir="ltr">${body}</body></html>`;
  const typed = [
    [milk, '<p>우유 2개, 빵 <b>2개</b>, 잼</p>'], ['<p>a <img src="cid:1"> b c</p>', '<p>a b <img src="cid:1"> c d</p>'], ['<p>a <b>b</b> c d</p>', '<p>a b c <b>d</b> e</p>'],
    [bold, '<p>x <b>굵게 메</b>모 추가</p>'], [bold, '<p>x <b>굵게 고침</b> 메모</p>'], [bold, '<p>x <b>굵게</b> 메모 추가</p>'], [bold, '<p>앞에 x <b>굵게</b></p>'],
    [bold, '<p>x <b>굵게</b> 메모</p><p>둘째 줄</p>'], [bold, '<p>x 굵게 메모 추가</p>'], [page(bold), page('<p>x <b>굵게</b> 메모 추가</p>')],
  ];
  same(typed.map(([before, now]) => changed(before, now)), typed.map(() => ['notes', 'words']), 'neither goes by the face');
  const formatting = [[milk, '<p>우유 2개, 빵 <b>2개</b></p>'], ['<p>a <img src="cid:1">b c</p>', '<p>a b<img src="cid:1"> c</p>'], [bold, '<p>x <i>굵게</i> 메모</p>'], [bold, '<p>x 굵게 메모</p>'], [page(bold), page('<p>x <i>굵게</i> 메모</p>')]];
  same(formatting.map(([before, now]) => changed(before, now)), formatting.map(() => ['notes']), 'the same words: the formatting alone');
  same([changed(bold, bold), changed('<p>처음</p>', '<p>고침</p>'), changed('<p>한 줄<br>둘째 줄</p>', '<p>한 줄<br>둘째 줄<br>셋째</p>'), changed('<p>x 굵게 메모</p>', bold), changed('<p>x 굵게 메모</p>', '<p>x <b>굵게</b> 메모 추가</p>')],
    [[], [], [], ['notes'], ['notes', 'words']], 'unchanged; a plain note\'s words are the face\'s; formatting added to a plain note is \'notes\' (asked: \'rich\')');
});

test('eighth check J1: 「원래 목록에서 지우기」 of a To Do → To Do copy never deletes an original whose formatted note changed since the move — other words beside the formatting say the two cannot be compared in full, the same words that it changed where this PC does not look —, writes nothing and keeps the record as it was; a plain note\'s text edit still goes once a sync shows it, and formatting added to a plain note, a word typed with it or not, is asked (\'rich\') and goes once agreed', async t => {
  const h = setup(t);
  const keptOf = async (title, content) => {
    const { remote, task } = await atTodo(h, ML, { title, body: { contentType: 'html', content } });
    h.svc.fail(/^DELETE /, 'busy');
    const kept = await h.sync.moveTask(task.id, ML2.id);
    same([kept.outcome, kept.why], ['kept', 'refused'], title);
    return { remote, kept, title, content };
  };
  // Other words beside the formatting — the eighth check's two probes first.
  const partial = [
    [await keptOf('2개 옮기고 잼', '<p>우유 <b>2개</b>, 빵 2개</p>'), '<p>우유 2개, 빵 <b>2개</b>, 잼</p>'],
    [await keptOf('그림 옮기고 d', '<p>a <img src="cid:1"> b c</p>'), '<p>a b <img src="cid:1"> c d</p>'],
    [await keptOf('굵게 옮김', '<p>a <b>b</b> c d</p>'), '<p>a b c <b>d</b> e</p>'],
    [await keptOf('굵게 넓힘', '<p>x <b>굵게</b> 메모</p>'), '<p>x <b>굵게 메</b>모 추가</p>'],
    [await keptOf('굵게 밖에 글자', '<p>x <b>굵게</b> 메모</p>'), '<p>x <b>굵게</b> 메모 추가</p>'],
    [await keptOf('굵게 앞에 글자', '<p>x <b>굵게</b> 메모</p>'), '<p>앞에 x <b>굵게</b> 메모</p>'],
  ];
  // The same words: the formatting alone moved.
  const unshown = [
    [await keptOf('2개만 옮김', '<p>우유 <b>2개</b>, 빵 2개</p>'), '<p>우유 2개, 빵 <b>2개</b></p>'],
    [await keptOf('그림만 옮김', '<p>a <img src="cid:1">b c</p>'), '<p>a b<img src="cid:1"> c</p>'],
  ];
  const plain = await keptOf('평범한 메모', '<p>처음</p>');
  const grown = [await keptOf('서식 생김', '<p>x 굵게 메모</p>'), await keptOf('서식 생기고 글자', '<p>x 굵게 메모</p>')];
  const body = (item, content) => { h.svc.tasks.get(item.remote.id).body = { contentType: 'html', content }; };
  for (const [item, content] of [...partial, ...unshown]) body(item, content);
  body(plain, '<p>고침</p>'); body(grown[0], '<p>x <b>굵게</b> 메모</p>'); body(grown[1], '<p>x <b>굵게</b> 메모 추가</p>');
  await h.seeded();
  for (const [words, list] of [[C3_WORDS, partial], [UNSHOWN_WORDS, unshown]]) for (const [{ remote, kept, title, content }] of list) {
    const record = JSON.stringify(recordOf(h, kept.id));
    const at = h.svc.calls.length;
    const finished = await h.sync.finishMove(kept.id);
    same([finished.outcome, finished.message, h.svc.writes(at), h.svc.tasks.has(remote.id), JSON.stringify(recordOf(h, kept.id)) === record], ['changed', words, [], true, true], `${title}: nothing written, the record as it was`);
    same([(await h.sync.finishMove(kept.id, { accept: ['rich'] })).outcome, h.svc.writes(at), h.svc.tasks.has(remote.id)], ['changed', [], true], `${title}: no answer lets it go`);
    same(h.svc.in(ML2).find(item => item.title === title).body.content, content, `${title}: the copy keeps the note as the move read it`);
  }
  let at = h.svc.calls.length;
  same([(await h.sync.finishMove(plain.kept.id)).outcome, h.svc.writes(at), recordOf(h, plain.kept.id)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${plain.remote.id}`], undefined], 'a plain note: shown here, so the user\'s to judge');
  for (const { remote, kept, title } of grown) {
    at = h.svc.calls.length;
    const asked = await h.sync.finishMove(kept.id);
    same([asked.outcome, asked.warns, asked.lines, h.svc.writes(at)], ['confirm', ['rich'], [M.warnText('rich')], []], `${title}: asked in the move's words, nothing written`);
    same([(await h.sync.finishMove(kept.id, { accept: asked.warns })).outcome, h.svc.writes(at), recordOf(h, kept.id)], ['moved', [`DELETE /v1.0/me/todo/lists/ml1/tasks/${remote.id}`], undefined], `${title}: agreed, it goes once`);
  }
});

test('ninth check: a To Do note is plain only when it is made of what this PC shows — a highlight, a strike, a size, <mark>, a rule or lines in <div>s are formatting: moved to Google they are asked (\'rich\'), and To Do → To Do a change of them keeps the original', async t => {
  const h = setup(t);
  same(['<p>우유 <span style="font-weight:bold">2개</span>, 빵 2개</p>', '<p>a <strike>b</strike> c</p>', '<p>a <span style="background:yellow">b</span> c</p>', '<p>a <span style="font-size:20pt">b</span> c</p>', '<p>a <mark>b</mark> c</p>', '<p>a</p><hr><p>b c</p>', '<div>a</div><div>b</div>', '<p class="MsoNormal">a</p>', 'a<br>b', '<p dir="ltr">a</p>', '<html><head><meta charset="utf-8"><style>p{margin:0}</style></head><body dir="ltr"><p>a</p><!-- x --></body></html>'].map(content => microsoft.richBody({ contentType: 'html', content })),
    [true, true, true, true, true, true, true, true, false, false, true], 'plain is paragraphs, line breaks, a bare span and the document around them; a style sheet styles the note (tenth check)');
  // Moved to Google: asked first, nothing written before the answer.
  const { task: lit } = await atTodo(h, ML, { title: '형광펜', body: { contentType: 'html', content: '<p>a <span style="background:yellow">b</span> c</p>' } });
  let at = h.svc.calls.length;
  const asked = await h.sync.moveTask(lit.id, GL.id);
  same([asked.outcome, asked.warns.includes('rich'), h.svc.writes(at)], ['confirm', true, []]);
  // To Do → To Do: kept (the DELETE refused), the phone changes the formatting, a sync, then 원래 목록에서 지우기.
  const keptOf = async (title, content) => {
    const { remote, task } = await atTodo(h, ML, { title, body: { contentType: 'html', content } });
    h.svc.fail(/^DELETE /, 'busy');
    const kept = await h.sync.moveTask(task.id, ML2.id);
    same([kept.outcome, kept.why], ['kept', 'refused'], title);
    return { remote, kept, title, content };
  };
  const cases = [
    [await keptOf('굵은 span', '<p>우유 <span style="font-weight:bold">2개</span>, 빵 2개</p>'), '<p>우유 2개, 빵 <span style="font-weight:bold">2개</span></p>', UNSHOWN_WORDS],
    [await keptOf('취소선', '<p>a <strike>b</strike> c</p>'), '<p>a b <strike>c</strike></p>', UNSHOWN_WORDS],
    [await keptOf('형광펜 옮김', '<p>a <span style="background:yellow">b</span> c</p>'), '<p>a b <span style="background:yellow">c</span></p>', UNSHOWN_WORDS],
    [await keptOf('글자 크기', '<p>a <span style="font-size:20pt">b</span> c</p>'), '<p><span style="font-size:20pt">a</span> b c</p>', UNSHOWN_WORDS],
    [await keptOf('mark', '<p>a <mark>b</mark> c</p>'), '<p>a b <mark>c</mark></p>', UNSHOWN_WORDS],
    [await keptOf('구분선', '<p>a</p><hr><p>b c</p>'), '<p>a</p><p>b</p><hr><p>c</p>', C3_WORDS],
    [await keptOf('div 줄', '<div>a</div><div>b</div>'), '<div>ab</div>', UNSHOWN_WORDS],
  ];
  for (const [item, content] of cases) h.svc.tasks.get(item.remote.id).body = { contentType: 'html', content };
  await h.seeded();
  for (const [{ remote, kept, title, content }, , words] of cases) {
    at = h.svc.calls.length;
    const finished = await h.sync.finishMove(kept.id);
    same([finished.outcome, finished.message, h.svc.writes(at), h.svc.tasks.has(remote.id), recordOf(h, kept.id)?.phase], ['changed', words, [], true, 'kept'], `${title}: nothing written, the original stays`);
    same(h.svc.in(ML2).find(item => item.title === title).body.content, content, `${title}: the copy keeps the note as the move read it`);
  }
});

test('tenth check: a style sheet, an entity this PC does not decode, a \'<\' or \'>\' left as text, \'</br>\' and broken comments are formatting too; what Dayboard itself writes stays plain', () => {
  const rich = content => microsoft.richBody({ contentType: 'html', content });
  same(['<html><head><style>p{margin:0}</style></head><body><p>a</p></body></html>', '<p>엄마&#39;s 생일&hellip;</p>', '<p>점수 <90 그리고 >80</p>', '<span dir="x>" style="color:red">b</span>', '<!-- a --!><b>bold</b><!-- c -->', 'a</br>b'].map(rich), [true, true, true, true, true, true]);
  same(['a &amp; b &lt;c&gt; &quot;d&quot;&nbsp;e', '<html><head><meta charset="utf-8"><title>x</title></head><body dir="ltr" lang="ko"><p>a</p><!-- x --></body></html>', microsoft.taskBody({ title: 't', notes: '한 줄 & <둘째>\n"셋째"' }).body.content].map(rich), [false, false, false], 'Dayboard\'s own note and a plain document stay plain');
});

test('Codex review F1–F3: a pull reads the original again before deleting it; a link\'s name is part of what is compared; a list shared since the last sync is asked about', async t => {
  const h = setup(t);
  // F1: the phone edits the original while the first read waits for its subtasks.
  const { remote, task } = await atGoogle(h, GL, { title: '가져올 것', notes: '처음' });
  h.svc.on(/^GET \/tasks\/v1\/lists\/gl1\/tasks$/, () => { Object.assign(h.svc.tasks.get(remote.id), { notes: '휴대폰에서 고침', updated: new Date(Date.parse(h.svc.tasks.get(remote.id).updated) + 60000).toISOString() }); });
  const pulled = await h.sync.moveTask(task.id, 'local-inbox', { accept: ['local'] });
  same([pulled.outcome, pulled.why, h.svc.tasks.has(remote.id), h.svc.tasks.get(remote.id).notes, h.get(pulled.id)?.listId, recordOf(h, pulled.id)?.phase], ['kept', 'changed', true, '휴대폰에서 고침', 'local-inbox', 'kept'], 'the edit stays at Google beside the task here');
  // F2: a link's name changes while the copy is made (same account, so its links go along).
  const linked = await atTodo(h, ML, { title: '메일 연결' }, { links: [{ applicationName: 'Outlook', displayName: '처음 이름', externalId: 'e1', webUrl: 'https://example.com/m' }] });
  h.svc.during(() => { for (const link of h.svc.linked.values()) if (link.task === linked.remote.id) link.displayName = '바뀐 이름'; });
  const copied = await h.sync.moveTask(linked.task.id, ML2.id);
  same([copied.outcome, copied.why, h.svc.tasks.has(linked.remote.id)], ['kept', 'changed', true], 'the original with the new name is not deleted');
  // F3: ML is shared on the phone after the last sync; the move asks, nothing is written.
  const plain = await atTodo(h, ML, { title: '공유된 뒤' });
  h.svc.lists.get('ml1').shared = true;
  const at = h.svc.calls.length;
  const asked = await h.sync.moveTask(plain.task.id, ML2.id);
  same([asked.outcome, asked.warns, h.svc.writes(at), h.store.get().lists.find(item => item.id === ML.id).shared], ['confirm', ['shared'], [], undefined], 'asked although this PC has not seen the sharing yet');
});

test('2026-11-05 owner reports: a move from To Do reads the sharing from the list of lists (no single-list $select, which To Do refused with HTTP 400), falling back to the last sync\'s flag when that is refused; a list made in a Microsoft or Google account comes back once from the next sync', async t => {
  const h = setup(t);
  const { task, remote } = await atTodo(h, ML, { title: '쇼핑으로' });
  let at = h.svc.calls.length;
  const moved = await h.sync.moveTask(task.id, ML2.id);
  same([moved.outcome, h.svc.calls.slice(at).some(c => /^GET \/v1\.0\/me\/todo\/lists\/[^/]+$/.test(c.line)), h.svc.calls.slice(at).some(c => c.line === 'GET /v1.0/me/todo/lists')], ['moved', false, true], 'moved; the list of lists, not one list');
  same(h.svc.tasks.has(remote.id), false);
  // The list of lists refused: the last sync's flag (not shared here) — the move still goes.
  const second = await atTodo(h, ML, { title: '목록 읽기 거절' });
  h.svc.fail(/^GET \/v1\.0\/me\/todo\/lists$/, 'refuse');
  same((await h.sync.moveTask(second.task.id, ML2.id)).outcome, 'moved');
  // New lists in the accounts: made at the service under the id a sync gives them, once.
  const ms = await h.sync.mutateList('add', { name: '쇼핑 리스트 2', accountId: 'acc-m', provider: 'microsoft' });
  const gg = await h.sync.mutateList('add', { name: '여행', accountId: 'acc-g', provider: 'google' });
  same([ms.provider, ms.accountId, ms.name, gg.provider, gg.accountId, gg.name], ['microsoft', 'acc-m', '쇼핑 리스트 2', 'google', 'acc-g', '여행']);
  h.store.mutate(state => { state.lists.push({ ...ms, color: '#ff9500' }, { ...gg, color: '#34c759' }); }); // as main list:add keeps them
  await h.seeded();
  const lists = h.store.get().lists;
  same([lists.filter(item => item.id === ms.id).length, lists.filter(item => item.id === gg.id).length, lists.find(item => item.id === ms.id).color], [1, 1, '#ff9500'], 'the sync finds them here: no second list, the colour kept');
  const lanes = require('../lib/lanes.cjs');
  same([lanes.COMMAND_LANES['list:add']({ name: 'x' }), lanes.COMMAND_LANES['list:add']({ name: 'x', accountId: 'acc-m' }), lanes.COMMAND_LANES['list:add']({ name: 'x', accountId: 3 })], ['local', 'remote', 'exclusive']);
});
