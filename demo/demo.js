/* /demo/: four sample scenes. Everything is written out in index.html (its finished state, readable without
 * script); this file only steps it. No network, no storage, no cookie, no microphone: the scenes are plain state
 * kept in this closure, and a reload brings every one back to its start. Under prefers-reduced-motion nothing
 * plays by itself: a tap moves one step. */
  // 받침에 맞는 조사(이/가, 을/를, 은/는). 한글이 아닌 끝 글자는 받침 없는 쪽.
  function josa(word, withFinal, withoutFinal) {
    const text = String(word);
    const code = text.charCodeAt(text.length - 1) - 0xac00;
    return code >= 0 && code <= 11171 && code % 28 !== 0 ? withFinal : withoutFinal;
  }
(function () {
  'use strict';
  var doc = document;
  var reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  function later(list, fn, ms) { var id = setTimeout(fn, ms); list.push(id); return id; }
  function clearAll(list) { while (list.length) clearTimeout(list.pop()); }
  function q(root, sel) { return root.querySelector(sel); }
  function qa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function say(panel, text) { var live = q(panel, '[data-live]'); if (live) live.textContent = text; }
  function toBottom(el) { if (el) el.scrollTop = el.scrollHeight; }
  function setState(el, kind, label) {
    el.className = 'badge ' + kind + ' dm-state';
    el.textContent = label;
  }

  /* ---------------------------------------------------------------- 1. routine */
  var STEPS = 5;
  var WORK_MS = 1500;
  var HOLD_MS = 1900;
  var STEP_NAMES = ['주제 조사', '기획', '대본', '썸네일', '업로드 준비'];

  function routine(panel) {
    var thread = q(panel, '[data-thread]');
    var s = { done: 0, working: false, started: false, playing: false, answer: null };
    var wait = [];

    function render() {
      var shown = s.done + (s.working ? 1 : 0);
      q(panel, '[data-idle]').hidden = s.started;
      qa(panel, '[data-step]').forEach(function (li) {
        var n = Number(li.getAttribute('data-step'));
        li.hidden = n > shown;
        var badge = q(li, '[data-state]');
        if (n <= s.done) setState(badge, 'done', '완료');
        else setState(badge, 'work', '하는 중');
        q(li, '[data-result]').hidden = n > s.done;
      });
      var approve = q(panel, '[data-approve]');
      approve.hidden = s.done < STEPS;
      q(panel, '[data-appr-buttons]').hidden = s.done < STEPS || s.answer !== null;
      var after = q(panel, '[data-after]');
      after.hidden = s.answer === null;
      if (s.answer === 'ok') after.textContent = '확인했어요 — 실제로는 내가 정한 뒤에만 올라가요';
      if (s.answer === 'edit') after.textContent = '알겠어요 — 고칠 부분을 말하면 팀이 다시 준비해요';
      var badge = q(panel, '[data-appr-badge]');
      badge.className = 'badge ' + (s.answer === 'ok' ? 'done' : 'wait');
      badge.textContent = s.answer === 'ok' ? '확인함' : s.answer === 'edit' ? '고치는 중' : '확인 필요';
      q(panel, '[data-progress]').textContent = s.done + '/' + STEPS;

      var finished = s.done === STEPS;
      var run = s.started && !finished;
      q(panel, '[data-action="start"]').hidden = s.started;
      q(panel, '[data-action="toggle"]').hidden = !run || reduced;
      q(panel, '[data-action="next"]').hidden = !run;
      q(panel, '[data-action="restart"]').hidden = !s.started;
      var toggle = q(panel, '[data-action="toggle"]');
      toggle.textContent = s.playing ? '일시정지' : '이어서 보기';
      toggle.setAttribute('aria-pressed', s.playing ? 'false' : 'true');
      toBottom(thread);
    }

    function begin(n) {
      s.working = true;
      say(panel, n + '/' + STEPS + ' ' + STEP_NAMES[n - 1] + ': 하는 중');
    }
    function finish(n) {
      s.working = false;
      s.done = n;
      say(panel, n + '/' + STEPS + ' ' + STEP_NAMES[n - 1] + ': 완료' + (n === STEPS ? '. 올릴지 물어봐요' : ''));
      if (n === STEPS) s.playing = false;
    }
    // One timed event at a time: finish the step that is working, or start the next one after a pause.
    function schedule() {
      clearAll(wait);
      if (!s.playing) return;
      if (s.working) {
        later(wait, function () { finish(s.done + 1); render(); schedule(); }, WORK_MS);
      } else if (s.done < STEPS) {
        later(wait, function () { begin(s.done + 1); render(); schedule(); }, HOLD_MS);
      }
    }
    function reset() { clearAll(wait); s = { done: 0, working: false, started: false, playing: false, answer: null }; }
    function forward() {
      clearAll(wait);
      s.playing = false;
      s.started = true;
      var n = s.done + 1;
      if (n > STEPS) return;
      begin(n);
      finish(n);
    }
    function start() {
      s.started = true;
      if (reduced) { forward(); return; }
      s.playing = true;
      begin(1);
      schedule();
    }

    panel.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!button || button.hidden) return;
      var action = button.getAttribute('data-action');
      if (action === 'start') start();
      else if (action === 'toggle') { s.playing = !s.playing; schedule(); }
      else if (action === 'next') forward();
      else if (action === 'restart') { reset(); start(); }
      else if (action === 'approve') s.answer = 'ok';
      else if (action === 'revise') s.answer = 'edit';
      else return;
      render();
    });
    reset();
    qa(panel, '[data-controls]').forEach(function (el) { el.hidden = false; });
    render();
    return { stop: function () { clearAll(wait); if (s.playing) { s.playing = false; render(); } } };
  }

  /* ---------------------------------------------------------------- 2. team */
  var MAX_MEMBERS = 6;
  var DUTIES = {
    research: ['주제 조사', '요즘 반응 좋은 주제를 찾아 정리해요'],
    plan: ['기획', '영상의 순서와 구성을 짜요'],
    script: ['대본 쓰기', '말할 내용을 장면별로 써요'],
    thumb: ['썸네일 문구', '영상 위에 올릴 짧은 문구를 정리해요'],
    upload: ['업로드 준비', '올리기 전에 확인할 것을 챙겨요'],
    growth: ['반응 살펴보기', '올린 뒤 반응을 보고 다음 주제를 제안해요'],
    inquiry: ['댓글·문의 정리', '들어온 댓글과 문의를 나눠 답변 초안을 써요'],
    brief: ['아침 브리핑', '매일 아침 볼 것을 한 장으로 모아요']
  };
  var CORE = ['research', 'script', 'thumb', 'upload'];
  var PEOPLE = {
    researcher: ['리서처', '리', 'research'],
    writer: ['작가', '작', 'script'],
    creative: ['크리에이티브', '크', 'thumb'],
    producer: ['프로듀서', '프', 'upload'],
    growth: ['그로스', '그', 'growth'],
    content: ['콘텐츠 담당', '콘', 'plan'],
    support: ['고객 문의 담당', '고', 'inquiry'],
    briefer: ['브리핑 담당', '브', 'brief']
  };
  var START_TEAM = ['researcher', 'writer', 'creative', 'producer', 'growth'];

  function team(panel) {
    var card = q(panel, '[data-team-card]');
    var note = q(panel, '[data-team-note]');
    var members;
    function reset() { members = START_TEAM.map(function (id) { return { id: id, duty: PEOPLE[id][2] }; }); }
    function has(id) { return members.some(function (m) { return m.id === id; }); }

    function rows() {
      var html = '<div class="kicker">유튜브 팀 · 예시</div>' +
        '<div class="team-row dm-member" data-member="manager"><span class="avatar">채</span><span class="team-who"><b>채널 매니저</b><small>유튜브 운영 총괄</small></span><span class="badge idle">매니저</span></div>';
      members.forEach(function (m) {
        var p = PEOPLE[m.id];
        var options = Object.keys(DUTIES).map(function (d) {
          return '<option value="' + d + '"' + (d === m.duty ? ' selected' : '') + '>' + esc(DUTIES[d][0]) + '</option>';
        }).join('');
        html += '<div class="team-row dm-member" data-member="' + m.id + '"><span class="avatar">' + esc(p[1]) + '</span>' +
          '<span class="team-who"><b>' + esc(p[0]) + '</b><small>' + esc(DUTIES[m.duty][0]) + '</small></span>' +
          '<label class="dm-duty"><span class="sr-only">' + esc(p[0]) + josa(p[0], '이', '가') + ' 맡을 일</span><select data-action="duty" data-id="' + m.id + '">' + options + '</select></label>' +
          '<button class="dm-x" type="button" data-action="remove" data-id="' + m.id + '" aria-label="' + esc(p[0]) + ' 빼기"' + (members.length <= 1 ? ' disabled' : '') + '>×</button></div>';
      });
      return html;
    }
    function addControls() {
      var free = Object.keys(PEOPLE).filter(function (id) { return !has(id); });
      var full = members.length >= MAX_MEMBERS;
      var options = free.map(function (id) { return '<option value="' + id + '">' + esc(PEOPLE[id][0]) + '</option>'; }).join('');
      return '<label for="dm-add-select">직원 더하기</label><select id="dm-add-select" data-add-select' + (full ? ' disabled' : '') + '>' + options + '</select>' +
        '<button class="button secondary" type="button" data-action="add"' + (full || !free.length ? ' disabled' : '') + '>더하기</button>';
    }
    function coverage() {
      var open = CORE.filter(function (d) { return !members.some(function (m) { return m.duty === d; }); });
      return open.length
        ? '아직 맡은 사람이 없는 일: ' + open.map(function (d) { return DUTIES[d][0]; }).join(', ') + '. 팀원에게 맡길 수 있어요.'
        : '영상 한 편에 필요한 일을 모두 누군가 맡고 있어요.';
    }
    function render() {
      var focused = doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute('data-id') : null;
      card.innerHTML = rows();
      q(panel, '[data-team-add]').innerHTML = addControls();
      q(panel, '[data-team-coverage]').textContent = coverage();
      if (focused) { var again = q(card, '[data-id="' + focused + '"]'); if (again && again.focus) again.focus(); }
    }
    function tell(text) { note.textContent = text; }

    panel.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!button || button.disabled) return;
      var action = button.getAttribute('data-action');
      if (action === 'add') {
        var id = q(panel, '[data-add-select]').value;
        if (!PEOPLE[id] || has(id) || members.length >= MAX_MEMBERS) return;
        members.push({ id: id, duty: PEOPLE[id][2] });
        tell(PEOPLE[id][0] + josa(PEOPLE[id][0], '이', '가') + ' 합류했어요. ' + '‘' + DUTIES[PEOPLE[id][2]][0] + '’' + josa(DUTIES[PEOPLE[id][2]][0], '을', '를') + ' 맡고, ' + DUTIES[PEOPLE[id][2]][1] + '.');
        render();
      } else if (action === 'remove') {
        var out = button.getAttribute('data-id');
        if (members.length <= 1 || !has(out)) return;
        var gone = members.filter(function (m) { return m.id === out; })[0];
        members = members.filter(function (m) { return m.id !== out; });
        tell(PEOPLE[out][0] + josa(PEOPLE[out][0], '이', '가') + ' 팀에서 빠졌어요. ‘' + DUTIES[gone.duty][0] + '’' + josa(DUTIES[gone.duty][0], '은', '는') + ' 다른 팀원에게 맡길 수 있어요.');
        render();
      }
    });
    panel.addEventListener('change', function (event) {
      var select = event.target;
      if (!select || select.getAttribute('data-action') !== 'duty') return;
      var id = select.getAttribute('data-id');
      var m = members.filter(function (x) { return x.id === id; })[0];
      if (!m || !DUTIES[select.value]) return;
      m.duty = select.value;
      tell(PEOPLE[id][0] + josa(PEOPLE[id][0], '은', '는') + ' 이제 ‘' + DUTIES[m.duty][0] + '’' + josa(DUTIES[m.duty][0], '을', '를') + ' 맡아요 — ' + DUTIES[m.duty][1] + '.');
      render();
    });
    reset();
    render();
    return { stop: function () {} };
  }

  /* ---------------------------------------------------------------- 3. AI */
  function ai(panel) {
    var chosen = null;
    var wait = [];
    function render(connecting) {
      qa(panel, '[data-provider]').forEach(function (b) {
        if (b.hasAttribute('data-action')) b.setAttribute('aria-pressed', b.getAttribute('data-provider') === chosen ? 'true' : 'false');
      });
      var conn = q(panel, '[data-conn]');
      conn.hidden = !chosen;
      conn.className = 'badge ' + (connecting ? 'work' : 'done') + ' dm-conn';
      conn.textContent = chosen ? chosen + (connecting ? ' 연결하는 중…' : ' 연결됨') : '';
      q(panel, '[data-idle]').hidden = !!chosen;
      q(panel, '[data-chat]').hidden = !chosen || connecting;
      if (chosen) q(panel, '[data-provider-name]').textContent = chosen;
      toBottom(q(panel, '[data-thread]'));
    }
    panel.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action="pick"]') : null;
      if (!button || button.disabled) return;
      var name = button.getAttribute('data-provider');
      clearAll(wait);
      chosen = name;
      if (reduced) { render(false); say(panel, name + ' 연결됨. 예시 답변이 도착했어요'); return; }
      render(true);
      say(panel, name + '에 연결하는 중');
      later(wait, function () { render(false); say(panel, name + ' 연결됨. 예시 답변이 도착했어요'); }, 800);
    });
    qa(panel, '[data-action="pick"]').forEach(function (b) { b.disabled = false; });
    chosen = null;
    render(false);
    return { stop: function () { clearAll(wait); if (chosen) render(false); } };
  }

  /* ---------------------------------------------------------------- 4. voice */
  var TYPE_MS = 70;

  function voice(panel) {
    var wait = [];
    var said = q(panel, '[data-said]');
    var line = said.textContent;
    var phase = 'idle'; // idle -> listening -> guide -> done
    var typed = 0;
    function render() {
      q(panel, '[data-idle]').hidden = phase !== 'idle';
      said.hidden = phase === 'idle';
      said.textContent = line.slice(0, typed);
      q(panel, '[data-guide]').hidden = phase !== 'guide' && phase !== 'done';
      q(panel, '[data-request]').hidden = phase !== 'done';
      var wave = q(panel, '[data-wave]');
      wave.className = 'dm-wave' + (phase === 'listening' && !reduced ? ' on' : '');
      var state = q(panel, '[data-call-state]');
      state.className = 'badge ' + (phase === 'listening' ? 'work' : phase === 'done' ? 'done' : 'idle');
      state.textContent = phase === 'listening' ? '듣는 중' : phase === 'done' ? '요청 만들어짐' : phase === 'guide' ? '답하는 중' : '통화 예시';
      var mic = q(panel, '[data-action="mic"]');
      mic.disabled = phase === 'listening' || phase === 'guide';
      mic.setAttribute('aria-label', phase === 'done' ? '다시 해 보기 (예시)' : '마이크 누르기 (예시)');
      toBottom(q(panel, '[data-thread]'));
    }
    function tick() {
      if (typed < line.length) {
        typed += 1;
        render();
        later(wait, tick, TYPE_MS);
      } else {
        later(wait, function () { phase = 'guide'; render(); say(panel, '사이드킥: 네, 주제 세 개를 뽑도록 팀에 맡길게요.'); later(wait, done, 900); }, 500);
      }
    }
    function done() {
      phase = 'done';
      render();
      say(panel, '요청이 만들어졌어요. 다음 주 영상 주제 3개, 맡은 직원은 리서처예요.');
    }
    panel.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action="mic"]') : null;
      if (!button || button.disabled) return;
      clearAll(wait);
      typed = 0;
      phase = 'listening';
      if (reduced) { typed = line.length; phase = 'done'; render(); say(panel, '내가 한 말: ' + line + '. 요청이 만들어졌어요. 다음 주 영상 주제 3개, 맡은 직원은 리서처예요.'); return; }
      render();
      say(panel, '듣는 중 (예시)');
      later(wait, tick, TYPE_MS);
    });
    qa(panel, '[data-action="mic"]').forEach(function (b) { b.hidden = false; });
    typed = 0;
    render();
    return { stop: function () { clearAll(wait); } };
  }

  /* ---------------------------------------------------------------- tabs */
  function init() {
    var tablist = q(doc, '[data-tabs]');
    var panels = qa(doc, '[data-demo]');
    if (!tablist || !panels.length) return;
    doc.documentElement.classList.add('dm-js');
    var scenes = {};
    var builders = { routine: routine, team: team, ai: ai, voice: voice };
    panels.forEach(function (panel) { scenes[panel.id] = builders[panel.getAttribute('data-demo')](panel); });
    var tabs = qa(tablist, '[data-panel]');
    tablist.hidden = false;

    function select(id, focus) {
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-panel') === id;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
        if (on && focus && tab.focus) tab.focus();
      });
      panels.forEach(function (panel) {
        var on = panel.id === id;
        if (!on && !panel.hidden && scenes[panel.id]) scenes[panel.id].stop();
        panel.hidden = !on;
      });
    }
    tablist.addEventListener('click', function (event) {
      var tab = event.target && event.target.closest ? event.target.closest('[data-panel]') : null;
      if (tab) select(tab.getAttribute('data-panel'), false);
    });
    tablist.addEventListener('keydown', function (event) {
      var at = -1;
      tabs.forEach(function (tab, i) { if (tab.getAttribute('aria-selected') === 'true') at = i; });
      var to = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (to === null) return;
      if (event.preventDefault) event.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length].getAttribute('data-panel'), true);
    });
    var first = 'routine';
    try { var hash = String(window.location.hash || '').slice(1); if (scenes[hash]) first = hash; } catch (e) {}
    select(first, false);
  }
  init();
})();
