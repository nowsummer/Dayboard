'use strict';
// Settings 「문의」 opens a mail with the app version, the Windows version and the copy filled in (owner 2026-11-14, 「넣기」 for 1.2.13),
// inside the security rules of before: main builds the address itself from four values (lib/contact.cjs contactMailUrl) behind contact:mail,
// which takes nothing from the page; external:open still opens a mailto only to the bare address, with no subject or body.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contactMailUrl } = require('../lib/contact.cjs');
const { CONTACT_EMAIL } = require('../renderer/domain.js');
const { COMMAND_LANES } = require('../lib/lanes.cjs');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const caseBody = label => {
  const at = main.indexOf(`    case '${label}':`);
  assert.ok(at > 0, label);
  const end = main.indexOf('\n    case ', at + 10);
  return main.slice(at, end);
};

test('the address for 1.2.13 on Windows 10.0.26300: Korean and English, the GitHub and the Store copy, exactly', () => {
  assert.equal(contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'github', lang: 'ko' }),
    'mailto:nowsummer.apps@gmail.com?subject=Dayboard%201.2.13%20%EB%AC%B8%EC%9D%98&body=%0D%0A%0D%0A%EC%95%B1%20%EB%B2%84%EC%A0%84%3A%201.2.13%0D%0AWindows%3A%2010.0.26300%0D%0A%ED%8C%90%3A%20GitHub');
  assert.equal(contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'store', lang: 'en' }),
    'mailto:nowsummer.apps@gmail.com?subject=Dayboard%201.2.13%20question&body=%0D%0A%0D%0AApp%20version%3A%201.2.13%0D%0AWindows%3A%2010.0.26300%0D%0AEdition%3A%20Microsoft%20Store');
  assert.equal(contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'store', lang: 'ko' }),
    'mailto:nowsummer.apps@gmail.com?subject=Dayboard%201.2.13%20%EB%AC%B8%EC%9D%98&body=%0D%0A%0D%0A%EC%95%B1%20%EB%B2%84%EC%A0%84%3A%201.2.13%0D%0AWindows%3A%2010.0.26300%0D%0A%ED%8C%90%3A%20Microsoft%20Store');
  // Read back as a mail program reads it: Dayboard's own address, two empty lines to write in, then the three lines.
  const url = new URL(contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'github', lang: 'en' }));
  assert.equal(url.protocol, 'mailto:');
  assert.equal(decodeURIComponent(url.pathname), CONTACT_EMAIL);
  assert.deepEqual([...url.searchParams.keys()], ['subject', 'body']);
  assert.equal(url.searchParams.get('subject'), 'Dayboard 1.2.13 question');
  assert.equal(url.searchParams.get('body'), '\r\n\r\nApp version: 1.2.13\r\nWindows: 10.0.26300\r\nEdition: GitHub');
});

test('nothing personal gets in: only the four values are read, and a value of a strange shape is not written', () => {
  const env = { USERNAME: process.env.USERNAME, COMPUTERNAME: process.env.COMPUTERNAME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { USERNAME: 'zq-user-name', COMPUTERNAME: 'ZQ-PC-NAME', USERPROFILE: 'D:\\Profiles\\zq-user-name' });
  try {
    const plain = contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'github', lang: 'ko' });
    const extra = contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'github', lang: 'ko', user: 'zq-user-name', home: 'D:\\Profiles\\zq-user-name', account: 'zq@example.com', settings: { theme: 'dark' } });
    assert.equal(extra, plain, 'other fields are not read');
    const text = decodeURIComponent(plain);
    for (const word of ['zq', 'ZQ', 'Profiles', 'example.com', 'dark', '\\']) assert.equal(text.includes(word), false, word);
    // The decoded mail is the fixed words and the two version numbers, nothing else.
    assert.equal(text, `mailto:${CONTACT_EMAIL}?subject=Dayboard 1.2.13 문의&body=\r\n\r\n앱 버전: 1.2.13\r\nWindows: 10.0.26300\r\n판: GitHub`);
  } finally {
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  // A version or release that is not a plain version number becomes '?': no line breaks, addresses or paths reach the mail.
  const odd = new URL(contactMailUrl({ version: '1.2.13\r\nBcc: x@y.z', release: 'D:\\Profiles\\me', edition: 'other', lang: 'xx' }));
  assert.equal(odd.searchParams.get('subject'), 'Dayboard ? 문의');
  assert.equal(odd.searchParams.get('body'), '\r\n\r\n앱 버전: ?\r\nWindows: ?\r\n판: GitHub');
  assert.equal(decodeURIComponent(odd.pathname), CONTACT_EMAIL);
});

