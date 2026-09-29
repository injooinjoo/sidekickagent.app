(() => {
  'use strict';

  // One sign-in for every page that needs an account: /membership/ and /ai/.
  // Both use the same doors the app offers, the same backend, and the same
  // bearer kept under the same sessionStorage key, so signing in on one page
  // carries to the other in the same tab. The token lives only there -- never in
  // a URL, never in localStorage -- and goes out only as an Authorization header.
  //
  // Google and Apple are Supabase logins in the app, and the backend accepts a
  // Supabase JWT as a bearer for any authenticated route. No SDK is loaded: just
  // a redirect to Supabase's authorize endpoint and a token read back out of the
  // URL fragment, which is cleared at once.
  const API_ORIGIN = 'https://api.sidekickagent.app';
  const SUPABASE_ORIGIN = 'https://wdjlokfsehsnvcipkods.supabase.co';
  const SUPABASE_PROVIDERS = { google: 'Google', apple: 'Apple' };
  // The one return address Supabase is told about. A page that is not this one
  // leaves its own path behind, and the membership page sends the person
  // straight back to it after the fragment is read.
  const RETURN_URL = 'https://sidekickagent.app/membership/';
  const RETURN_PATHS = ['/ai/'];
  const RETURN_KEY = 'sidekick_web_return_path';
  const NOTICE_KEY = 'sidekick_web_auth_notice';
  const TOKEN_KEY = 'sidekick_web_access_token';
  // 32 random bytes are 43 base64url characters: inside the server's
  // ^[A-Za-z0-9_-]{32,128}$ for a ChatGPT sign-in's app_state.
  const APP_STATE_BYTES = 32;
  const NETWORK_COPY = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  const SOCIAL_FAILED_COPY = '로그인이 완료되지 않았어요. 다시 시도해 주세요.';
  // Every way in the app offers, so a purchase or a connection is attached to
  // the account the person already has instead of minting a second one.
  const AUTH_METHODS = {
    email: { label: '이메일', inputType: 'email', autocomplete: 'email', placeholder: '' },
    phone: { label: '휴대폰', inputType: 'tel', autocomplete: 'tel', placeholder: '010-1234-5678' }
  };

  const session = {
    token: readStore(TOKEN_KEY),
    user: null,
    method: 'email',
    challengeId: null,
    busy: false,
    // A ChatGPT sign-in waiting for approval. Held in memory only: the page
    // stays open while the person approves in another tab.
    chatgpt: null
  };
  const hooks = { onSignedIn: null, onNotice: null };

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

  function setToken(token, user) {
    session.token = String(token || '').trim();
    session.user = user && typeof user === 'object' ? user : null;
    writeStore(TOKEN_KEY, session.token);
  }

  function signOut() {
    stopChatGpt();
    session.token = '';
    session.user = null;
    writeStore(TOKEN_KEY, '');
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
    return session.user;
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

  function notify(message, isError) {
    showSocialStatus(message, isError);
    if (typeof hooks.onNotice === 'function') hooks.onNotice(message, isError);
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

  // ---- Sign-in sheet ------------------------------------------------------

  function open() {
    const sheet = $('signin-sheet');
    if (!sheet) return;
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
    // Switching method abandons any code already sent, so the second form must
    // not stay open offering to verify a code for the other identity.
    $('code-form').hidden = true;
    $('code').value = '';
    setAuthStatus('', false);
    input.focus();
  }

  async function finishSignIn() {
    close();
    if (typeof hooks.onSignedIn === 'function') await hooks.onSignedIn(session.user);
  }

  // ---- Google / Apple through Supabase -------------------------------------

  function startSupabaseLogin(provider) {
    if (!SUPABASE_PROVIDERS[provider]) return;
    writeStore(RETURN_KEY, RETURN_PATHS.includes(window.location.pathname) ? window.location.pathname : '');
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
      signOut();
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
    setAuthStatus('', false);
    await finishSignIn();
  }

  // ---- Wiring ----------------------------------------------------------------

  function bindSheet() {
    const sheet = $('signin-sheet');
    if (!sheet) return;
    $('google-button').addEventListener('click', () => startSupabaseLogin('google'));
    $('apple-button').addEventListener('click', () => startSupabaseLogin('apple'));
    $('chatgpt-button').addEventListener('click', startChatGptLogin);
    document.querySelectorAll('[data-method]').forEach((tab) => {
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
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !sheet.hidden) close();
    });
  }

  let initialized = null;

  // Each page calls this once. It resolves to whether a bearer is held once any
  // Supabase fragment has been read, and never resolves while the page is
  // handing the person back to the page they started on.
  function init(options = {}) {
    if (initialized) return initialized;
    hooks.onSignedIn = options.onSignedIn || null;
    hooks.onNotice = options.onNotice || null;
    bindSheet();
    initialized = adoptSupabaseRedirect().then((adopted) => {
      const notice = readStore(NOTICE_KEY);
      if (notice) {
        writeStore(NOTICE_KEY, '');
        notify(notice, true);
      }
      return Boolean(adopted || session.token);
    });
    return initialized;
  }

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
    token: () => session.token,
    user: () => session.user
  });
})();
