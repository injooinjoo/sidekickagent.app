// '앱으로 로그인' on /login/: the website opens a login request and shows it as a QR code; the signed-in Sidekick app
// scans it and approves (owner decision 2026-11-20 23:0x on #6028: QR, approve/deny only, two minutes).
//
// The page sends an S256 challenge and a state (POST /auth/push-login/start), draws the answer's request id as a QR
// code, and asks POST /auth/push-login/check with the verifier until the app has answered. The QR holds only the
// short one-time request id inside the app link -- never the state, the verifier, a token or a session. An approved
// check carries a 30-day Sidekick session, adopted exactly as a code sign-in's (SidekickAuth.adoptSignIn): the same
// stored session, header and return path. The state and the verifier live in this page's memory only -- never in a
// URL, storage or a log -- and a session is taken only from the check answer of this page's own request (login
// CSRF, #3688). A request lives two minutes; then '새로 만들기' opens a new one.
//
// Bound only on /login/ in its website mode; the app hand-off (#app_handoff=…) and every other page are untouched.
// The pure part is on window.SidekickAppLogin for apps/site/test_login_with_app.mjs. The QR encoder below is this
// file's own (byte mode, error correction L, versions 1-5): the site loads no library.
(() => {
  'use strict';

  const POLL_DEFAULT_MS = 2000;
  const POLL_MIN_MS = 1000;
  const POLL_MAX_MS = 5000;
  const REQUEST_ID = /^pl_[A-Za-z0-9_-]{32}$/;
  // The app link the QR carries (controller default; the app side, #6059, opens it and shows the approval sheet).
  const APP_LINK_PREFIX = 'sidekick://web-login/';
  const COPY = {
    denied: '앱에서 로그인을 거절했어요.',
    expired: '시간이 지났어요. 새로 만들거나 인증번호로 로그인해 주세요.',
    cancelled: '요청이 취소됐어요.',
    conflict: '이 브라우저에는 다른 계정이 로그인돼 있어요. 로그아웃한 뒤 다시 시도해 주세요.',
    failed: '사이드킥에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 뒤 다시 시도해 주세요.'
  };

  // ---- The pure part ---------------------------------------------------------------------------------------

  // What the page shows for an answer of check (or the error SidekickAuth.api threw): 'waiting' with the whole
  // seconds left, 'approved' with the session, or one of the endings.
  function appLoginView(answer, nowMs) {
    if (!answer || typeof answer !== 'object') return { kind: 'failed' };
    if (typeof answer.status === 'number') {
      return answer.status === 409 && answer.code === 'account_conflict' ? { kind: 'conflict' } : { kind: 'failed' };
    }
    switch (answer.status) {
      case 'pending': {
        const expiresAt = Number(answer.expires_at);
        if (!Number.isFinite(expiresAt)) return { kind: 'failed' };
        const secondsLeft = Math.ceil(expiresAt - Number(nowMs) / 1000);
        return secondsLeft > 0 ? { kind: 'waiting', secondsLeft } : { kind: 'expired' };
      }
      case 'approved': {
        const session = answer.session;
        return session && typeof session === 'object' && typeof session.access_token === 'string' && session.access_token
          ? { kind: 'approved', session } : { kind: 'failed' };
      }
      case 'denied': return { kind: 'denied' };
      case 'expired': return { kind: 'expired' };
      case 'cancelled': return { kind: 'cancelled' };
      default: return { kind: 'failed' };
    }
  }

  // How long to wait before the next check: the server's poll_after_seconds, kept between one and five seconds.
  function pollDelayMs(answer) {
    const seconds = answer && answer.poll_after_seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return POLL_DEFAULT_MS;
    return Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, Math.round(seconds * 1000)));
  }

  // What the QR carries for one request: the app link with the request id, nothing else; '' for anything else.
  function appLink(requestId) {
    return REQUEST_ID.test(String(requestId || '')) ? APP_LINK_PREFIX + requestId : '';
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function base64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      const left = bytes.length - i;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (left > 1) out += B64[(n >> 6) & 63];
      if (left > 2) out += B64[n & 63];
    }
    return out;
  }

  function randomText() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  // A fresh state and verifier (43 url-safe characters each) and the verifier's S256 challenge.
  async function makeProof() {
    const state = randomText();
    const verifier = randomText();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { state, verifier, challenge: base64url(new Uint8Array(digest)) };
  }

  // ---- QR code (ISO/IEC 18004: byte mode, level L, versions 1-5, one block each) -----------------------------

  // [data codewords, error-correction codewords] for versions 1..5 at level L.
  const QR_L = [null, [19, 7], [34, 10], [55, 15], [80, 20], [108, 26]];
  const GF_EXP = new Array(512);
  const GF_LOG = new Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i += 1) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
  })();
  const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

  function errorCodewords(data, count) {
    let generator = [1];
    for (let i = 0; i < count; i += 1) {
      const next = new Array(generator.length + 1).fill(0);
      generator.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= gfMul(g, GF_EXP[i]); });
      generator = next;
    }
    const rest = data.concat(new Array(count).fill(0));
    for (let i = 0; i < data.length; i += 1) {
      const factor = rest[i];
      if (factor) for (let j = 0; j < generator.length; j += 1) rest[i + j] ^= gfMul(generator[j], factor);
    }
    return rest.slice(data.length);
  }

  function codewords(bytes, version) {
    const [dataCount, ecCount] = QR_L[version];
    const bits = [];
    const put = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    put(4, 4);
    put(bytes.length, 8);
    bytes.forEach((b) => put(b, 8));
    if (bits.length + 4 <= dataCount * 8) put(0, 4);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
    for (let pad = 0; data.length < dataCount; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
    return data.concat(errorCodewords(data, ecCount));
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0
  ];

  // The 15 format bits for level L (01) and a mask: BCH(15,5) with the fixed XOR.
  function formatBits(mask) {
    const data = (1 << 3) | mask;
    let rem = data << 10;
    for (let bit = 14; bit >= 10; bit -= 1) if (rem & (1 << bit)) rem ^= 0x537 << (bit - 10);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function layout(version, words, mask, scoring) {
    const size = version * 4 + 17;
    const grid = Array.from({ length: size }, () => new Array(size).fill(null));
    const finder = (row, col) => {
      for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
        if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size) continue;
        grid[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    if (version > 1) {
      const at = size - 7;
      for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) {
        grid[at + r][at + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
      }
    }
    for (let i = 8; i < size - 8; i += 1) {
      if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
      if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
    }
    const format = formatBits(mask);
    for (let i = 0; i < 15; i += 1) {
      const on = !scoring && ((format >> i) & 1) === 1;
      grid[i < 6 ? i : i < 8 ? i + 1 : size - 15 + i][8] = on;
      grid[8][i < 8 ? size - i - 1 : i < 9 ? 15 - i : 14 - i] = on;
    }
    grid[size - 8][8] = !scoring;
    let index = 0;
    let bit = 7;
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let step = 0; step < size; step += 1) {
        const row = up ? size - 1 - step : step;
        for (let c = 0; c < 2; c += 1) {
          if (grid[row][col - c] !== null) continue;
          let dark = index < words.length && ((words[index] >>> bit) & 1) === 1;
          if (MASKS[mask](row, col - c)) dark = !dark;
          grid[row][col - c] = dark;
          bit -= 1;
          if (bit < 0) { index += 1; bit = 7; }
        }
      }
      up = !up;
    }
    return grid;
  }

  function penalty(grid) {
    const size = grid.length;
    const at = (r, c) => grid[r][c];
    let points = 0;
    let dark = 0;
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      let same = 0;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if ((dr || dc) && r + dr >= 0 && r + dr < size && c + dc >= 0 && c + dc < size && at(r + dr, c + dc) === at(r, c)) same += 1;
      }
      if (same > 5) points += 3 + same - 5;
      if (at(r, c)) dark += 1;
      if (r < size - 1 && c < size - 1) {
        const n = at(r, c) + at(r + 1, c) + at(r, c + 1) + at(r + 1, c + 1);
        if (n === 0 || n === 4) points += 3;
      }
      if (c < size - 6 && at(r, c) && !at(r, c + 1) && at(r, c + 2) && at(r, c + 3) && at(r, c + 4) && !at(r, c + 5) && at(r, c + 6)) points += 40;
      if (r < size - 6 && at(r, c) && !at(r + 1, c) && at(r + 2, c) && at(r + 3, c) && at(r + 4, c) && !at(r + 5, c) && at(r + 6, c)) points += 40;
    }
    return points + (Math.abs((100 * dark) / size / size - 50) / 5) * 10;
  }

  // The QR code of a short text: {version, mask, size, modules: rows of booleans (true = dark)}, or null when the
  // text does not fit version 5-L (106 bytes).
  function qrMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let version = 1;
    while (version <= 5 && 12 + bytes.length * 8 > QR_L[version][0] * 8) version += 1;
    if (version > 5) return null;
    const words = codewords(bytes, version);
    let best = 0;
    let lowest = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const points = penalty(layout(version, words, mask, true));
      if (points < lowest) { lowest = points; best = mask; }
    }
    const modules = layout(version, words, best, false);
    return { version, mask: best, size: modules.length, modules };
  }

  // One SVG path for the dark modules, in module units with a four-module quiet zone.
  function qrPath(matrix) {
    let d = '';
    matrix.modules.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
    return d;
  }

  // ---- The binder (/login/, website mode) ------------------------------------------------------------------

  function bindLoginPage() {
    const auth = window.SidekickAuth;
    if (!auth || window.location.pathname !== '/login/') return false;
    if (typeof auth.loginMode !== 'function' || auth.loginMode() === 'app') return false;
    const el = (id) => document.getElementById(id);
    const button = el('login-with-app');
    const panel = el('app-login-panel');
    const form = el('email-form');
    const block = el('otp-block');
    const qr = el('app-login-qr');
    const qrPathNode = el('app-login-qr-path');
    if (!button || !panel || !form || !block || !qr || !qrPathNode) return false;
    const waiting = el('app-login-waiting');
    const leftLine = el('app-login-left');
    const statusLine = el('app-login-status');
    const renewButton = el('app-login-renew');
    const codeButton = el('app-login-code');
    const cancelButton = el('app-login-cancel');
    const failedCopy = auth.NETWORK_COPY || COPY.failed;

    // The one request in flight: {requestId, state, verifier, expiresAt, pollMs, poll, tick}. Memory only.
    let flow = null;
    let busy = false;

    function refresh() {
      button.hidden = false;
      button.disabled = busy || Boolean(flow);
      if (renewButton) renewButton.disabled = busy;
    }

    function say(node, message, isError) {
      if (!node) return;
      node.classList.toggle('is-error', Boolean(isError));
      node.textContent = message || '';
    }

    const quiet = (node) => { if (node) { node.classList.remove('option', 'primary'); node.classList.add('quiet'); } };
    const primary = (node) => { if (node) { node.classList.remove('quiet'); node.classList.add('option', 'primary'); } };

    function stopTimers() {
      if (!flow) return;
      clearTimeout(flow.poll);
      clearInterval(flow.tick);
      flow.poll = null;
      flow.tick = null;
    }

    // Ends the wait and forgets the proof. With `cancel`, the server is told once (best effort).
    function finish(cancel) {
      if (!flow) return;
      const ended = flow;
      stopTimers();
      flow = null;
      if (cancel) {
        auth.api('/auth/push-login/cancel', { method: 'POST', body: JSON.stringify({
          request_id: ended.requestId, state: ended.state, code_verifier: ended.verifier }) }).catch(() => {});
      }
    }

    function clearQr() {
      qrPathNode.setAttribute('d', '');
    }

    function closePanel() {
      panel.hidden = true;
      form.hidden = false;
      clearQr();
      say(statusLine, '', false);
      refresh();
    }

    function showWaiting(view) {
      if (waiting) waiting.hidden = false;
      if (cancelButton) cancelButton.hidden = false;
      if (renewButton) renewButton.hidden = true;
      quiet(codeButton);
      const seconds = Math.max(0, view.secondsLeft);
      if (leftLine) leftLine.textContent = `남은 시간 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      say(statusLine, '', false);
    }

    function showEnding(kind) {
      if (waiting) waiting.hidden = true;
      if (cancelButton) cancelButton.hidden = true;
      if (renewButton) { renewButton.hidden = false; primary(renewButton); }
      quiet(codeButton);
      clearQr();
      say(statusLine, kind === 'failed' ? failedCopy : COPY[kind], kind !== 'cancelled');
    }

    // What one answer (or error) does to the page.
    async function apply(answer) {
      const current = flow;
      if (!current) return;
      const view = appLoginView(answer && answer.status === 'pending'
        ? { ...answer, expires_at: current.expiresAt } : answer, Date.now());
      if (view.kind === 'waiting') { showWaiting(view); return; }
      finish(false);
      if (view.kind === 'approved') {
        await auth.adoptSignIn(view.session.method || 'phone', view.session);
        return;
      }
      showEnding(view.kind);
    }

    function check() {
      const current = flow;
      if (!current) return;
      current.poll = null;
      if (block.hidden) { finish(true); closePanel(); return; }
      auth.api('/auth/push-login/check', { method: 'POST', body: JSON.stringify({
        request_id: current.requestId, state: current.state, code_verifier: current.verifier }) })
        .then((answer) => answer, (error) => error || null)
        .then(async (answer) => {
          if (flow !== current) return;
          await apply(answer);
          if (flow === current && !current.poll) current.poll = setTimeout(check, current.pollMs);
        });
    }

    function tick() {
      if (!flow) return;
      if (block.hidden) { finish(true); closePanel(); return; }
      apply({ status: 'pending' });
    }

    async function begin() {
      if (busy || flow) return;
      const token = auth.humanCheckToken();
      if (token === '') return;
      busy = true;
      refresh();
      let answer = null;
      let proof = null;
      try {
        proof = await makeProof();
        answer = await auth.api('/auth/push-login/start', { method: 'POST', body: JSON.stringify({
          code_challenge: proof.challenge,
          code_challenge_method: 'S256',
          state: proof.state,
          turnstile_token: token || null
        }) });
      } catch (error) {
        answer = error || null;
      }
      busy = false;
      const link = answer && appLink(answer.request_id);
      const matrix = link ? qrMatrix(link) : null;
      if (!proof || !matrix || !Number.isFinite(Number(answer.expires_at))) {
        const view = appLoginView(answer, Date.now());
        if (panel.hidden) say(el('auth-status'), view.kind === 'conflict' ? COPY.conflict : failedCopy, true);
        else showEnding(view.kind === 'conflict' ? 'conflict' : 'failed');
        refresh();
        return;
      }
      flow = { requestId: answer.request_id, state: proof.state, verifier: proof.verifier,
        expiresAt: Number(answer.expires_at), pollMs: pollDelayMs(answer), poll: null, tick: null };
      say(el('auth-status'), '', false);
      const side = matrix.size + 8;
      qr.setAttribute('viewBox', `0 0 ${side} ${side}`);
      qrPathNode.setAttribute('d', qrPath(matrix));
      form.hidden = true;
      panel.hidden = false;
      refresh();
      await apply({ status: 'pending' });
      if (!flow) return;
      flow.tick = setInterval(tick, 1000);
      flow.poll = setTimeout(check, flow.pollMs);
    }

    button.addEventListener('click', () => { begin(); });
    if (renewButton) renewButton.addEventListener('click', () => { finish(true); begin(); });
    if (codeButton) codeButton.addEventListener('click', () => { finish(true); closePanel(); });
    if (cancelButton) cancelButton.addEventListener('click', () => { finish(true); closePanel(); });
    window.addEventListener('pagehide', () => { stopTimers(); flow = null; });
    refresh();
    return true;
  }

  window.SidekickAppLogin = Object.freeze({ appLoginView, pollDelayMs, makeProof, appLink, qrMatrix });
  bindLoginPage();
})();
