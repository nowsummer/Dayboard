'use strict';
// Event notes (2026-11-05 owner 「달력에서 메모 기능도 있는 게 좋지 않을까?」 → 「달력 메모 이거도 구현해줘」): an event's plain-text notes under
// 장소 in the card, in the widget's dialog and on this PC's events, kept as Google's description, Outlook's body and iCloud's DESCRIPTION.
// A note its service keeps with formatting is never flattened: never sent when nobody changed it, refused unless edited as text in the
// card (main notesEditable). The fake services store what they are sent — Google's is tests/r50-c-google-fake.cjs, the Outlook and iCloud
// ones follow tests/calendar-split.test.cjs —; main's event:add/event:update are cut from main.cjs and run with the real helpers; the
// card, the widget's dialog and the search are the real renderer code over tests/r50-F-dom.cjs. Every assert compares primitives.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ICAL = require('ical.js');
const C = require('../lib/providers/common.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const V = require('../lib/validate.cjs');
const S = require('../lib/series.cjs');
const D = require('../renderer/domain.js');
const { tr } = require('../lib/i18n.cjs');
const { createStore, initialState, validateState } = require('../lib/store.cjs');
const { seriesKey, createSync } = require('../lib/sync.cjs');
const { createCalendarHistory } = require('../lib/calhistory.cjs');
const { googleCalendar, occurrenceAt } = require('./r50-c-google-fake.cjs');
const { harness, read } = require('./r50-F-harness.cjs');

const project = path.resolve(__dirname, '..');
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
const journal = () => { const records = new Map(); let n = 0; return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } }; };
const json = value => JSON.stringify(value);

// ---------------- The plain form and the formatted one (lib/providers/common.cjs) ----------------
test('Dayboard\'s HTML of a note, in the document Outlook keeps it in, reads back as the same words and as plain; a formatted note keeps its words and link addresses', () => {
  const words = '첫 줄 & <괄호>\n\n  들여 쓴  줄';
  const html = C.noteHtml(words);
  const kept = `<html>\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\r\n<meta content="text/html; charset=us-ascii">\r\n</head>\r\n<body>\r\n${html.replace(/<br>/g, '<br>\r\n')}\r\n</body>\r\n</html>\r\n`;
  assert.equal(C.richBody({ contentType: 'html', content: kept }), false, 'plain: editable here');
  assert.equal(C.htmlText(kept), words, 'the same words, the blank line and the doubled spaces too');
  const teams = '<div class="elementToProof" style="font-family:Aptos">회의 안건<br></div><div><a href="https://teams.example/join?a=1&amp;b=2">참가하려면 클릭</a></div><ul><li>하나</li><li>둘</li></ul>';
  assert.equal(C.richBody({ contentType: 'html', content: teams }), true);
  assert.equal(C.htmlText(teams), '회의 안건\n참가하려면 클릭 <https://teams.example/join?a=1&b=2>\n하나\n둘', 'lines per block, the link\'s address after its words');
  assert.equal(C.htmlText('<a href="https://example.org">https://example.org</a>'), 'https://example.org', 'an address that is its own words is not doubled');
  assert.equal(C.htmlText('<p>a</p><p>b</p>'), 'a\nb');
  assert.equal(C.htmlText('<div>a</div><div><br></div><div>b</div>'), 'a\n\nb', 'an empty block line is one blank line');
  assert.equal(C.htmlText('AT&amp;T &#54620;&#xAD6D; &unknown;'), 'AT&T 한국 &unknown;');
  const long = C.noteFields('가'.repeat(C.NOTES_MAX + 1));
  assert.equal(long.notes.length, C.NOTES_MAX); assert.equal(long.notesCut, true, 'cut: kept as the service has it');
  assert.equal(long.notesRich, undefined, 'a plain note cut is not called formatted (2026-11-05 check)');
  assert.equal(C.plainNotes('x'.repeat(25000)).notesCut, true);
  const both = C.htmlNotes(`<b>${'가'.repeat(C.NOTES_MAX + 1)}</b>`);
  assert.equal(both.notesRich, true); assert.equal(both.notesCut, true, 'formatted and cut: both marks');
  assert.equal(Object.hasOwn(C.plainNotes('짧은 메모'), 'notesCut'), false);
  assert.equal(C.notesChanged({ notes: '' }), true, 'an add carries its notes');
  assert.equal(C.notesChanged({ title: 'x' }), false, 'an event without notes (moved from an old build) carries none');
  assert.equal(C.notesChanged({ notes: 'a' }, { notes: 'a' }), false);
  assert.equal(C.notesChanged({ notes: '' }, {}), false, 'none and empty are the same');
});

// ---------------- Google ----------------
const gCal = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
const gRead = description => google.normalizeEvent({ id: 'e', summary: '회의', start: { date: '2026-11-05' }, end: { date: '2026-11-06' }, ...(description === undefined ? {} : { description }) }, gCal);

test('Google: a description is the notes — plain text as it is, Google\'s plain HTML as its lines, formatting marked', () => {
  assert.equal(gRead(undefined).notes, ''); assert.equal(gRead(undefined).notesRich, undefined);
  assert.equal(gRead('a < b & c\n둘째 줄').notes, 'a < b & c\n둘째 줄', 'text from Google\'s apps: its \'<\' and \'&\' as they are');
  assert.equal(gRead('a < b & c\n둘째 줄').notesRich, undefined);
  assert.equal(gRead('첫 줄<br>둘째 줄').notes, '첫 줄\n둘째 줄'); assert.equal(gRead('첫 줄<br>둘째 줄').notesRich, undefined, 'line breaks only: editable');
  assert.equal(gRead('<b>굵게</b> 안건').notes, '굵게 안건'); assert.equal(gRead('<b>굵게</b> 안건').notesRich, true);
  assert.equal(gRead('AT&amp;T').notes, 'AT&T');
});

test('Google: notes are written only when they changed; text that would read as HTML goes as HTML and reads back the same', () => {
  const was = { id: 'e1', remoteId: 'r1', calendarId: 'cal', provider: 'google', title: '회의', start: '2026-11-05', end: '2026-11-06', allDay: true, location: '', notes: '굵게 안건', notesRich: true };
  assert.equal(json(google.eventBody({ ...was, title: '회의 2' }, was)), json({ summary: '회의 2' }), 'a title change leaves the formatted description alone');
  assert.equal(google.eventBody({ ...was, notes: '새 메모\n둘째 줄' }, was).description, '새 메모\n둘째 줄', 'plain text as it is');
  const literal = 'x <b>y</b> & z';
  const sent = google.eventBody({ ...was, notes: literal }, was).description;
  assert.equal(sent, 'x &lt;b&gt;y&lt;/b&gt; &amp; z');
  assert.equal(gRead(sent).notes, literal); assert.equal(gRead(sent).notesRich, undefined, 'and stays plain');
  assert.equal(google.eventBody({ ...was, notes: '첫 줄' }).description, '첫 줄', 'an add carries them');
});

test('Google: 「이후 모든 일정」 keeps the series\' formatted description unless the notes were changed; then the new series has the new text', async () => {
  const master = { id: 'm', summary: '회의', description: '<b>굵게</b> 안건', start: { dateTime: '2026-10-21T01:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T02:00:00Z', timeZone: 'UTC' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=5'] };
  const occurrence = { ...occurrenceAt('2026-10-23T01:00:00.000Z'), notes: '굵게 안건', notesRich: true };
  const kept = googleCalendar(master);
  await kept.provider.mutateEvent('update', { ...occurrence, title: '바뀐 회의' }, gCal, { scope: 'future', previous: occurrence, splits: journal() });
  assert.equal(kept.made().summary, '바뀐 회의'); assert.equal(kept.made().description, '<b>굵게</b> 안건', 'the HTML as it was');
  const changed = googleCalendar(master);
  await changed.provider.mutateEvent('update', { ...occurrence, notes: '새 메모' }, gCal, { scope: 'future', previous: occurrence, splits: journal() });
  assert.equal(changed.made().description, '새 메모');
  assert.equal(changed.events.get('m').description, '<b>굵게</b> 안건', 'the earlier part keeps its own');
});

test('Google: 「이 일정만」 patches the occurrence\'s description, 「모든 일정」 the series\', and only when the notes changed', async () => {
  const calls = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, method: options.method || 'GET', body });
    const id = decodeURIComponent(new URL(url).pathname.split('/events/')[1] || '');
    return { id, summary: '회의', ...(body?.description !== undefined ? { description: body.description } : {}), start: { dateTime: '2026-10-23T01:00:00Z' }, end: { dateTime: '2026-10-23T02:00:00Z' }, ...(id === 'm' ? { recurrence: ['RRULE:FREQ=DAILY'] } : { recurringEventId: 'm' }) };
  } });
  const occurrence = { ...occurrenceAt('2026-10-23T01:00:00.000Z'), notes: '안건' };
  const one = await provider.mutateEvent('update', { ...occurrence, notes: '이날만' }, gCal, { scope: 'one', previous: occurrence });
  const patch = calls.find(call => call.method === 'PATCH');
  assert.equal(patch.url.endsWith('/events/m_x'), true); assert.equal(json(patch.body), json({ description: '이날만' }));
  assert.equal(one.events[0].notes, '이날만', 'read back from Google\'s answer');
  calls.length = 0;
  await provider.mutateEvent('update', { ...occurrence, notes: '모두' }, gCal, { scope: 'all', previous: occurrence });
  const all = calls.find(call => call.method === 'PATCH');
  assert.equal(all.url.endsWith('/events/m'), true); assert.equal(json(all.body), json({ description: '모두' }));
  calls.length = 0;
  await provider.mutateEvent('update', { ...occurrence, title: '제목만' }, gCal, { scope: 'one', previous: occurrence });
  assert.equal(calls.find(call => call.method === 'PATCH').body.description, undefined, 'a title change sends no description');
});

