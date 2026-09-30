(() => {
  'use strict';

  // One sign-in for every page of the site. Every page carries the same header
  // account slot (#account-pill) and loads this file: signed out, the slot opens
  // the sign-in sheet in place; signed in, it opens a small menu with the
  // account page, AI 연결 and 로그아웃. /membership/, /ai/ and /account/ also
  // use the sheet and the one `api()` for their own calls.
  //
  // The doors are the ones the app offers, the backend is the same, and the
  // bearer is kept under one sessionStorage key, so signing in on one page
  // carries to the others in the same tab. The token lives only there -- never
  // in a URL, never in localStorage -- and goes out only as an Authorization
  // header.
  //
  // Google and Apple are Supabase logins in the app, and the backend accepts a
  // Supabase JWT as a bearer for any authenticated route. No SDK is loaded: just
  // a redirect to Supabase's authorize endpoint and a token read back out of the
  // URL fragment, which is cleared at once.
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
  const RETURN_KEY = 'sidekick_web_return_path';
  const NOTICE_KEY = 'sidekick_web_auth_notice';
  const TOKEN_KEY = 'sidekick_web_access_token';
  // What the person signed in with and the address the sign-in answer named,
  // for display only: "Google로 로그인했어요 · a@b.com". Never a token or a
  // code, and cleared with the token.
  const PROFILE_KEY = 'sidekick_web_account_hint';
  // 32 random bytes are 43 base64url characters: inside the server's
  // ^[A-Za-z0-9_-]{32,128}$ for a ChatGPT sign-in's app_state.
  const APP_STATE_BYTES = 32;
  const NETWORK_COPY = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  const SOCIAL_FAILED_COPY = '로그인이 완료되지 않았어요. 다시 시도해 주세요.';
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
  // the page no longer knows which door was pressed.
  const METHOD_PHRASES = {
    google: 'Google로 로그인했어요',
    apple: 'Apple로 로그인했어요',
    chatgpt: 'ChatGPT로 로그인했어요',
    email: '이메일로 로그인했어요',
    phone: '휴대폰 번호로 로그인했어요',
    kakao: '카카오로 로그인했어요',
    supabase: 'Google 또는 Apple로 로그인했어요'
  };
  const METHOD_LABELS = {
    google: 'Google', apple: 'Apple', chatgpt: 'ChatGPT', email: '이메일', phone: '휴대폰 번호',
    kakao: '카카오', supabase: 'Google 또는 Apple'
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

  const session = {
    token: readStore(TOKEN_KEY),
    user: null,
    // The server's name for how this bearer was issued (GET /auth/session):
    // `supabase`, or `sidekick-email|phone|chatgpt|kakao`.
    source: '',
    // True once GET /auth/session answered for this token.
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

  const $ = (id) => document.getElementById(id);

  function readStore(key) {
    try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function writeStore(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch (_) { /* a private window may refuse storage; the page still works for this visit */ }
  }

  function cleanText(value, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  // A display hint only. Anything that does not look like one is dropped.
  function readProfile() {
    let raw = null;
    try { raw = JSON.parse(readStore(PROFILE_KEY) || 'null'); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object' || !METHOD_PHRASES[raw.method]) return null;
    const userId = cleanText(raw.user_id, 160);
    return {
      method: raw.method,
      email: cleanText(raw.email, 254),
      phone: cleanText(raw.phone, 32),
      name: cleanText(raw.name, 80),
      user_id: SAFE_ID.test(userId) ? userId : ''
    };
  }

  function saveProfile(profile) {
    session.profile = profile;
    writeStore(PROFILE_KEY, profile ? JSON.stringify(profile) : '');
  }

  // What a sign-in answer said about the person. Only fields meant for display:
  // a masked phone number, never the full one.
  function rememberAccount(method, user) {
    const person = user && typeof user === 'object' ? user : {};
    const userId = String(person.id || '');
    saveProfile({
      method,
      email: cleanText(person.email, 254),
      phone: cleanText(person.phoneMasked, 32),
      name: cleanText(person.name, 80),
      user_id: SAFE_ID.test(userId) ? userId : ''
    });
  }

  function setToken(token, user) {
    session.token = String(token || '').trim();
    session.user = user && typeof user === 'object' ? user : null;
    session.source = '';
    session.checked = false;
    writeStore(TOKEN_KEY, session.token);
  }

  function clearLocalSession() {
    stopChatGpt();
    session.token = '';
    session.user = null;
    session.source = '';
    session.checked = false;
    writeStore(TOKEN_KEY, '');
    saveProfile(null);
  }

  // Signing out ends the session on the server too (POST /auth/logout revokes
  // this token's own session), then forgets it here. The local part happens
  // first and does not wait: a dropped connection must not leave the person
  // signed in on a shared computer. `server: false` is for a token the server
  // already refused -- there is nothing left to revoke. `silent: true` is for a
  // page that resets itself and needs no hook back.
  function signOut(options = {}) {
    const bearer = session.token;
    clearLocalSession();
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

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (session.token) headers.Authorization = `Bearer ${session.token}`;
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
    const id = session.user ? String(session.user.id || '') : '';
    const profile = session.profile;
    // A hint written for another account is not this person's.
    if (profile && profile.user_id && profile.user_id !== id) saveProfile(null);
    else if (profile && !profile.user_id && SAFE_ID.test(id)) saveProfile({ ...profile, user_id: id });
    return session.user;
  }

  // Run once per page: a stored bearer is only believed after the server says
  // it still is one. 401/403 is a token that ended (expired, revoked, signed out
  // elsewhere): sign out here, quietly, so no page shows "내 계정" over a dead
  // session. 423 is an account being deleted. A dropped connection or a server
  // error proves nothing about the token, so it is kept and the page says so.
  async function validateSession() {
    if (!session.token || session.checked) return;
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

  function signInMethod() {
    const source = session.source;
    const hinted = session.profile ? session.profile.method : '';
    if (source.indexOf('sidekick-') === 0 && METHOD_PHRASES[source.slice(9)]) return source.slice(9);
    if (source === 'supabase') return hinted === 'google' || hinted === 'apple' ? hinted : 'supabase';
    return METHOD_PHRASES[hinted] ? hinted : '';
  }

  function shortId(id) {
    const text = String(id || '');
    return text.length > 16 ? `${text.slice(0, 9)}…${text.slice(-4)}` : text;
  }

  // Everything a page may show about the person, built only from the server's
  // answer and the display hint. Null when signed out.
  function account() {
    if (!session.token) return null;
    const method = signInMethod();
    const profile = session.profile || {};
    const id = session.user ? String(session.user.id || '') : '';
    return {
      id,
      shortId: shortId(id),
      checked: session.checked,
      method,
      methodLabel: METHOD_LABELS[method] || '',
      phrase: METHOD_PHRASES[method] || '로그인했어요',
      email: profile.email || '',
      phone: profile.phone || '',
      name: profile.name || ''
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
    renderHeader();
    if (typeof hooks.onSignedIn === 'function') await hooks.onSignedIn(session.user);
    else showToast('로그인했어요.', false);
  }

  // ---- Google / Apple through Supabase -------------------------------------

  function startSupabaseLogin(provider) {
    if (!SUPABASE_PROVIDERS[provider]) return;
    const here = window.location.pathname;
    writeStore(RETURN_KEY, RETURN_PATHS.includes(here) ? here : here === '/membership/' ? '' : DEFAULT_RETURN_PATH);
    // Which door, so the account page can say "Google로 로그인했어요".
    rememberAccount(provider, null);
    showSocialStatus(`${SUPABASE_PROVIDERS[provider]}으로 이동하고 있어요.`, false);
    const url = new URL(`${SUPABASE_ORIGIN}/auth/v1/authorize`);
    url.searchParams.set('provider', provider);
    url.searchParams.set('redirect_to', RETURN_URL);
    window.location.assign(url.toString());
  }

  // A person who started on another page goes back there now. The token is
  // already in sessionStorage, which the same tab carries across pages.
  function returnToStartingPage() {
    const back = readStore(RETURN_KEY);
    writeStore(RETURN_KEY, '');
    if (!back || !RETURN_PATHS.includes(back) || back === window.location.pathname) return false;
    window.location.replace(back);
    return true;
  }

  // Supabase's implicit flow returns the session in the fragment. Reading it
  // here and clearing it immediately keeps the token out of history and out of
  // anything that later logs a URL.
  async function adoptSupabaseRedirect() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) {
      if (hash.includes('error=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        writeStore(NOTICE_KEY, SOCIAL_FAILED_COPY);
        if (returnToStartingPage()) return new Promise(() => {});
      }
      return false;
    }
    const params = new URLSearchParams(hash.slice(1));
    const token = String(params.get('access_token') || '').trim();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!token) return false;
    setToken(token, null);
    // The page the person started on checks the session itself.
    if (returnToStartingPage()) return new Promise(() => {});
    try {
      await whoami();
      showSocialStatus('', false);
      return true;
    } catch (_) {
      signOut({ server: false, silent: true });
      writeStore(NOTICE_KEY, '로그인은 됐지만 계정을 확인하지 못했어요. 다시 시도해 주세요.');
      return false;
    }
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
      setToken(signedIn.access_token, signedIn.user || null);
      rememberAccount('chatgpt', signedIn.user);
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
  // from the approval tab is exactly when the answer is ready.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !session.chatgpt) return;
    if (session.chatgpt.timer) clearTimeout(session.chatgpt.timer);
    pollChatGptLogin();
  });

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
    setToken(result.access_token, result.user || null);
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
  // Supabase fragment has been read and the server has confirmed the bearer,
  // and never resolves while the page is handing the person back to the page
  // they started on.
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
      const notice = readStore(NOTICE_KEY);
      if (notice) {
        writeStore(NOTICE_KEY, '');
        notify(notice, true);
      }
      await validateSession();
      renderHeader();
      return Boolean(adopted || session.token);
    });
    return initialized;
  }

  document.addEventListener('DOMContentLoaded', () => { init(); });

  window.SidekickAuth = Object.freeze({
    API_ORIGIN,
    NETWORK_COPY,
    init,
    api,
    whoami,
    open,
    close,
    signOut,
    copyText,
    httpsUrl,
    account,
    token: () => session.token,
    user: () => session.user
  });
})();
