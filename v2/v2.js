/* Sidekick landing V2 · the film is the page.
   Eight generated scenes of one working morning, scrubbed by scroll. The
   engine (scrollcraft.js) drives the routine morph, the team rail and the
   close; this file owns the session film, the few words laid on it, the
   session log, and the approval, which is the one thing on the page that
   does not happen by scrolling. Nothing here touches the engine. */
(function () {
  'use strict';

  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE = innerWidth < 860;
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var $ = function (id) { return document.getElementById(id); };

  // ---- the scenario: eight scenes, one request ---------------------------
  var REQUEST = '이번 주 네이버 블로그에 올릴 글 하나 만들어줘.';
  var SCENES = [
    { id: 's1', stage: 'request', w: 1.8 },
    { id: 's2', stage: 'assign', w: 2.0 },
    { id: 's3', stage: 'work', w: 2.4, channel: 'video' },
    { id: 's4', stage: 'work', w: 2.4, channel: 'naver' },
    { id: 's5', stage: 'work', w: 2.0, channel: 'instagram' },
    { id: 's6', stage: 'work', w: 2.0, channel: 'wordpress' },
    { id: 's7', stage: 'approve', w: 2.2 },
    { id: 's8', stage: 'result', w: 1.8 }
  ];
  var TOTAL = SCENES.reduce(function (s, x) { return s + x.w; }, 0);
  var TITLES = { base: '가을 캠핑 의자, 3만원대에서 고른 3가지', short: '3만원대 캠핑 의자 3가지' };
  var state = { p: 0, scene: SCENES[0], q: 0, approved: false, edits: [] };

  // ---- elements -----------------------------------------------------------
  var session = $('session'), stick = $('stick');
  if (!session || !stick) return;
  var caps = Array.prototype.slice.call(stick.querySelectorAll('.cap'));
  var chips = Array.prototype.slice.call(stick.querySelectorAll('.chan'));
  var segs = Array.prototype.slice.call(stick.querySelectorAll('.seq i'));
  var appr = $('appr'), resCard = $('res');
  var el = { apprTitle: $('appr-title'), resTitle: $('res-title'), resPost: $('res-post'), capResult: $('cap-result'), revised: $('revised'), revisedText: $('revised-text'), apprWhen: $('appr-when') };

  // ---- helpers ------------------------------------------------------------
  function sceneAt(p) {
    var acc = 0;
    for (var i = 0; i < SCENES.length; i++) {
      var w = SCENES[i].w / TOTAL;
      if (p < acc + w || i === SCENES.length - 1) return { s: SCENES[i], q: clamp01((p - acc) / w), i: i };
      acc += w;
    }
  }
  function sceneStart(id) {
    var acc = 0;
    for (var i = 0; i < SCENES.length; i++) { if (SCENES[i].id === id) return acc; acc += SCENES[i].w / TOTAL; }
    return 0;
  }
  function syncHeader() {}
  var headerH = function () { return 0; };
  function travel() { return Math.max(session.offsetHeight - stick.offsetHeight, 1); }
  function sessionTop() { return session.getBoundingClientRect().top + scrollY; }
  function scrollToScene(id, extra) {
    var y = sessionTop() - headerH() + travel() * (sceneStart(id) + (extra || 0));
    scrollTo({ top: Math.round(y), behavior: REDUCED ? 'auto' : 'smooth' });
  }

  // ---- the film -----------------------------------------------------------
  // One plate per scene: the poster (landscape or portrait by viewport), then
  // the clip once it has data. The clip's playhead is the scene's progress,
  // so the work on screen advances exactly as far as the visitor has scrolled.
  // Two loops that play on their own: the opening under the headline and the
  // last scene under the close. Muted, inline, primed on the first gesture
  // for browsers that refuse to autoplay.
  Array.prototype.forEach.call(document.querySelectorAll('.hero-loop video'), function (v) {
    var name = v.closest('.close-loop') ? 'ending' : 'hero';
    v.src = '/assets/landing-v2/film/' + name + (MOBILE ? '-m.mp4' : '.mp4');
    if (REDUCED) return;
    v.load();
    var tryPlay = function () { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); };
    v.addEventListener('canplay', tryPlay);
    ['touchend', 'click', 'scroll'].forEach(function (e) { addEventListener(e, tryPlay, { passive: true, once: true }); });
  });
  var plates = Array.prototype.map.call(document.querySelectorAll('.scene[data-hg-ready="1"]'), function (fig) {
    var id = fig.getAttribute('data-hg');
    var base = '/assets/landing-v2/film/' + id;
    var img = new Image(); img.src = base + (MOBILE ? '-poster-m.jpg' : '-poster.jpg'); img.alt = ''; img.decoding = 'async'; fig.appendChild(img);
    var rec = { fig: fig, v: null, id: id, scene: fig.getAttribute('data-scene') || '', loading: false, src: base + (MOBILE ? '-m.mp4' : '.mp4') };
    fig._plate = rec;
    return rec;
  });
  function loadPlate(rec) {
    if (rec.loading || REDUCED) return;
    rec.loading = true;
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = rec.src;
    v.addEventListener('loadeddata', function () { rec.v = v; rec.fig.classList.add('has-clip'); });
    rec.fig.appendChild(v);
    v.load();
  }
  function seek(v, t) {
    if (!v || !v.duration) return;
    if (Math.abs(v.currentTime - t) > 0.04 && !v.seeking) v.currentTime = t;
  }
  function drivePlates() {
    var cur = sceneAt(state.p);
    var near = Math.abs(session.getBoundingClientRect().top) < innerHeight * 3.5;
    plates.forEach(function (rec) {
      if (rec.scene) {
        var idx = SCENES.map(function (s) { return s.id; }).indexOf(rec.scene);
        var on = rec.scene === cur.s.id;
        rec.fig.classList.toggle('is-on', on);
        rec.fig.classList.toggle('is-past', idx < cur.i);
        // The current scene and its neighbours load at once; the rest follow a
        // moment later so a fast scroll never lands on a poster for long.
        if (near && Math.abs(idx - cur.i) <= 1) loadPlate(rec);
        else if (near && !rec.queued) { rec.queued = true; setTimeout(function () { loadPlate(rec); }, 900 + Math.abs(idx - cur.i) * 400); }
        if (on) rec.fig.style.setProperty('--q', cur.q.toFixed(3));
        if (on && rec.v) seek(rec.v, cur.q * (rec.v.duration - 0.05));
      } else {
        var host = rec.fig.closest('[data-sc-act]');
        var r = host ? host.getBoundingClientRect() : null;
        var visible = r && r.bottom > -innerHeight && r.top < innerHeight * 2;
        if (visible || scrollY < innerHeight * 2) loadPlate(rec);
        var p = r ? clamp01(-r.top / Math.max(r.height, 1)) : 0;
        if (rec.v) seek(rec.v, p * (rec.v.duration - 0.05));
      }
    });
  }
  plates.forEach(function (rec) { if (!rec.scene) rec.fig.classList.add('is-on'); });

  // ---- the words on the film ---------------------------------------------
  function render() {
    var cur = sceneAt(state.p);
    state.scene = cur.s; state.q = cur.q;
    stick.setAttribute('data-scene', cur.s.id);
    stick.setAttribute('data-stage', cur.s.stage);
    caps.forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-cap') === cur.s.id); });
    // channels light up as their scene is reached and stay lit
    chips.forEach(function (c) {
      var ch = c.getAttribute('data-chan');
      var idx = SCENES.map(function (s) { return s.channel; }).indexOf(ch);
      c.classList.toggle('is-on', idx >= 0 && (cur.i > idx || (cur.i === idx && cur.q > 0.25)));
      c.classList.toggle('is-now', idx === cur.i);
    });
    segs.forEach(function (seg, i) {
      seg.style.setProperty('--f', i < cur.i ? 1 : i === cur.i ? cur.q.toFixed(3) : 0);
      seg.classList.toggle('is-now', i === cur.i);
    });
    // approval: the card is a real control; the result reads what the visitor did
    el.resPost.textContent = state.approved ? '게시 완료 · 네이버 블로그 · 인스타그램 · 워드프레스' : '승인 대기 · 아직 게시 전';
    el.capResult.textContent = state.approved
      ? '승인한 순간 세 채널에 게시됐어요. 직원이 한 일은 카드 하나로 정리됩니다.'
      : '승인하면 그때 게시돼요. 아직이라면 결과 카드에서 승인할 수 있어요.';
    var sig = 'scene:' + cur.s.id + '|q:' + (Math.round(cur.q * 20) / 20);
    if (cur.s.stage === 'approve' || cur.s.stage === 'result') sig += '|approved:' + (state.approved ? 1 : 0);
    stick.setAttribute('data-sc-verify-state', sig);
    stick.setAttribute('data-sc-verify-hold', cur.s.stage === 'approve' && cur.q > 0.15 && cur.q < 0.85 ? 'true' : 'false');
    renderLog();
    drivePlates();
  }

  // ---- the approval: the one thing scrolling cannot do ------------------
  function approve() {
    if (state.approved) return;
    state.approved = true;
    stick.setAttribute('data-approved', '1');
    render();
  }
  $('btn-approve').addEventListener('click', function () {
    approve();
    setTimeout(function () { scrollToScene('s8', 0.01); }, 220);
  });
  $('btn-approve-late').addEventListener('click', approve);
  $('btn-edit').addEventListener('click', function () { var o = $('edit-opts'); o.hidden = !o.hidden; });
  Array.prototype.forEach.call(document.querySelectorAll('#edit-opts button'), function (b) {
    b.addEventListener('click', function () {
      var kind = b.getAttribute('data-edit');
      if (state.edits.indexOf(kind) < 0) state.edits.push(kind);
      if (kind === 'title') {
        el.apprTitle.textContent = TITLES.short; el.resTitle.textContent = TITLES.short;
        el.revisedText.textContent = '제목을 짧게 바꿨어요. 다시 확인해 주세요.';
      }
      if (kind === 'time') {
        el.apprWhen.textContent = '이미지 3장 · 영상 1편 · 예약 목요일 10:00';
        el.revisedText.textContent = '발행 시간을 10:00으로 바꿨어요. 다시 확인해 주세요.';
      }
      el.revised.hidden = false;
      b.disabled = true;
      $('edit-opts').hidden = true;
      render();
    });
  });

  // ---- the session log: what the visitor actually did -------------------
  var logItems = Array.prototype.slice.call(document.querySelectorAll('#log button'));
  var journeyItems = Array.prototype.slice.call(document.querySelectorAll('#journey li'));
  var routine = $('routine'), team = $('team');
  var STAGES = ['request', 'assign', 'work', 'approve', 'result'];
  function stamps() {
    var cur = sceneAt(state.p), passed = {};
    var idx = STAGES.indexOf(cur.s.stage);
    STAGES.forEach(function (id, i) { passed[id] = state.p >= 0.999 ? true : i < idx; });
    var routineTop = routine.getBoundingClientRect().top + scrollY;
    var teamTop = team.getBoundingClientRect().top + scrollY;
    passed.result = passed.result || scrollY > routineTop - innerHeight * 0.6;
    passed.routine = scrollY > teamTop - innerHeight * 0.8;
    var detail = {
      work: passed.work ? '영상 · 블로그 · 인스타 · 워드프레스' : '',
      approve: state.approved ? '승인함' + (state.edits.length ? ' · 수정 ' + state.edits.length + '회' : '') : (passed.approve ? '아직 승인 전' : ''),
      result: passed.result ? (state.approved ? '게시 완료' : '게시 보류') : '',
      routine: passed.routine ? '화·목 10:00' : ''
    };
    return { passed: passed, detail: detail, now: cur.s.stage };
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
    logItems.forEach(function (b) { mark(b, b.getAttribute('data-stage') || 'routine'); });
    journeyItems.forEach(function (li) { mark(li, li.getAttribute('data-stage')); });
  }
  logItems.forEach(function (b) {
    b.addEventListener('click', function () {
      var stage = b.getAttribute('data-stage');
      if (stage) {
        var first = SCENES.filter(function (s) { return s.stage === stage; })[0];
        scrollToScene(first.id, 0.01);
      } else {
        var target = document.querySelector(b.getAttribute('data-go'));
        if (target) scrollTo({ top: target.getBoundingClientRect().top + scrollY, behavior: REDUCED ? 'auto' : 'smooth' });
      }
    });
  });

  // ---- scroll read --------------------------------------------------------
  var raf = 0;
  function read() {
    raf = 0;
    var top = session.getBoundingClientRect().top;
    state.p = clamp01((headerH() - top) / travel());
    render();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(read); }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  addEventListener('load', read);
  document.addEventListener('DOMContentLoaded', read);
  setTimeout(read, 400);
  read();

  ScrollCraft.mount(document.body);
})();
