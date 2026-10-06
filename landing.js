/* sidekickagent.app landing and /use/ pages — the hero phone, the start
 * button, pricing figures, scroll reveal and the shared scenario renderer.
 *
 * No library: CSS transitions and keyframes do the drawing, this file only
 * decides when. Every timeline is cancellable (a token per run) so a quick
 * second choice never overlaps the first, and the hero phone moves only when
 * the visitor taps it. Under prefers-reduced-motion nothing animates: the
 * static markup is always the finished state of each scene, and a tap on the
 * hero phone shows its next state at once. */
(function () {
  'use strict';
  var API_ORIGIN = 'https://api.sidekickagent.app';
  var REDUCED = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!REDUCED) document.documentElement.classList.add('js');

  // The supplied character loops share the page's existing motion preference.
  // Posters stay visible until playback succeeds, including without JavaScript.
  var characterPreference = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var characterPlayers = [];
  document.querySelectorAll('video[data-character-motion]').forEach(function (video) {
    var visible = false;
    var failed = false;
    var frame = video.parentElement;
    var update = function () {
      if (!visible || document.hidden || (characterPreference && characterPreference.matches) || failed) {
        video.pause();
        if (characterPreference && characterPreference.matches) frame.classList.remove('is-ready');
        return;
      }
      if (!video.hasAttribute('src')) video.src = video.getAttribute('data-src');
      video.muted = true;
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () { frame.classList.remove('is-ready'); });
    };
    video.addEventListener('playing', function () {
      if (visible && !document.hidden && !(characterPreference && characterPreference.matches)) frame.classList.add('is-ready');
      else update();
    });
    video.addEventListener('error', function () { failed = true; video.pause(); frame.classList.remove('is-ready'); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.2;
        update();
      }, { threshold: [0, 0.2] }).observe(video);
    }
    characterPlayers.push(update);
  });
  var updateCharacters = function () { characterPlayers.forEach(function (update) { update(); }); };
  document.addEventListener('visibilitychange', updateCharacters);
  if (characterPreference) {
    if (characterPreference.addEventListener) characterPreference.addEventListener('change', updateCharacters);
    else if (characterPreference.addListener) characterPreference.addListener(updateCharacters);
  }
  var CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function money(value) { return Number(value).toLocaleString('ko-KR') + '원'; }
  function raf(fn) { return window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16); }
  function observe(target, onEnter, onLeave, threshold) {
    if (!('IntersectionObserver' in window)) { onEnter(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) onEnter(); else if (onLeave) onLeave(); });
    }, { threshold: threshold || 0.35 });
    io.observe(target);
  }

  // ---- Timeline: a list of [ms, fn] steps under one cancel token -----------
  function Timeline() { this.timers = []; this.token = 0; }
  Timeline.prototype.run = function (steps) {
    this.cancel();
    var token = ++this.token, self = this;
    steps.forEach(function (step) {
      self.timers.push(setTimeout(function () { if (self.token === token) step[1](); }, step[0]));
    });
    return token;
  };
  Timeline.prototype.cancel = function () {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.token++;
  };

  // ---- The one primary action: picking a goal -------------------------------
  // One analytics event, use_case_selected, with the goal slug and where it was
  // picked. Everything after it (sign-in, account) is measured by auth.js and
  // the server, so this is the only event this file sends.
  function trackGoal(slug, source) {
    try {
      if (window.SidekickWebAnalytics) window.SidekickWebAnalytics.track('use_case_selected', { task_type: slug, source: source });
    } catch (_) { /* analytics never changes what the page does */ }
  }
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('[data-goal]') : null;
    if (link) trackGoal(link.getAttribute('data-goal'), link.getAttribute('data-source') || 'landing');
  });

  // ---- Pricing at a glance ----------------------------------------------------
  // No row carries a number. Every figure comes from the KRW catalog the
  // backend serves; an empty catalog prints none rather than a placeholder
  // somebody could mistake for a price. The membership page owns purchase.
  var catalog = {};
  var salesOpen = false;
  function priceOf(plan, funding) {
    var amount = catalog[plan + ':' + funding];
    return typeof amount === 'number' && amount > 0 ? amount : null;
  }
  var planRows = Array.prototype.slice.call(document.querySelectorAll('.plan-row[data-plan]'));
  function renderPlans() {
    planRows.forEach(function (row) {
      var plan = row.getAttribute('data-plan');
      var included = priceOf(plan, 'included');
      var connected = priceOf(plan, 'connected');
      row.querySelector('[data-role="price"]').textContent = included === null ? '' : '월 ' + money(included);
      var cheaper = row.querySelector('[data-role="price-connected"]');
      var known = included !== null && connected !== null && connected < included;
      cheaper.textContent = known ? '내 AI 계정 연결 시 ' + money(connected) : '';
      cheaper.hidden = !known;
    });
    var closed = document.getElementById('pricing-closed');
    if (closed) closed.hidden = salesOpen;
  }
  // Through /maintenance.js when the page has it: during a release the read
  // waits for the window to end and the prices then fill in by themselves.
  if (window.fetch && planRows.length) {
    var maintenance = window.SidekickMaintenance;
    var configUrl = API_ORIGIN + '/membership/toss/config';
    (maintenance ? maintenance.fetch(configUrl) : fetch(configUrl)).then(function (response) {
      return response.ok ? response.json() : {};
    }).then(function (config) {
      salesOpen = Boolean(config) && config.sales_enabled === true && config.mode === 'live';
      if (config && config.plans && typeof config.plans === 'object') catalog = config.plans;
      renderPlans();
    }).catch(function () { /* no catalog, no price */ });
  }

  // ---- Scroll reveal ---------------------------------------------------------
  // Below-the-fold blocks rise in once as they enter the viewport and reset when
  // they leave below, so scrolling back down plays them again. Group children
  // arrive 70ms apart. Nothing above the fold is hidden.
  //
  // Arriving and re-arming are two observers with a gap between them. A block
  // arrives when 12% of it is above the bottom 8% of the window, but its rise
  // starts lower than it rests (motion.css story-arrive: 24px), and an observer
  // measures the moved box. With one observer that start pushed a block resting
  // near the edge back under the line, the block was re-armed, rose again, and
  // so on every frame: the shiver seen mid-scroll. Now a block is re-armed only
  // once it is entirely below the window plus REARM_GAP, which its own rise can
  // never reach.
  var REARM_GAP = 32; // px, more than the 24px a rise starts below its place
  (function () {
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    if (!targets.length || REDUCED || !('IntersectionObserver' in window)) { targets.forEach(function (t) { t.classList.add('in'); }); return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal-group]'), function (group) {
      Array.prototype.forEach.call(group.querySelectorAll('[data-reveal]'), function (child, i) {
        var delay = document.body.classList.contains('product-story') ? Math.min(i * 70, 210) : i * 70;
        child.style.setProperty('--reveal-delay', delay + 'ms');
      });
    });
    var arrive = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) entry.target.classList.add('in'); });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    var rearm = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) entry.target.classList.remove('in'); // wholly below the fold: arm again
      });
    }, { threshold: 0, rootMargin: '0px 0px ' + REARM_GAP + 'px 0px' });
    targets.forEach(function (t) { arrive.observe(t); rearm.observe(t); });
  })();

  // Homepage depth follows native scroll. No perpetual frame loop or hidden
  // content; CSS provides the complete static scene when motion is unavailable.
  // The hero stage is not a scene: its phone is something to tap, and a target
  // that drifts while the page scrolls is harder to hit.
  (function () {
    if (!document.body.classList.contains('product-story') || !window.matchMedia) return;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var desktop = window.matchMedia('(min-width: 701px)');
    var scenes = Array.prototype.slice.call(document.querySelectorAll('.work-stage, .approval-stage'));
    var queued = false;
    function draw() {
      queued = false;
      if (document.hidden) return;
      var enabled = !motion.matches && desktop.matches;
      // Read all geometry before writing styles to avoid interleaved layout.
      var values = scenes.map(function (scene) {
        var box = scene.getBoundingClientRect();
        return enabled ? Math.max(-1, Math.min(1, (window.innerHeight / 2 - box.top - box.height / 2) / (window.innerHeight / 2 + box.height / 2))) : 0;
      });
      scenes.forEach(function (scene, i) { scene.style.setProperty('--scene-progress', values[i].toFixed(4)); });
    }
    function schedule() {
      if (!queued) { queued = true; raf(draw); }
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('visibilitychange', schedule);
    if (motion.addEventListener) motion.addEventListener('change', schedule);
    schedule();
  })();

  // The homepage sample is local editorial content, never a real work request.
  (function () {
    var content = document.getElementById('sample-content');
    if (!content) return;
    var controls = document.querySelector('.sample-controls');
    var buttons = Array.prototype.slice.call(controls.querySelectorAll('[data-sample]'));
    var revise = document.getElementById('revise-sample');
    var selected = 'script', shortened = false;
    var samples = {
      script: {
        title: '첫 캠핑, 이 5가지만 준비하세요', label: '도입', outlineLabel: '장면 구성',
        intro: '첫 캠핑을 앞두고 장바구니만 가득 찼나요? 오늘은 꼭 필요한 장비 다섯 가지와, 나중에 사도 되는 물건을 정리해볼게요.',
        short: '첫 캠핑, 뭘 챙길지 막막하죠? 꼭 필요한 장비 다섯 가지만 알아볼게요.',
        outline: ['잠자리를 편하게: 텐트와 침낭', '오래 앉아도 편하게: 의자와 테이블', '해가 진 뒤에도 밝게: 랜턴']
      },
      blog: {
        title: '첫 캠핑 준비물, 가볍게 시작하는 법', label: '첫 문단', outlineLabel: '글 구성',
        intro: '처음부터 모든 장비를 살 필요는 없어요. 하룻밤을 편하게 보낼 수 있는 기본 장비부터 챙기고, 내 캠핑 방식에 맞춰 하나씩 더해보세요.',
        short: '첫 캠핑은 기본 장비부터. 필요한 물건은 경험하면서 하나씩 더해도 충분해요.',
        outline: ['꼭 필요한 준비물 다섯 가지', '빌리거나 나중에 사도 되는 물건', '떠나기 전 마지막 확인 목록']
      }
    };
    function render() {
      var sample = samples[selected];
      document.getElementById('sample-title').textContent = sample.title;
      document.getElementById('sample-label').textContent = sample.label;
      document.getElementById('sample-intro').textContent = shortened ? sample.short : sample.intro;
      document.getElementById('sample-outline-label').textContent = sample.outlineLabel;
      var outline = document.getElementById('sample-outline');
      outline.replaceChildren();
      sample.outline.forEach(function (text) { var item = document.createElement('li'); item.textContent = text; outline.appendChild(item); });
      buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.sample === selected)); });
      revise.setAttribute('aria-pressed', String(shortened));
      revise.textContent = shortened ? '원래 도입부로 돌아가기 ↶' : '도입부를 더 짧게 바꿔줘 ↗';
    }
    buttons.forEach(function (button) { button.addEventListener('click', function () { selected = button.dataset.sample; shortened = false; render(); }); });
    revise.addEventListener('click', function () { shortened = !shortened; render(); });
    controls.hidden = false;
  })();

  // ---- Scenario renderer (the hero demo and the /use/ story phone) -----------
  // `role` is one goal from roles.json: its lead, team and helpers name who is
  // doing what, so the phone shows a team at work rather than a model at work.
  function bubble(kind, text, from) {
    var node = el('div', 'msg ' + kind);
    if (from) node.appendChild(el('span', 'from', from));
    node.appendChild(document.createTextNode(text));
    return node;
  }
  function teamRow(avatar, light, name, sub, badge, badgeKind) {
    var row = el('div', 'team-row');
    row.appendChild(el('span', light ? 'avatar light' : 'avatar', avatar));
    var who = el('span', 'team-who');
    who.appendChild(el('b', '', name));
    who.appendChild(el('small', '', sub));
    row.appendChild(who);
    row.appendChild(el('span', 'badge ' + badgeKind, badge));
    return row;
  }
  function teamCard(role) {
    var card = el('div', 'team-card');
    card.appendChild(el('div', 'kicker', role.short + ' 팀이 꾸려졌어요'));
    card.appendChild(teamRow(role.lead.name.charAt(0), false, role.lead.name, role.lead.role, '맡았어요', 'work'));
    if (role.team && role.team.length) card.appendChild(teamRow('+' + role.team.length, true, '팀원 ' + role.team.length + '명', role.team.join(' · '), '함께해요', 'idle'));
    if (role.helpers && role.helpers.length) card.appendChild(teamRow('+' + role.helpers.length, true, '알바 ' + role.helpers.length + '명', role.helpers.join(' · '), '필요할 때', 'idle'));
    return card;
  }
  function stepLabel(step) {
    var label = el('span');
    if (Array.isArray(step)) { label.appendChild(document.createTextNode(step[0])); label.appendChild(el('small', '', step[1])); }
    else label.textContent = step;
    return label;
  }
  function progressCard(msg) {
    var card = el('div', 'prog');
    var head = el('div', 'lbl');
    head.appendChild(el('span', '', msg.label));
    card.appendChild(head);
    msg.steps.forEach(function (step) {
      var row = el('div');
      row.appendChild(stepLabel(step));
      row.appendChild(el('span', 'badge idle', '대기'));
      card.appendChild(row);
    });
    return card;
  }
  function approvalCard(msg) {
    var card = el('div', 'appr');
    var top = el('div', 'top');
    top.appendChild(el('h5', '', msg.title));
    top.appendChild(el('span', 'badge wait', '확인 필요'));
    card.appendChild(top);
    card.appendChild(el('p', '', msg.text));
    if (msg.files && msg.files.length) {
      var files = el('ul', 'files');
      msg.files.forEach(function (name) { var li = el('li'); li.appendChild(el('i')); li.appendChild(document.createTextNode(name)); files.appendChild(li); });
      card.appendChild(files);
    }
    var row = el('div', 'btn-row');
    row.appendChild(el('span', 'ink', msg.approve || '확인'));
    row.appendChild(el('span', 'line', msg.hold || '수정 요청'));
    card.appendChild(row);
    return card;
  }
  function resultCard(msg) {
    var card = el('div', 'res');
    card.appendChild(el('div', 'kicker', msg.kicker || '보고 도착'));
    card.appendChild(el('h5', '', msg.title));
    if (msg.rows && msg.rows.length) {
      var dl = el('dl');
      msg.rows.forEach(function (row) { dl.appendChild(el('dt', '', row[0])); dl.appendChild(el('dd', '', row[1])); });
      card.appendChild(dl);
    }
    return card;
  }
  function routineCard(msg) {
    var card = el('div', 'rt');
    var head = el('div', 'rt-head');
    head.appendChild(el('b', '', msg.title));
    head.appendChild(el('span', 'badge done', '반복 등록'));
    card.appendChild(head);
    card.appendChild(el('small', '', msg.cadence));
    return card;
  }
  function noteLine(msg) { return el('p', 'note', msg.text); }
  function nodeFor(msg, role) {
    if (msg.type === 'team') return teamCard(role);
    if (msg.type === 'me') return bubble('me', msg.text);
    if (msg.type === 'ai') return bubble('ai', msg.text, role.lead.name);
    if (msg.type === 'note') return noteLine(msg);
    if (msg.type === 'routine') return routineCard(msg);
    if (msg.type === 'result') return resultCard(msg);
    if (msg.type === 'approval') return approvalCard(msg);
    return progressCard(msg);
  }
  function approve(card) {
    card.querySelector('.ink').classList.add('pressed');
    var badge = card.querySelector('.badge');
    badge.className = 'badge done';
    badge.textContent = '확인함';
  }
  // The finished state of a scene, drawn at once (reduced motion, or a page
  // that needs the end of the story without the wait).
  function appendFinished(screen, messages, role) {
    messages.forEach(function (msg) {
      var node = nodeFor(msg, role);
      if (msg.type === 'progress') Array.prototype.forEach.call(node.querySelectorAll('.badge.idle'), function (b) { b.className = 'badge done'; b.innerHTML = CHECK + '완료'; });
      if (msg.type === 'approval') approve(node);
      screen.appendChild(node);
    });
    screen.scrollTop = screen.scrollHeight;
  }
  function renderFinished(screen, messages, role) {
    screen.replaceChildren();
    appendFinished(screen, messages, role);
  }

  // Plays `messages` into `screen`, one at a time. Returns the finish time.
  function playMessages(timeline, screen, messages, startAt, role) {
    var steps = [], t = startAt || 0;
    function add(node) {
      steps.push([t, function () {
        if (!REDUCED) node.classList.add('pop');
        screen.appendChild(node);
        screen.scrollTop = screen.scrollHeight;
      }]);
    }
    messages.forEach(function (msg, index) {
      t += index === 0 ? 0 : (msg.type === 'note' ? 900 : 1100);
      var node = nodeFor(msg, role);
      add(node);
      if (msg.type === 'team') {
        // The lead takes it first, then the team (or helpers) join.
        var rows = Array.prototype.slice.call(node.querySelectorAll('.team-row'));
        rows.forEach(function (row, i) { if (i > 0) row.classList.add('pending'); });
        rows.slice(1).forEach(function (row, i) {
          steps.push([t + 600 + i * 500, function () { row.classList.remove('pending'); row.classList.add('pop'); }]);
        });
        t += 300 + rows.length * 500;
      } else if (msg.type === 'progress') {
        var bars = node.querySelectorAll('div:not(.lbl)');
        msg.steps.forEach(function (_, i) {
          var at = t + 500 + i * 900;
          steps.push([at, function () { var b = bars[i].querySelector('.badge'); b.className = 'badge work spin-badge'; b.innerHTML = '<span class="spin" aria-hidden="true"></span>진행 중'; }]);
          steps.push([at + 800, function () { var b = bars[i].querySelector('.badge'); b.className = 'badge done'; b.innerHTML = CHECK + '완료'; }]);
        });
        t += 500 + msg.steps.length * 900;
      } else if (msg.type === 'approval') {
        var pressAt = t + 1700;
        steps.push([pressAt, function () { approve(node); }]);
        t = pressAt + 200;
      }
    });
    timeline.run(steps);
    return t;
  }
  function threadHead(head, role) {
    head.replaceChildren();
    head.appendChild(el('span', 'avatar', role.lead.name.charAt(0)));
    var who = el('div');
    who.appendChild(el('b', '', role.lead.name));
    who.appendChild(el('small', '', role.lead.role));
    head.appendChild(who);
    head.appendChild(el('span', 'badge work', role.status));
  }

  // ---- Landing hero: a phone the visitor drives -------------------------------
  // Without this script the phone shows the first featured goal's finished run,
  // as tools/site/build_use_pages.py writes it. With it, the phone becomes the
  // app's first screen: one example sentence for every goal in roles.json. A
  // tap sends the sentence, that goal's team forms and asks its one question,
  // the visitor taps the example answer, the team works, and the visitor
  // answers the confirmation before the report arrives. Every turn waits for a
  // tap, so nothing replays by itself. It is all sample text kept in the page:
  // nothing is typed, sent, stored or measured, and the page's one event is
  // still a goal link — the one a finished run ends on. Under reduced motion a
  // tap shows the next state at once.
  var ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var BACK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SEND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var demo = document.getElementById('demo');
  var demoScreen = document.getElementById('demo-screen');
  var demoHead = document.getElementById('demo-head');
  var demoCompose = document.getElementById('demo-compose');
  if (demo && demoScreen && demoHead && demoCompose && window.fetch) {
    fetch('/roles.json').then(function (response) { return response.ok ? response.json() : null; }).then(function (data) {
      if (data && data.roles && data.roles.length) heroDemo(data.roles);
    }).catch(function () { /* the static finished scene stays */ });
  }

  function heroDemo(roles) {
    var phone = demoScreen.parentNode;
    var live = document.getElementById('demo-live');
    var caption = document.getElementById('demo-cap-text');
    var flow = new Timeline();   // the team's turn
    var next = new Timeline();   // what follows a finished turn
    var typing = new Timeline(); // a sentence typing itself into the composer
    var keyboard = false, touched = false;

    function stop() { flow.cancel(); next.cancel(); typing.cancel(); }
    function say(text) { if (live) live.textContent = text; }
    function sentence(role) { return role.goal.replace(/기$/, '고 싶어요'); }
    function indexOf(messages, type) {
      for (var i = 0; i < messages.length; i++) if (messages[i].type === type) return i;
      return -1;
    }
    function add(node) {
      if (!REDUCED) node.classList.add('pop');
      demoScreen.appendChild(node);
      demoScreen.scrollTop = demoScreen.scrollHeight;
    }
    // A tap target. Enter and Space click with detail 0, so focus follows the
    // story to the next target only for someone on a keyboard.
    function button(className, text, onTap) {
      var node = el('button', className, text);
      node.type = 'button';
      node.addEventListener('click', function (event) {
        if (node.disabled) return;
        touched = true;
        keyboard = !event.detail;
        onTap();
      });
      return node;
    }
    function ready(node) {
      if (!REDUCED) node.classList.add('demo-next');
      if (keyboard && node.focus) node.focus({ preventScroll: true });
    }

    // The composer: suggestions above a picture of an input (no field, nothing
    // to type into). A tapped sentence types itself in and is sent.
    var input = el('div', 'demo-input');
    var inputText = el('span');
    var sendMark = el('span', 'demo-send');
    input.setAttribute('aria-hidden', 'true');
    sendMark.innerHTML = SEND;
    input.appendChild(inputText);
    input.appendChild(sendMark);
    function setInput(text, placeholder) {
      inputText.textContent = text || placeholder || '';
      input.className = text ? 'demo-input typing' : 'demo-input';
    }
    // A taller composer leaves less screen, so the thread is scrolled back to
    // its newest line each time the composer changes.
    function compose(label, chips, placeholder) {
      demoCompose.replaceChildren();
      if (chips && chips.length) {
        var box = el('div', 'demo-suggest');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', label);
        box.appendChild(el('span', 'demo-suggest-label', label));
        chips.forEach(function (chip) { box.appendChild(chip); });
        demoCompose.appendChild(box);
      }
      setInput('', placeholder);
      demoCompose.appendChild(input);
      demoScreen.scrollTop = demoScreen.scrollHeight;
    }
    function send(text, then) {
      compose('', null, '');
      if (REDUCED) { add(bubble('me', text)); then(); return; }
      var per = Math.max(18, Math.min(45, Math.round(800 / text.length)));
      var steps = [];
      for (var n = 1; n <= text.length; n++) steps.push([n * per, setInput.bind(null, text.slice(0, n), '')]);
      steps.push([text.length * per + 280, function () { setInput('', ''); add(bubble('me', text)); then(); }]);
      typing.run(steps);
    }
    // Plays messages nobody answers (the team forming, the question, the work,
    // the report), then `then`.
    function turn(role, messages, then) {
      if (!messages.length) { then(); return; }
      if (REDUCED) { appendFinished(demoScreen, messages, role); then(); return; }
      var end = playMessages(flow, demoScreen, messages, 400, role);
      next.run([[end + 450, then]]);
    }

    // The first screen: a greeting and one example sentence per goal.
    function home() {
      stop();
      demoHead.replaceChildren(el('span', 'avatar', '사'));
      var who = el('div');
      who.appendChild(el('b', '', '사이드킥'));
      who.appendChild(el('small', '', '새 대화 · 예시'));
      demoHead.appendChild(who);
      demoScreen.replaceChildren(bubble('ai', '무엇을 시작할까요? 아래 문장 하나를 눌러 보세요. 그 일을 맡을 팀이 바로 꾸려져요.', '사이드킥'));
      var list = el('div', 'demo-home');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', '예시 문장');
      roles.forEach(function (role) {
        var chip = button(role.featured ? 'demo-chip featured' : 'demo-chip', '', function () { start(role); });
        var icon = document.querySelector('#goals [data-goal="' + role.slug + '"] svg');
        if (icon) chip.appendChild(icon.cloneNode(true));
        chip.appendChild(el('span', '', sentence(role)));
        list.appendChild(chip);
      });
      demoScreen.appendChild(list);
      compose('', null, '위 문장을 누르면 여기에 써져요');
      demoScreen.scrollTop = 0;
      return list.firstChild;
    }
    function backHome() {
      var first = home();
      say('처음 화면이에요. 예시 문장을 골라 보세요.');
      if (keyboard) first.focus({ preventScroll: true });
    }
    // A goal's run is its roles.json messages, cut where the visitor answers:
    // the example answer ("me") and the confirmation ("approval").
    function start(role) {
      stop();
      threadHead(demoHead, role);
      var back = button('demo-back', '', backHome);
      back.setAttribute('aria-label', '처음 화면으로');
      back.innerHTML = BACK;
      demoHead.insertBefore(back, demoHead.firstChild);
      demoScreen.replaceChildren();
      var at = indexOf(role.messages, 'me');
      say(sentence(role));
      send(sentence(role), function () {
        turn(role, role.messages.slice(0, at), function () { ask(role, role.messages[at], role.messages.slice(at + 1)); });
      });
    }
    function ask(role, mine, rest) {
      say(role.lead.name + ': ' + role.messages[indexOf(role.messages, 'ai')].text);
      var chip = button('demo-chip answer', mine.text, function () {
        send(mine.text, function () { work(role, rest); });
      });
      compose('예시 답변', [chip], '');
      ready(chip);
    }
    function work(role, rest) {
      var at = indexOf(rest, 'approval');
      if (at === -1) { turn(role, rest, function () { done(role, true); }); return; }
      turn(role, rest.slice(0, at), function () { confirm(role, rest[at], rest.slice(at + 1)); });
    }
    // The confirmation card, with buttons that work: the visitor decides.
    function confirm(role, msg, rest) {
      var card = approvalCard(msg);
      var badge = card.querySelector('.badge');
      var yes = button('ink', msg.approve || '확인', function () { decide(true); });
      var hold = button('line', msg.hold || '수정 요청', function () { decide(false); });
      card.querySelector('.btn-row').replaceChildren(yes, hold);
      function decide(ok) {
        yes.disabled = true;
        hold.disabled = true;
        (ok ? yes : hold).classList.add('pressed');
        badge.className = ok ? 'badge done' : 'badge work';
        badge.textContent = ok ? '확인함' : '고치는 중';
        compose('', null, '');
        if (ok) { turn(role, rest, function () { done(role, true); }); return; }
        add(bubble('ai', '알겠어요. 고칠 부분을 말해 주시면 팀이 다시 준비해서 또 확인받을게요.', role.lead.name));
        done(role, false);
      }
      add(card);
      compose('', null, '확인 카드의 버튼을 눌러 보세요');
      say('확인 필요: ' + msg.title + '. ' + msg.text);
      ready(yes);
    }
    // The end of a run: this goal's real start, or another try.
    function done(role, approved) {
      var result = role.messages[indexOf(role.messages, 'result')];
      say(approved ? '보고 도착: ' + result.title : role.lead.name + ': 고칠 부분을 말해 주시면 다시 준비해요.');
      var go = el('a', 'demo-chip demo-go', role.goal);
      go.href = '/use/' + role.slug + '/';
      go.setAttribute('data-goal', role.slug);
      go.setAttribute('data-source', 'landing_demo');
      go.insertAdjacentHTML('beforeend', ARROW);
      var again = button('demo-chip', '처음부터 다시', function () { start(role); });
      var other = button('demo-chip', '다른 일 해 보기', backHome);
      compose('예시는 여기까지예요', [go, again, other], '');
      ready(go);
    }

    demo.setAttribute('role', 'group');
    demo.setAttribute('aria-label', '직접 눌러 보는 예시 앱 화면. 누른 내용은 어디에도 보내지지 않아요.');
    phone.removeAttribute('aria-hidden');
    if (caption) caption.textContent = '직접 눌러 보세요';
    demoCompose.hidden = false;
    var first = home();
    // The first time the phone is well on screen, its first sentence glows to
    // say it can be pressed — unless somebody already has.
    var hinted = false;
    observe(demo, function () {
      if (hinted || touched || REDUCED) return;
      hinted = true;
      first.classList.add('demo-next');
    }, null, 0.5);
  }

  // ---- The start button (/use/ pages) -----------------------------------------
  // [data-start] is a plain link to /account/ without this script. With it:
  // signed out, it opens the shared sign-in sheet in place; signed in (now or
  // after that sheet), the page says what happens next instead of moving away.
  var starts = Array.prototype.slice.call(document.querySelectorAll('[data-start]'));
  var auth = window.SidekickAuth;
  if (starts.length && auth) {
    var wanted = false;
    var readies = Array.prototype.slice.call(document.querySelectorAll('[data-start-ready]'));
    var bar = document.getElementById('cta-bar');
    var showReady = function (near) {
      readies.forEach(function (node) { node.hidden = false; });
      if (bar) bar.hidden = true;
      var target = near && near.closest ? near.closest('section') : null;
      var panel = (target && target.querySelector('[data-start-ready]')) || readies[0];
      if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: false }); }
    };
    var lastStart = null;
    auth.init({ onSignedIn: function () { if (wanted) showReady(lastStart); } });
    starts.forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        wanted = true;
        lastStart = link;
        trackGoal(link.getAttribute('data-start'), 'use_page_start');
        if (auth.token()) showReady(link);
        else auth.open();
      });
    });
    // On a phone the start button stays in thumb reach once the first one has
    // scrolled away, and steps aside when the closing one is on screen.
    var heroActions = document.getElementById('hero-actions');
    var closing = document.getElementById('start');
    if (bar && heroActions && closing && 'IntersectionObserver' in window) {
      var heroSeen = true, closingSeen = false;
      var update = function () { bar.hidden = heroSeen || closingSeen || readies.some(function (n) { return !n.hidden; }); };
      new IntersectionObserver(function (entries) { heroSeen = entries[0].isIntersecting; update(); }).observe(heroActions);
      new IntersectionObserver(function (entries) { closingSeen = entries[0].isIntersecting; update(); }).observe(closing);
    }
  }

  // Shared with /use/<slug>/ (use.js): the same renderer draws the story phone.
  window.SidekickDemo = {
    el: el, observe: observe, Timeline: Timeline, playMessages: playMessages, renderFinished: renderFinished,
    bubble: bubble, teamCard: teamCard, progressCard: progressCard, approvalCard: approvalCard, resultCard: resultCard,
    routineCard: routineCard, noteLine: noteLine, threadHead: threadHead, CHECK: CHECK, REDUCED: REDUCED
  };
})();
