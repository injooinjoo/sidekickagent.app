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
  // redirect to Supabase's authorize endpoint with a PKCE challenge, and a code
  // that comes back only to /login/ (receiveWebLogin), which trades it with the
  // verifier this tab kept for a 30-day Sidekick session on the same account --
  // what an email, phone or ChatGPT sign-in already hands over. A session
  // handed over in the URL fragment (#access_token=, Supabase's implicit flow)
  // is never taken: anyone can put their own session in a link (login CSRF), so
  // a page only takes it out of the address bar (discardSessionFragment).
  const API_ORIGIN = 'https://api.sidekickagent.app';
  const SUPABASE_ORIGIN = 'https://wdjlokfsehsnvcipkods.supabase.co';
  const SUPABASE_PROVIDERS = { google: 'Google', apple: 'Apple' };
  // Where a Google/Apple sign-in ends after /login/. A page on this list goes
  // back to its own path; any other page (the landing, a policy page, the 404)
  // returns to the account page rather than to /membership/: a sign-in started
  // on a page the app opens must not end on the web checkout.
  const RETURN_PATHS = ['/ai/', '/account/'];
  const DEFAULT_RETURN_PATH = '/account/';
  // Per tab (sessionStorage), left by the retired fragment sign-in: where it
  // started, and a message to say on the page it came back to. Nothing writes
  // them any more; a tab that still holds them clears them (로그아웃, init()).
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
    unknown: '로그인했어요'
  };
  const METHOD_LABELS = {
    google: 'Google', apple: 'Apple', chatgpt: 'ChatGPT', email: '이메일', phone: '휴대폰 번호',
    // A web Google/Apple sign-in is answered as `unknown` on purpose (the server
    // cannot tell the two apart), so it is named the way the person chose it.
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
  function storeSession(token, expiresAt, strict = false) {
    if (!isSidekickToken(token) || !(expiresAt > nowSeconds())) return false;
    const serialized = JSON.stringify({ token, expires_at: expiresAt });
    if (strict) {
      const area = storageArea('local');
      if (!area) return false;
      try { area.setItem(SESSION_KEY, serialized); if (area.getItem(SESSION_KEY) !== serialized) return false; }
      catch (_) { return false; }
    } else writeLocal(SESSION_KEY, serialized);
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

  // ---- App handoff receiver --------------------------------------------------
  // Reuse the site's authorize/fetch owner, with an isolated PKCE client per
  // attempt. This is the same /token?grant_type=pkce body auth-js 2.108.2 uses;
  // no shared SDK storage or SIGNED_IN subscription can adopt a candidate.
  async function initAppHandoff(input) {
    const ACTIVE = 'sidekick_web_app_handoff_active';
    const PREFIX = 'sidekick_web_app_handoff:';
    const FINISHED = 'sidekick_web_app_handoff_finished:';
    const LOGIN_URL = 'https://sidekickagent.app/login/';
    // Existing project's public client key; never an account credential.
    const PUBLIC_KEY = 'sb_publishable_nzZjUATdZBWRKZfNLUuCUg_q7TmhhPh';
    const PROOF = /^[A-Za-z0-9_-]{32,128}$/;
    const el = (id) => document.getElementById(id);
    const status = el('handoff-status');
    const choices = el('handoff-choices');
    const existing = el('handoff-existing');
    const confirm = el('handoff-confirm');
    const back = el('handoff-return');
    const cancel = el('handoff-cancel');
    let pending = null;
    let candidate = null; // bearer lives only in this page's memory
    let browser = null;
    let stopped = false;
    let busy = false;
    let expiryTimer = null;
    let callbackExpiresAt = 0;

    function say(message, failed = false) {
      status.textContent = message;
      status.setAttribute('role', failed ? 'alert' : 'status');
    }

    function clearAttempt() {
      if (!pending) return;
      writeTab(PREFIX + pending.id, '');
      if (readTab(ACTIVE) === pending.id) writeTab(ACTIVE, '');
      // A bounded tombstone contains no proofs and prevents reload/remint.
      writeTab(FINISHED + pending.id, String(pending.expires_at));
      pending.oauth = null;
      pending.state = '';
      candidate = null;
      browser = null;
    }

    function stop(message) {
      stopped = true;
      clearTimeout(expiryTimer);
      clearAttempt();
      choices.hidden = true;
      confirm.hidden = true;
      back.hidden = true;
      back.removeAttribute('href');
      cancel.hidden = true;
      say(message, true);
    }

    function fail(error) {
      const copy = {
        400: '로그인 정보를 확인하지 못했어요. 앱에서 다시 시작해 주세요.',
        401: '로그인이 만료됐어요. 앱에서 다시 시작해 주세요.',
        403: '이 계정으로 계속할 수 없어요. 앱에서 계정을 확인해 주세요.',
        409: '계정이 다르거나 이미 사용한 로그인이에요. 앱에서 다시 시작해 주세요.',
        410: '로그인 시간이 지났거나 취소됐어요. 앱에서 다시 시작해 주세요.',
        429: '잠시 기다린 뒤 앱에서 다시 시작해 주세요.'
      };
      stop(copy[error && error.status] || '로그인을 확인하지 못했어요. 앱에서 다시 시작해 주세요.');
    }

    function assertCurrent() {
      if (stopped || !pending || pending.expires_at <= nowSeconds()) throw { status: 410 };
      if (readTab(ACTIVE) !== pending.id) throw { status: 409 };
    }

    function persist() {
      assertCurrent();
      const serialized = JSON.stringify(pending);
      writeTab(PREFIX + pending.id, serialized);
      if (readTab(PREFIX + pending.id) !== serialized) throw { status: 400 };
    }

    async function request(url, bearer, body, extraHeaders = {}, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...extraHeaders,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
      });
      if (!response.ok) throw { status: response.status };
      return response.json();
    }

    function base64url(bytes) {
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function randomProof() {
      return base64url(window.crypto.getRandomValues(new Uint8Array(32)));
    }

    async function digest(value) {
      const bytes = new window.TextEncoder().encode(value);
      return base64url(new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes)));
    }

    async function browserFingerprint() {
      const stored = readStoredSession();
      // Presence, expiry and bearer changes (including logout in another tab)
      // fence this attempt, even if the new bearer names the same account.
      return stored ? digest(stored.token + ':' + stored.expiresAt) : '';
    }

    async function checkBrowser() {
      assertCurrent();
      if (await browserFingerprint() !== pending.browser_fingerprint) throw { status: 409 };
      assertCurrent();
      if (browser && browser.expiresAt <= nowSeconds()) throw { status: 401 };
    }

    function checkedCandidate(answer) {
      const token = String((answer && answer.access_token) || '');
      const id = String((answer && answer.user && answer.user.id) || '');
      const expiresAt = expiryOf(token, answer);
      if (!isSidekickToken(token) || !SAFE_ID.test(id) || expiresAt <= nowSeconds()) throw { status: 401 };
      if (pending.browser_user_id && pending.browser_user_id !== id) throw { status: 409 };
      return { token, id, expiresAt };
    }

    async function verifyCandidate(person) {
      const answer = await request(API_ORIGIN + '/auth/session', person.token);
      await checkBrowser();
      if (!answer || !answer.user || answer.user.id !== person.id) throw { status: 409 };
      if (person.expiresAt <= nowSeconds()) throw { status: 401 };
    }

    async function startProvider(provider) {
      if (busy || stopped || !SUPABASE_PROVIDERS[provider]) return;
      busy = true;
      choices.hidden = true;
      try {
        await checkBrowser();
        // The hint never sends credentials or starts a provider by itself.
        const verifier = randomProof();
        const oauthState = randomProof();
        const challenge = await digest(verifier);
        await checkBrowser();
        pending.provider = provider;
        pending.oauth = { state: oauthState, verifier,
          expires_at: Math.min(nowSeconds() + 300, pending.expires_at) };
        pending.phase = 'provider';
        persist();
        const redirect = new URL(LOGIN_URL);
        redirect.searchParams.set('oauth_attempt', pending.id);
        redirect.searchParams.set('oauth_state', oauthState);
        const authorize = new URL(SUPABASE_ORIGIN + '/auth/v1/authorize');
        authorize.searchParams.set('provider', provider);
        authorize.searchParams.set('redirect_to', redirect.toString());
        authorize.searchParams.set('code_challenge', challenge);
        authorize.searchParams.set('code_challenge_method', 's256');
        if (provider === 'google') authorize.searchParams.set('prompt', 'select_account');
        say(SUPABASE_PROVIDERS[provider] + '로 이동하고 있어요.');
        window.location.assign(authorize.toString());
      } catch (error) { fail(error); }
      finally { busy = false; }
    }

    async function receiveProvider(returned) {
      const oauth = pending.oauth;
      if (!oauth || pending.phase !== 'provider' || returned.attempt !== pending.id
          || returned.state !== oauth.state || oauth.expires_at <= nowSeconds()
          || !PROOF.test(oauth.verifier)) throw { status: 400 };
      if (returned.error) throw { status: 400 };
      await checkBrowser();
      pending.phase = 'exchanging';
      persist(); // A lost response or reload must start a fresh attempt.
      say('선택한 계정을 확인하고 있어요.');
      const providerAnswer = await request(SUPABASE_ORIGIN + '/auth/v1/token?grant_type=pkce', '',
        { auth_code: returned.code, code_verifier: oauth.verifier }, { apikey: PUBLIC_KEY });
      returned.code = '';
      await checkBrowser();
      const providerToken = String((providerAnswer && providerAnswer.access_token) || '');
      if (!providerToken) throw { status: 401 };
      const answer = await request(API_ORIGIN + '/auth/session/exchange', providerToken, undefined, {}, 'POST');
      await checkBrowser();
      candidate = checkedCandidate(answer);
      await verifyCandidate(candidate);
      pending.oauth = null;
      pending.selected_user_id = candidate.id;
      pending.phase = 'confirmed';
      persist();
      confirm.hidden = false;
      say(SUPABASE_PROVIDERS[pending.provider] + '에서 선택한 계정으로 앱에 로그인할 준비가 됐어요.');
    }

    async function selectExisting() {
      if (busy || stopped || !browser) return;
      busy = true;
      choices.hidden = true;
      try {
        await checkBrowser();
        candidate = { token: browser.token, id: pending.browser_user_id, expiresAt: browser.expiresAt };
        await verifyCandidate(candidate);
        pending.selected_user_id = candidate.id;
        pending.phase = 'confirmed';
        pending.oauth = null;
        persist();
        confirm.hidden = false;
        say('이 브라우저에서 확인한 계정으로 앱에 로그인할 준비가 됐어요.');
      } catch (error) { fail(error); }
      finally { busy = false; }
    }

    function callbackUrl(answer) {
      if (!answer || answer.attempt_id !== pending.id) throw { status: 400 };
      const expiry = Number(answer.expires_at);
      if (!Number.isInteger(expiry) || expiry <= nowSeconds()
          || expiry > Math.min(nowSeconds() + 60, pending.expires_at, candidate.expiresAt)) throw { status: 410 };
      const url = new URL(answer.callback_url);
      const keys = Array.from(url.searchParams.keys()).sort();
      if (url.protocol !== 'sidekick:' || url.hostname !== 'auth' || url.pathname !== '/complete'
          || url.username || url.password || url.port || url.hash || keys.join(',') !== 'code,state'
          || !PROOF.test(url.searchParams.get('code') || '') || url.searchParams.get('state') !== pending.state)
        throw { status: 400 };
      return { url: url.toString(), expiry };
    }

    async function complete() {
      if (busy || stopped || !candidate || pending.phase !== 'confirmed') return;
      busy = true;
      confirm.hidden = true;
      try {
        await checkBrowser();
        await verifyCandidate(candidate);
        pending.phase = 'completing';
        persist();
        say('앱으로 돌아갈 준비를 하고 있어요.');
        const answer = await request(API_ORIGIN + '/auth/app-handoff/complete', candidate.token,
          { attempt_id: pending.id, state: pending.state, workspace_id: null });
        await checkBrowser();
        const returned = callbackUrl(answer);
        stopped = true;
        clearTimeout(expiryTimer);
        clearAttempt();
        cancel.hidden = true;
        back.href = returned.url;
        callbackExpiresAt = returned.expiry;
        back.hidden = false;
        say('계정을 확인했어요. 앱으로 돌아가 로그인을 마쳐 주세요.');
        expiryTimer = setTimeout(() => stop('앱으로 돌아갈 시간이 지났어요. 앱에서 다시 시작해 주세요.'),
          Math.max(0, returned.expiry * 1000 - Date.now()));
        window.location.assign(returned.url);
      } catch (error) { fail(error); }
      finally { busy = false; }
    }

    cancel.addEventListener('click', () => stop('로그인을 취소했어요. 이 창을 닫고 앱으로 돌아가 주세요.'));
    back.addEventListener('click', (event) => {
      if (callbackExpiresAt <= nowSeconds()) {
        event.preventDefault();
        stop('앱으로 돌아갈 시간이 지났어요. 앱에서 다시 시작해 주세요.');
      }
    });
    confirm.addEventListener('click', complete);
    existing.addEventListener('click', selectExisting);
    el('handoff-google').addEventListener('click', () => startProvider('google'));
    el('handoff-apple').addEventListener('click', () => startProvider('apple'));
    window.addEventListener('storage', (event) => {
      if (!stopped && (event.key === null || event.key === SESSION_KEY)) fail({ status: 409 });
    });
    window.addEventListener('hashchange', () => {
      // Same-document navigation does not rerun the inline bootstrap. Scrub
      // it immediately and require a fresh app attempt instead of rebinding.
      try { history.replaceState(null, '', '/login/'); } catch (_) {}
      fail({ status: 409 });
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && !stopped) fail({ status: 409 });
    });
    document.addEventListener('visibilitychange', () => {
      if (!stopped && document.visibilityState === 'visible') checkBrowser().catch(fail);
    });

    try {
      if (!input || input.invalid || !window.crypto || !window.crypto.subtle) throw { status: 400 };
      // Sweep only this receiver's expired attempt/proof/tombstone records.
      const area = storageArea('tab');
      if (!area) throw { status: 400 };
      for (const key of Object.keys(area)) {
        if (!key.startsWith(PREFIX) && !key.startsWith(FINISHED)) continue;
        let expiry = 0;
        try { expiry = key.startsWith(FINISHED) ? Number(readTab(key)) : JSON.parse(readTab(key)).expires_at; } catch (_) {}
        if (!(expiry > nowSeconds())) writeTab(key, '');
      }
      if (input.handoff) {
        const entry = input.handoff;
        if (readTab(FINISHED + entry.id)) throw { status: 409 };
        if (readTab(PREFIX + entry.id)) {
          pending = JSON.parse(readTab(PREFIX + entry.id));
          throw { status: 409 };
        }
        const old = readTab(ACTIVE);
        if (old) {
          let oldExpiry = nowSeconds() + 600;
          try { oldExpiry = JSON.parse(readTab(PREFIX + old)).expires_at; } catch (_) {}
          writeTab(FINISHED + old, String(Math.min(oldExpiry, nowSeconds() + 600)));
          writeTab(PREFIX + old, '');
        }
        writeTab(ACTIVE, entry.id);
        pending = { id: entry.id, state: entry.state, provider: entry.provider, phase: 'choosing',
          expires_at: nowSeconds() + 600, browser_fingerprint: await browserFingerprint(),
          browser_user_id: '', selected_user_id: '', oauth: null };
        persist();
      } else {
        const id = input.provider ? input.provider.attempt : readTab(ACTIVE);
        if (!SAFE_ID.test(id || '') || readTab(ACTIVE) !== id || readTab(FINISHED + id)) throw { status: 400 };
        pending = JSON.parse(readTab(PREFIX + id) || 'null');
        if (!pending || pending.id !== id || !PROOF.test(pending.state)
            || !Number.isInteger(pending.expires_at) || pending.expires_at > nowSeconds() + 600
            || !['choosing', 'provider'].includes(pending.phase)) throw { status: 409 };
      }
      await checkBrowser();
      const stored = readStoredSession();
      if (stored) {
        browser = stored;
        const answer = await request(API_ORIGIN + '/auth/session', browser.token);
        await checkBrowser();
        const id = String((answer && answer.user && answer.user.id) || '');
        if (!SAFE_ID.test(id) || (pending.browser_user_id && pending.browser_user_id !== id)) throw { status: 409 };
        pending.browser_user_id = id;
        persist();
        existing.hidden = false;
      }
      expiryTimer = setTimeout(() => fail({ status: 410 }), Math.max(0, pending.expires_at * 1000 - Date.now()));
      cancel.hidden = false;
      if (input.provider) await receiveProvider(input.provider);
      else {
        choices.hidden = false;
        say(browser ? '이 브라우저의 계정을 계속 사용하거나 같은 계정으로 로그인해 주세요.'
          : '앱에서 쓰는 계정으로 로그인해 주세요.');
      }
    } catch (error) { fail(error); }
    finally { delete window.__sidekickLoginInput; }
  }

  const LOGIN_RECEIVER = window.location.pathname === '/login/';
  const loginInput = window.__sidekickLoginInput;
  // App handoff never subscribes or adopts this browser's shared account.
  if (LOGIN_RECEIVER && loginInput && (loginInput.mode === 'app'
      || (!loginInput.invalid && loginInput.mode === 'none'
        && readTab('sidekick_web_app_handoff_active') && !readTab('sidekick_web_pkce_active')))) {
    initAppHandoff(loginInput);
    return;
  }
  // Generic callbacks must not migrate, expire or delete the source session.
  const sourceAtLoad = LOGIN_RECEIVER ? readStoredSession() : null;
  const loaded = LOGIN_RECEIVER ? { token: sourceAtLoad ? sourceAtLoad.token : '',
    expiresAt: sourceAtLoad ? sourceAtLoad.expiresAt : 0, expired: false, exchange: '' } : loadSession();

  const session = {
    webHandoff: null,
    handoffGeneration: 0,
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
  function setToken(token, user, expiresAt, strict = false) {
    const value = String(token || '').trim();
    if (!value || (strict && !storeSession(value, expiresAt, true))) return false;
    invalidateWebLogin();
    retireWebHandoff();
    session.token = value;
    session.expiresAt = expiresAt > 0 ? expiresAt : 0;
    session.user = user && typeof user === 'object' ? user : null;
    session.source = '';
    session.checked = false;
    if (!strict) storeSession(value, session.expiresAt);
    scheduleExpiry();
    return true;
  }

  // Forgets the session in this tab, and in storage when storage still holds
  // this tab's own session. Another tab may have signed in again in the
  // meantime; its newer session is not this tab's to delete.
  function clearLocalSession() {
    invalidateWebLogin();
    retireWebHandoff();
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
    if (LOGIN_RECEIVER) invalidateWebLogin('계정이 바뀌었어요. 로그인을 다시 시작해 주세요.');
    else { invalidateWebLogin(); followOtherTab(); }
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
    // A checked bearer can explicitly say its current sign-in method is unknown.
    // Its account identity source and old display hints cannot make it known.
    const verifiedClaims = session.checked && isSidekickToken(session.token) ? tokenClaims(session.token) : null;
    if (verifiedClaims?.sign_in === 'unknown') return 'unknown';
    if (session.source === 'sidekick-unknown') return 'unknown';
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

  // Built on first use: 누가 로그인했는지, 내 계정, AI 연결, 서비스 연결, 로그아웃. It never
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
    menu.append(who, menuLink('/account/', '내 계정'), menuLink('/ai/', 'AI 연결'), menuLink('/connections/', '서비스 연결'), signOutButton);
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
    prepareTurnstile();
  }

  function close() {
    invalidateWebLogin();
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

  // ---- General web PKCE: one tab's candidate, never an SDK session -----------
  const WEB_ACTIVE = 'sidekick_web_pkce_active';
  const WEB_PREFIX = 'sidekick_web_pkce:';
  const WEB_PROOF = /^[A-Za-z0-9_-]{43}$/;
  let webAttempt = null;
  let webGeneration = 0;
  let webStarting = false;
  let webTimer = null;

  function webProof() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function webDigest(value) {
    const bytes = new window.TextEncoder().encode(value);
    const hash = new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes));
    return btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function webRequest(path, bearer, body) {
    const response = await fetch(API_ORIGIN + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
    });
    if (!response.ok) throw { status: response.status };
    return response.json();
  }

  function currentWebSource() {
    const area = storageArea('local');
    if (!area) throw { status: 400 };
    let raw;
    try { raw = area.getItem(SESSION_KEY); } catch (_) { throw { status: 400 }; }
    const stored = readStoredSession();
    if (raw && !stored) throw { status: 400 };
    const source = stored || { token: '', expiresAt: 0 };
    if (source.token !== session.token || source.expiresAt !== session.expiresAt
        || (source.token && source.expiresAt <= nowSeconds())) throw { status: 409 };
    return source;
  }

  function sameWebSource(left, right) {
    return left.token === right.token && left.expiresAt === right.expiresAt;
  }

  function webSay(message, failed = false) {
    if (!LOGIN_RECEIVER) return;
    const node = document.getElementById('handoff-status');
    if (node) { node.textContent = message; node.setAttribute('role', failed ? 'alert' : 'status'); }
    for (const id of ['handoff-choices', 'handoff-confirm', 'handoff-return']) {
      const item = $(id);
      if (item) { item.hidden = true; if (id === 'handoff-return') item.removeAttribute('href'); }
    }
  }

  function invalidateWebLogin(message = '') {
    webGeneration += 1;
    clearTimeout(webTimer);
    webTimer = null;
    const id = webAttempt ? webAttempt.id : readTab(WEB_ACTIVE);
    if (WEB_PROOF.test(id || '')) {
      writeTab(WEB_PREFIX + id, '');
      if (readTab(WEB_ACTIVE) === id) writeTab(WEB_ACTIVE, '');
    }
    if (webAttempt) { webAttempt.verifier = ''; webAttempt.state = ''; }
    webAttempt = null;
    if (message) {
      webSay(message, true);
      const cancel = document.getElementById('handoff-cancel');
      if (LOGIN_RECEIVER && cancel) cancel.hidden = true;
    }
  }

  function assertWebAttempt() {
    const pending = webAttempt;
    if (!pending || pending.generation !== webGeneration || pending.expires_at <= nowSeconds()
        || pending.oauth_expires_at <= nowSeconds() || readTab(WEB_ACTIVE) !== pending.id) throw { status: 410 };
    let saved;
    try { saved = JSON.parse(readTab(WEB_PREFIX + pending.id)); } catch (_) { throw { status: 400 }; }
    if (!saved || saved.generation !== pending.generation || saved.phase !== pending.phase
        || saved.id !== pending.id || saved.state !== pending.state || saved.verifier !== pending.verifier)
      throw { status: 409 };
  }

  function persistWebAttempt(start = false) {
    const serialized = JSON.stringify(webAttempt);
    writeTab(WEB_PREFIX + webAttempt.id, serialized);
    if (start) writeTab(WEB_ACTIVE, webAttempt.id);
    if (readTab(WEB_PREFIX + webAttempt.id) !== serialized || readTab(WEB_ACTIVE) !== webAttempt.id)
      throw { status: 400 };
    assertWebAttempt();
  }

  async function checkWebSource() {
    assertWebAttempt();
    const source = currentWebSource();
    const fingerprint = source.token ? await webDigest(source.token + ':' + source.expiresAt) : '';
    assertWebAttempt();
    if (!sameWebSource(source, currentWebSource()) || fingerprint !== webAttempt.source_fingerprint
        || Boolean(source.token) !== Boolean(webAttempt.source_user_id)) throw { status: 409 };
    return source;
  }

  function restoredWebAttempt(id) {
    if (!WEB_PROOF.test(id || '') || readTab(WEB_ACTIVE) !== id) throw { status: 400 };
    let p;
    try { p = JSON.parse(readTab(WEB_PREFIX + id)); } catch (_) { throw { status: 400 }; }
    const now = nowSeconds();
    if (!p || p.id !== id || typeof p.state !== 'string' || typeof p.verifier !== 'string'
        || !WEB_PROOF.test(p.state) || !WEB_PROOF.test(p.verifier)
        || !Object.hasOwn(SUPABASE_PROVIDERS, p.provider_intent) || p.phase !== 'provider'
        || !Number.isSafeInteger(p.generation) || p.generation < 0
        || !Number.isInteger(p.created_at) || p.created_at > now
        || !Number.isInteger(p.expires_at) || p.expires_at <= now || p.expires_at > p.created_at + 600
        || !Number.isInteger(p.oauth_expires_at) || p.oauth_expires_at <= now
        || p.oauth_expires_at > p.created_at + 300 || p.oauth_expires_at > p.expires_at
        || !RETURN_PATHS.includes(p.return_path)
        || typeof p.source_user_id !== 'string' || !(p.source_user_id === '' || SAFE_ID.test(p.source_user_id))
        || typeof p.source_fingerprint !== 'string' || !(p.source_fingerprint === '' || WEB_PROOF.test(p.source_fingerprint))) throw { status: 400 };
    return p;
  }

  async function receiveWebLogin(input) {
    document.title = '로그인 · 사이드킥';
    const title = document.getElementById('handoff-title');
    if (title) title.textContent = '사이드킥 로그인';
    const cancel = document.getElementById('handoff-cancel');
    if (cancel) cancel.addEventListener('click', () => invalidateWebLogin('로그인을 취소했어요. 원래 화면에서 다시 시작해 주세요.'));
    window.addEventListener('hashchange', () => {
      try { history.replaceState(null, '', '/login/'); } catch (_) {}
      invalidateWebLogin('로그인 정보가 바뀌었어요. 다시 시작해 주세요.');
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) invalidateWebLogin('원래 화면에서 로그인을 다시 시작해 주세요.');
    });
    let receiverGeneration = null;
    try {
      if (!input || input.invalid || input.mode !== 'web' || !input.web
          || readTab('sidekick_web_app_handoff_active') || !window.crypto || !window.crypto.subtle)
        throw { status: 400 };
      const returned = input.web;
      webAttempt = restoredWebAttempt(returned.attempt);
      webGeneration = webAttempt.generation;
      receiverGeneration = webGeneration;
      if (returned.state !== webAttempt.state || returned.error) throw { status: 400 };
      if (cancel) cancel.hidden = false;
      webTimer = setTimeout(() => invalidateWebLogin('로그인 시간이 지났어요. 다시 시작해 주세요.'),
        Math.max(0, Math.min(webAttempt.oauth_expires_at, session.expiresAt || Infinity) * 1000 - Date.now()));
      const source = await checkWebSource();
      if (source.token) {
        const answer = await webRequest('/auth/session', source.token);
        await checkWebSource();
        if (!answer || !answer.user || answer.user.id !== webAttempt.source_user_id) throw { status: 409 };
      }
      webAttempt.phase = 'exchanging';
      persistWebAttempt();
      webSay('선택한 계정을 확인하고 있어요.');
      const exchange = webRequest('/auth/session/exchange', source.token, {
        flow: 'web_pkce', provider: webAttempt.provider_intent,
        auth_code: returned.code, code_verifier: webAttempt.verifier
      });
      returned.code = '';
      const answer = await exchange;
      await checkWebSource();
      const token = String((answer && answer.access_token) || '');
      const id = String((answer && answer.user && answer.user.id) || '');
      const expiresAt = expiryOf(token, answer);
      if (!isSidekickToken(token) || !SAFE_ID.test(id) || expiresAt <= nowSeconds()
          || answer.method !== 'unknown' || (webAttempt.source_user_id && webAttempt.source_user_id !== id))
        throw { status: 409 };
      const checked = await webRequest('/auth/session', token);
      await checkWebSource();
      if (!checked || !checked.user || checked.user.id !== id) throw { status: 409 };
      const destination = webAttempt.return_path;
      // No await in this final source fence + storage adoption block.
      assertWebAttempt();
      if (!sameWebSource(source, currentWebSource()) || expiresAt <= nowSeconds()) throw { status: 409 };
      if (!setToken(token, checked.user, expiresAt, true)) throw { status: 400 };
      rememberAccount('unknown', checked.user);
      session.source = 'sidekick-unknown';
      session.checked = true;
      webSay('로그인했어요.');
      if (cancel) cancel.hidden = true;
      window.location.replace(destination);
      return true;
    } catch (error) {
      // The server's one account-mismatch refusal gets its own sentence: the
      // person picked a different Google/Apple account than the one this browser
      // is already signed in with, and only signing out first fixes that.
      const copy = error && error.status === 423 ? DELETION_PENDING_COPY
        : error && error.status === 409 && error.detail === 'Sign-in account does not match'
          ? '지금 로그인한 계정과 다른 계정이에요. 로그아웃한 뒤 다시 로그인해 주세요.'
        : '로그인을 완료하지 못했어요. 원래 화면에서 다시 시작해 주세요.';
      if (receiverGeneration === null || receiverGeneration === webGeneration) invalidateWebLogin(copy);
      return false;
    } finally {
      if (input && input.web) input.web.code = '';
      delete window.__sidekickLoginInput;
    }
  }


  async function startSupabaseLogin(provider) {
    if (!Object.hasOwn(SUPABASE_PROVIDERS, provider) || webStarting) return;
    webStarting = true;
    invalidateWebLogin();
    const generation = webGeneration;
    try {
      if (!window.crypto || !window.crypto.subtle) throw { status: 400 };
      const source = currentWebSource();
      const assertStart = () => {
        if (generation !== webGeneration || !sameWebSource(source, currentWebSource())) throw { status: 409 };
      };
      let sourceId = '';
      if (source.token) {
        const answer = await webRequest('/auth/session', source.token);
        assertStart();
        sourceId = String((answer && answer.user && answer.user.id) || '');
        if (!SAFE_ID.test(sourceId)) throw { status: 401 };
      }
      const verifier = webProof();
      const challenge = await webDigest(verifier);
      assertStart();
      const fingerprint = source.token ? await webDigest(source.token + ':' + source.expiresAt) : '';
      assertStart();
      const here = window.location.pathname;
      const now = nowSeconds();
      webAttempt = { id: webProof(), state: webProof(), verifier, provider_intent: provider,
        phase: 'provider', generation, created_at: now, expires_at: now + 600,
        oauth_expires_at: now + 300, source_user_id: sourceId, source_fingerprint: fingerprint,
        return_path: RETURN_PATHS.includes(here) ? here : DEFAULT_RETURN_PATH };
      persistWebAttempt(true);
      await checkWebSource();
      const redirect = new URL('https://sidekickagent.app/login/');
      redirect.searchParams.set('web_login_attempt', webAttempt.id);
      redirect.searchParams.set('web_login_state', webAttempt.state);
      const url = new URL(SUPABASE_ORIGIN + '/auth/v1/authorize');
      url.searchParams.set('provider', provider);
      url.searchParams.set('redirect_to', redirect.toString());
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 's256');
      if (provider === 'google') url.searchParams.set('prompt', 'select_account');
      showSocialStatus(SUPABASE_PROVIDERS[provider] + '로 이동하고 있어요.', false);
      window.location.assign(url.toString());
    } catch (_) {
      if (generation === webGeneration) { invalidateWebLogin(); showSocialStatus(SOCIAL_FAILED_COPY, true); }
    } finally { webStarting = false; }
  }

  // Google and Apple come back only to /login/ (receiveWebLogin), bound to this
  // tab's PKCE verifier. A Supabase session in the fragment (#access_token=…,
  // the implicit flow this site no longer starts) proves nothing about who
  // opened the link: anyone can paste their own session into one, and taking it
  // would sign the visitor into that account for 30 days (login CSRF). So it is
  // never read, traded or stored -- only taken out of the address bar, so it
  // sits in no history entry and in nothing that later logs a URL.
  function discardSessionFragment() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) return;
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) { /* never used either way */ }
  }

  // POST /auth/session/exchange for a per-tab Google/Apple bearer kept before
  // the 30-day session (loadSession: this browser's own sessionStorage, never a
  // URL). The token, from memory, is the bearer of this one call, and a 30-day
  // Sidekick session on the same account comes back -- the only thing kept.
  // Answers true, or the sentence to say.
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

  // ---- App→Web: the app the person is signed in to vouches for this page ----
  // Only the in-app /connections/ page inside the Sidekick app's own viewer asks
  // (docs/08 2026-10-01 앱→웹 인계). The page keeps its S256 verifier; the app
  // sees only the challenge and returns a 60s single-use code bound to this
  // page's state. A different account already signed in here is refused by the
  // server and stays as it is.
  const APP_WEB_REQUEST = 'sidekick.web_handoff.request';
  const APP_WEB_CODE = 'sidekick.web_handoff.code';
  let appWebPending = null;

  function retireWebHandoff() {
    session.handoffGeneration += 1;
    if (session.webHandoff) session.webHandoff = { required: true };
  }
  function webHandoffWorkspace() {
    const receipt = session.webHandoff;
    if (!receipt) return null;
    const current = receipt.generation === session.handoffGeneration && receipt.token === session.token
      && receipt.userId === String(session.user?.id || '') && !sessionExpired();
    return { required: true, workspaceId: current ? receipt.workspaceId : '' };
  }
  window.addEventListener('pagehide', retireWebHandoff);

  function appWebHandoffAvailable() {
    const bridge = window.ReactNativeWebView;
    let inApp = false;
    try { inApp = new URLSearchParams(window.location.search).get('in_app') === '1'; } catch (_) { inApp = false; }
    return Boolean(bridge && typeof bridge.postMessage === 'function' && inApp
      && window.location.origin === 'https://sidekickagent.app' && window.location.pathname === '/connections/'
      && window.crypto && window.crypto.subtle);
  }

  function appWebCode(state) {
    return new Promise((resolve) => {
      let timer = null;
      const receive = (event) => {
        let data = null;
        try { data = typeof event.data === 'string' ? JSON.parse(event.data) : null; } catch (_) { data = null; }
        if (!data || data.type !== APP_WEB_CODE || data.state !== state) return;
        const attempt = String(data.attempt_id || '');
        const code = String(data.code || '');
        finish(/^ah_[A-Za-z0-9_-]{32}$/.test(attempt) && /^[A-Za-z0-9_-]{43}$/.test(code) ? { attempt, code } : null);
      };
      const finish = (value) => {
        clearTimeout(timer);
        window.removeEventListener('message', receive);
        document.removeEventListener('message', receive);
        window.removeEventListener('pagehide', cancelled);
        resolve(value);
      };
      const cancelled = () => finish(null);
      window.addEventListener('pagehide', cancelled);
      timer = setTimeout(() => finish(null), 60000);
      // No event.origin check, on purpose: the app's viewer (react-native-webview)
      // delivers its reply with an empty origin, so there is nothing to compare.
      // The reply is bound instead by `state` -- 32 fresh random bytes this page
      // sent only to the app, through ReactNativeWebView.postMessage -- and by
      // the S256 verifier that never leaves this page: a forged message cannot
      // name the state, and a code without the verifier is refused by the server.
      // iOS delivers the viewer's message on window, Android on document.
      window.addEventListener('message', receive);
      document.addEventListener('message', receive);
      return state;
    });
  }

  async function appWebHandoff() {
    if (!appWebHandoffAvailable()) return false;
    if (appWebPending) return appWebPending;
    appWebPending = (async () => {
      const verifier = webProof();
      const state = webProof();
      const before = session.token;
      const generation = session.handoffGeneration;
      session.webHandoff = { required: true };
      const replied = appWebCode(state);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: APP_WEB_REQUEST, version: 1, state, code_challenge: await webDigest(verifier)
      }));
      const reply = await replied;
      if (!reply || session.token !== before || session.handoffGeneration !== generation) return false;
      let answer = null;
      try {
        answer = await api('/auth/web-handoff/exchange', {
          method: 'POST',
          body: JSON.stringify({ attempt_id: reply.attempt, state, code: reply.code, code_verifier: verifier }),
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
        });
      } catch (_) {
        return false;
      }
      const token = String((answer && answer.access_token) || '').trim();
      const user = answer && answer.user && typeof answer.user === 'object' ? answer.user : null;
      const receipt = answer && answer.handoff;
      if (!isSidekickToken(token) || !user || !SAFE_ID.test(String(user.id || '')) || session.token !== before
        || session.handoffGeneration !== generation || !receipt || receipt.attempt_id !== reply.attempt
        || receipt.user_id !== user.id || typeof receipt.workspace_id !== 'string' || !SAFE_ID.test(receipt.workspace_id)) return false;
      if (before && session.user && String(session.user.id || '') !== String(user.id)) return false;
      setToken(token, user, expiryOf(token, answer));
      session.webHandoff = { required: true, attemptId: reply.attempt, userId: user.id, workspaceId: receipt.workspace_id,
        token: session.token, generation: session.handoffGeneration };
      // The server resolved the account and its deletion lock to mint this.
      session.checked = true;
      return true;
    })().finally(() => { appWebPending = null; });
    return appWebPending;
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
    if (LOGIN_RECEIVER) {
      if (webAttempt && (webAttempt.oauth_expires_at <= nowSeconds() || sessionExpired()))
        invalidateWebLogin('로그인 시간이 지났어요. 다시 시작해 주세요.');
      return;
    }
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

  // ---- Turnstile in front of the email/phone code --------------------------
  //
  // Cloudflare Turnstile (owner 2026-10-04): a bot check before 인증번호 sends a
  // mail or a text. Off while TURNSTILE_SITE_KEY is empty: no script is loaded,
  // no field is sent and the sheet is exactly what it was. To turn it on, create
  // the widget in the Cloudflare dashboard for sidekickagent.app, put its site
  // key here (public, not a secret), and have the backend verify
  // `turnstile_token` with the widget's secret key (siteverify) on POST
  // /auth/start. Every page that can open the sheet already allows
  // https://challenges.cloudflare.com in script-src and frame-src; /login/ has
  // no code sign-in and does not.
  const TURNSTILE_SITE_KEY = '';
  const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const TURNSTILE_RETRY_MS = 5000;
  const TURNSTILE_FAILED_COPY = '보안 확인을 하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  const TURNSTILE_EXPIRED_COPY = '보안 확인 시간이 지나 다시 확인하고 있어요.';
  const TURNSTILE_WAIT_COPY = '보안 확인이 끝나면 인증번호를 받을 수 있어요.';
  // One widget per page. A token is single-use and lasts five minutes; `stale`
  // marks a widget that must run again the next time the code form shows.
  const turnstile = { loading: null, widget: null, token: '', stale: false, said: '', retry: null };

  function codeButton() {
    const form = $('email-form');
    return form ? form.querySelector('button[type="submit"]') : null;
  }

  function codeFormShowing() {
    const sheet = $('signin-sheet');
    const block = $('otp-block');
    return Boolean(sheet && !sheet.hidden && block && !block.hidden);
  }

  // 인증번호 can be pressed only while an unused token is held. A token that
  // arrives takes back the sentence the check itself put up, nothing else.
  function holdTurnstileToken(token) {
    turnstile.token = typeof token === 'string' ? token : '';
    const button = codeButton();
    if (button) button.disabled = !turnstile.token;
    if (turnstile.token && turnstile.said) {
      const status = $('auth-status');
      if (status && status.textContent === turnstile.said) setAuthStatus('', false);
      turnstile.said = '';
    }
  }

  function sayTurnstile(message) {
    turnstile.said = message;
    setAuthStatus(message, true);
  }

  function loadTurnstile() {
    if (!turnstile.loading) {
      turnstile.loading = new Promise((resolve, reject) => {
        const ready = () => Boolean(window.turnstile && typeof window.turnstile.render === 'function');
        if (ready()) { resolve(window.turnstile); return; }
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT;
        script.async = true;
        script.onload = () => (ready() ? resolve(window.turnstile) : reject(new Error('turnstile_unavailable')));
        script.onerror = () => reject(new Error('turnstile_unavailable'));
        document.head.append(script);
      });
      // A load that failed (offline, blocked) is tried again the next time.
      turnstile.loading.catch(() => { turnstile.loading = null; });
    }
    return turnstile.loading;
  }

  function resetTurnstile() {
    clearTimeout(turnstile.retry);
    turnstile.retry = null;
    turnstile.stale = false;
    holdTurnstileToken('');
    try { window.turnstile.reset(turnstile.widget); } catch (_) { turnstile.stale = true; }
  }

  // Expired or timed out: run again now while the form shows, else when it next shows.
  function lapseTurnstile() {
    holdTurnstileToken('');
    if (!codeFormShowing()) { turnstile.stale = true; return; }
    sayTurnstile(TURNSTILE_EXPIRED_COPY);
    resetTurnstile();
  }

  // Failed: said, and run again after a pause -- never in a tight loop.
  function failTurnstile() {
    holdTurnstileToken('');
    clearTimeout(turnstile.retry);
    turnstile.stale = true;
    if (codeFormShowing()) sayTurnstile(TURNSTILE_FAILED_COPY);
    turnstile.retry = setTimeout(() => {
      turnstile.retry = null;
      if (codeFormShowing()) resetTurnstile();
    }, TURNSTILE_RETRY_MS);
  }

  // Runs whenever the code form shows (the sheet opens on it, or 이메일 ·
  // 휴대폰으로 로그인 opens it): the script loads once, the widget renders once
  // into a slot under the form, and a spent, expired or failed check runs again.
  function prepareTurnstile() {
    if (!TURNSTILE_SITE_KEY) return;
    // Fetched as the sheet opens, so it is there by the time the form shows.
    loadTurnstile().catch(() => {});
    const form = $('email-form');
    if (!form || !codeFormShowing()) return;
    let slot = $('turnstile-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'turnstile-slot';
      slot.className = 'turnstile-slot';
      form.after(slot);
    }
    if (turnstile.widget !== null) {
      if (turnstile.stale) resetTurnstile();
      else holdTurnstileToken(turnstile.token);
      return;
    }
    holdTurnstileToken('');
    loadTurnstile().then((api) => {
      if (turnstile.widget !== null) return;
      turnstile.widget = api.render(slot, {
        sitekey: TURNSTILE_SITE_KEY,
        action: 'sign_in',
        appearance: 'interaction-only',
        language: 'ko',
        'response-field': false,
        'refresh-expired': 'never',
        'refresh-timeout': 'never',
        callback: (token) => holdTurnstileToken(token),
        'expired-callback': lapseTurnstile,
        'timeout-callback': lapseTurnstile,
        'error-callback': () => { failTurnstile(); return true; }
      });
    }).catch(() => { if (codeFormShowing()) sayTurnstile(TURNSTILE_FAILED_COPY); });
  }

  // ---- Email / phone code ---------------------------------------------------

  async function sendCode(event) {
    event.preventDefault();
    const body = { method: session.method, value: $('email').value.trim() };
    if (TURNSTILE_SITE_KEY) {
      if (!turnstile.token) { sayTurnstile(TURNSTILE_WAIT_COPY); return; }
      // Spent by this request: the next 인증번호 waits for a fresh token.
      body.turnstile_token = turnstile.token;
      holdTurnstileToken('');
      turnstile.stale = true;
    }
    setAuthStatus('인증번호를 보내고 있어요.', false);
    try {
      const result = await api('/auth/start', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      session.challengeId = result.challenge_id;
      $('code-form').hidden = false;
      $('code').focus();
      setAuthStatus(`${result.value_masked || `입력한 ${AUTH_METHODS[session.method].label}`}로 인증번호를 보냈어요.`, false);
    } catch (error) {
      setAuthStatus(error && error.network ? NETWORK_COPY
        : error && error.status === 422 ? (session.method === 'phone' ? '휴대폰 번호를 확인해 주세요.' : '이메일 주소를 확인해 주세요.')
        : error && error.status === 429 ? '인증번호를 너무 자주 요청했어요. 잠시 뒤 다시 시도해 주세요.'
        : '인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    } finally {
      if (TURNSTILE_SITE_KEY && codeFormShowing()) resetTurnstile();
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
      prepareTurnstile();
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
  // DOMContentLoaded below. It resolves to whether a bearer is held, after a
  // pre-30-day Google/Apple bearer has been traded and the server has confirmed
  // the bearer. A session in the URL fragment is removed, never used
  // (discardSessionFragment). Page hooks: onSignedIn(user, {otherTab}) after a
  // sign-in here or in another tab, onSignedOut() after 로그아웃 here or in
  // another tab or an expiry, onNotice(message, isError) for what the page
  // should say.
  function init(options = {}) {
    if (initialized) return initialized;
    if (LOGIN_RECEIVER) { initialized = receiveWebLogin(loginInput); return initialized; }
    hooks.onSignedIn = options.onSignedIn || null;
    hooks.onSignedOut = options.onSignedOut || null;
    hooks.onNotice = options.onNotice || null;
    bindHeader();
    renderHeader();
    // A page that ships the sheet in its HTML has it bound now; any other page
    // builds it the first time someone asks to sign in.
    if ($('signin-sheet')) ensureSheet();
    discardSessionFragment();
    initialized = Promise.resolve().then(async () => {
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
      return Boolean(session.token);
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
    appWebHandoff,
    webHandoffWorkspace,
    token: () => session.token,
    user: () => session.user
  });
})();
