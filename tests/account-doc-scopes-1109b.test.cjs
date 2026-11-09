'use strict';
// The guides name the permissions Dayboard really asks for (2026-11-09 review F7, F37, F106). 계정 연결.md tells the
// reader to stop if the consent screen shows a permission its table lacks, so the table must hold every scope of
// lib/providers/oauth.cjs, the notes ones included (Google drive.appdata always, Microsoft Files.ReadWrite.AppFolder
// when 메모 is on). Both guides are private (not in the public source), so each test skips without its file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('../lib/providers/oauth.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const MS_NOTES = (read('lib/providers/oauth.cjs').match(/const MS_NOTES_SCOPE = '([^']+)'/) || [])[1];

test('계정 연결.md: the permission table holds every scope Dayboard asks for', { skip: !fs.existsSync(path.join(root, '계정 연결.md')) && '계정 연결.md is private (not in the public source)' }, () => {
  const doc = read('계정 연결.md');
  const table = doc.slice(doc.indexOf('### Dayboard가 요청하는 권한'), doc.indexOf('**달력 쓰기 권한'));
  assert.equal(typeof MS_NOTES, 'string');
  const microsoft = [...CONFIG.microsoft.scopes, MS_NOTES].map(s => s.replace('https://graph.microsoft.com/', ''));
  const missing = [...microsoft, ...CONFIG.google.scopes].filter(scope => !table.includes(`\`${scope}\``));
  assert.equal(missing.join(), '');
  assert.equal(/목록보다 넓은 권한/.test(doc), false, 'stop only for a permission the table lacks');
  const step3 = doc.split('\n').find(line => line.startsWith('3. 동의 화면에 앱 이름이 **Microsoft Graph Command Line Tools**')) || '';
  assert.equal(step3.includes('Files.ReadWrite.AppFolder'), true, 'the Microsoft sign-in steps name the notes folder too');
  const google = doc.split('\n').find(line => line.startsWith('2. 기본 브라우저에 Google 로그인 창이 열림.')) || '';
  assert.equal(google.includes('drive.appdata'), true, 'so do the Google ones');
});

test('시작하기.md: the consent screens ask for calendar read and write and the notes folder', { skip: !fs.existsSync(path.join(root, '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = read('시작하기.md');
  assert.equal(guide.includes('달력 읽기, 계정 확인') || guide.includes('캘린더 읽기, 계정 확인'), false);
  assert.equal(guide.includes('할 일 읽기·쓰기, 달력 읽기·쓰기, 계정 확인'), true);
  assert.equal(guide.includes('Google Tasks 읽기·쓰기, 캘린더 읽기·쓰기'), true);
  assert.equal(guide.includes('OneDrive 앱 폴더') && guide.includes('drive.appdata'), true, 'the notes folder on both');
});

test('계정 연결.md calls Apple\'s password 앱 암호, as the app does', { skip: !fs.existsSync(path.join(root, '계정 연결.md')) && '계정 연결.md is private (not in the public source)' }, () => {
  const { EN } = require('../renderer/i18n.js');
  assert.equal(EN['앱 암호'], 'App-specific password');
  assert.equal(read('계정 연결.md').includes('앱 전용 암호'), false);
});

// Design review after F7·F37: the account window draws 「메모」 for Microsoft as for Google (renderer/app.js), so neither guide says
// Google alone has it.
test('both guides give 「메모」 to Microsoft and Google alike', () => {
  const app = read('renderer/app.js');
  assert.equal(app.includes("a.provider==='google'||a.provider==='microsoft'?h('label',{class:'sync-toggle checkbox-field'}"), true);
  for (const file of ['계정 연결.md', '시작하기.md']) {
    if (!fs.existsSync(path.join(root, file))) continue;
    assert.equal(/(?<!Microsoft·)Google은 메모도/.test(read(file)), false, file);
  }
});