// ---------------- Outlook ----------------
const msCal = { id: 'mcal', remoteId: 'CAL', accountId: 'acc', provider: 'microsoft' };
const kept = text => `<html>\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\r\n</head>\r\n<body>\r\n${text}\r\n</body>\r\n</html>\r\n`;
// One event as Outlook answers an add: the event read through the provider (normalizeEvent).
async function msRead(extra) {
  const provider = microsoft.createMicrosoft({ request: async () => ({ id: 'X', subject: '회의', type: 'singleInstance', isAllDay: false, start: { dateTime: '2026-11-05T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-05T02:00:00.0000000', timeZone: 'UTC' }, ...extra }) });
  return (await provider.mutateEvent('add', { title: '회의', start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false, location: '' }, msCal)).events[0];
}

test('Outlook: the body is the notes — Dayboard\'s plain HTML as its words, formatting marked, a body never read is unknown', async () => {
  const plain = await msRead({ body: { contentType: 'html', content: kept('첫 줄<br>\r\n둘째 &amp; 줄') } });
  assert.equal(plain.notes, '첫 줄\n둘째 & 줄'); assert.equal(plain.notesRich, undefined);
  const styled = await msRead({ body: { contentType: 'html', content: kept('<div class="elementToProof" style="color:rgb(0,0,0)">Outlook에서 <span style="color:rgb(196,49,75)">쓴</span> 메모</div>') } });
  assert.equal(styled.notes, 'Outlook에서 쓴 메모'); assert.equal(styled.notesRich, true, 'a coloured word');
  const text = await msRead({ body: { contentType: 'text', content: '글자\r\n그대로 <b>' } });
  assert.equal(text.notes, '글자\n그대로 <b>'); assert.equal(text.notesRich, undefined);
  const empty = await msRead({ body: { contentType: 'html', content: '' } });
  assert.equal(empty.notes, '');
  const unread = await msRead({});
  assert.equal(Object.hasOwn(unread, 'notes'), false, 'no body in the answer: unknown, not empty');
});

test('Outlook: notes go as HTML only when they changed; a title change leaves a formatted body alone', () => {
  const was = { id: 'e', remoteId: 'X', calendarId: 'mcal', provider: 'microsoft', title: '회의', start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false, location: '', notes: 'Outlook에서 쓴 메모', notesRich: true };
  assert.equal(json(microsoft.eventBody({ ...was, title: '회의 2' }, was)), json({ subject: '회의 2' }));
  assert.equal(json(microsoft.eventBody({ ...was, notes: 'a<b\n둘째' }, was)), json({ body: { contentType: 'html', content: 'a&lt;b<br>둘째' } }));
  assert.equal(microsoft.eventBody({ ...was, notes: '' }, was).body.content, '', 'cleared');
  assert.equal(microsoft.eventBody({ ...was, notes: 'x' }).body.content, 'x', 'an add carries them');
});

// Bodies Outlook keeps for an event with no notes, as Graph answers them (2026-11-05 check: each was marked formatted, so no note could be
// added in the widget's dialog and the card asked for 「텍스트로 고치기」 over nothing) — OWA and the new Outlook, Word (classic Outlook),
// Exchange's copy of an RTF body —, and lines typed in OWA, each in the compose font.
const OWA_HEAD = '<html><head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style type="text/css" style="display:none">\r\nP {margin-top:0;margin-bottom:0;}\r\n</style>\r\n</head>\r\n<body dir="ltr">\r\n';
const OWA_FONT = 'font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);';
const owaLine = (inner, style = OWA_FONT) => `<div class="elementToProof" style="${style}">\r\n${inner}</div>\r\n`;
const owaBody = (...lines) => `${OWA_HEAD}${lines.join('')}</body>\r\n</html>\r\n`;
const OWA_EMPTY = owaBody(owaLine('<br>\r\n'));
const WORD_SHEET = '<style><!--\r\n/* Font Definitions */\r\n@font-face\r\n\t{font-family:"맑은 고딕";\r\n\tpanose-1:2 11 5 3 2 0 0 2 0 4;}\r\n/* Style Definitions */\r\np.MsoNormal, li.MsoNormal, div.MsoNormal\r\n\t{margin:0cm;\r\n\tfont-size:10.0pt;\r\n\tfont-family:"맑은 고딕";}\r\na:link, span.MsoHyperlink\r\n\t{mso-style-priority:99;\r\n\tcolor:#0563C1;\r\n\ttext-decoration:underline;}\r\n@page WordSection1\r\n\t{size:612.0pt 792.0pt;\r\n\tmargin:3.0cm 72.0pt 72.0pt 72.0pt;}\r\ndiv.WordSection1\r\n\t{page:WordSection1;}\r\n--></style>';
const wordBody = paragraph => `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\r\n<meta name="Generator" content="Microsoft Word 15 (filtered medium)">\r\n${WORD_SHEET}<!--[if gte mso 9]><xml>\r\n<o:shapedefaults v:ext="edit" spidmax="1026" />\r\n</xml><![endif]-->\r\n</head>\r\n<body lang="KO" link="#0563C1" vlink="#954F72" style="word-wrap:break-word">\r\n<div class="WordSection1">\r\n${paragraph}\r\n</div>\r\n</body>\r\n</html>\r\n`;
const WORD_EMPTY = wordBody('<p class="MsoNormal"><o:p>&nbsp;</o:p></p>');
const RTF_EMPTY = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="Generator" content="Microsoft Exchange Server"><!-- converted from rtf --><style><!-- .EmailQuote { margin-left: 1pt; padding-left: 4pt; border-left: #800000 2px solid; } --></style></head><body><font face="Times New Roman" size="3"><span style="font-size:12pt;"><a name="BM_BEGIN"></a><div><font face="Calibri" size="2"><span style="font-size:11pt;">&nbsp;</span></font></div></span></font></body></html>';

test('Outlook\'s body of an event without notes (OWA, Word, an RTF copy) is no words and plain; a picture, table, rule, list, border or link with no words stays formatting', async () => {
  for (const [name, body] of Object.entries({ OWA_EMPTY, WORD_EMPTY, RTF_EMPTY })) {
    const notes = C.htmlNotes(body);
    assert.equal(notes.notes, '', `${name}: no words`); assert.equal(notes.notesRich, undefined, `${name}: plain`);
  }
  const owa = await msRead({ body: { contentType: 'html', content: OWA_EMPTY } });
  assert.equal(owa.notes, ''); assert.equal(owa.notesRich, undefined, 'read through the provider too');
  assert.equal((await msRead({ body: { contentType: 'html', content: WORD_EMPTY } })).notesRich, undefined);
  for (const [name, inner] of Object.entries({ picture: '<img src="cid:image001.png">', table: '<table><tr><td>&nbsp;</td></tr></table>', rule: '<hr>', list: '<ul><li><br></li></ul>', link: '<a href="https://teams.example/j"></a>' })) {
    assert.equal(C.htmlNotes(owaBody(owaLine(inner))).notesRich, true, name);
  }
  assert.equal(C.htmlNotes(owaBody('<div style="border:1px solid rgb(0,0,0)"><br></div>')).notesRich, true, 'a border');
  assert.equal(C.htmlNotes(owaBody('<div style="background-image:url(cid:x)"><br></div>')).notesRich, true, 'a background');
  assert.equal(C.richBody({ contentType: 'html', content: OWA_EMPTY }), true, 'a To Do note keeps its own rule (a move asks first, lib/taskmove.cjs)');
});

test('lines typed in OWA, each in the compose font, are plain; a colour, a second font, bold, centring or Word\'s style sheet round words stay formatting', () => {
  const typed = C.htmlNotes(owaBody(owaLine('회의 안건'), owaLine('<br>\r\n'), owaLine('자료 준비 &amp; 확인')));
  assert.equal(typed.notes, '회의 안건\n\n자료 준비 & 확인'); assert.equal(typed.notesRich, undefined);
  assert.equal(C.htmlNotes(owaBody(owaLine('회의 안건'), owaLine('빨강', 'font-family: Aptos; font-size: 12pt; color: rgb(255, 0, 0);'))).notesRich, true, 'a red line');
  assert.equal(C.htmlNotes(owaBody(owaLine('회의 안건'), owaLine('큰 글', 'font-family: Aptos; font-size: 20pt; color: rgb(0, 0, 0);'))).notesRich, true, 'two fonts');
  assert.equal(C.htmlNotes(owaBody(owaLine('회의 <span style="font-size: 20pt;">안건</span>'))).notesRich, true, 'a bigger word');
  assert.equal(C.htmlNotes(owaBody(owaLine('회의 <b>안건</b>'))).notesRich, true, 'bold');
  assert.equal(C.htmlNotes(owaBody(owaLine('가운데', `${OWA_FONT} text-align: center;`))).notesRich, true, 'centred');
  assert.equal(C.htmlNotes(wordBody('<p class="MsoNormal">회의 안건<o:p></o:p></p>')).notesRich, true, 'Word\'s typed words: its style sheet sets their font');
  assert.equal(C.htmlNotes('<html><head><style>p { color: red; }</style></head><body><p>안건</p></body></html>').notesRich, true, 'a style sheet that colours');
});

// A fake Outlook calendar for a split, as tests/calendar-split.test.cjs graphCalendar: it stores what it is sent and lists a series'
// occurrences by date in its zone.
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wallToUtc = (date, time, zone) => { const guess = Date.parse(`${date}T${time}Z`); const shown = C.zonedParts(new Date(guess).toISOString(), zone); return guess - (Date.parse(`${shown.date}T${shown.time}Z`) - guess); };
function graphCalendar(master) {
  const events = new Map([[master.id, structuredClone(master)]]); let next = 0;
  const dates = ev => { const { range } = ev.recurrence; const out = []; for (let i = 0; out.length < 60; i++) { const date = day(range.startDate, i); if (range.type === 'numbered' && i >= range.numberOfOccurrences) break; if (range.type === 'endDate' && date > range.endDate) break; out.push(date); } return out; };
  const span = (ev, date) => { const time = ev.start.dateTime.slice(11, 19); const length = wallToUtc(ev.end.dateTime.slice(0, 10), ev.end.dateTime.slice(11, 19), ev.end.timeZone) - wallToUtc(ev.start.dateTime.slice(0, 10), time, ev.start.timeZone); const start = wallToUtc(date, time, ev.start.timeZone); return [start, start + length]; };
  const render = (ms, zone) => { const p = C.zonedParts(new Date(ms).toISOString(), zone); return { dateTime: `${p.date}T${p.time}.0000000`, timeZone: zone }; };
  const occurrence = (ev, date, zone) => { const [s, e] = span(ev, date); return { id: `${ev.id}@${date}`, seriesMasterId: ev.id, type: 'occurrence', isAllDay: false, subject: ev.subject, originalStart: new Date(s).toISOString(), originalStartTimeZone: ev.start.timeZone, start: render(s, zone), end: render(e, zone) }; };
  const masterView = (ev, zone) => ({ ...structuredClone(ev), start: render(wallToUtc(ev.start.dateTime.slice(0, 10), ev.start.dateTime.slice(11, 19), ev.start.timeZone), zone), end: render(wallToUtc(ev.end.dateTime.slice(0, 10), ev.end.dateTime.slice(11, 19), ev.end.timeZone), zone) });
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const zone = /outlook\.timezone="([^"]+)"/.exec(options.headers?.Prefer || '')?.[1] || 'UTC';
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.replace('/v1.0', ''));
    if (method === 'POST' && /^\/me\/calendars\/[^/]+\/events$/.test(tail)) { const id = `N${++next}`; events.set(id, { ...structuredClone(body), id, type: 'seriesMaster', originalStartTimeZone: body.start.timeZone }); return { id, ...structuredClone(body) }; }
    const [, , , id, sub] = tail.split('/');
    const [series, date] = String(id).split('@');
    if (date) return occurrence(events.get(series), date, zone);
    const ev = events.get(id); if (!ev) throw httpError(404);
    if (method === 'DELETE') { events.delete(id); return null; }
    if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); return masterView(ev, zone); }
    if (sub === 'instances') { const from = Date.parse(u.searchParams.get('startDateTime')); const to = Date.parse(u.searchParams.get('endDateTime')); return { value: dates(ev).filter(d => { const [s, e] = span(ev, d); return e > from && s < to; }).map(d => occurrence(ev, d, zone)) }; }
    return masterView(ev, zone);
  }
  return { provider: microsoft.createMicrosoft({ request }), events, made: () => events.get('N1') };
}
const rich = { contentType: 'html', content: kept('<div style="color:red"><a href="https://teams.example/j">참가</a> 안건</div>') };
const msMaster = () => ({ id: 'M', subject: '운동', type: 'seriesMaster', isAllDay: false, originalStartTimeZone: 'UTC', body: rich, start: { dateTime: '2026-10-21T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T02:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-10-21', recurrenceTimeZone: 'UTC' } } });
const msThird = { id: 'o', remoteId: 'M@2026-10-23', seriesId: 'M', recurring: true, recurrenceAt: '2026-10-23T01:00:00.000Z', calendarId: 'mcal', provider: 'microsoft', title: '운동', start: '2026-10-23T01:00:00.000Z', end: '2026-10-23T02:00:00.000Z', allDay: false, location: '', notes: '참가 <https://teams.example/j> 안건', notesRich: true };