test('main: contact:mail takes no input from the page and opens the address built from the app, Windows, the copy and the app language', async () => {
  const body = caseBody('contact:mail');
  assert.equal(/payload/.test(body), false, 'the page sends nothing it reads');
  assert.match(main, /const \{ contactMailUrl \} = require\('\.\/lib\/contact\.cjs'\);/);
  const run = async (deps) => {
    const opened = [];
    const fn = new Function('deps', `with (deps) { return (async () => { switch ('contact:mail') { ${body} } })(); }`);
    const answer = await fn({ shell: { openExternal: async href => { opened.push(href); } }, app: { getVersion: () => '1.2.13' }, os: { release: () => '10.0.26300' }, i18n: { getLanguage: () => deps.lang }, contactMailUrl, STORE: deps.STORE,
      payload: { url: 'mailto:someone@example.com', subject: 'x', body: 'y' } });
    return { answer, opened };
  };
  const ko = await run({ STORE: false, lang: 'ko' });
  assert.equal(ko.answer, true);
  assert.deepEqual(ko.opened, [contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'github', lang: 'ko' })]);
  const en = await run({ STORE: true, lang: 'en' });
  assert.deepEqual(en.opened, [contactMailUrl({ version: '1.2.13', release: '10.0.26300', edition: 'store', lang: 'en' })]);
  // It waits in no account's line: a local command (lib/lanes.cjs).
  assert.equal(COMMAND_LANES['contact:mail'](), 'local');
});

test('external:open keeps its guard: the bare address only, a subject or body from the page is still refused', async () => {
  const body = main.slice(main.indexOf("    case 'external:open': {"), main.indexOf("    case 'backup:export': {"));
  assert.match(body, /url\.protocol === 'mailto:' && decodeURIComponent\(url\.pathname\) === CONTACT_EMAIL && !url\.search && !url\.hash\) \{ await shell\.openExternal\(`mailto:\$\{CONTACT_EMAIL\}`\); return true; \}/);
  const inner = body.replace("    case 'external:open': ", '').trim();
  const go = async url => {
    const opened = [];
    const fn = new Function('deps', `with (deps) { return (async () => ${inner})(); }`);
    try { await fn({ STORE: false, shell: { openExternal: async href => { opened.push(href); } }, payload: { url }, text: value => value, tr: value => value, CONTACT_EMAIL, URL, decodeURIComponent, Set }); }
    catch (error) { return `threw:${error.message}`; }
    return opened.join(',');
  };
  assert.equal(await go(`mailto:${CONTACT_EMAIL}`), `mailto:${CONTACT_EMAIL}`);
  for (const url of [`mailto:${CONTACT_EMAIL}?subject=x`, `mailto:${CONTACT_EMAIL}?body=x`, `mailto:${CONTACT_EMAIL}#x`, 'mailto:someone@example.com'])
    assert.equal(await go(url), 'threw:안전한 HTTPS 웹 주소만 열 수 있습니다.', url);
});

test('settings: the 「문의」 link keeps the plain address to copy and opens the filled mail through contact:mail', () => {
  const link = app.slice(app.indexOf("h('p',{class:'settings-contact'}"), app.indexOf("h('footer',{class:'dialog-footer bare'})"));
  assert.match(link, /h\('a',\{href:'mailto:'\+D\.CONTACT_EMAIL,onclick:e=>\{e\.preventDefault\(\);api\.invoke\('contact:mail'\)\.catch\(error=>toast\(error\.message,true\)\);\}\},D\.CONTACT_EMAIL\)/);
  assert.equal(/external:open/.test(link), false);
  assert.equal(/api\.invoke\('external:open',\{url:'mailto:/.test(app), false, 'no page code sends a mailto any more');
  // The command is in the contract with the others (a private document: the public source has none).
  const contract = path.join(root, 'CONTRACT.md');
  if (fs.existsSync(contract)) assert.match(fs.readFileSync(contract, 'utf8'), /contact:mail \(인자 없음/);
});
