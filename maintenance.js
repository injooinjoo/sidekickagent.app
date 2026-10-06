(() => {
  'use strict';

  // While a release cuts over, the API is a writer-free responder
  // (infra/maintenance/server.py): every request answers 503 with Retry-After
  // and {"detail": "Sidekick is briefly in maintenance for a release. ..."},
  // and GET /health answers 200 {"status": "maintenance", "writer": "disabled"}.
  // This file is the one place the site recognises that, says so in a small
  // notice ("잠깐 정비하고 있어요"), and checks /health again until it ends.
  //
  // The request helpers (auth.js api() and its two sign-in helpers, landing.js)
  // send their API calls through SidekickMaintenance.fetch. A page without this
  // file keeps calling fetch directly and behaves as before.
  //
  // * A read (GET/HEAD) that meets maintenance is held, not failed: it waits
  //   until /health stops saying maintenance and is then sent again, so the page
  //   finishes its own load by itself. Aborting its signal ends the wait.
  // * A write (POST/PUT/PATCH/DELETE) is never sent again: its answer goes back
  //   to the page as it came, and the notice asks the person to try again once
  //   it clears.
  // * A request that failed without an answer (a dropped connection, or a
  //   cross-origin answer the browser would not hand over) counts as maintenance
  //   only when /health itself says "maintenance". Anything else stays the
  //   page's own error, worded as today.
  // * /health is asked again no sooner than Retry-After (30 s when absent,
  //   never more than 120 s, plus a little jitter so open tabs do not arrive
  //   together), and not at all while the page is hidden.
  const API_ORIGIN = 'https://api.sidekickagent.app';
  const HEALTH_URL = API_ORIGIN + '/health';
  const DEFAULT_DELAY_S = 30;
  const MIN_DELAY_S = 5;
  const MAX_DELAY_S = 120;
  const JITTER = 0.2;
  // A dropped request asks /health once; requests that fail together share it.
  const PROBE_REUSE_MS = 5000;
  const COPY = {
    title: '잠깐 정비하고 있어요.',
    body: '1~2분이면 끝나요. 자동으로 다시 확인할게요.',
    write: '방금 요청은 처리되지 않았어요. 정비가 끝나면 다시 시도해 주세요.',
    checking: '확인하고 있어요…',
    paused: '이 화면으로 돌아오면 다시 확인할게요.',
    retry: '다시 확인',
    label: '정비 안내'
  };

  const rawFetch = (url, init) => window.fetch(url, init);
  const state = {
    active: false,
    write: false,
    delayS: DEFAULT_DELAY_S,
    nextAt: 0,
    timer: null,
    tick: null,
    polling: false,
    waiters: [],
    probe: null,
    probeAt: 0,
    probeResult: false,
    notice: null
  };

  function isApi(url) {
    const text = String(url && url.url ? url.url : url || '');
    return text === API_ORIGIN || text.startsWith(API_ORIGIN + '/');
  }

  function methodOf(url, init) {
    const named = (init && init.method) || (url && typeof url === 'object' && url.method) || 'GET';
    return String(named).toUpperCase();
  }

  function header(response, name) {
    try { return response && response.headers ? response.headers.get(name) : null; } catch (_) { return null; }
  }

  // Seconds the server asked for, as given: an integer or an HTTP date. null when
  // absent or unreadable (a cross-origin answer hides Retry-After unless exposed).
  function retryAfterSeconds(response) {
    const value = header(response, 'Retry-After');
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
    const at = Date.parse(text);
    return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
  }

  function clampDelay(seconds) {
    const wanted = seconds === null || seconds === undefined || !Number.isFinite(seconds) ? DEFAULT_DELAY_S : seconds;
    return Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, wanted));
  }

  // Never earlier than asked: jitter only adds, and the cap still holds.
  function jittered(seconds) {
    return Math.min(MAX_DELAY_S, seconds + seconds * JITTER * Math.random()) * 1000;
  }

  async function bodyOf(response) {
    try {
      const copy = typeof response.clone === 'function' ? response.clone() : response;
      return await copy.json();
    } catch (_) {
      return null;
    }
  }

  // The detector. `data` is the parsed body when the caller already has it.
  // 503 is maintenance when its detail says so, or when it carries Retry-After
  // and no reason of its own (no detail, code or status). /health is
  // maintenance when its status says so. Every other answer -- 500, 502, a 503
  // with its own reason, an ordinary /health -- is not.
  function isMaintenance(response, data) {
    if (!response) return false;
    const status = Number(response.status);
    const body = data && typeof data === 'object' ? data : null;
    if (status === 200) return Boolean(body && body.status === 'maintenance');
    if (status !== 503) return false;
    if (body && typeof body.detail === 'string' && /\bmaintenance\b/i.test(body.detail)) return true;
    const ownReason = body && (body.detail || body.code || body.status);
    return header(response, 'Retry-After') !== null && !ownReason;
  }

  async function responseIsMaintenance(response) {
    if (!response) return false;
    if (response.status === 503) return isMaintenance(response, await bodyOf(response));
    return false;
  }

  // Asks /health once. True only for a readable answer that says maintenance.
  async function checkHealth() {
    let response;
    try {
      response = await rawFetch(HEALTH_URL, {
        method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
      });
    } catch (_) {
      return { maintenance: false, delay: null };
    }
    const data = await bodyOf(response);
    return { maintenance: isMaintenance(response, data), delay: retryAfterSeconds(response) };
  }

  // A request that failed without an answer: is the service in maintenance?
  function probe() {
    if (state.active) return Promise.resolve(true);
    if (state.probe) return state.probe;
    if (state.probeAt && Date.now() - state.probeAt < PROBE_REUSE_MS) return Promise.resolve(state.probeResult);
    state.probe = checkHealth().then((result) => {
      state.probe = null;
      state.probeAt = Date.now();
      state.probeResult = result.maintenance;
      if (result.maintenance) enter({ delay: result.delay });
      return result.maintenance;
    });
    return state.probe;
  }

  // ---- The notice -----------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // /login/ loads no stylesheet (its policy names one inline block by hash), so
  // there the notice takes a few properties through the CSSOM, from the
  // page's own tokens. Every other page styles .maintenance-notice in styles.css.
  function needsOwnStyle() {
    return !document.querySelector('link[href="/styles.css"]');
  }

  function ownStyle(node) {
    const set = (name, value) => { try { node.style.setProperty(name, value); } catch (_) {} };
    [['position', 'fixed'], ['left', '16px'], ['right', '16px'], ['bottom', '16px'], ['z-index', '60'],
      ['max-width', '440px'], ['margin', '0 auto'], ['padding', '14px 16px'], ['border', '1px solid var(--line)'],
      ['border-radius', 'var(--radius-md)'], ['background', 'var(--card)'], ['color', 'var(--ink)'],
      ['box-shadow', 'var(--shadow)'], ['font-size', '14px'], ['text-align', 'left']].forEach(([name, value]) => set(name, value));
  }

  function build() {
    if (state.notice) return state.notice;
    const box = el('div', 'maintenance-notice');
    box.id = 'maintenance-notice';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', COPY.label);
    // What is said once; the countdown below updates every second and is kept
    // out of the live region so a screen reader is not told each tick.
    const said = el('div', 'maintenance-notice-text');
    said.setAttribute('role', 'status');
    said.setAttribute('aria-live', 'polite');
    const title = el('p', 'maintenance-notice-title', COPY.title);
    const body = el('p', 'maintenance-notice-body', COPY.body);
    const write = el('p', 'maintenance-notice-write', COPY.write);
    write.hidden = true;
    said.append(title, body, write);
    const meta = el('p', 'maintenance-notice-meta');
    const countdown = el('span', 'maintenance-notice-countdown', '');
    const retry = el('button', 'maintenance-notice-retry', COPY.retry);
    retry.type = 'button';
    retry.addEventListener('click', () => { checkNow(); });
    meta.append(countdown, retry);
    box.append(said, meta);
    if (needsOwnStyle()) ownStyle(box);
    state.notice = { box, write, countdown, retry };
    return state.notice;
  }

  function show() {
    const notice = build();
    notice.write.hidden = !state.write;
    if (!notice.box.parentNode && document.body) document.body.appendChild(notice.box);
    notice.box.hidden = false;
    renderCountdown();
  }

  function hide() {
    if (!state.notice) return;
    state.notice.box.hidden = true;
    state.notice.write.hidden = true;
    if (state.notice.box.parentNode) state.notice.box.parentNode.removeChild(state.notice.box);
  }

  function renderCountdown() {
    if (!state.notice) return;
    const notice = state.notice;
    if (state.polling) {
      notice.countdown.textContent = COPY.checking;
      notice.retry.disabled = true;
      return;
    }
    notice.retry.disabled = false;
    if (document.hidden) { notice.countdown.textContent = COPY.paused; return; }
    const left = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
    notice.countdown.textContent = left > 0 ? `${left}초 뒤 다시 확인할게요.` : COPY.checking;
  }

  // ---- Checking again -----------------------------------------------------

  function stopTimers() {
    if (state.timer) clearTimeout(state.timer);
    if (state.tick) clearTimeout(state.tick);
    state.timer = null;
    state.tick = null;
  }

  function arm() {
    stopTimers();
    if (!state.active || state.polling || document.hidden) { renderCountdown(); return; }
    state.timer = setTimeout(poll, Math.max(0, state.nextAt - Date.now()));
    const tick = () => {
      renderCountdown();
      if (state.active && !state.polling && !document.hidden) state.tick = setTimeout(tick, 1000);
    };
    tick();
  }

  function schedule() {
    state.nextAt = Date.now() + jittered(state.delayS);
    arm();
  }

  async function poll() {
    if (!state.active || state.polling) return;
    stopTimers();
    state.polling = true;
    renderCountdown();
    const result = await checkHealth();
    state.polling = false;
    if (!state.active) return;
    if (result.maintenance) {
      if (result.delay !== null) state.delayS = clampDelay(result.delay);
      schedule();
      return;
    }
    clear();
  }

  // The person asked: check now, once (the button waits while a check runs).
  function checkNow() {
    if (!state.active || state.polling) return;
    poll();
  }

  function enter({ delay = null, write = false } = {}) {
    if (write) state.write = true;
    if (delay !== null && delay !== undefined) state.delayS = clampDelay(delay);
    if (!state.active) {
      state.active = true;
      show();
      schedule();
      return;
    }
    show();
  }

  // Maintenance ended (or /health stopped saying so): the notice goes and every
  // held read is sent again.
  function clear() {
    state.active = false;
    state.write = false;
    state.delayS = DEFAULT_DELAY_S;
    state.probeAt = 0;
    stopTimers();
    hide();
    const waiters = state.waiters;
    state.waiters = [];
    waiters.forEach((waiter) => waiter.resolve());
  }

  function whenClear(signal) {
    if (!state.active) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve: () => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); } };
      function onAbort() {
        state.waiters = state.waiters.filter((item) => item !== waiter);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort);
      }
      state.waiters.push(waiter);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!state.active) return;
    if (document.hidden) { stopTimers(); renderCountdown(); return; }
    arm();
  });

  // ---- The guarded fetch ------------------------------------------------------

  async function guardedFetch(url, init = {}) {
    if (!isApi(url)) return rawFetch(url, init);
    const replayable = ['GET', 'HEAD'].includes(methodOf(url, init));
    const signal = init && init.signal;
    for (;;) {
      let response;
      try {
        response = await rawFetch(url, init);
      } catch (cause) {
        if (cause && cause.name === 'AbortError') throw cause;
        if (!(await probe())) throw cause;
        if (!replayable) {
          enter({ write: true });
          throw cause;
        }
        await whenClear(signal);
        continue;
      }
      if (await responseIsMaintenance(response)) {
        enter({ delay: retryAfterSeconds(response), write: !replayable });
        if (!replayable) return response;
        await whenClear(signal);
        continue;
      }
      return response;
    }
  }

  window.SidekickMaintenance = Object.freeze({
    API_ORIGIN,
    COPY,
    fetch: guardedFetch,
    isMaintenance,
    retryAfterSeconds,
    active: () => state.active,
    checkNow
  });
})();
