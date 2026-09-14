/* Sidekick landing V2.
   Three moving things and one control. The opening and the ending are loops
   that play while on screen. The film is one continuous cut of a working
   morning that starts when the visitor arrives at it and plays to the end;
   captions and channel chips follow the film's own clock, and at the 확인
   scene the film waits for the visitor's tap, because publishing is the one
   thing nothing should do for them. The cards below reveal and tilt through
   the engine. Nothing here touches the engine. */
(function () {
  'use strict';

  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE = innerWidth < 860;
  var $ = function (id) { return document.getElementById(id); };
  function play(v) { if (!v.paused) return; var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }

  // ---- the two loops ------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.loop video'), function (v) {
    var name = v.closest('.loop').getAttribute('data-loop');
    v.src = '/assets/landing-v2/film/' + name + (MOBILE ? '-m.mp4' : '.mp4');
    if (REDUCED) return;
    v.load();
    v.addEventListener('canplay', function () { var r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) play(v); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) play(v); else if (!v.paused) v.pause(); });
      }, { threshold: 0.05 }).observe(v.closest('section') || v);
    }
    ['touchend', 'click', 'scroll'].forEach(function (e) { addEventListener(e, function () { var r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) play(v); }, { passive: true }); });
  });

  // ---- the film -----------------------------------------------------------
  // Eight scenes of ten seconds joined by one-second crossfades: scene i
  // begins at 9i seconds. The 확인 scene pauses the film for the tap.
  var stage = $('film-stage'), film = $('film-video');
  if (!stage || !film) return;
  var SCENES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  var CHANNEL = { s3: 'video', s4: 'naver', s5: 'instagram', s6: 'wordpress' };
  var STEP = 9, HOLD_AT = 6 * STEP + 5.5, HOLD_FALLBACK = 14000;
  var caps = Array.prototype.slice.call(stage.querySelectorAll('.cap'));
  var chips = Array.prototype.slice.call(stage.querySelectorAll('.chan'));
  var segs = Array.prototype.slice.call(stage.querySelectorAll('.seq i'));
  var ctl = $('film-ctl');
  var state = { scene: 's1', held: false, approved: false, edits: [], holdTimer: 0, started: false, userPaused: false };
  film.src = '/assets/landing-v2/film/' + (MOBILE ? 'film-m.mp4' : 'film.mp4');
  if (!REDUCED) film.load();

  function sceneAt(t) { return SCENES[Math.min(SCENES.length - 1, Math.max(0, Math.floor((t + 0.5) / STEP)))]; }
  function render() {
    var t = film.currentTime || 0, s = sceneAt(t), i = SCENES.indexOf(s);
    if (s !== state.scene) { state.scene = s; stage.setAttribute('data-scene', s); }
    caps.forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-cap') === s); });
    chips.forEach(function (c) {
      var idx = SCENES.indexOf(Object.keys(CHANNEL).filter(function (k) { return CHANNEL[k] === c.getAttribute('data-chan'); })[0]);
      c.classList.toggle('is-on', idx >= 0 && (i > idx || (i === idx && t - idx * STEP > 2)));
      c.classList.toggle('is-now', idx === i);
    });
    segs.forEach(function (seg, k) {
      var f = k < i ? 1 : k === i ? Math.max(0, Math.min(1, (t - i * STEP) / STEP)) : 0;
      seg.style.setProperty('--f', f.toFixed(3)); seg.classList.toggle('is-now', k === i);
    });
    // the wait: the first time the film reaches the 확인 card, it stops
    if (!state.held && !state.approved && t >= HOLD_AT && t < HOLD_AT + 1.5) {
      state.held = true; film.pause(); stage.setAttribute('data-hold', '1');
      state.holdTimer = setTimeout(function () { if (state.held && !state.approved) release(); }, HOLD_FALLBACK);
    }
    $('res-post').textContent = state.approved ? '게시 완료 · 세 채널' : '승인 대기';
    stage.setAttribute('data-sc-verify-state', 'scene:' + s + '|hold:' + (state.held ? 1 : 0) + '|approved:' + (state.approved ? 1 : 0));
  }
  function release() {
    clearTimeout(state.holdTimer); state.held = false; stage.removeAttribute('data-hold');
    if (!state.userPaused) play(film);
  }
  function approve() {
    if (state.approved) return;
    state.approved = true; stage.setAttribute('data-approved', '1'); render();
    setTimeout(release, 900);
  }
  $('btn-approve').addEventListener('click', approve);
  $('btn-edit').addEventListener('click', function () { var o = $('edit-opts'); o.hidden = !o.hidden; });
  Array.prototype.forEach.call(document.querySelectorAll('#edit-opts button'), function (b) {
    b.addEventListener('click', function () {
      var kind = b.getAttribute('data-edit');
      if (kind === 'title') { $('appr-title').textContent = '3만원대 캠핑 의자 3가지'; $('res-title').textContent = '3만원대 캠핑 의자 3가지'; }
      if (kind === 'time') $('appr-when').textContent = '이미지 3장 · 영상 1편 · 목요일 10:00';
      b.disabled = true; $('edit-opts').hidden = true;
      clearTimeout(state.holdTimer); state.holdTimer = setTimeout(function () { if (state.held && !state.approved) release(); }, HOLD_FALLBACK);
    });
  });

  // starts when the visitor arrives, pauses when they leave, resumes on return
  function startFilm() {
    if (REDUCED || state.userPaused || state.held) return;
    if (!state.started) { state.started = true; try { film.currentTime = 0; } catch (e) {} }
    play(film);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) startFilm(); else if (!film.paused) film.pause(); });
    }, { threshold: 0.45 }).observe(stage);
  } else { startFilm(); }
  ['touchend', 'click', 'scroll'].forEach(function (e) {
    addEventListener(e, function () { var r = stage.getBoundingClientRect(); if (r.top < innerHeight * 0.55 && r.bottom > innerHeight * 0.45) startFilm(); }, { passive: true });
  });
  film.addEventListener('ended', function () { stage.setAttribute('data-ended', '1'); });
  film.addEventListener('timeupdate', render);
  film.addEventListener('play', function () { ctl.textContent = '❚❚'; ctl.setAttribute('aria-label', '일시정지'); });
  film.addEventListener('pause', function () { ctl.textContent = '▶'; ctl.setAttribute('aria-label', '재생'); });
  ctl.addEventListener('click', function () {
    if (film.paused) { state.userPaused = false; if (stage.getAttribute('data-ended')) { stage.removeAttribute('data-ended'); state.held = false; state.approved = false; stage.removeAttribute('data-approved'); try { film.currentTime = 0; } catch (e) {} } if (state.held) release(); else play(film); }
    else { state.userPaused = true; film.pause(); }
  });
  render();

  ScrollCraft.mount(document.body);
})();
