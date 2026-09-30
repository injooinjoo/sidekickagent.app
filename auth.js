(() => {
  'use strict';

  // One sign-in for every page of the site. Every page carries the same header
  // account slot (#account-pill) and loads this file: signed out, the slot opens
  // the sign-in sheet in place; signed in, it opens a small menu with the
  // account page, AI 연결 and 로그아웃. /membership/, /ai/ and /account/ also
  // use the sheet and the one `api()` for their own calls.
  //
  // The doors are the ones the app offers, and the backend is the same.
  //
  // A sign-in lasts 30 days in this browser (owner decision 2026-09-30, "30일
  // 유지"): across pages, tabs and restarts, until it expires or the person
  // signs out. The one credential kept is the Sidekick session token the
  // backend minted, with its expiry, under one localStorage key (beside it
  // only a display hint: which door, which address). Never a Supabase token or
  // refresh token, never in a URL; it goes out only as an Authorization header. Every page load asks the server whether it still
  // holds, and 로그아웃 in one tab signs every open tab out (the storage event).
  //
  // Google and Apple are Supabase logins in the app. No SDK is loaded: a
  // redirect to Supabase's authorize endpoint, and an access token read back
  // out of the URL fragment, which is cleared at once. That token lasts about
  // an hour, so it is not kept: it is presented once, from memory, to POST
  // /auth/session/exchange, which answers with a 30-day Sidekick session on the
  // same account -- what an email, phone or ChatGPT sign-in already hands over.
  const API_ORIGIN = 'https://api.sidekickagent.app';
  const SUPABASE_ORIGIN = 'https://wdjlokfsehsnvcipkods.supabase.co';
  const SUPABASE_PROVIDERS = { google: 'Google', apple: 'Apple' };
  // The one return address Supabase is told about. A page on this list leaves
  // its own path behind, and the membership page sends the person straight back
  // to it after the fragment is read. Any other page (the landing, a policy
  // page, the 404) returns to the account page rather than to /membership/: a
  // sign-in started on a page the app opens must not end on the web checkout.
  const RETURN_URL = 'https://sidekickagent.app/membership/';
  const RETURN_PATHS = ['/ai/', '/account/'];
  const DEFAULT_RETURN_PATH = '/account/';
  // Per tab (sessionStorage): where a Google/Apple sign-in started, and a
  // message to say on the page it comes back to.
  const RETURN_KEY = 'sidekick_web_return_path';
  const NOTICE_KEY = 'sidekick_web_auth_notice';
  // The session (localStorage): {token, expires_at}, one JSON value, so another
  // tab never reads a token without its expiry.
  const SESSION_KEY = 'sidekick_web_session';
  // Where the bearer lived before the 30-day session (sessionStorage, per tab).
  // Read once at start, moved into SESSION_KEY or traded, and removed.
  const LEGACY_TOKEN_KEY = 'sidekick_web_access_token';
  // What the person signed in with and the address the sign-in answer named,
  // for display only: "Google로 로그인했어요 · a@b.com". Never a token or a
  // code, kept beside the session (localStorage) and cleared with it.
  const PROFILE_KEY = 'sidekick_web_account_hint';
  // A ChatGPT sign-in's one-time claim on its own account as a project's AI
  // (sessionStorage, per tab): see keepChatGptHandoff().
  const HANDOFF_KEY = 'sidekick_web_chatgpt_handoff';
  // The server keeps the account for a day (CHATGPT_LOGIN_HANDOFF_SECONDS);
  // the page stops offering it a little before that.
  const HANDOFF_MAX_AGE_MS = 23 * 60 * 60 * 1000;
  // Every token the backend mints names this issuer (login.py
  // _issue_sidekick_session_token). Only such a token is ever kept: a Supabase
  // token names Supabase and so can never reach storage.
  const SIDEKICK_ISSUER = 'sidekick-auth';
  // The backend's session lifetime. Nothing is kept longer, whatever an answer says.
  const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;
  // setTimeout holds a delay of at most 2^31-1 ms (about 24.8 days).
  const MAX_TIMER_MS = 2147483000;
  // 32 random bytes are 43 base64url characters: inside the server's
  // ^[A-Za-z0-9_-]{32,128}$ for a ChatGPT sign-in's app_state.
  const APP_STATE_BYTES = 32;
  const NETWORK_COPY = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  const SOCIAL_FAILED_COPY = '로그인이 완료되지 않았어요. 다시 시도해 주세요.';
  const EXCHANGE_FAILED_COPY = '로그인은 됐지만 계정을 확인하지 못했어요. 다시 시도해 주세요.';
  const EXPIRED_COPY = '로그인이 만료돼 로그아웃했어요. 다시 로그인해 주세요.';
  const DELETION_PENDING_COPY = '계정 삭제가 진행 중이라 로그인할 수 없어요. 30일 안에는 앱에서 되돌릴 수 있어요.';
  const CHECK_FAILED_COPY = '계정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  // Every way in the app offers, so a purchase or a connection is attached to
  // the account the person already has instead of minting a second one.
  const AUTH_METHODS = {
    email: { label: '이메일', inputType: 'email', autocomplete: 'email', placeholder: '' },
    phone: { label: '휴대폰', inputType: 'tel', autocomplete: 'tel', placeholder: '010-1234-5678' }
  };
  // How each way in is named to the person. `supabase` is Google or Apple when
  // the page no longer knows which door was pressed; `unknown` is the server's
  // word for the same (GET /account, POST /auth/session/exchange).
  const METHOD_PHRASES = {
    google: 'Google로 로그인했어요',
    apple: 'Apple로 로그인했어요',
    chatgpt: 'ChatGPT로 로그인했어요',
    email: '이메일로 로그인했어요',
    phone: '휴대폰 번호로 로그인했어요',
    kakao: '카카오로 로그인했어요',
    naver: '네이버로 로그인했어요',
    supabase: 'Google 또는 Apple로 로그인했어요',
    unknown: 'Google 또는 Apple로 로그인했어요'
  };
  const METHOD_LABELS = {
    google: 'Google', apple: 'Apple', chatgpt: 'ChatGPT', email: '이메일', phone: '휴대폰 번호',
    kakao: '카카오', naver: '네이버', supabase: 'Google 또는 Apple', unknown: 'Google 또는 Apple'
  };
  const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

  // The sheet every page without its own copy gets. /membership/ and /ai/ carry
  // the same markup in their HTML (same ids, bound the same way below), so a
  // page with JavaScript off still shows the doors there.
  const SHEET_HTML = [
    '<div class="signin-sheet" id="signin-sheet" hidden aria-modal="true" role="dialog" aria-label="로그인">',
    '<div class="signin-inner">',
    '<button class="sheet-close" type="button" id="close-signin" aria-label="닫기">',
    '<svg viewBox="0 0 24 24" aria-hidden="true" data-icon="close"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    '</button>',
    '<div class="signin-body">',
    '<span class="signin-mark" aria-hidden="true">',
    '<svg viewBox="0 0 24 24" data-icon="flash"><path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9z"/></svg>',
    '</span>',
    '<h2>사이드킥 로그인</h2>',
    '<div class="doors">',
    '<button class="door" type="button" id="google-button">Google로 로그인</button>',
    '<button class="door" type="button" id="apple-button">Apple로 로그인</button>',
    '<button class="door" type="button" id="chatgpt-button">ChatGPT로 로그인</button>',
    '<button class="door" type="button" id="otp-toggle">이메일 · 휴대폰으로 로그인</button>',
    '</div>',
    '<div class="otp-block" id="otp-block" hidden>',
    '<div class="method-tabs" role="tablist" aria-label="로그인 방법">',
    '<button type="button" role="tab" data-method="email" aria-selected="true" class="is-selected">이메일</button>',
    '<button type="button" role="tab" data-method="phone" aria-selected="false">휴대폰</button>',
    '</div>',
    '<form id="email-form">',
    '<label for="email" id="value-label" class="sr-only">이메일</label>',
    '<div class="form-row"><input id="email" name="email" type="email" autocomplete="email" required /><button type="submit">인증번호</button></div>',
    '</form>',
    '<form id="code-form" hidden>',
    '<label for="code" class="sr-only">인증번호</label>',
    '<div class="form-row"><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,12}" required /><button type="submit">로그인</button></div>',
    '</form>',
    '</div>',
    '<p class="form-status" id="auth-status" aria-live="polite"></p>',
    '<p class="social-status" id="social-status" aria-live="polite" hidden></p>',
    '<p class="app-hint">앱에서 쓰는 로그인 방법으로 로그인해야 같은 계정이 열려요.</p>',
    '</div>',
    '<p class="legal">계속하면 <a href="/terms/">서비스 약관</a> 및 <a href="/privacy/">개인정보처리방침</a>에 동의하는 것으로 간주됩니다</p>',
    '</div>',
    '</div>'
  ].join('');

  const $ = (id) => document.getElementById(id);

  // ---- Storage -----------------------------------------------------------------
  //
  // `local` is the 30-day session and its display hint; `tab` is what belongs to
  // one tab's journey. Either may be refused (a private window, a blocked
  // site): the page still works for this visit, it just does not remember.

  function storageArea(kind) {
    try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (_) { return null; }
  }

  function readArea(kind, key) {
    const area = storageArea(kind);
    try { return (area && area.getItem(key)) || ''; } catch (_) { return ''; }
  }

  function writeArea(kind, key, value) {
    const area = storageArea(kind);
    try {
      if (!area) return;
      if (value) area.setItem(key, value);
      else area.removeItem(key);
    } catch (_) { /* storage refused: this visit still works */ }
  }

  function readLocal(key) { return readArea('local', key); }
  function writeLocal(key, value) { writeArea('local', key, value); }
  function readTab(key) { return readArea('tab', key); }
  function writeTab(key, value) { writeArea('tab', key, value); }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  // What a JWT says about itself, unverified. Only `iss` and `exp` are read,
  // and only to decide whether a token may be kept and until when; who the
  // person is stays the server's answer.
  function tokenClaims(token) {
    const part = String(token || '').split('.')[1] || '';
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
    try {
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)));
      return claims && typeof claims === 'object' ? claims : null;
    } catch (_) {
      return null;
    }
  }

  function isSidekickToken(token) {
    const claims = tokenClaims(token);
    return Boolean(claims && claims.iss === SIDEKICK_ISSUER);
  }

  // When a sign-in stops being kept: the server's `expires_at`, else the
  // token's own `exp`, else now plus the lifetime the server named -- and never
  // later than 30 days from now. 0 when nothing says.
  function expiryOf(token, answer) {
    const now = nowSeconds();
    const said = answer && typeof answer === 'object' ? answer : {};
    const claims = tokenClaims(token) || {};
    const at = [Number(said.expires_at), Number(claims.exp), now + Number(said.expires_in_seconds)]
      .find((value) => Number.isFinite(value) && value > now);
    return at ? Math.min(Math.floor(at), now + MAX_SESSION_SECONDS) : 0;
  }

  function readStoredSession() {
    let raw = null;
    try { raw = JSON.parse(readLocal(SESSION_KEY) || 'null'); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object') return null;
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';
    const expiresAt = Number(raw.expires_at);
    if (!isSidekickToken(token) || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
    return { token, expiresAt };
  }

  // The only write of a token to storage. A token the backend did not mint (a
  // Supabase token above all) or one without a future expiry is refused: the
  // sign-in then lasts for this page only.
  function storeSession(token, expiresAt) {
    if (!isSidekickToken(token) || !(expiresAt > nowSeconds())) return false;
    writeLocal(SESSION_KEY, JSON.stringify({ token, expires_at: expiresAt }));
    return true;
  }

  // Run once, before anything reads the session. A stored session past its
  // expiry is forgotten here and said on init(). A per-tab bearer from before
  // the 30-day session is taken out of sessionStorage first, whatever it is: a
  // Sidekick token moves into the session, anything else (a Google or Apple
  // sign-in's Supabase token) is traded on init() and never stored.
  function loadSession() {
    const legacy = readTab(LEGACY_TOKEN_KEY).trim();
    const legacyProfile = readTab(PROFILE_KEY);
    writeTab(LEGACY_TOKEN_KEY, '');
    writeTab(PROFILE_KEY, '');
    const loaded = { token: '', expiresAt: 0, expired: false, exchange: '' };
    const stored = readStoredSession();
    if (!stored && readLocal(SESSION_KEY)) writeLocal(SESSION_KEY, '');
    if (stored && stored.expiresAt <= nowSeconds()) {
      writeLocal(SESSION_KEY, '');
      writeLocal(PROFILE_KEY, '');
      loaded.expired = true;
    } else if (stored) {
      return { ...loaded, token: stored.token, expiresAt: stored.expiresAt };
    }
    if (!legacy) return loaded;
    if (!isSidekickToken(legacy)) return { ...loaded, exchange: legacy };
    const expiresAt = expiryOf(legacy, null);
    if (!storeSession(legacy, expiresAt)) return { ...loaded, expired: true };
    if (legacyProfile) writeLocal(PROFILE_KEY, legacyProfile);
    return { ...loaded, token: legacy, expiresAt, expired: false };
  }

  const loaded = loadSession();

  const session = {
    token: loaded.token,
    // Epoch seconds; 0 for a sign-in this page could not keep.
    expiresAt: loaded.expiresAt,
    user: null,
    // The server's name for how this bearer was issued (GET /auth/session):
    // `sidekick-email|phone|chatgpt|kakao|google|apple`, or `supabase`.
    source: '',
    // True once the server answered for this token.
    checked: false,
    profile: readProfile(),
    method: 'email',
    challengeId: null,
    busy: false,
    // A ChatGPT sign-in waiting for approval. Held in memory only: the page
    // stays open while the person approves in another tab.
    chatgpt: null
  };
  const hooks = { onSignedIn: null, onSignedOut: null, onNotice: null };
  let sheetOpener = null;
  let toastTimer = null;
  let expiryTimer = null;

  function cleanText(value, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  // A phone number is shown only as the server masked it: digits, dashes and
  // at least one `*`.
  function maskedPhone(value) {
    const text = cleanText(value, 32);
    return /^[0-9*+ -]{4,32}$/.test(text) && text.includes('*') ? text : '';
  }

  // A display hint only. Anything that does not look like one is dropped.
  function readProfile() {
    let raw = null;
    try { raw = JSON.parse(readLocal(PROFILE_KEY) || 'null'); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object' || !METHOD_PHRASES[raw.method]) return null;
    const userId = cleanText(raw.user_id, 160);
    return {
      method: raw.method,
      email: cleanText(raw.email, 254),
      phone: maskedPhone(raw.phone),
      name: cleanText(raw.name, 80),
      user_id: SAFE_ID.test(userId) ? userId : ''
    };
  }

  function saveProfile(profile) {
    session.profile = profile;
    writeLocal(PROFILE_KEY, profile ? JSON.stringify(profile) : '');
  }

  // What a sign-in answer said about the person. Only fields meant for display:
  // a masked phone number, never the full one.
  function rememberAccount(method, user) {
    const person = user && typeof user === 'object' ? user : {};
    const userId = String(person.id || '');
    saveProfile({
      method,
      email: cleanText(person.email, 254),
      phone: maskedPhone(person.phoneMasked),
      name: cleanText(person.name, 80),
      user_id: SAFE_ID.test(userId) ? userId : ''
    });
  }

  // GET /account's answer, so the header menu says what the account page says:
  // which door the person used (the server knows it even when the token was
  // traded) and the address to show.
  function learnAccount(answer) {
    if (!session.token || !answer || typeof answer !== 'object') return;
    const id = String(answer.id || '');
    const hinted = session.profile ? session.profile.method : '';
    const method = METHOD_PHRASES[answer.method] ? answer.method : hinted;
    if (!METHOD_PHRASES[method]) return;
    saveProfile({
      method,
      email: cleanText(answer.email, 254),
      phone: maskedPhone(answer.phone_masked),
      name: cleanText(answer.display_name, 80),
      user_id: SAFE_ID.test(id) ? id : ''
    });
  }

  // A sign-in's answer becomes this browser's session.
  function setToken(token, user, expiresAt) {
    const value = String(token || '').trim();
    if (!value) return false;
    session.token = value;
    session.expiresAt = expiresAt > 0 ? expiresAt : 0;
    session.user = user && typeof user === 'object' ? user : null;
    session.source = '';
    session.checked = false;
    storeSession(value, session.expiresAt);
    scheduleExpiry();
    return true;
  }

  // Forgets the session in this tab, and in storage when storage still holds
  // this tab's own session. Another tab may have signed in again in the
  // meantime; its newer session is not this tab's to delete.
  function clearLocalSession() {
    stopChatGpt();
    const mine = session.token;
    session.token = '';
    session.expiresAt = 0;
    session.user = null;
    session.source = '';
    session.checked = false;
    session.profile = null;
    scheduleExpiry();
    const stored = readStoredSession();
    if (!stored || stored.token === mine) {
      writeLocal(SESSION_KEY, '');
      writeLocal(PROFILE_KEY, '');
    }
    writeTab(LEGACY_TOKEN_KEY, '');
    writeTab(PROFILE_KEY, '');
    writeTab(HANDOFF_KEY, '');
    writeTab(RETURN_KEY, '');
  }

  // Signing out ends the session on the server too (POST /auth/logout revokes
  // this token's own session, and a traded Google/Apple session's source), then
  // forgets it here. The local part happens first and does not wait: a dropped
  // connection must not leave the person signed in on a shared computer.
  // `server: false` is for a token the server already refused, or one another
  // tab already ended -- there is nothing left to revoke. `silent: true` is for
  // a page that resets itself and needs no hook back.
  function signOut(options = {}) {
    const bearer = session.token;
    clearLocalSession();
    try { window.SidekickWebAnalytics?.logout(options.server !== false && !options.silent)?.catch(() => {}); } catch (_) {}
    closeMenu(false);
    renderHeader();
    if (bearer && options.server !== false) {
      api('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        keepalive: true
      }).catch(() => { /* best effort: the token is already gone from this browser */ });
    }
    if (!options.silent) {
      if (typeof hooks.onSignedOut === 'function') hooks.onSignedOut();
      else showToast('로그아웃했어요.', false);
    }
  }

  // ---- Expiry and other tabs ---------------------------------------------------

  function sessionExpired() {
    return Boolean(session.token && session.expiresAt && session.expiresAt <= nowSeconds());
  }

  // The session ran out while a page was open: the page drops to its signed-out
  // view at once, and says why. Nothing to revoke on the server.
  function expireSession() {
    if (!session.token) return;
    signOut({ server: false });
    notify(EXPIRED_COPY, true);
  }

  function scheduleExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!session.token || !session.expiresAt) return;
    const wait = Math.max(0, session.expiresAt * 1000 - Date.now());
    expiryTimer = setTimeout(() => {
      if (sessionExpired()) expireSession();
      else scheduleExpiry();
    }, Math.min(wait, MAX_TIMER_MS));
  }

  // Another tab signed in, signed out or switched accounts. Storage is read
  // again rather than the event trusted: what counts is what is stored now.
  async function followOtherTab() {
    const stored = readStoredSession();
    const token = stored && stored.expiresAt > nowSeconds() ? stored.token : '';
    if (token === session.token) return;
    if (!token) {
      if (session.token) signOut({ server: false });
      return;
    }
    if (session.token) signOut({ server: false, silent: true });
    session.token = token;
    session.expiresAt = stored.expiresAt;
    session.profile = readProfile();
    scheduleExpiry();
    renderHeader();
    await validateSession();
    renderHeader();
    if (session.token === token && typeof hooks.onSignedIn === 'function') {
      await hooks.onSignedIn(session.user, { otherTab: true });
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.storageArea !== storageArea('local')) return;
    if (event.key !== null && event.key !== SESSION_KEY) return;
    followOtherTab();
  });

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    // A call that names its own bearer (the Google/Apple exchange, 로그아웃)
    // keeps it.
    if (session.token && !headers.Authorization) headers.Authorization = `Bearer ${session.token}`;
    let response;
    try {
      response = await fetch(`${API_ORIGIN}${path}`, { ...options, headers });
    } catch (cause) {
      const error = new Error('network_failed');
      error.status = 0;
      error.network = true;
      error.aborted = Boolean(cause && cause.name === 'AbortError');
      error.detail = '';
      error.code = '';
      throw error;
    }
    let data = {};
    try { data = await response.json(); } catch (_) { /* fail with bounded message below */ }
    if (!response.ok) {
      const error = new Error('request_failed');
      error.status = response.status;
      error.network = false;
      // 서버가 준 짧은 사유 코드만 들고 간다. 화면 문구는 부르는 페이지가 정한다.
      const detail = data ? data.detail : null;
      error.detail = typeof detail === 'string' ? detail : '';
      error.code = detail && typeof detail === 'object' && typeof detail.code === 'string' ? detail.code : error.detail;
      throw error;
    }
    return data;
  }

  // The backend is the authority on who this is; a provider only proved the
  // person holds an account.
  async function whoami() {
    const result = await api('/auth/session', { method: 'GET' });
    session.user = result && result.user && typeof result.user === 'object' ? result.user : null;
    session.source = cleanText(result && result.source, 40);
    session.checked = Boolean(session.user);
    // Bind the optional preference exchange to the bearer that verified this
    // account, including a later PUT after its GET. It cannot follow a tab's
    // newly signed-in account while an earlier GET is still pending.
    const verifiedToken = session.token;
    try {
      session.analyticsReady = window.SidekickWebAnalytics?.accountKnown(session.user,
        (path, options = {}) => api(path, { ...options,
          headers: { ...(options.headers || {}), Authorization: `Bearer ${verifiedToken}` } }))
        ?.catch(() => {});
    } catch (_) {}
    const id = session.user ? String(session.user.id || '') : '';
    const profile = session.profile;
    // A hint written for another account is not this person's.
    if (profile && profile.user_id && profile.user_id !== id) saveProfile(null);
    else if (profile && !profile.user_id && SAFE_ID.test(id)) saveProfile({ ...profile, user_id: id });
    return session.user;
  }

  // Run once per page: a stored bearer is only believed while it is inside its
  // expiry and after the server says it still is one. 401/403 is a token that
  // ended (expired, revoked, signed out elsewhere): sign out here, quietly, so
  // no page shows "내 계정" over a dead session. 423 is an account being
  // deleted. A dropped connection or a server error proves nothing about the
  // token, so it is kept and the page says so.
  async function validateSession() {
    if (!session.token || session.checked) return;
    if (sessionExpired()) { expireSession(); return; }
    try {
      await whoami();
    } catch (error) {
      const status = error ? error.status : 0;
      if (status === 401 || status === 403 || status === 423) {
        signOut({ server: false, silent: true });
        notify(status === 423 ? DELETION_PENDING_COPY : EXPIRED_COPY, status === 423);
        return;
      }
      notify(error && error.network ? NETWORK_COPY : CHECK_FAILED_COPY, true);
    }
  }

  function randomAppState() {
    const bytes = new Uint8Array(APP_STATE_BYTES);
    window.crypto.getRandomValues(bytes);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function httpsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch (_) {
      return '';
    }
  }

  // A page that shows its own messages takes them; any other page gets a short
  // toast at the bottom of the screen.
  function notify(message, isError) {
    showSocialStatus(message, isError);
    if (typeof hooks.onNotice === 'function') hooks.onNotice(message, isError);
    else showToast(message, isError);
  }

  function showToast(message, isError) {
    if (!message || !document.body) return;
    let toast = $('auth-toast');
    if (!toast) {
      toast = document.createElement('p');
      toast.id = 'auth-toast';
      toast.className = 'auth-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('is-error', Boolean(isError));
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  }

  function showSocialStatus(message, isError) {
    const node = $('social-status');
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }

  function setAuthStatus(message, isError) {
    const node = $('auth-status');
    if (!node) return;
    node.classList.toggle('is-error', Boolean(isError));
    node.textContent = message || '';
  }

  // ---- Who is signed in, for display ---------------------------------------

  // Which door the person used. The hint comes from the sign-in answer or from
  // GET /account, which know it even when a Google or Apple sign-in was traded
  // for a session whose token says `email`; the server's source name is the
  // fallback.
  function signInMethod() {
    const hinted = session.profile ? session.profile.method : '';
    if (METHOD_PHRASES[hinted] && hinted !== 'supabase' && hinted !== 'unknown') return hinted;
    const source = session.source;
    if (source.indexOf('sidekick-') === 0 && METHOD_PHRASES[source.slice(9)]) return source.slice(9);
    return METHOD_PHRASES[hinted] ? hinted : source === 'supabase' ? 'supabase' : '';
  }

  function methodLabel(method) {
    return METHOD_LABELS[method] || '';
  }

  // Everything a page may show about the person, built only from the server's
  // answer and the display hint. Null when signed out. No account id: a phone
  // account's id carries the whole number.
  function account() {
    if (!session.token) return null;
    const method = signInMethod();
    const profile = session.profile || {};
    return {
      checked: session.checked,
      method,
      methodLabel: methodLabel(method),
      phrase: METHOD_PHRASES[method] || '로그인했어요',
      email: profile.email || '',
      phone: profile.phone || '',
      name: profile.name || '',
      // Epoch seconds this browser keeps the sign-in until; 0 when it is not kept.
      expiresAt: session.expiresAt
    };
  }

  // ---- Header account slot ---------------------------------------------------

  function renderHeader() {
    const pill = $('account-pill');
    if (!pill) return;
    const signedIn = Boolean(session.token);
    pill.textContent = signedIn ? '내 계정' : '로그인';
    pill.classList.toggle('is-signed-in', signedIn);
    // A disclosure, not an ARIA menu: the panel holds ordinary links and one
    // button, reached with Tab like the rest of the page.
    if (signedIn) {
      pill.setAttribute('aria-controls', 'account-menu');
      pill.setAttribute('aria-expanded', String(Boolean($('account-menu') && !$('account-menu').hidden)));
    } else {
      pill.removeAttribute('aria-controls');
      pill.removeAttribute('aria-expanded');
    }
  }

  function menuLink(href, text) {
    const link = document.createElement('a');
    link.className = 'account-menu-item';
    link.href = href;
    link.textContent = text;
    if (window.location.pathname === href) link.setAttribute('aria-current', 'page');
    return link;
  }

  // Built on first use: 누가 로그인했는지, 내 계정, AI 연결, 로그아웃. It never
  // links to /membership/ -- the policy pages carry this header too.
  function ensureMenu() {
    let menu = $('account-menu');
    if (menu) return menu;
    const pill = $('account-pill');
    if (!pill || !pill.parentElement) return null;
    menu = document.createElement('div');
    menu.id = 'account-menu';
    menu.className = 'account-menu';
    menu.hidden = true;
    const who = document.createElement('div');
    who.className = 'account-menu-who';
    const phrase = document.createElement('strong');
    phrase.id = 'account-menu-phrase';
    const detail = document.createElement('span');
    detail.id = 'account-menu-detail';
    who.append(phrase, detail);
    const signOutButton = document.createElement('button');
    signOutButton.type = 'button';
    signOutButton.className = 'account-menu-item';
    signOutButton.id = 'account-menu-signout';
    signOutButton.textContent = '로그아웃';
    signOutButton.addEventListener('click', () => signOut());
    menu.append(who, menuLink('/account/', '내 계정'), menuLink('/ai/', 'AI 연결'), signOutButton);
    pill.parentElement.append(menu);
    return menu;
  }

  function openMenu() {
    const menu = ensureMenu();
    if (!menu) return;
    const person = account();
    $('account-menu-phrase').textContent = person ? person.phrase : '';
    $('account-menu-detail').textContent = person ? (person.email || person.phone || person.name || '') : '';
    $('account-menu-detail').hidden = !$('account-menu-detail').textContent;
    menu.hidden = false;
    renderHeader();
    const first = menu.querySelector('.account-menu-item');
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus) {
    const menu = $('account-menu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    renderHeader();
    if (returnFocus && $('account-pill')) $('account-pill').focus({ preventScroll: true });
  }

  function bindHeader() {
    const pill = $('account-pill');
    if (!pill || pill.dataset.bound) return;
    pill.dataset.bound = '1';
    pill.addEventListener('click', () => {
      const signedIn = Boolean(session.token);
      if (!signedIn) { open(); return; }
      const menu = $('account-menu');
      if (menu && !menu.hidden) closeMenu(true);
      else openMenu();
    });
    document.addEventListener('click', (event) => {
      const menu = $('account-menu');
      if (!menu || menu.hidden) return;
      if (event.target === pill || pill.contains(event.target) || menu.contains(event.target)) return;
      closeMenu(false);
    });
  }

  // ---- Sign-in sheet ------------------------------------------------------

  function ensureSheet() {
    let sheet = $('signin-sheet');
    if (!sheet) {
      if (!document.body) return null;
      const holder = document.createElement('div');
      holder.innerHTML = SHEET_HTML;
      sheet = holder.firstElementChild;
      document.body.append(sheet);
    }
    if (!sheet.dataset.bound) {
      sheet.dataset.bound = '1';
      bindSheet(sheet);
    }
    return sheet;
  }

  function open() {
    const sheet = ensureSheet();
    if (!sheet) return;
    if (sheet.hidden) window.SidekickWebAnalytics?.track('login_started', { surface: 'web_auth' });
    closeMenu(false);
    sheetOpener = document.activeElement;
    sheet.hidden = false;
    // 두 프레임을 기다렸다가 클래스를 붙인다: hidden을 벗기자마자
    // 붙이면 브라우저가 시작 상태를 그리기 전이라 전환이 통째로 생략된다.
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
    document.body.style.overflow = 'hidden';
    const first = sheet.querySelector('.door');
    if (first) first.focus({ preventScroll: true });
  }

  function close() {
    const sheet = $('signin-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('is-open');
    document.body.style.overflow = '';
    const done = () => { sheet.hidden = true; sheet.removeEventListener('transitionend', done); };
    // 전환이 꺼져 있거나 잘려도 화면이 반쯤 덮인 채 남지는 않게 한다.
    sheet.addEventListener('transitionend', done);
    setTimeout(done, 400);
    const opener = sheetOpener;
    sheetOpener = null;
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  function applyAuthMethod(method) {
    const chosen = AUTH_METHODS[method] ? method : 'email';
    session.method = chosen;
    session.challengeId = null;
    const config = AUTH_METHODS[chosen];
    const input = $('email');
    document.querySelectorAll('[data-method]').forEach((tab) => {
      const selected = tab.dataset.method === chosen;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    input.type = config.inputType;
    input.autocomplete = config.autocomplete;
    input.placeholder = config.placeholder;
    input.value = '';
    // The screen reader label follows the field, not the page's first draft.
    if ($('value-label')) $('value-label').textContent = config.label;
    // Switching method abandons any code already sent, so the second form must
    // not stay open offering to verify a code for the other identity.
    $('code-form').hidden = true;
    $('code').value = '';
    setAuthStatus('', false);
    input.focus();
  }

  async function finishSignIn() {
    close();
    session.checked = Boolean(session.user && session.user.id);
    if (session.checked) {
      const verifiedToken = session.token;
      Promise.resolve(session.analyticsReady).then(() => {
        if (session.checked && session.token === verifiedToken)
          window.SidekickWebAnalytics?.track('login_completed', { surface: 'web_auth' });
      }).catch(() => {});
    }
    renderHeader();
    if (typeof hooks.onSignedIn === 'function') await hooks.onSignedIn(session.user);
    else showToast('로그인했어요.', false);
  }

  // ---- Google / Apple through Supabase -------------------------------------

  function startSupabaseLogin(provider) {
    if (!SUPABASE_PROVIDERS[provider]) return;
    const here = window.location.pathname;
    writeTab(RETURN_KEY, RETURN_PATHS.includes(here) ? here : here === '/membership/' ? '' : DEFAULT_RETURN_PATH);
    // Which door, so the account page can say "Google로 로그인했어요".
    rememberAccount(provider, null);
    showSocialStatus(`${SUPABASE_PROVIDERS[provider]}으로 이동하고 있어요.`, false);
    const url = new URL(`${SUPABASE_ORIGIN}/auth/v1/authorize`);
    url.searchParams.set('provider', provider);
    url.searchParams.set('redirect_to', RETURN_URL);
    window.location.assign(url.toString());
  }

  // A person who started on another page goes back there now. The session is
  // already stored, and that page checks it itself.
  function returnToStartingPage() {
    const back = readTab(RETURN_KEY);
    writeTab(RETURN_KEY, '');
    if (!back || !RETURN_PATHS.includes(back) || back === window.location.pathname) return false;
    window.location.replace(back);
    return true;
  }

  // Supabase's implicit flow returns its session in the fragment: an access
  // token and a refresh token. The fragment leaves the address bar before
  // anything else runs, so neither sits in history or in anything that later
  // logs a URL. The refresh token is never read; the access token is traded at
  // once for a Sidekick session and dropped.
  async function adoptSupabaseRedirect() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) {
      if (hash.includes('error=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        writeTab(NOTICE_KEY, SOCIAL_FAILED_COPY);
        if (returnToStartingPage()) return new Promise(() => {});
      }
      return false;
    }
    const params = new URLSearchParams(hash.slice(1));
    const supabaseToken = String(params.get('access_token') || '').trim();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!supabaseToken) return false;
    const traded = await exchangeSupabaseToken(supabaseToken);
    if (traded !== true) writeTab(NOTICE_KEY, traded);
    showSocialStatus('', false);
    if (returnToStartingPage()) return new Promise(() => {});
    return traded === true;
  }

  // POST /auth/session/exchange: the Supabase access token, from memory, is the
  // bearer of this one call, and a 30-day Sidekick session on the same account
  // comes back -- the only thing kept. Answers true, or the sentence to say.
  async function exchangeSupabaseToken(supabaseToken) {
    let answer = null;
    try {
      answer = await api('/auth/session/exchange', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseToken}` }
      });
    } catch (error) {
      if (error && error.status === 423) return DELETION_PENDING_COPY;
      return error && error.network ? NETWORK_COPY : EXCHANGE_FAILED_COPY;
    }
    const token = String((answer && answer.access_token) || '').trim();
    const user = answer && answer.user && typeof answer.user === 'object' ? answer.user : null;
    if (!isSidekickToken(token) || !user || !SAFE_ID.test(String(user.id || ''))) return EXCHANGE_FAILED_COPY;
    const hinted = session.profile ? session.profile.method : '';
    const method = SUPABASE_PROVIDERS[answer.method] ? answer.method : SUPABASE_PROVIDERS[hinted] ? hinted : 'supabase';
    setToken(token, user, expiryOf(token, answer));
    rememberAccount(method, user);
    // The server resolved the account and its deletion lock to mint this.
    session.checked = true;
    return true;
  }

  // ---- ChatGPT: a device code the person approves in another tab ------------

  function chatGptBlock() {
    let block = $('chatgpt-code-block');
    if (block) return block;
    const doors = document.querySelector('#signin-sheet .doors');
    if (!doors) return null;
    block = document.createElement('div');
    block.id = 'chatgpt-code-block';
    block.className = 'otp-block';
    block.hidden = true;
    const hint = document.createElement('p');
    hint.className = 'form-status';
    hint.textContent = '아래 코드를 ChatGPT 승인 페이지에 입력해 주세요.';
    const row = document.createElement('div');
    row.className = 'form-row';
    const code = document.createElement('input');
    code.id = 'chatgpt-user-code';
    code.readOnly = true;
    code.setAttribute('aria-label', 'ChatGPT 승인 코드');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.id = 'chatgpt-copy-code';
    copy.textContent = '코드 복사';
    row.append(code, copy);
    const openPage = document.createElement('button');
    openPage.type = 'button';
    openPage.className = 'door';
    openPage.id = 'chatgpt-open-page';
    openPage.textContent = 'ChatGPT 승인 페이지 열기';
    block.append(hint, row, openPage);
    doors.after(block);
    copy.addEventListener('click', () => copyText(code.value, copy));
    // The new tab opens from this click, so no pop-up blocker stands in the way,
    // and noopener keeps the provider's page from reaching back into this one.
    openPage.addEventListener('click', () => {
      if (session.chatgpt && session.chatgpt.authorizationUrl) {
        window.open(session.chatgpt.authorizationUrl, '_blank', 'noopener');
      }
    });
    return block;
  }

  async function copyText(value, button) {
    const text = String(value || '');
    if (!text) return;
    const label = button ? (button.dataset.label || button.textContent) : '';
    if (button) button.dataset.label = label;
    try {
      await navigator.clipboard.writeText(text);
      if (button) button.textContent = '복사했어요';
    } catch (_) {
      if (button) button.textContent = '직접 복사해 주세요';
    }
    if (button) setTimeout(() => { button.textContent = label; }, 2000);
  }

  function showChatGptCode(userCode) {
    const block = chatGptBlock();
    if (!block) return;
    $('chatgpt-user-code').value = userCode;
    block.hidden = false;
  }

  function hideChatGptCode() {
    const block = $('chatgpt-code-block');
    if (block) block.hidden = true;
  }

  function stopChatGpt() {
    const pending = session.chatgpt;
    if (pending && pending.timer) clearTimeout(pending.timer);
    session.chatgpt = null;
    hideChatGptCode();
  }

  function scheduleChatGptPoll(delay) {
    const pending = session.chatgpt;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(pollChatGptLogin, delay);
  }

  async function startChatGptLogin() {
    if (session.busy) return;
    stopChatGpt();
    session.busy = true;
    showSocialStatus('ChatGPT 승인 코드를 받고 있어요.', false);
    const appState = randomAppState();
    try {
      // The server binds the code to this app_state and answers with the page to
      // approve on, the code to type there, and the state to poll with.
      const started = await api('/auth/oauth/chatgpt/start', {
        method: 'POST',
        body: JSON.stringify({ app_state: appState })
      });
      const state = String(started.state || '');
      const userCode = String(started.user_code || '');
      const authorizationUrl = httpsUrl(started.authorization_url);
      if (!state || !userCode || !authorizationUrl) throw new Error('chatgpt_start_invalid');
      session.chatgpt = {
        state,
        appState,
        authorizationUrl,
        interval: Math.max(2, Number(started.poll_interval_seconds) || 5) * 1000,
        expiresAt: Date.now() + Math.max(60, Number(started.expires_in_seconds) || 600) * 1000,
        timer: null,
        inFlight: false
      };
      showChatGptCode(userCode);
      showSocialStatus('승인 페이지에서 코드를 입력하고 돌아오면 이어서 로그인해요.', false);
      scheduleChatGptPoll(session.chatgpt.interval);
    } catch (error) {
      stopChatGpt();
      showSocialStatus(error && error.network ? NETWORK_COPY
        : error && error.status === 503 ? '지금은 ChatGPT로 로그인할 수 없어요. 다른 방법으로 로그인해 주세요.'
        : 'ChatGPT 로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    } finally {
      session.busy = false;
    }
  }

  async function pollChatGptLogin() {
    const pending = session.chatgpt;
    if (!pending || pending.inFlight) return;
    if (Date.now() > pending.expiresAt) {
      stopChatGpt();
      showSocialStatus('승인 시간이 지났어요. 처음부터 다시 시도해 주세요.', true);
      return;
    }
    pending.inFlight = true;
    let signedIn = null;
    let failed = false;
    try {
      const polled = await api('/auth/oauth/chatgpt/poll', {
        method: 'POST',
        body: JSON.stringify({ state: pending.state, app_state: pending.appState })
      });
      if (polled && polled.status === 'complete' && polled.access_token) signedIn = polled;
    } catch (error) {
      // A dropped connection is worth another try; any answer from the server
      // that is not "pending" means this code is spent.
      failed = !(error && error.network);
    } finally {
      pending.inFlight = false;
    }
    // Cancelled or replaced by a new attempt while this answer was on its way.
    if (session.chatgpt !== pending) return;
    if (signedIn) {
      stopChatGpt();
      showSocialStatus('', false);
      setToken(signedIn.access_token, signedIn.user || null, expiryOf(signedIn.access_token, signedIn));
      rememberAccount('chatgpt', signedIn.user);
      keepChatGptHandoff(signedIn.ai_engine, signedIn.user);
      await finishSignIn();
      return;
    }
    if (failed) {
      stopChatGpt();
      showSocialStatus('승인이 확인되지 않았어요. 처음부터 다시 시도해 주세요.', true);
      return;
    }
    scheduleChatGptPoll(pending.interval);
  }

  // A background tab's timers are throttled; the moment the person comes back
  // from the approval tab is exactly when the answer is ready. Coming back is
  // also when a session that ran out while the machine slept is noticed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (sessionExpired()) { expireSession(); return; }
    if (!session.chatgpt) return;
    if (session.chatgpt.timer) clearTimeout(session.chatgpt.timer);
    pollChatGptLogin();
  });

  // A ChatGPT sign-in also proves a ChatGPT account the person may want their
  // projects to run on. The server holds that account for a day and answers the
  // sign-in with a one-time claim on it (ai_engine.handoff_state/handoff_code);
  // /ai/ offers it for a project (POST /ai-engine/login-handoff/claim) so the
  // person does not sign in to ChatGPT a second time. The claim stays in this
  // tab only, never in a URL, and is dropped once used or declined, after a day,
  // or on 로그아웃. It is bound to the account that signed in.
  function keepChatGptHandoff(engine, user) {
    const ready = Boolean(engine && typeof engine === 'object' && engine.status === 'ready_to_connect');
    const state = ready ? cleanText(engine.handoff_state, 200) : '';
    const code = ready ? cleanText(engine.handoff_code, 200) : '';
    const userId = user && typeof user === 'object' ? String(user.id || '') : '';
    if (!state || !code || !SAFE_ID.test(userId)) { writeTab(HANDOFF_KEY, ''); return; }
    writeTab(HANDOFF_KEY, JSON.stringify({ state, code, user_id: userId, saved_at: Date.now() }));
  }

  function chatGptHandoff() {
    let raw = null;
    try { raw = JSON.parse(readTab(HANDOFF_KEY) || 'null'); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object') return null;
    const id = session.user ? String(session.user.id || '') : '';
    const fresh = Number(raw.saved_at) > Date.now() - HANDOFF_MAX_AGE_MS;
    const state = cleanText(raw.state, 200);
    const code = cleanText(raw.code, 200);
    if (!session.token || !fresh || !id || raw.user_id !== id || !state || !code) return null;
    return { state, code };
  }

  function forgetChatGptHandoff() {
    writeTab(HANDOFF_KEY, '');
  }

  // ---- Email / phone code ---------------------------------------------------

  async function sendCode(event) {
    event.preventDefault();
    setAuthStatus('인증번호를 보내고 있어요.', false);
    try {
      const result = await api('/auth/start', {
        method: 'POST',
        body: JSON.stringify({ method: session.method, value: $('email').value.trim() })
      });
      session.challengeId = result.challenge_id;
      $('code-form').hidden = false;
      $('code').focus();
      setAuthStatus(`${result.value_masked || `입력한 ${AUTH_METHODS[session.method].label}`}로 인증번호를 보냈어요.`, false);
    } catch (error) {
      setAuthStatus(error && error.network ? NETWORK_COPY : '인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (!session.challengeId) return;
    setAuthStatus('인증번호를 확인하고 있어요.', false);
    let result;
    try {
      result = await api('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: session.challengeId, code: $('code').value.trim() })
      });
    } catch (error) {
      setAuthStatus(error && error.network ? NETWORK_COPY : '인증번호가 맞지 않거나 만료됐어요.', true);
      return;
    }
    setToken(result.access_token, result.user || null, expiryOf(result.access_token, result));
    rememberAccount(session.method, result.user);
    setAuthStatus('', false);
    await finishSignIn();
  }

  // ---- Wiring ----------------------------------------------------------------

  function bindSheet(sheet) {
    $('google-button').addEventListener('click', () => startSupabaseLogin('google'));
    $('apple-button').addEventListener('click', () => startSupabaseLogin('apple'));
    $('chatgpt-button').addEventListener('click', startChatGptLogin);
    sheet.querySelectorAll('[data-method]').forEach((tab) => {
      tab.addEventListener('click', () => applyAuthMethod(tab.dataset.method));
    });
    $('otp-toggle').addEventListener('click', () => {
      const block = $('otp-block');
      block.hidden = !block.hidden;
      if (!block.hidden) $('email').focus();
    });
    $('email-form').addEventListener('submit', sendCode);
    $('code-form').addEventListener('submit', verifyCode);
    $('close-signin').addEventListener('click', close);
    sheet.addEventListener('click', (event) => { if (event.target === sheet) close(); });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const sheet = $('signin-sheet');
    if (sheet && !sheet.hidden) { close(); return; }
    closeMenu(true);
  });

  let initialized = null;

  // Each page calls this once; a page with no script of its own gets it on
  // DOMContentLoaded below. It resolves to whether a bearer is held, after any
  // Supabase fragment has been read and traded, a pre-30-day Google/Apple
  // bearer traded the same way, and the server has confirmed the bearer; it
  // never resolves while the page is handing the person back to the page they
  // started on. Page hooks: onSignedIn(user, {otherTab}) after a sign-in here
  // or in another tab, onSignedOut() after 로그아웃 here or in another tab or an
  // expiry, onNotice(message, isError) for what the page should say.
  function init(options = {}) {
    if (initialized) return initialized;
    hooks.onSignedIn = options.onSignedIn || null;
    hooks.onSignedOut = options.onSignedOut || null;
    hooks.onNotice = options.onNotice || null;
    bindHeader();
    renderHeader();
    // A page that ships the sheet in its HTML has it bound now; any other page
    // builds it the first time someone asks to sign in.
    if ($('signin-sheet')) ensureSheet();
    initialized = adoptSupabaseRedirect().then(async (adopted) => {
      const legacy = loaded.exchange;
      loaded.exchange = '';
      if (legacy && !session.token) {
        const traded = await exchangeSupabaseToken(legacy);
        if (traded !== true) notify(traded === EXCHANGE_FAILED_COPY ? EXPIRED_COPY : traded, true);
      }
      if (loaded.expired && !session.token) notify(EXPIRED_COPY, true);
      loaded.expired = false;
      const notice = readTab(NOTICE_KEY);
      if (notice) {
        writeTab(NOTICE_KEY, '');
        notify(notice, true);
      }
      await validateSession();
      scheduleExpiry();
      renderHeader();
      return Boolean(adopted || session.token);
    });
    return initialized;
  }

  document.addEventListener('DOMContentLoaded', () => { init(); });

  window.SidekickAuth = Object.freeze({
    API_ORIGIN,
    NETWORK_COPY,
    EXPIRED_COPY,
    DELETION_PENDING_COPY,
    init,
    api,
    whoami,
    open,
    close,
    signOut,
    copyText,
    httpsUrl,
    account,
    learnAccount,
    methodLabel,
    chatGptHandoff,
    forgetChatGptHandoff,
    token: () => session.token,
    user: () => session.user
  });
})();