test('Outlook: 「이후 모든 일정」 keeps the series\' formatted body unless the notes were changed; then the new series has the new text', async () => {
  const same = graphCalendar(msMaster());
  await same.provider.mutateEvent('update', { ...msThird, title: '바뀜' }, msCal, { scope: 'future', previous: msThird, splits: journal() });
  assert.equal(same.made().subject, '바뀜'); assert.equal(json(same.made().body), json(rich), 'the HTML as it was');
  const changed = graphCalendar(msMaster());
  await changed.provider.mutateEvent('update', { ...msThird, notes: '새 메모\n둘째' }, msCal, { scope: 'future', previous: msThird, splits: journal() });
  assert.equal(json(changed.made().body), json({ contentType: 'html', content: '새 메모<br>둘째' }));
  assert.equal(json(changed.events.get('M').body), json(rich), 'the earlier part keeps its own');
});

// ---------------- iCloud ----------------
const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icCal = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
const SERIES = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261021T010000Z', 'DTEND:20261021T020000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:매일 회의',
  'DESCRIPTION:안건\\, 자료\\; 끝 \\\\ 표시\\n둘째 줄', 'X-ALT-DESC;FMTTYPE=text/html:<b>안건</b>', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
function davCalendar(data = SERIES) {
  const objects = [{ url: `${home}series.ics`, etag: '"a"', data }]; let version = 0;
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => !objectUrls || objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    createCalendarObject: async ({ calendar, filename, iCalString }) => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.some(item => item.url === url)) throw httpError(412); objects.push({ url, etag: '"new"', data: iCalString }); return new Response(null, { status: 201 }); },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
    deleteCalendarObject: async ({ calendarObject }) => { const i = objects.findIndex(item => item.url === calendarObject.url); if (i < 0) throw httpError(404); objects.splice(i, 1); return new Response(null, { status: 204 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const events = (i = 0) => icloud.parseCalendarObject(objects[i].data, icCal, range, ICAL, { href: objects[i].url, etag: objects[i].etag });
  // The VEVENTs of a file: the master first, then each exception by its RECURRENCE-ID.
  const vevents = (i = 0) => new ICAL.Component(ICAL.parse(objects[i].data)).getAllSubcomponents('vevent');
  const byDay = (date, i = 0) => vevents(i).find(item => String(item.getFirstPropertyValue('recurrence-id') || '').startsWith(date));
  return { provider, objects, events, vevents, byDay };
}
const description = item => String(item.getFirstPropertyValue('description') ?? '');

test('iCloud: DESCRIPTION is the notes with RFC 5545\'s escapes undone, written with them; an HTML copy beside it marks the note formatted', () => {
  const [first] = davCalendar().events();
  assert.equal(first.notes, '안건, 자료; 끝 \\ 표시\n둘째 줄'); assert.equal(first.notesRich, true, 'X-ALT-DESC');
  const plain = davCalendar(SERIES.replace(/X-ALT-DESC[^\r]*\r\n/, '')).events()[0];
  assert.equal(plain.notesRich, undefined);
  const notes = '쉼표, 쌍반점; 역빗금 \\ 끝\n둘째 줄';
  const ics = icloud.buildEventIcs({ title: '새 일정', start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false, location: '', notes }, 'uid-n', ICAL);
  assert.equal(ics.replace(/\r\n /g, '').includes('DESCRIPTION:쉼표\\, 쌍반점\\; 역빗금 \\\\ 끝\\n둘째 줄'), true, 'escaped in the file');
  assert.equal(icloud.parseCalendarObject(ics, icCal, range, ICAL)[0].notes, notes, 'and read back the same');
  assert.equal(icloud.buildEventIcs({ title: 'x', start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false, location: '', notes: '' }, 'uid-e', ICAL).includes('DESCRIPTION'), false, 'no notes, no DESCRIPTION');
});

// The series with another DESCRIPTION and HTML copy, written with RFC 5545's escapes as Outlook writes them (ical.js leaves them in).
const icsText = value => value.replace(/[\\;,]/g, char => `\\${char}`).replace(/\r?\n/g, () => '\\n');
const withAlt = (html, words = '') => SERIES.replace(/DESCRIPTION:[^\r]*\r\n/, () => (words ? `DESCRIPTION:${icsText(words)}\r\n` : '')).replace(/X-ALT-DESC[^\r]*/, () => `X-ALT-DESC;FMTTYPE=text/html:${icsText(html)}`);

test('iCloud: an HTML copy of the same words with nothing formatted (an Outlook invitation without notes) does not mark the note formatted', () => {
  const empty = davCalendar(withAlt(OWA_EMPTY)).events()[0];
  assert.equal(empty.notes, ''); assert.equal(empty.notesRich, undefined, '2026-11-05 check: an empty styled body');
  const same = davCalendar(withAlt(owaBody(owaLine('안건, 자료; 끝')), '안건, 자료; 끝')).events()[0];
  assert.equal(same.notes, '안건, 자료; 끝'); assert.equal(same.notesRich, undefined, 'its escapes undone: the same words');
  assert.equal(davCalendar(withAlt(owaBody(owaLine('다른 글')), '안건')).events()[0].notesRich, true, 'other words: an app showing the copy shows another note');
  assert.equal(davCalendar(withAlt(owaBody(owaLine('<b>안건</b>')), '안건')).events()[0].notesRich, true, 'formatted');
});

test('iCloud: 「이 일정만」 — a title change copies the series\' notes and their HTML; a notes change writes the text and drops the HTML; the series keeps its own', async () => {
  const cal = davCalendar();
  const [, second, third] = cal.events();
  await cal.provider.mutateEvent('update', { ...second, title: '옮긴 회의' }, icCal, { scope: 'one', previous: second });
  assert.equal(description(cal.byDay('2026-10-22')), '안건, 자료; 끝 \\ 표시\n둘째 줄');
  assert.equal(cal.byDay('2026-10-22').hasProperty('x-alt-desc'), true, 'the formatting goes with the occurrence');
  await cal.provider.mutateEvent('update', { ...third, notes: '이날만 메모' }, icCal, { scope: 'one', previous: third });
  assert.equal(description(cal.byDay('2026-10-23')), '이날만 메모');
  assert.equal(cal.byDay('2026-10-23').hasProperty('x-alt-desc'), false, 'an old HTML copy would show the old note');
  assert.equal(description(cal.vevents()[0]), '안건, 자료; 끝 \\ 표시\n둘째 줄', 'the series untouched');
  assert.equal(cal.vevents()[0].hasProperty('x-alt-desc'), true);
  const shown = cal.events();
  assert.equal(shown.find(e => e.start === '2026-10-23T01:00:00.000Z').notes, '이날만 메모'); assert.equal(shown.find(e => e.start === '2026-10-23T01:00:00.000Z').notesRich, undefined);
});

test('iCloud: 「모든 일정」 — the series\' notes change, an occurrence that kept them follows, one with its own keeps it', async () => {
  const cal = davCalendar(SERIES.replace(/X-ALT-DESC[^\r]*\r\n/, ''));
  const [, second, third] = cal.events();
  await cal.provider.mutateEvent('update', { ...second, notes: '따로 쓴 메모' }, icCal, { scope: 'one', previous: second });
  await cal.provider.mutateEvent('update', { ...third, title: '제목만 바꿈' }, icCal, { scope: 'one', previous: third });
  const first = cal.events()[0];
  await cal.provider.mutateEvent('update', { ...first, notes: '모두 바뀐 메모' }, icCal, { scope: 'all', previous: first });
  assert.equal(description(cal.vevents()[0]), '모두 바뀐 메모');
  assert.equal(description(cal.byDay('2026-10-23')), '모두 바뀐 메모', 'it kept the series\' notes');
  assert.equal(description(cal.byDay('2026-10-22')), '따로 쓴 메모', 'its own stays');
  assert.equal(cal.byDay('2026-10-23').getFirstPropertyValue('summary'), '제목만 바꿈');
});

test('iCloud: 「이후 모든 일정」 keeps the series\' notes and their HTML unless the notes were changed', async () => {
  const same = davCalendar();
  const third = same.events()[2];
  await same.provider.mutateEvent('update', { ...third, title: '나눈 회의' }, icCal, { scope: 'future', previous: third, splits: journal() });
  const made = same.vevents(1)[0];
  assert.equal(made.getFirstPropertyValue('summary'), '나눈 회의');
  assert.equal(description(made), '안건, 자료; 끝 \\ 표시\n둘째 줄'); assert.equal(made.hasProperty('x-alt-desc'), true);
  const changed = davCalendar();
  const at = changed.events()[2];
  await changed.provider.mutateEvent('update', { ...at, notes: '새 메모' }, icCal, { scope: 'future', previous: at, splits: journal() });
  const fresh = changed.vevents(1)[0];
  assert.equal(description(fresh), '새 메모'); assert.equal(fresh.hasProperty('x-alt-desc'), false);
  assert.equal(description(changed.vevents(0)[0]), '안건, 자료; 끝 \\ 표시\n둘째 줄', 'the earlier part keeps its own');
});

// ---------------- main.cjs event:add / event:update (cut from the source, the real helpers; the services above) ----------------
const mainSource = fs.readFileSync(path.join(project, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function mainPiece(name) {
  const at = [`\nfunction ${name}(`, `\nasync function ${name}(`].map(head => mainSource.indexOf(head)).find(i => i >= 0);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  // To its closing brace at the start of a line (writeRemoteEvent's parameters hold braces of their own).
  const end = mainSource.indexOf('\n}\n', at); assert.ok(end > at);
  return mainSource.slice(at + 1, end + 2);
}
const mainLine = head => { const at = mainSource.indexOf(`\n${head}`); assert.ok(at >= 0, head); return mainSource.slice(at + 1, mainSource.indexOf('\n', at + 1)); };
function mainEvents(t, provider) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const context = {
    store, tr, randomUUID: () => crypto.randomUUID(), ...V, ...S, ...D, seriesKey, path, __dirname: project,
    commit: fn => store.mutate(fn),
    sync: { mutateEvent: (kind, event, calendar, options) => provider.mutateEvent(kind, event, calendar, options) },
    mainWindow: null, Notification: { isSupported: () => false }, showMain() {},
  };
  vm.createContext(context);
  vm.runInContext(['lookup', 'resolveEvent', 'notesEditable', 'writeRemoteEvent'].map(mainPiece).concat(mainLine('const scopeFacts =')).join('\n'), context, { filename: 'main.cjs' });
  const from = mainSource.indexOf("    case 'event:add': {"); const to = mainSource.indexOf("    case 'event:color': {", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has event:add and event:update');
  const command = vm.runInContext(`(async function command(commandName, payload) { switch (commandName) { ${mainSource.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { store, command, event: id => store.get().events.find(item => item.id === id) };
}

test('this PC: an event keeps its notes (trimmed, up to 20,000 characters); a title change leaves them; the series\' scopes treat them as the title', async t => {
  const m = mainEvents(t, null);
  const added = await m.command('event:add', { calendarId: 'local-calendar', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', notes: '  메뉴 정하기\n예약  \n' });
  assert.equal(m.event(added.id).notes, '메뉴 정하기\n예약');
  await m.command('event:update', { id: added.id, title: '팀 점심' });
  assert.equal(m.event(added.id).notes, '메뉴 정하기\n예약', 'a title change keeps them');
  await m.command('event:update', { id: added.id, notes: '' });
  assert.equal(m.event(added.id).notes, '');
  await assert.rejects(m.command('event:update', { id: added.id, notes: '가'.repeat(20001) }), /메모/);
  const series = await m.command('event:add', { calendarId: 'local-calendar', title: '운동', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', rrule: 'FREQ=DAILY;COUNT=6', notes: '시리즈 메모' });
  const occurrence = id => `${series.id}@${D.expandEvent(m.event(series.id), '2026-11-01', '2026-11-10').find(o => o.start.startsWith(id)).recurrenceId}`;
  const own = await m.command('event:update', { id: occurrence('2026-11-03'), scope: 'one', title: '운동 (짧게)' });
  assert.equal(m.event(own.id).notes, '시리즈 메모', 'an occurrence made its own takes the series\' notes along');
  const noted = await m.command('event:update', { id: occurrence('2026-11-04'), scope: 'one', notes: '이날만' });
  assert.equal(m.event(noted.id).notes, '이날만'); assert.equal(m.event(series.id).notes, '시리즈 메모');
  const later = await m.command('event:update', { id: occurrence('2026-11-06'), scope: 'future', notes: '이후 메모' });
  assert.equal(m.event(later.id).notes, '이후 메모', 'the new series'); assert.equal(m.event(series.id).notes, '시리즈 메모', 'the earlier part keeps its own');
  await m.command('event:update', { id: occurrence('2026-11-02'), scope: 'all', notes: '모두' });
  assert.equal(m.event(series.id).notes, '모두');
  assert.equal(m.event(noted.id).notes, '이날만', 'an occurrence with its own keeps it, as its own title');
  assert.equal(D.expandEvent(m.event(series.id), '2026-11-01', '2026-11-03')[0].notes, '모두', 'its occurrences show the series\' notes');
});

test('a connected calendar through main: a formatted note is refused unless edited as text; an unread note is never written over; the service\'s answer is kept', async t => {
  const sent = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; if (options.method === 'PATCH') sent.push(body);
    return { id: decodeURIComponent(new URL(url).pathname.split('/events/')[1] || 'r1'), summary: body?.summary ?? '회의', description: body?.description ?? '<b>굵게</b> 안건', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } };
  } });
  const m = mainEvents(t, provider);
  const calendar = { id: 'gcal', name: 'Google', provider: 'google', accountId: 'acc', remoteId: 'primary' };
  const event = { ...google.normalizeEvent({ id: 'r1', summary: '회의', description: '<b>굵게</b> 안건', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } }, { ...gCal, id: 'gcal' }), calendarId: 'gcal' };
  const unread = { ...event, id: 'old', remoteId: 'r2' }; delete unread.notes; delete unread.notesRich;
  m.store.mutate(state => { state.calendars.push(calendar); state.events.push(event, unread); });
  assert.equal(event.notesRich, true);
  await assert.rejects(m.command('event:update', { id: event.id, notes: '덮어쓰기' }), /서식이 있는 메모/);
  await m.command('event:update', { id: event.id, title: '회의 2', notes: event.notes });
  assert.equal(json(sent.at(-1)), json({ summary: '회의 2' }), 'the same words with another change: no description sent');
  await m.command('event:update', { id: event.id, notes: '글자만', notesPlain: true });
  assert.equal(json(sent.at(-1)), json({ description: '글자만' }), 'chosen in the card: written as text');
  assert.equal(m.event(event.id).notes, '글자만'); assert.equal(m.event(event.id).notesRich, undefined, 'plain now, as Google answered');
  assert.equal(Object.hasOwn(m.event(event.id), 'notesPlain'), false, 'the choice is not stored');
  await assert.rejects(m.command('event:update', { id: 'old', notes: 'x' }), /아직 받지 못했어요/);
  await m.command('event:update', { id: 'old', title: '제목만' });
  assert.equal(sent.at(-1).description, undefined, 'its other fields still change');
});

test('through main, a note cut at 20,000 characters is never written, even as text; another change leaves it as the service has it', async t => {
  const sent = [];
  const long = '안건 '.repeat(9000).trim();
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; if (options.method === 'PATCH') sent.push(body);
    return { id: 'r1', summary: body?.summary ?? '회의', description: body?.description ?? long, start: { date: '2026-11-05' }, end: { date: '2026-11-06' } };
  } });
  const m = mainEvents(t, provider);
  const event = { ...google.normalizeEvent({ id: 'r1', summary: '회의', description: long, start: { date: '2026-11-05' }, end: { date: '2026-11-06' } }, { ...gCal, id: 'gcal' }), calendarId: 'gcal' };
  assert.equal(event.notes.length, C.NOTES_MAX); assert.equal(event.notesCut, true); assert.equal(event.notesRich, undefined);
  m.store.mutate(state => { state.calendars.push({ id: 'gcal', name: 'Google', provider: 'google', accountId: 'acc', remoteId: 'primary' }); state.events.push(event); });
  await assert.rejects(m.command('event:update', { id: event.id, notes: `${event.notes.slice(0, -1)}끝`, notesPlain: true }), /메모가 길어 앞부분만 보여요/);
  await assert.rejects(m.command('event:update', { id: event.id, notes: '', notesPlain: true }), /메모가 길어/);
  assert.equal(sent.length, 0, '2026-11-05 check: a save kept only the part shown, on every device');
  await m.command('event:update', { id: event.id, title: '회의 2', notes: event.notes });
  assert.equal(json(sent), json([{ summary: '회의 2' }]), 'the same words with another change: no description sent');
  assert.equal(m.event(event.id).notesCut, true, 'still cut, as Google answered'); assert.equal(m.event(event.id).title, '회의 2');
});

test('through main, an Outlook event without notes takes one: written as Outlook\'s HTML, plain as the answer reads', async t => {
  const patches = [];
  const provider = microsoft.createMicrosoft({ request: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; if (options.method === 'PATCH') patches.push(body);
    return { id: 'X', subject: '회의', type: 'singleInstance', isAllDay: false, start: { dateTime: '2026-11-05T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-05T02:00:00.0000000', timeZone: 'UTC' }, body: body?.body ?? { contentType: 'html', content: OWA_EMPTY } };
  } });
  const m = mainEvents(t, provider);
  const empty = await msRead({ body: { contentType: 'html', content: OWA_EMPTY } });
  m.store.mutate(state => { state.calendars.push({ id: 'mcal', name: 'Outlook', provider: 'microsoft', accountId: 'acc', remoteId: 'CAL' }); state.events.push(empty); });
  await m.command('event:update', { id: empty.id, notes: '회의 자료 & 노트북' });
  assert.equal(json(patches), json([{ body: { contentType: 'html', content: '회의 자료 &amp; 노트북' } }]), 'no 「텍스트로 고치기」 needed (2026-11-05 check)');
  assert.equal(m.event(empty.id).notes, '회의 자료 & 노트북'); assert.equal(m.event(empty.id).notesRich, undefined);
});

// ---------------- The saved file and the older tier ----------------
test('the store publishes notes and their marks, repairs what is the wrong shape, and keeps no marks on this PC\'s events', () => {
  const state = initialState();
  const gcal = { id: 'gcal', name: 'Google', provider: 'google', accountId: 'acc', remoteId: 'primary' };
  state.calendars.push(gcal);
  state.events.push({ id: 'a', calendarId: 'gcal', provider: 'google', title: 'x', start: '2026-11-05', end: '2026-11-06', allDay: true, notes: 42, notesRich: 'yes', notesCut: 1 });
  state.events.push({ id: 'b', calendarId: 'gcal', provider: 'google', title: 'y', start: '2026-11-05', end: '2026-11-06', allDay: true, notes: '그대로', notesRich: true, notesCut: true });
  // 2026-11-05 check: an archive kept them, and its note stayed 「서식이 있는 메모」 with no original app left.
  state.events.push({ id: 'c', calendarId: 'local-calendar', provider: 'local', title: 'z', start: '2026-11-05', end: '2026-11-06', allDay: true, notes: '보관본', notesRich: true, notesCut: true });
  state.events.push({ id: 'd', calendarId: 'local-calendar', title: 'w', start: '2026-11-05', end: '2026-11-06', allDay: true, notes: '옛 일정', notesRich: true });
  validateState(state);
  assert.equal(state.events[0].notes, '42'); assert.equal(Object.hasOwn(state.events[0], 'notesRich'), false); assert.equal(Object.hasOwn(state.events[0], 'notesCut'), false);
  assert.equal(state.events[1].notes, '그대로'); assert.equal(state.events[1].notesRich, true); assert.equal(state.events[1].notesCut, true);
  assert.equal(state.events[2].notes, '보관본'); assert.equal(Object.hasOwn(state.events[2], 'notesRich'), false); assert.equal(Object.hasOwn(state.events[2], 'notesCut'), false);
  assert.equal(Object.hasOwn(state.events[3], 'notesRich'), false, 'in this PC\'s calendar, whatever its provider field says');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notes-store-'));
  try {
    const store = createStore(directory);
    store.mutate(s => { s.calendars.push(gcal); s.events.push(state.events[1]); });
    const shown = store.publicState().events.find(e => e.id === 'b');
    assert.equal(shown.notes, '그대로'); assert.equal(shown.notesRich, true); assert.equal(shown.notesCut, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a disconnect\'s archive keeps the words and drops the marks: on this PC they are the whole note', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notes-archive-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const base = { accountId: 'acc', provider: 'google', calendarId: 'gcal', start: '2026-11-05', end: '2026-11-06', allDay: true, location: '' };
  store.mutate(state => {
    state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' });
    state.calendars.push({ id: 'gcal', remoteId: 'primary', accountId: 'acc', provider: 'google', name: 'Work' });
    state.events.push({ ...base, id: 'g1', remoteId: 'r1', title: '링크', notes: '참가 <https://meet.example/j>', notesRich: true }, { ...base, id: 'g2', remoteId: 'r2', title: '긴 메모', notes: '가'.repeat(C.NOTES_MAX), notesCut: true });
  });
  assert.equal(store.get().events.find(e => e.id === 'g1').notesRich, true, 'kept while connected');
  const sync = createSync({ store, safeStorage: null, shell: null, userData: directory, dependencies: { vault: { get: () => null, set() {}, remove() {} }, auth: { authorize: async () => { throw new Error('no browser in tests'); }, refresh: async c => c, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  await sync.disconnect('acc');
  const archived = store.get().events.filter(e => e.title === '링크' || e.title === '긴 메모');
  assert.equal(archived.length, 2);
  assert.equal(archived.every(e => e.provider === 'local' && !Object.hasOwn(e, 'notesRich') && !Object.hasOwn(e, 'notesCut')), true);
  assert.equal(archived.find(e => e.title === '링크').notes, '참가 <https://meet.example/j>');
  assert.equal(archived.find(e => e.title === '긴 메모').notes.length, C.NOTES_MAX);
  assert.match(read('lib/sync.cjs'), /'recurrenceAt', 'notesRich', 'notesCut'\]\) delete event\[field\]/, 'dropped where the archive is made, not only by the store\'s repair');
});

test('the older tier\'s search finds an event by its notes', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notes-history-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createStore(userData);
  const CAL = { id: 'g-cal', remoteId: 'primary', accountId: 'acc-g', provider: 'google', name: '개인' };
  store.mutate(state => { state.accounts.push({ id: 'acc-g', provider: 'google', name: 'g', status: 'connected', syncCalendar: true }); state.calendars.push(CAL); });
  const old = { id: 'h1', calendarId: CAL.id, accountId: 'acc-g', provider: 'google', title: '모임', start: new Date(2023, 4, 1, 9).toISOString(), end: new Date(2023, 4, 1, 10).toISOString(), allDay: false, location: '', notes: '회비 3만 원\n장소 미정' };
  const history = createCalendarHistory({ userData, store, fetchEvents: async (accountId, calendarId, r) => (Date.parse(old.start) >= Date.parse(r.start) && Date.parse(old.start) < Date.parse(r.end) ? [structuredClone(old)] : []), now: () => new Date(2026, 9, 30, 10) });
  await history.refreshDue();
  const found = history.search('회비');
  assert.equal(found.events.length, 1); assert.equal(found.events[0].id, 'h1'); assert.equal(found.events[0].history, true, 'read-only');
  assert.equal(found.events[0].notes, '회비 3만 원\n장소 미정');
});

// ---------------- The card (renderer/calendar.js) ----------------
function cardHarness() {
  const h = harness({ isLocalEvent: e => e.provider === 'local', calendarKey: () => false });
  h.loadApp('function toLocalInput(');
  h.loadCalendar();
  // calRenderCard redraws the card; here only the notes row is drawn, into one holder (the rest of the card needs app.js).
  const holder = h.document.createElement('div'); h.app.append(holder);
  h.context.__holder = holder;
  h.eval(`calRenderCard = () => { const node = calNotesRow(calCard.mode === 'view'); __holder.replaceChildren(...(node ? [node] : [])); calCard.node = __holder; }`);
  h.open = (event, mode = 'edit') => { h.eval(`calCard = { mode: ${json(mode)}, event: ${json(event)}, key: ${json(event?.id || 'draft')}, v: calValuesOf(${json(event || { start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false })}), pending: {}, series: false, node: null }; calCard.original = { ...calCard.v }; calRenderCard();`); return holder; };
  h.box = () => holder.querySelector('textarea.card-notes-input');
  h.type = (node, value) => { node.value = value; node.dispatchEvent(new h.context.Event('input', { bubbles: true })); };
  h.blur = node => node.dispatchEvent(new h.context.Event('blur'));
  h.updates = () => h.calls.filter(call => call.name === 'event:update').map(call => json(call.payload));
  return h;
}
const localEvent = { id: 'l1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false, location: '', notes: '메뉴' };

test('card: a box under 장소 that saves on leaving it, as 장소 does; a new event sends its notes with the rest', async () => {
  const h = cardHarness();
  h.open(localEvent);
  const box = h.box();
  assert.equal(box.value, '메뉴'); assert.equal(box.getAttribute('placeholder'), '메모 추가'); assert.equal(box.getAttribute('aria-label'), '메모');
  assert.equal(box.getAttribute('maxlength'), '20000');
  h.type(box, '메뉴\n예약하기'); assert.equal(h.eval('calCard.v.notes'), '메뉴\n예약하기');
  assert.equal(h.updates().length, 0, 'nothing while typing');
  h.blur(box);
  await h.eval('calCardFlush(calCard)');
  assert.equal(json(h.updates()), json([json({ id: 'l1', notes: '메뉴\n예약하기' })]));
  h.blur(box); await h.eval('calCardFlush(calCard)');
  assert.equal(h.updates().length, 1, 'unchanged since: nothing more');
  h.open(null, 'create');
  h.type(h.box(), '새 일정 메모');
  h.eval(`calCard.calendarId = 'local-calendar'; calCard.addKey = '0123456789abcdef0123456789abcdef';`);
  assert.equal(h.eval(`calAddPayload(calCard, '새 일정').notes`), '새 일정 메모');
  h.type(h.box(), '   ');
  assert.equal(h.eval(`'notes' in calAddPayload(calCard, '새 일정')`), false, 'blank notes are not sent');
  assert.match(read('renderer/calendar.js'), /about\.push\(calNotesRow\(view\)\);[\s\S]{0,120}group\(calAlertRow\(view\)/, 'the row sits under 장소, above 알림');
});

test('card: a formatted note shows its words and changes only after 「텍스트로 고치기」, which says the formatting goes', async () => {
  const h = cardHarness();
  const formatted = { ...localEvent, id: 'g1', provider: 'google', calendarId: 'gcal', notes: '굵게 안건', notesRich: true };
  const holder = h.open(formatted);
  assert.equal(h.box(), null, 'no box yet');
  assert.equal(holder.querySelector('.card-notes-text').textContent, '굵게 안건');
  const choose = holder.querySelector('button.card-notes-plain');
  assert.equal(choose.textContent, '텍스트로 고치기');
  assert.equal(holder.querySelector('.card-note').textContent.startsWith('서식이 있는 메모예요.'), true);
  choose.dispatchEvent(new h.context.Event('click', { bubbles: true }));
  assert.equal(h.box().value, '굵게 안건');
  assert.equal(h.document.activeElement === h.box(), true, 'the keyboard goes to the box');
  assert.equal(holder.querySelector('.card-note').textContent, '고치면 서식은 사라지고 글자만 남아요.');
  h.blur(h.box()); await h.eval('calCardFlush(calCard)');
  assert.equal(h.updates().length, 0, 'opened but unchanged: nothing sent');
  h.type(h.box(), '글자만'); h.blur(h.box()); await h.eval('calCardFlush(calCard)');
  assert.equal(json(h.updates()), json([json({ id: 'g1', notes: '글자만', notesPlain: true })]));
});

test('card: a read-only or older event shows its notes as text; a connected event whose notes no sync has brought shows none', () => {
  const h = cardHarness();
  const holder = h.open({ ...localEvent, history: true, notes: '지난 메모\n둘째 줄' }, 'view');
  assert.equal(h.box(), null); assert.equal(holder.querySelector('.card-notes-text').textContent, '지난 메모\n둘째 줄');
  h.open({ ...localEvent, notes: '' }, 'view');
  assert.equal(holder.querySelector('.card-notes'), null, 'no notes, no row');
  const unread = { ...localEvent, provider: 'microsoft', calendarId: 'mcal' }; delete unread.notes;
  h.open(unread);
  assert.equal(holder.querySelector('.card-notes'), null);
  const local = { ...localEvent }; delete local.notes;
  h.open(local);
  assert.equal(h.box().value, '', 'this PC\'s event from before notes: an empty box');
});

test('card styles: the notes box is the card\'s own field, 13px on 20px lines, no colour of its own, before the r60-apple block', () => {
  const css = read('renderer/styles.css');
  const at = css.indexOf('.event-card .card-notes-input{'); const apple = css.indexOf('/* r60-apple');
  assert.equal(at > 0 && at < apple, true);
  const rules = css.slice(css.indexOf('/* Event notes (2026-11-05'), apple);
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(rules), false, 'tokens only');
  assert.equal([...rules.matchAll(/font-size:(\d+)px/g)].every(m => Number(m[1]) >= 12), true, 'no text under 12px');
});

// ---------------- The widget's dialog (renderer/app.js eventDialog) ----------------
function dialogHarness() {
  const el = (h, tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  const h = harness({ calendarKey: () => false, toastAction: null, toastRedo: null, openNoteFind: () => false, notesTrash: false, activeNote: null, isTaskView: () => false });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(', 'function submitGuard(', 'function toLocalInput(', 'const providerName=', 'const calendarOf=', 'const isLocalEvent=', 'function dateFace(', 'const timeFormat=', 'function fmtTime(', 'function alertLabel(', 'function eventAlertPicker(', 'function eventDialog(');
  const c = h.context;
  c.state.calendars = [{ id: 'local-calendar', name: '개인 일정', provider: 'local' }, { id: 'gcal', name: '업무', provider: 'google', accountId: 'acc' }];
  Object.assign(c, { writableCalendars: () => c.state.calendars, calendarLabel: x => x?.name || '', calendarColor: () => 'var(--blue)', eventSwatchPicker: () => ({ node: el(h, 'div'), value: null }), repeatPicker: () => ({ node: el(h, 'div'), value: () => '' }), deleteEventFlow() {}, scopeChooser() {} });
  h.open = existing => { h.eval('eventDialog')(existing, '2026-11-05'); return h.modalRoot.querySelector('.dialog'); };
  h.notes = () => h.modalRoot.querySelector('textarea[name=notes]');
  h.submit = async () => { const form = h.modalRoot.querySelector('form'); form.requestSubmit(form.querySelector('button[type=submit]')); await h.tick(10); };
  h.sent = () => h.calls.filter(call => call.name === 'event:update' || call.name === 'event:add').map(call => call.payload);
  return h;
}

test('widget dialog: a 메모 field under 장소, sent only when it changed; a formatted note stays as it is; an unread one shows none', async () => {
  const h = dialogHarness();
  h.open(localEvent);
  assert.equal(h.notes().value, '메뉴');
  h.modalRoot.querySelector('[name=title]').value = '점심 2';
  await h.submit();
  assert.equal(h.sent().length, 1); assert.equal(Object.hasOwn(h.sent()[0], 'notes'), false, 'untouched: not sent');
  h.open(localEvent);
  h.notes().value = '메뉴\n예약'; await h.submit();
  assert.equal(h.sent().at(-1).notes, '메뉴\n예약');
  const formatted = { ...localEvent, id: 'g1', provider: 'google', calendarId: 'gcal', notes: '굵게', notesRich: true };
  const dialog = h.open(formatted);
  assert.equal(h.notes().hasAttribute('readonly'), true);
  assert.equal([...dialog.querySelectorAll('.field-help')].some(n => n.textContent === '서식이 있는 메모는 원래 달력 앱에서 고쳐 주세요.'), true);
  h.modalRoot.querySelector('[name=title]').value = '바뀐 제목'; await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'notes'), false, 'never from here');
  const unread = { ...formatted, id: 'g2' }; delete unread.notes; delete unread.notesRich;
  h.open(unread);
  assert.equal(h.notes(), null);
  h.open(null);
  h.modalRoot.querySelector('[name=title]').value = '새 일정'; h.notes().value = '새 메모'; await h.submit();
  assert.equal(h.sent().at(-1).notes, '새 메모', 'a new event takes them');
});

// 2026-11-05 check: a note cut at 20,000 characters stays text everywhere (a save kept only the part shown); this PC's events have no
// marks to heed (an archive's kept them); an Outlook event without notes takes one directly.
const CUT_NOTE = '메모가 길어 앞부분만 보여요. 원래 달력 앱에서 고쳐 주세요.';
test('card: a note cut at 20,000 characters stays text, even after 「텍스트로 고치기」; this PC\'s event edits its note whatever marks it has', async () => {
  const h = cardHarness();
  const cut = { ...localEvent, id: 'g3', provider: 'google', calendarId: 'gcal', notes: '앞부분', notesCut: true, notesRich: true };
  const holder = h.open(cut);
  assert.equal(h.box(), null); assert.equal(holder.querySelector('button.card-notes-plain'), null, 'no edit as text');
  assert.equal(holder.querySelector('.card-notes-text').textContent, '앞부분');
  assert.equal(holder.querySelector('.card-note').textContent, CUT_NOTE);
  h.eval('calCard.notesPlain = true; calRenderCard();');
  assert.equal(h.box(), null, 'still text');
  const archived = { ...localEvent, notesRich: true, notesCut: true };
  h.open(archived);
  assert.equal(h.box().value, '메뉴'); assert.equal(holder.querySelector('.card-note'), null, 'no notice');
  h.type(h.box(), '메뉴 바꿈'); h.blur(h.box()); await h.eval('calCardFlush(calCard)');
  assert.equal(json(h.updates()), json([json({ id: 'l1', notes: '메뉴 바꿈' })]));
});

test('card and widget dialog: an Outlook event without notes takes one directly', async () => {
  const empty = await msRead({ body: { contentType: 'html', content: OWA_EMPTY } });
  const card = cardHarness();
  const holder = card.open(empty);
  assert.equal(holder.querySelector('button.card-notes-plain'), null, 'no 「텍스트로 고치기」 over nothing');
  card.type(card.box(), '회의 자료'); card.blur(card.box()); await card.eval('calCardFlush(calCard)');
  assert.equal(json(card.updates()), json([json({ id: empty.id, notes: '회의 자료' })]));
  const h = dialogHarness();
  h.context.state.calendars.push({ id: 'mcal', name: 'Outlook', provider: 'microsoft', accountId: 'acc' });
  h.open(empty);
  assert.equal(h.notes().hasAttribute('readonly'), false);
  h.notes().value = '회의 자료'; await h.submit();
  assert.equal(h.sent().at(-1).notes, '회의 자료');
});

test('widget dialog: a note cut at 20,000 characters is read-only and says why; this PC\'s event edits its note whatever marks it has', async () => {
  const h = dialogHarness();
  const dialog = h.open({ ...localEvent, id: 'g3', provider: 'google', calendarId: 'gcal', notes: '앞부분', notesCut: true });
  assert.equal(h.notes().hasAttribute('readonly'), true);
  assert.equal([...dialog.querySelectorAll('.field-help')].some(n => n.textContent === CUT_NOTE), true);
  h.modalRoot.querySelector('[name=title]').value = '바뀐 제목'; await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'notes'), false, 'never from here');
  const archived = h.open({ ...localEvent, notesRich: true, notesCut: true });
  assert.equal(h.notes().hasAttribute('readonly'), false);
  assert.equal([...archived.querySelectorAll('.field-help')].some(n => n.textContent === CUT_NOTE || n.textContent.startsWith('서식이 있는 메모')), false);
  h.notes().value = '메뉴 바꿈'; await h.submit();
  assert.equal(h.sent().at(-1).notes, '메뉴 바꿈');
});

// ---------------- The search (renderer/calendar.js) ----------------
test('search: notes are searched, and a hit found by them shows its matching line under the title', () => {
  const h = harness({ isLocalEvent: e => e.provider === 'local', calendarKey: () => false, timeLabel: () => '오전 10:00', eventColor: () => 'var(--blue)', eventMenu() {} });
  h.load(read('renderer/notefind.js'), 'renderer/notefind.js');
  h.loadCalendar();
  const today = D.dateKey();
  const at = D.fromDate(today); at.setHours(10);
  h.context.state.events = [
    { id: 'n1', calendarId: 'local-calendar', provider: 'local', title: '치과', start: at.toISOString(), end: new Date(at.getTime() + 3600000).toISOString(), allDay: false, location: '', notes: '보험증 챙기기\n주차는 지하 2층' },
    { id: 'n2', calendarId: 'local-calendar', provider: 'local', title: '회의', start: at.toISOString(), end: new Date(at.getTime() + 3600000).toISOString(), allDay: false, location: '' },
  ];
  assert.equal(json(h.eval(`calSearchHits('주차', ${json(today)})`).map(e => e.id)), json(['n1']));
  h.context.search = '주차';
  const node = h.eval('calSearchResults()');
  const line = node.querySelector('.search-hit-note');
  assert.equal(line.textContent, '주차는 지하 2층'); assert.equal(line.querySelector('mark').textContent, '주차');
  assert.equal(h.eval(`calSearchResults`).toString().includes('제목·장소·메모에서 찾아요'), true, 'the empty search says notes are searched');
});

// ---------------- Codex 1.2.10 fourth review (2026-11-05 fixes, behaviour tests 2026-11-06) ----------------
// F2: 「모든 일정」 with new notes replaces an occurrence's DESCRIPTION (and drops its HTML copy) only when both are the series' own, byte for
// byte — compared as shown (trimmed, cut at 20,000 characters) an occurrence's own words past the cut, or a formatting of its own, were lost.
test('iCloud: 「모든 일정」 keeps an occurrence\'s note that differs from the series\' past 20,000 characters (F2)', async () => {
  const long = '가'.repeat(20000);
  const cal = davCalendar(SERIES.replace(/DESCRIPTION:[^\r]*\r\n/, () => `DESCRIPTION:${long}\r\n`).replace(/X-ALT-DESC[^\r]*\r\n/, ''));
  const [, second, third] = cal.events();
  assert.equal([second.notes.length, second.notesCut === true].join('|'), '20000|false', 'the series\' note is whole here');
  await cal.provider.mutateEvent('update', { ...second, notes: `${long} 이날만 덧붙임` }, icCal, { scope: 'one', previous: second });
  await cal.provider.mutateEvent('update', { ...third, title: '제목만 바꿈' }, icCal, { scope: 'one', previous: third });
  const first = cal.events()[0];
  await cal.provider.mutateEvent('update', { ...first, notes: '모두 바뀐 메모' }, icCal, { scope: 'all', previous: first });
  assert.equal(description(cal.vevents()[0]), '모두 바뀐 메모');
  assert.equal(description(cal.byDay('2026-10-22')) === `${long} 이날만 덧붙임`, true, 'its own words past the cut: its own note stays');
  assert.equal(description(cal.byDay('2026-10-23')), '모두 바뀐 메모', 'one that kept the series\' note follows');
});

test('iCloud: 「모든 일정」 keeps an occurrence whose HTML copy is its own though its words are the series\' (F2)', async () => {
  const cal = davCalendar();
  const [, second, third] = cal.events();
  await cal.provider.mutateEvent('update', { ...second, title: '옮긴 회의' }, icCal, { scope: 'one', previous: second });
  await cal.provider.mutateEvent('update', { ...third, title: '다른 회의' }, icCal, { scope: 'one', previous: third });
  // Another app made the 22nd's copy italic; its DESCRIPTION is still the series' own.
  const file = new ICAL.Component(ICAL.parse(cal.objects[0].data));
  const own = file.getAllSubcomponents('vevent').find(item => String(item.getFirstPropertyValue('recurrence-id') || '').startsWith('2026-10-22'));
  own.getFirstProperty('x-alt-desc').setValue('<i>안건</i>');
  cal.objects[0].data = file.toString();
  assert.equal([description(cal.byDay('2026-10-22')) === description(cal.vevents()[0]), String(cal.byDay('2026-10-22').getFirstPropertyValue('x-alt-desc'))].join('|'), 'true|<i>안건</i>');
  const first = cal.events()[0];
  await cal.provider.mutateEvent('update', { ...first, notes: '모두 바뀐 메모' }, icCal, { scope: 'all', previous: first });
  assert.equal([description(cal.byDay('2026-10-22')), String(cal.byDay('2026-10-22').getFirstPropertyValue('x-alt-desc'))].join('|'), '안건, 자료; 끝 \\ 표시\n둘째 줄|<i>안건</i>', 'its own formatting: kept, words and copy');
  assert.equal([description(cal.byDay('2026-10-23')), cal.byDay('2026-10-23').hasProperty('x-alt-desc')].join('|'), '모두 바뀐 메모|false', 'the series\' own copy: follows, the old copy gone');
});

// F3: a card write that failed rolls back only the fields still holding what it sent; a field typed again while it was on its way keeps the
// new words, and c.original goes back to the event's, so the next blur sends them (typing B after A's failed save lost B).
test('card: a failed write keeps what was typed after it went, and the next blur sends it; a field left alone goes back (F3)', async () => {
  const h = cardHarness();
  h.open(localEvent);
  let fail = null;
  h.context.answer = name => name === 'event:update' ? new Promise((resolve, reject) => { fail = () => reject(new Error('offline')); }) : {};
  h.type(h.box(), '메뉴 A'); h.blur(h.box());
  const flushing = h.eval('calCardFlush(calCard)');
  await h.tick();
  assert.equal([h.updates().length, typeof fail].join('|'), '1|function', 'A on its way');
  h.type(h.box(), '메뉴 B');
  fail(); await flushing;
  assert.equal([h.eval('calCard.v.notes'), h.box().value, h.eval('calCard.original.notes')].join('|'), '메뉴 B|메뉴 B|메뉴', 'B stays; the saved value is the event\'s again');
  h.context.answer = () => ({});
  h.blur(h.box()); await h.eval('calCardFlush(calCard)');
  assert.equal(h.updates().at(-1), json({ id: 'l1', notes: '메뉴 B' }), 'and goes on the next blur');
  // Nothing typed after the failed write: the field shows the event's own notes again, as before.
  h.context.answer = name => { if (name === 'event:update') throw new Error('offline'); return {}; };
  h.type(h.box(), '메뉴 C'); h.blur(h.box()); await h.eval('calCardFlush(calCard)');
  assert.equal([h.eval('calCard.v.notes'), h.box().value].join('|'), '메뉴|메뉴');
});

// Codex sixth review N4: the widget's dialog goes by the card's rule: 하루 종일 on and off gives the times back; else the next whole hour, no 09:00.
test('widget dialog: 하루 종일 on and off gives its times back; an all-day event off takes the next whole hour', async () => {
  const h = dialogHarness();
  const timed = { ...localEvent, allDay: false, start: '2026-11-05T15:00:00', end: '2026-11-05T16:30:00' };
  h.open(timed);
  const box = h.modalRoot.querySelector('input[name=allDay]'), start = h.modalRoot.querySelector('input[name=start]'), end = h.modalRoot.querySelector('input[name=end]');
  const flip = value => { box.checked = value; box.dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  const was = [start.value, end.value].join('|');
  flip(true); assert.equal([start.value, end.value].join('|'), '2026-11-05|2026-11-05');
  flip(false); assert.equal([start.value, end.value].join('|'), was);
  const D = require('../renderer/domain.js');
  const [s, e] = D.defaultEventTimes('2026-11-05');
  flip(true); end.value = '2026-11-06'; flip(false);
  assert.equal(start.value, s, 'another span: the next whole hour');
  assert.equal(end.value, e.startsWith('2026-11-05') ? '2026-11-06' + e.slice(10) : '2026-11-07T00:00');
});

// 2026-11-09 review F46: an occurrence of this PC's series edited on its own (masterId, no rule) takes no repeat rule — main refuses it as
// the card and the widget's dialog hide the 반복 field: with one it would be a series still tied to the old one, deleted with it.
test('F46: main refuses a repeat rule on an occurrence edited on its own; its other fields and a cleared rule still save', async t => {
  const m = mainEvents(t, null);
  const series = await m.command('event:add', { calendarId: 'local-calendar', title: '운동', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', rrule: 'FREQ=DAILY;COUNT=6' });
  const day = D.expandEvent(m.event(series.id), '2026-11-01', '2026-11-10').find(o => o.start.startsWith('2026-11-03')).recurrenceId;
  const own = await m.command('event:update', { id: `${series.id}@${day}`, scope: 'one', title: '운동 (짧게)' });
  assert.equal([Boolean(m.event(own.id).masterId), m.event(own.id).rrule || ''].join('|'), 'true|');
  await assert.rejects(m.command('event:update', { id: own.id, rrule: 'FREQ=WEEKLY' }), /반복/);
  assert.equal(m.event(own.id).rrule || '', '', 'no rule stored');
  await m.command('event:update', { id: own.id, title: '운동 (길게)', rrule: '' });
  assert.equal([m.event(own.id).title, m.event(own.id).rrule || ''].join('|'), '운동 (길게)|');
});

// 2026-11-09 사용자 결정 F47 「추가」: the widget's dialog has the card's 알림 above 색상 — the same choices (calendar.js calAlertRow: the
// timed or all-day list, 「당일 오전 9시」 only on this PC's and iCloud calendars, 「달력 기본값」 first for a new event on a connected
// calendar), refilled when 하루 종일 turns, the alert each kind had kept; an alert nobody changed is not sent.
function alertDialogHarness() {
  const h = dialogHarness();
  Object.assign(h.context, { calSeries: () => false, writableCalendars: () => h.context.state.calendars });
  h.loadCalendar();
  h.context.state.calendars[1].defaultAlert = 30;
  h.alert = () => h.modalRoot.querySelector('select[name=alert]');
  h.options = () => [...h.alert().querySelectorAll('option')].map(o => o.value + '=' + o.textContent).join(' | ');
  // The card's choices for the same event, calendar and kind (calAlertRow of the real calendar.js).
  h.card = (mode, event, calendarId) => {
    h.context.__ev = event;
    h.eval(`calCard = { mode: ${JSON.stringify(mode)}, event: ${mode === 'create' ? 'null' : '__ev'}, v: calValuesOf(__ev), calendarId: ${JSON.stringify(calendarId)}, pending: {} }`);
    return [...h.eval('calAlertRow(false)').querySelectorAll('option')].map(o => o.value + '=' + o.textContent).join(' | ');
  };
  h.flip = value => { const box = h.modalRoot.querySelector('input[name=allDay]'); box.checked = value; box.dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  h.pick = value => { h.alert().value = value; h.alert().dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  return h;
}

test('F47 widget dialog: 알림 above 색상 with the card\'s choices; unchanged is not sent; 하루 종일 refills and gives the timed alert back', async () => {
  const h = alertDialogHarness();
  const timed = { ...localEvent, alert: 60 };
  const dialog = h.open(timed);
  const labels = [...dialog.querySelectorAll('.form-field > span, .field > span, label > span')].map(n => n.textContent);
  assert.equal(labels.indexOf('알림') >= 0 && labels.indexOf('알림') === labels.indexOf('색상') - 1, true, '알림 right above 색상: ' + labels.join(','));
  assert.equal(h.alert().value, '60');
  assert.equal(h.options(), h.card('edit', timed, 'local-calendar'), 'the same choices as the card (timed, this PC)');
  h.modalRoot.querySelector('[name=title]').value = '점심 2'; await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'alert'), false, 'untouched: not sent');
  // 하루 종일 on: the all-day list and its default; off again: 1시간 전 back, so nothing to send.
  h.open(timed);
  h.flip(true);
  assert.equal(h.options(), h.card('edit', { ...timed, allDay: true, start: '2026-11-05', end: '2026-11-06', alert: -540 }, 'local-calendar'));
  assert.equal(h.alert().value, '-540');
  h.flip(false);
  assert.equal(h.alert().value, '60', 'the timed alert comes back');
  await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'alert'), false);
  // A changed alert is sent; 알림 없음 as null.
  h.open(timed); h.pick('15'); await h.submit();
  assert.equal(h.sent().at(-1).alert, 15);
  h.open(timed); h.pick('none'); await h.submit();
  assert.equal(h.sent().at(-1).alert, null);
});

test('F47 widget dialog: a new event on a connected calendar starts on 「달력 기본값」 (not sent); Google has no 당일 alert', async () => {
  const h = alertDialogHarness();
  const calendar = id => { const n = h.modalRoot.querySelector('select[name=calendarId]'); n.value = id; n.dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  h.open(null); calendar('gcal');
  const draft = { start: '2026-11-05', end: '2026-11-06', allDay: true };
  assert.equal(h.alert().value, 'default');
  assert.equal(h.options(), h.card('create', draft, 'gcal'), 'the same choices as the card (new, all-day, Google)');
  assert.equal(h.options().includes('-540='), false, 'no 당일 오전 9시 on Google');
  h.modalRoot.querySelector('[name=title]').value = '휴가'; await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'alert'), false, 'the calendar\'s default: nothing sent');
  h.open(null); calendar('gcal'); calendar('local-calendar');
  assert.equal(h.alert().value, 'none', 'back on this PC: 알림 없음');
  assert.equal(h.options(), h.card('create', draft, 'local-calendar'), 'this PC: no 달력 기본값, 당일 offered');
  h.pick('-540'); h.modalRoot.querySelector('[name=title]').value = '휴가'; await h.submit();
  assert.equal(h.sent().at(-1).alert, -540);
});

test('F47 widget dialog: 「당일 오전 9시」 on a new all-day event becomes the calendar\'s default when the calendar becomes Google, as on the card (Argon review 2026-11-09 G1)', async () => {
  const h = alertDialogHarness();
  const calendar = id => { const n = h.modalRoot.querySelector('select[name=calendarId]'); n.value = id; n.dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  h.open(null); calendar('local-calendar');
  h.pick('-540');
  assert.equal(h.alert().value, '-540');
  calendar('gcal');
  const draft = { start: '2026-11-05', end: '2026-11-06', allDay: true };
  assert.equal(h.alert().value, 'default', 'Google keeps only alerts before the start');
  assert.equal(h.options().includes('-540='), false, 'no 당일 오전 9시 left in the list');
  assert.equal(h.options(), h.card('create', draft, 'gcal'), 'the same choices as the card');
  h.modalRoot.querySelector('[name=title]').value = '휴가'; await h.submit();
  assert.equal(Object.hasOwn(h.sent().at(-1), 'alert'), false, 'the calendar\'s default: nothing sent, so Google has nothing to refuse');
});
