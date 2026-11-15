'use strict';
// Settings 「문의」 (owner 2026-11-14): a new mail to Dayboard's own address with the app version, the Windows version and the copy filled in,
// so a question arrives with what is needed to answer it. main.cjs contact:mail builds it from these four values alone — nothing the page
// sends, and no name, account, path, PC name or setting — and external:open keeps opening only the bare address (tests/contact-mail-1114).
const { CONTACT_EMAIL } = require('../renderer/domain.js');
const { translate } = require('../renderer/i18n.js');

// A version number as app.getVersion() and os.release() give it; anything else is written as '?'.
const plain = value => (/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(String(value)) ? String(value) : '?');

function contactMailUrl({ version, release, edition, lang }) {
  const language = lang === 'en' ? 'en' : 'ko';
  const tr = (key, params) => translate(language, key, params);
  const subject = tr('Dayboard {0} 문의', [plain(version)]);
  // Two empty lines to write in, then the three lines.
  const body = ['', '', tr('앱 버전: {0}', [plain(version)]), `Windows: ${plain(release)}`, tr('판: {0}', [edition === 'store' ? 'Microsoft Store' : 'GitHub'])].join('\r\n');
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

module.exports = { contactMailUrl };
