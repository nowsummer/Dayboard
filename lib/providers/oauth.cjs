'use strict';
const { tr } = require('../i18n.cjs');

const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// A shipped app embeds its publisher's Google OAuth client (Google treats installed
// app secrets as non-confidential), so users only click "sign in". The file is
// optional: without it the connect dialog shows the publisher's one-time setup.
const PUBLISHER_CLIENT_FILES = () => [process.env.DAYBOARD_GOOGLE_CLIENT_FILE, path.join(__dirname, '..', '..', 'assets', 'google-oauth.json')];
function loadPublisherClient(candidates = PUBLISHER_CLIENT_FILES()) {
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : '';
      if (clientId && clientId.length <= 300 && !/[\s<>]/.test(clientId)) return { clientId, clientSecret: typeof data.clientSecret === 'string' ? data.clientSecret.trim() : '' };
    } catch { /* malformed file: behave as if absent */ }
  }
  return null;
}
const CONFIG = Object.freeze({
  microsoft: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // Calendars.ReadWrite (2026-10-20): events are written to Outlook calendars from Dayboard.
    scopes: ['offline_access', 'https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Tasks.ReadWrite', 'https://graph.microsoft.com/Calendars.ReadWrite'],
    // Microsoft's own public client "Microsoft Graph Command Line Tools" (the
    // Microsoft Graph PowerShell app). It signs in personal Microsoft accounts,
    // accepts the http://localhost loopback redirect and needs no client secret,
    // so this personal build can sign in without an Entra app registration,
    // which personal accounts cannot create without an Azure subscription.
    // The user may still supply their own registration (advanced option).
    publicClientId: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    publicClientName: 'Microsoft Graph Command Line Tools',
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    // calendar.readonly lists the calendars (CalendarList), calendar.events writes events to them
    // (2026-10-20; narrower than the full "calendar" scope, which could also delete calendars).
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
    publisher: loadPublisherClient(),
  },
});
function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
function stateMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function parseCallback(url, expectedState) {
  if (url.searchParams.getAll('state').length !== 1 || !stateMatches(url.searchParams.get('state'), expectedState)) {
    throw new Error(tr('로그인 응답의 보안 확인에 실패했습니다. 계정 연결을 다시 시작해 주세요.'));
  }
  if (url.searchParams.has('error')) {
    const code = String(url.searchParams.get('error') || '').replace(/[^\w.-]/g, '').slice(0, 60);
    const detail = String(url.searchParams.get('error_description') || '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, 160);
    throw new Error(tr("로그인이 취소되었거나 계정 접근이 허용되지 않았습니다.{0}", [code ? ` (${code}${detail ? `: ${detail}` : ''})` : '']));
  }
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 8192) throw new Error(tr('로그인 인증 코드를 받지 못했습니다. 다시 연결해 주세요.'));
  return codes[0];
}
function normalizeTokens(body, previous = {}) {
  if (!body || typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 64000
    || String(body.token_type || '').toLowerCase() !== 'bearer' || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) {
    throw new Error(tr('로그인 서비스가 유효한 인증 정보를 반환하지 않았습니다. 다시 연결해 주세요.'));
  }
  const refreshToken = body.refresh_token || previous.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 64000) {
    throw new Error(tr('자동 동기화 권한을 받지 못했습니다. 계정을 다시 연결하고 요청한 권한을 허용해 주세요.'));
  }
  // The granted scopes come back with the tokens (both services). They decide whether this sign-in
  // may write to calendars: a sign-in from before the write scopes were added keeps its old grant.
  const scope = typeof body.scope === 'string' && body.scope.length <= 4000 ? body.scope : previous.scope;
  return { accessToken: body.access_token, refreshToken, expiresAt: Date.now() + Number(body.expires_in) * 1000, ...(scope ? { scope } : {}) };
}
// Whether a stored sign-in is allowed to write calendar events. iCloud's app password always is;
// Google and Microsoft need the write scope in the grant recorded at sign-in (older grants lack it).
function calendarWriteScope(credential) {
  if (!credential) return false;
  if (credential.provider === 'icloud') return true;
  const scope = String(credential.scope || '');
  if (credential.provider === 'google') return /\/auth\/calendar(?:\.events)?(?=\s|$)/.test(scope);
  if (credential.provider === 'microsoft') return /Calendars\.ReadWrite/i.test(scope);
  return false;
}
function createVault(userData, safeStorage) {
  const file = path.join(userData, 'cloud-credentials.bin');
  let loaded = false; let data = {}; let notice = null;
  function encryptionReady() {
    if (!safeStorage?.isEncryptionAvailable?.() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error(tr('Windows의 보안 저장소를 사용할 수 없습니다. 계정 연결 정보는 저장하지 않았습니다.'));
    }
  }
  function read() {
    if (loaded) return data;
    encryptionReady();
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('format');
      } catch {
        // Undecryptable after a Windows profile or DPAPI change: keep the original
        // aside and continue with an empty vault so accounts can be reconnected.
        const aside = `${file}.corrupt-${Date.now()}`;
        try { fs.renameSync(file, aside); } catch { /* leave it in place; the next write replaces it */ }
        data = {};
        notice = tr("이 PC에서 계정 보관함을 열 수 없어 비워 두었습니다(원본은 {0}로 보존). 계정을 다시 연결해 주세요.", [path.basename(aside)]);
      }
    }
    loaded = true;
    return data;
  }
  function write(next) {
    encryptionReady();
    fs.mkdirSync(userData, { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(next));
    const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, encrypted, { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    data = next; loaded = true;
  }
  return {
    get(id) { return read()[id]; },
    set(id, credential) { write({ ...read(), [id]: credential }); },
    remove(id) { const next = { ...read() }; delete next[id]; write(next); },
    notice() { read(); return notice; },
  };
}
// The OAuth error body names the actual problem (missing client secret, wrong
// platform, expired test-mode grant); keep a short, sanitized copy for the user.
async function errorDetail(response) {
  try {
    const body = await response.json();
    return [body?.error, body?.error_description]
      .filter(value => typeof value === 'string' && value)
      .map(value => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 160))
      .join(': ');
  } catch { return ''; }
}
function tokenHint(detail) {
  if (/client_secret/i.test(detail)) return tr('Google 데스크톱 앱 클라이언트는 클라이언트 보안 비밀도 함께 입력해야 합니다.');
  if (/AADSTS7000218/.test(detail)) return tr('Microsoft 앱 등록의 리디렉션 URI를 「모바일 및 데스크톱 애플리케이션」 플랫폼에 두거나 「공용 클라이언트 흐름 허용」을 켜 주세요.');
  if (/AADSTS50011/.test(detail)) return tr('Microsoft 앱 등록에 리디렉션 URI http://localhost 가 등록되어 있는지 확인해 주세요.');
  if (/AADSTS50020|AADSTS700016|AADSTS65002|unauthorized_client/i.test(detail)) return tr('Microsoft가 이 계정에 기본 로그인 앱 사용을 허용하지 않았습니다. 연결 화면의 「직접 등록한 앱 사용」을 따라 주세요.');
  if (/invalid_grant/i.test(detail)) return tr('로그인 권한이 만료되었습니다. Google 테스트 상태 앱은 7일마다 다시 로그인이 필요합니다.');
  return tr('로그인 권한이 만료되었거나 앱 등록 정보가 맞지 않습니다.');
}
async function tokenRequest(provider, params, previous, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(CONFIG[provider].token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(), redirect: 'error', signal: AbortSignal.timeout(25000),
    });
  } catch { throw new Error(tr('로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')); }
  if (!response.ok) {
    const detail = await errorDetail(response);
    if (response.status === 400 || response.status === 401) throw new Error(tr("{0} 계정 연결 설정을 확인하고 다시 로그인해 주세요.{1}", [tokenHint(detail), detail ? ` (${detail})` : '']));
    throw new Error(tr("로그인 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요. (HTTP {0}{1})", [response.status, detail ? `, ${detail}` : '']));
  }
  let body; try { body = await response.json(); } catch { throw new Error(tr('로그인 응답을 읽을 수 없습니다. 다시 연결해 주세요.')); }
  return normalizeTokens(body, previous);
}
function createAuthenticator({ shell, fetchImpl = globalThis.fetch }) {
  const pending = new Set();
  async function authorize(provider, clientId, clientSecret) {
    const config = CONFIG[provider];
    if (!config) throw new Error(tr('지원하지 않는 로그인 서비스입니다.'));
    if (!clientId && config.publicClientId) clientId = config.publicClientId;
    if (!clientId && config.publisher) { clientId = config.publisher.clientId; clientSecret = clientSecret || config.publisher.clientSecret; }
    if (!clientId) throw new Error(tr("{0}가 필요합니다. 연결 화면의 안내를 확인해 주세요.", [provider === 'microsoft' ? tr('Microsoft 앱 등록의 애플리케이션(클라이언트) ID') : tr('Google 데스크톱 앱의 클라이언트 ID')]));
    if (clientId.length > 300 || /[\s<>]/.test(clientId)) throw new Error(tr('클라이언트 ID 형식을 확인해 주세요.'));
    const state = crypto.randomBytes(32).toString('base64url'); const { verifier, challenge } = pkcePair();
    let server; let timeout; let finish; let redirectUri;
    const result = new Promise((resolve, reject) => {
      let finished = false;
      finish = (error, code) => {
        if (finished) return; finished = true;
        clearTimeout(timeout); pending.delete(cancel); server?.close(); server?.closeAllConnections?.();
        if (error) reject(error); else resolve(code);
      };
      const cancel = error => finish(error || new Error(tr('앱이 종료되어 로그인이 취소되었습니다.')));
      pending.add(cancel);
      server = http.createServer((req, res) => {
        const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
        let url;
        try { url = new URL(req.url, redirectUri); } catch { res.writeHead(400, headers); res.end(tr('잘못된 요청')); return; }
        if (req.method !== 'GET' || url.pathname !== '/') { res.writeHead(404, headers); res.end(''); return; }
        let code;
        try { code = parseCallback(url, state); }
        catch (error) {
          res.writeHead(400, headers); res.end(tr('<meta charset="utf-8"><p>로그인을 확인하지 못했습니다. Dayboard에서 다시 연결해 주세요.</p>'));
          // A stray local request cannot cancel the legitimate authorization flow.
          if (stateMatches(url.searchParams.get('state'), state)) setImmediate(() => finish(error));
          return;
        }
        res.writeHead(200, headers);
        res.end(tr('<meta charset="utf-8"><title>Dayboard</title><body style="font:18px system-ui;padding:64px;color:#26342f;background:#f5f8f5"><h1>Dayboard에 연결 중입니다.</h1><p>이 창을 닫고 앱으로 돌아가세요.</p></body>'));
        setImmediate(() => finish(null, code));
      });
      server.on('error', () => finish(new Error(tr('로그인 응답을 받을 임시 창을 열지 못했습니다. 앱을 다시 시작해 주세요.'))));
      server.listen(0, '127.0.0.1', async () => {
        if (finished) { server.close(); return; } // cancelled before the listener was ready: open no browser
        redirectUri = `http://${provider === 'microsoft' ? 'localhost' : '127.0.0.1'}:${server.address().port}/`;
        const url = new URL(config.authorize);
        for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: config.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', prompt: provider === 'google' ? 'consent' : 'select_account' })) url.searchParams.set(key, value);
        if (provider === 'google') url.searchParams.set('access_type', 'offline');
        timeout = setTimeout(() => finish(new Error(tr('로그인 대기 시간이 지났습니다. 계정 연결을 다시 시작해 주세요.'))), 180000);
        try { await shell.openExternal(url.href); } catch { finish(new Error(tr('기본 브라우저를 열지 못했습니다. Windows 기본 브라우저 설정을 확인해 주세요.'))); }
      });
    });
    const code = await result;
    const params = { client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' };
    if (provider === 'google' && clientSecret) params.client_secret = clientSecret;
    if (provider === 'microsoft') params.scope = config.scopes.join(' ');
    const token = await tokenRequest(provider, params, {}, fetchImpl);
    return { provider, clientId, ...(provider === 'google' && clientSecret ? { clientSecret } : {}), ...token };
  }
  async function refresh(credential) {
    const params = { client_id: credential.clientId, refresh_token: credential.refreshToken, grant_type: 'refresh_token' };
    if (credential.provider === 'google' && credential.clientSecret) params.client_secret = credential.clientSecret;
    // A refresh may only ask for scopes the user already granted; asking for a newer scope (e.g.
    // Calendars.ReadWrite on a sign-in that only has Calendars.Read) would fail every sync with a
    // consent error. Resend the recorded grant, or omit the parameter so the same scopes come back.
    if (credential.provider === 'microsoft' && credential.scope) params.scope = credential.scope;
    return { ...credential, ...await tokenRequest(credential.provider, params, credential, fetchImpl) };
  }
  // Ends every sign-in still waiting for the browser (the user pressed 취소, or a new sign-in replaces it). A token
  // exchange already under way is not in `pending` and finishes normally. The error carries `cancelled: true`.
  function cancelPending() {
    const count = pending.size;
    const error = Object.assign(new Error(tr('로그인을 취소했어요.')), { cancelled: true });
    for (const cancel of [...pending]) cancel(error);
    return count;
  }
  return { authorize, refresh, cancelPending, dispose() { for (const cancel of [...pending]) cancel(); } };
}
// What the connect dialog needs to know: which providers sign in with one click.
function providerStatus() {
  return {
    microsoft: { builtIn: true, name: CONFIG.microsoft.publicClientName },
    google: { builtIn: Boolean(CONFIG.google.publisher), name: 'Dayboard' },
    icloud: { builtIn: true, name: 'iCloud' },
  };
}
module.exports = { createAuthenticator, createVault, pkcePair, stateMatches, parseCallback, normalizeTokens, tokenRequest, providerStatus, loadPublisherClient, calendarWriteScope, CONFIG };
