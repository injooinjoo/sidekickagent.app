/* Sidekick landing V2 · the session.
   One phone, five states, driven by how far the visitor has scrolled through
   the session block. The engine (scrollcraft.js) drives the hero planes, the
   routine morph, the team rail and the close; this file owns the phone, the
   session log and the approval, which is the one thing on the page that does
   not happen by scrolling. Nothing here touches the engine. */
(function () {
  'use strict';

  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var $ = function (id) { return document.getElementById(id); };

  // ---- the scenario -----------------------------------------------------
  var REQUEST = '이번 주 네이버 블로그에 올릴 글 하나 만들어줘.';
  var SCENES = [
    { id: 'request', w: 1.2 },
    { id: 'assign', w: 1.0 },
    { id: 'work', w: 3.0 },
    { id: 'approve', w: 1.5 },
    { id: 'result', w: 1.0 }
  ];
  var TOTAL = SCENES.reduce(function (s, x) { return s + x.w; }, 0);
  var EVENTS = ['search', 'search', 'draft', 'draft', 'image', 'connect'];
  var LIVE = {
    search: '자료를 찾고 있어요',
    draft: '초안을 만드는 중',
    image: '이미지를 준비하는 중',
    connect: '네이버 블로그를 연결하는 중',
    final: '최종 확인을 준비하고 있어요'
  };
  var TITLES = {
    base: '가을 캠핑 의자, 3만원대에서 고른 3가지',
    short: '3만원대 캠핑 의자 3가지'
  };

  var state = { scene: 'request', q: 0, p: 0, approved: false, edits: [], time: '09:00' };

  // ---- elements ---------------------------------------------------------
  var session = $('session'), stick = session && session.querySelector('.session-stick');
  var phone = $('phone'), thread = $('thread'), composer = $('composer'), composerText = $('composer-text'), wave = $('wave');
  if (!session || !phone) return;
  var el = {
    req: $('m-req'), reqText: $('req-text'), reqStamp: $('req-stamp'), typing: $('typing'),
    assign: $('m-assign'), emp: $('c-emp'), temp: $('c-temp'),
    prog: $('c-prog'), progStep: $('prog-step'), steps: $('steps'), event: $('event'),
    appr: $('c-appr'), revised: $('m-revised'), revisedText: $('revised-text'),
    res: $('c-res'), resPost: $('res-post'), badge: $('ph-badge'), capLive: $('cap-live'), capResult: $('cap-result'),
    connectBtn: $('connect-btn'), connectOk: $('connect-ok'), draftTitle: $('draft-title'), apprTitle: $('appr-title'), resTitle: $('res-title')
  };
  var tiles = Array.prototype.slice.call(el.event.querySelectorAll('.v2-tile'));
  var docLines = Array.prototype.slice.call(el.event.querySelectorAll('.doc i'));
  var thumbs = Array.prototype.slice.call(el.event.querySelectorAll('.ev-image .thumbs span'));
  var stepEls = Array.prototype.slice.call(el.steps.querySelectorAll('li'));
  var waveBars = Array.prototype.slice.call(wave.querySelectorAll('i'));
  var caps = Array.prototype.slice.call(session.querySelectorAll('.cap'));

  // ---- helpers ----------------------------------------------------------
  function show(node, on) { if (node) node.hidden = !on; }
  function badge(cls, text) {
    el.badge.className = 'badge ' + cls;
    el.badge.textContent = text;
  }
  function sceneAt(p) {
    var acc = 0;
    for (var i = 0; i < SCENES.length; i++) {
      var end = acc + SCENES[i].w / TOTAL;
      if (p < end || i === SCENES.length - 1) return { id: SCENES[i].id, q: clamp01((p - acc) / (SCENES[i].w / TOTAL)), i: i };
      acc = end;
    }
  }
  function sceneStart(id) {
    var acc = 0;
    for (var i = 0; i < SCENES.length; i++) {
      if (SCENES[i].id === id) return acc;
      acc += SCENES[i].w / TOTAL;
    }
    return 0;
  }
  // The shared header wraps to two rows on phones, so its height is measured,
  // not assumed. Everything that sits under it reads --header-h.
  var siteHeader = document.querySelector('.site-header');
  function syncHeader() {
    if (siteHeader) document.documentElement.style.setProperty('--header-h', Math.round(siteHeader.getBoundingClientRect().height) + 'px');
  }
  syncHeader();
  var headerH = function () { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64; };
  function travel() { return Math.max(session.offsetHeight - stick.offsetHeight, 1); }
  function sessionTop() { return session.getBoundingClientRect().top + scrollY; }
  function scrollToScene(id, extra) {
    var y = sessionTop() - headerH() + travel() * (sceneStart(id) + (extra || 0));
    scrollTo({ top: Math.round(y), behavior: REDUCED ? 'auto' : 'smooth' });
  }

  // ---- the five states --------------------------------------------------
  function renderRequest(q) {
    var mode = q < 0.12 ? 'idle' : q < 0.3 ? 'rec' : q < 0.74 ? 'typing' : 'sent';
    composer.setAttribute('data-mode', mode);
    if (mode === 'idle') composerText.textContent = '말로 맡기기';
    if (mode === 'rec') {
      composerText.textContent = '듣고 있어요';
      var t = (q - 0.12) / 0.18;
      waveBars.forEach(function (b, i) {
        var h = 0.5 + 0.5 * Math.sin(t * 14 + i * 1.7) * Math.sin(t * 5 + i);
        b.style.setProperty('--h', h.toFixed(2));
      });
    }
    if (mode === 'typing') {
      var n = Math.round(REQUEST.length * clamp01((q - 0.3) / 0.42));
      composerText.textContent = REQUEST.slice(0, n);
    }
    if (mode === 'sent') composerText.textContent = '말로 맡기기';
    var sent = mode === 'sent';
    show(el.req, sent); if (sent) el.reqText.textContent = REQUEST;
    show(el.reqStamp, q > 0.86);
    show(el.typing, false); show(el.assign, false); show(el.emp, false);
    badge(sent ? 'work' : 'idle', sent ? '확인 중' : '대기 중');
  }
  function renderAssign(q) {
    composer.setAttribute('data-mode', 'sent'); composerText.textContent = '말로 맡기기';
    show(el.req, true); el.reqText.textContent = REQUEST; show(el.reqStamp, true);
    show(el.typing, q < 0.22);
    show(el.assign, q >= 0.22);
    show(el.emp, q >= 0.48);
    show(el.temp, q >= 0.72);
    show(el.prog, false);
    badge(q >= 0.22 ? 'work' : 'idle', q >= 0.22 ? '작업 시작' : '확인 중');
  }
  function renderWork(q) {
    composer.setAttribute('data-mode', 'sent');
    show(el.req, true); el.reqText.textContent = REQUEST; show(el.reqStamp, true); show(el.typing, false);
    show(el.assign, true); show(el.emp, true); show(el.temp, true);
    show(el.prog, true); show(el.appr, false); show(el.revised, false); show(el.res, false);
    var step = Math.min(5, Math.floor(q * 6));
    var sq = clamp01(q * 6 - step);
    el.progStep.textContent = (step + 1) + ' / 6';
    stepEls.forEach(function (li, i) { li.className = i < step ? 'done' : i === step ? 'is-active' : ''; });
    var ev = EVENTS[step];
    if (step === 5 && sq > 0.55) ev = 'final';
    el.event.setAttribute('data-ev', ev);
    // search: tiles arrive across steps 0 and 1
    var sp = clamp01(q * 3);
    tiles.forEach(function (t, i) { t.classList.toggle('is-in', sp > (i + 1) / 4); });
    // draft: lines fill across steps 2 and 3
    var dp = clamp01((q * 6 - 2) / 2);
    docLines.forEach(function (l, i) { l.style.setProperty('--fill', clamp01(dp * docLines.length - i).toFixed(2)); });
    // images: three thumbnails fill across step 4
    var ip = step < 4 ? 0 : step > 4 ? 1 : sq;
    thumbs.forEach(function (s, i) { s.style.setProperty('--fill', clamp01(ip * 3 - i).toFixed(2)); });
    // connect: the button, then the connected chip
    var connected = step === 5 && sq > 0.3;
    show(el.connectBtn, !connected); show(el.connectOk, connected);
    el.capLive.textContent = LIVE[ev];
    badge('work', '작업 중');
  }
  function renderApprove(q) {
    renderWork(1);
    show(el.prog, true);
    show(el.appr, true);
    show(el.revised, state.edits.length > 0);
    show(el.res, false);
    badge(state.approved ? 'done' : 'wait', state.approved ? '승인됨' : '확인 필요');
  }
  function renderResult(q) {
    renderApprove(1);
    show(el.res, true);
    el.resPost.textContent = state.approved ? '게시 완료 · 네이버 블로그' : '승인 대기 · 게시 전';
    el.capResult.textContent = state.approved
      ? '승인한 순간 게시됐어요. 직원이 한 일은 카드 하나로 정리됩니다.'
      : '승인하면 그때 게시돼요. 아직이라면 결과 카드에서 승인할 수 있어요.';
    badge(state.approved ? 'done' : 'wait', state.approved ? '완료' : '승인 대기');
  }
  var RENDER = { request: renderRequest, assign: renderAssign, work: renderWork, approve: renderApprove, result: renderResult };

  function render() {
    var s = sceneAt(state.p);
    state.scene = s.id; state.q = s.q;
    RENDER[s.id](s.q);
    phone.setAttribute('data-state', s.id);
    caps.forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-cap') === s.id); });
    thread.scrollTop = thread.scrollHeight;
    // What actually paints, rounded, for the verification harness.
    var sig = 'scene:' + s.id + '|q:' + (Math.round(s.q * 20) / 20);
    if (s.id === 'request') sig += '|mode:' + composer.getAttribute('data-mode') + '|typed:' + composerText.textContent.length;
    if (s.id === 'work') sig += '|step:' + el.progStep.textContent + '|ev:' + el.event.getAttribute('data-ev');
    if (s.id === 'approve' || s.id === 'result') sig += '|approved:' + (state.approved ? 1 : 0);
    phone.setAttribute('data-sc-verify-state', sig);
    phone.setAttribute('data-sc-verify-hold', s.id === 'approve' && s.q > 0.1 && s.q < 0.9 ? 'true' : 'false');
    renderLog();
  }

  // ---- the approval: the one thing scrolling cannot do ------------------
  function approve() {
    if (state.approved) return;
    state.approved = true;
    phone.setAttribute('data-approved', '1');
    render();
  }
  $('btn-approve').addEventListener('click', function () {
    approve();
    setTimeout(function () { scrollToScene('result', 0.02); }, 220);
  });
  $('btn-approve-late').addEventListener('click', function () { approve(); });
  $('btn-edit').addEventListener('click', function () {
    var opts = $('edit-opts');
    opts.hidden = !opts.hidden;
  });
  Array.prototype.forEach.call(document.querySelectorAll('#edit-opts button'), function (b) {
    b.addEventListener('click', function () {
      var kind = b.getAttribute('data-edit');
      if (state.edits.indexOf(kind) < 0) state.edits.push(kind);
      if (kind === 'title') {
        [el.apprTitle, el.resTitle, el.draftTitle].forEach(function (n) { n.textContent = TITLES.short; });
        el.revisedText.textContent = '제목을 짧게 바꿨어요. 다시 확인해 주세요.';
      }
      if (kind === 'time') {
        state.time = '10:00';
        var small = el.appr.querySelectorAll('.preview small')[1];
        if (small) small.textContent = '이미지 3장 · 예약 목요일 10:00';
        el.revisedText.textContent = '발행 시간을 10:00으로 바꿨어요. 다시 확인해 주세요.';
      }
      b.disabled = true;
      $('edit-opts').hidden = true;
      render();
    });
  });

  // ---- the session log: what the visitor actually did -------------------
  var logItems = Array.prototype.slice.call(document.querySelectorAll('#log button'));
  var journeyItems = Array.prototype.slice.call(document.querySelectorAll('#journey li'));
  var routine = $('routine'), team = $('team');
  function stamps() {
    var s = sceneAt(state.p), passed = {};
    var idx = { request: 0, assign: 1, work: 2, approve: 3, result: 4 }[s.id];
    ['request', 'assign', 'work', 'approve', 'result'].forEach(function (id, i) {
      passed[id] = state.p >= 0.999 ? true : i < idx;
    });
    var routineTop = routine.getBoundingClientRect().top + scrollY;
    var teamTop = team.getBoundingClientRect().top + scrollY;
    passed.result = passed.result || scrollY > routineTop - innerHeight * 0.6;
    passed.routine = scrollY > teamTop - innerHeight * 0.8;
    var detail = {
      approve: state.approved ? '승인함' + (state.edits.length ? ' · 수정 ' + state.edits.length + '회' : '') : (passed.approve ? '아직 승인 전' : ''),
      result: passed.result ? (state.approved ? '게시 완료' : '게시 보류') : '',
      routine: passed.routine ? '화·목 10:00' : ''
    };
    return { passed: passed, detail: detail, now: s.id };
  }
  function renderLog() {
    var st = stamps();
    var mark = function (node, id) {
      var on = !!st.passed[id];
      node.classList.toggle('done', on);
      node.classList.toggle('ok', on && id === 'approve' && state.approved);
      node.classList.toggle('is-now', !on && id === st.now && state.p > 0 && state.p < 1);
      var small = node.querySelector('small');
      if (small) small.textContent = on && st.detail[id] ? st.detail[id] : '';
    };
    logItems.forEach(function (b) { mark(b, b.getAttribute('data-scene') || 'routine'); });
    journeyItems.forEach(function (li) { mark(li, li.getAttribute('data-scene')); });
  }
  logItems.forEach(function (b) {
    b.addEventListener('click', function () {
      var scene = b.getAttribute('data-scene');
      if (scene) scrollToScene(scene, 0.02);
      else {
        var target = document.querySelector(b.getAttribute('data-go'));
        if (target) scrollTo({ top: target.getBoundingClientRect().top + scrollY, behavior: REDUCED ? 'auto' : 'smooth' });
      }
    });
  });

  // ---- scroll read ------------------------------------------------------
  var raf = 0, lastP = -1;
  function read() {
    raf = 0;
    var top = session.getBoundingClientRect().top;
    var p = clamp01((headerH() - top) / travel());
    if (p !== lastP || true) { state.p = p; render(); lastP = p; }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(read); }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', function () { syncHeader(); schedule(); });
  addEventListener('load', function () { syncHeader(); schedule(); });
  read();

  // ---- scene plates (Higgsfield) ----------------------------------------
  // A figure marked data-hg-ready="1" gets its poster and, outside reduced
  // motion, its clip. currentTime follows the scene's progress. See
  // HIGGSFIELD_ASSET_PLAN.md for the files and how they are cut.
  Array.prototype.forEach.call(document.querySelectorAll('.scene[data-hg-ready="1"]'), function (fig) {
    var id = (fig.getAttribute('data-hg') || '').toLowerCase();
    var base = '/assets/landing-v2/higgsfield/' + id;
    var img = new Image(); img.src = base + '-poster.jpg'; img.alt = ''; fig.appendChild(img);
    if (REDUCED) return;
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'none'; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = base + (innerWidth < 860 ? '-m.mp4' : '.mp4');
    fig.appendChild(v);
    v.addEventListener('loadedmetadata', function () { fig.classList.add('has-clip'); });
    v.load();
    fig._clip = v;
  });
  function driveClips() {
    Array.prototype.forEach.call(document.querySelectorAll('.scene.has-clip'), function (fig) {
      var v = fig._clip; if (!v || !v.duration) return;
      var host = fig.closest('[data-sc-act]');
      var p = host ? parseFloat(getComputedStyle(host).getPropertyValue('--sc-p')) || 0 : 0;
      if (fig.classList.contains('scene-session')) p = state.p;
      var t = p * (v.duration - 0.05);
      if (Math.abs(v.currentTime - t) > 0.04 && !v.seeking) v.currentTime = t;
    });
  }
  addEventListener('scroll', function () { requestAnimationFrame(driveClips); }, { passive: true });

  ScrollCraft.mount(document.body);
})();
