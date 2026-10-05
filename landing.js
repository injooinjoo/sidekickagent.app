/* sidekickagent.app landing and /use/ pages — the goal demo, the start
 * button, pricing figures, scroll reveal and the shared scenario renderer.
 *
 * No library: CSS transitions and keyframes do the drawing, this file only
 * decides when. Every timeline is cancellable (a token per run) so a quick
 * second choice never overlaps the first, and the demo plays only while it is
 * on screen. Under prefers-reduced-motion the page keeps the static markup —
 * always the finished state of each scene — and plays nothing. */
(function () {
  'use strict';
  var API_ORIGIN = 'https://api.sidekickagent.app';
  var REDUCED = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!REDUCED) document.documentElement.classList.add('js');
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
  if (window.fetch && planRows.length) {
    fetch(API_ORIGIN + '/membership/toss/config').then(function (response) {
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
  (function () {
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    if (!targets.length || REDUCED || !('IntersectionObserver' in window)) { targets.forEach(function (t) { t.classList.add('in'); }); return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal-group]'), function (group) {
      Array.prototype.forEach.call(group.querySelectorAll('[data-reveal]'), function (child, i) {
        var delay = document.body.classList.contains('product-story') ? Math.min(i * 70, 210) : i * 70;
        child.style.setProperty('--reveal-delay', delay + 'ms');
      });
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('in');
        else if (entry.boundingClientRect.top > 0) entry.target.classList.remove('in'); // left below the fold: arm again
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  })();

  // Homepage depth follows native scroll. No perpetual frame loop or hidden
  // content; CSS provides the complete static scene when motion is unavailable.
  (function () {
    if (!document.body.classList.contains('product-story') || !window.matchMedia) return;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var desktop = window.matchMedia('(min-width: 701px)');
    var scenes = Array.prototype.slice.call(document.querySelectorAll('.team-stage, .work-stage, .approval-stage'));
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
  function renderFinished(screen, messages, role) {
    screen.replaceChildren();
    messages.forEach(function (msg) {
      var node = nodeFor(msg, role);
      if (msg.type === 'progress') Array.prototype.forEach.call(node.querySelectorAll('.badge.idle'), function (b) { b.className = 'badge done'; b.innerHTML = CHECK + '완료'; });
      if (msg.type === 'approval') approve(node);
      screen.appendChild(node);
    });
    screen.scrollTop = screen.scrollHeight;
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

  // ---- Landing hero: the chosen goal's team at work ---------------------------
  // The phone plays the first featured goal while it is on screen. On a pointer
  // that hovers, pointing at another goal previews its team; choosing a goal
  // opens its page either way (the links work without this script).
  var demo = document.getElementById('demo');
  var demoScreen = document.getElementById('demo-screen');
  var demoHead = document.getElementById('demo-head');
  var demoGoal = document.getElementById('demo-goal');
  if (demo && demoScreen && demoHead && window.fetch) {
    fetch('/roles.json').then(function (response) { return response.ok ? response.json() : null; }).then(function (data) {
      if (!data || !data.roles || !data.roles.length) return;
      var goals = {};
      data.roles.forEach(function (role) { goals[role.slug] = role; });
      var first = data.roles.filter(function (role) { return role.featured; })[0] || data.roles[0];
      var timeline = new Timeline();
      var visible = false, playing = null, loops = 0, loopTimer = null, swapTimer = null, pending = null;
      var phone = demoScreen.parentNode;
      var play = function (role, again) {
        clearTimeout(loopTimer);
        clearTimeout(swapTimer);
        timeline.cancel();
        loops = again ? loops + 1 : 0;
        playing = role;
        if (demoGoal) demoGoal.textContent = role.goal;
        if (REDUCED || document.body.classList.contains('product-story')) { threadHead(demoHead, role); renderFinished(demoScreen, role.messages, role); return; }
        phone.classList.add('fade');
        swapTimer = setTimeout(function () {
          threadHead(demoHead, role);
          demoScreen.replaceChildren();
          phone.classList.remove('fade');
          var end = playMessages(timeline, demoScreen, role.messages, 250, role);
          // Replay a few times while it is on screen, then rest on the result.
          if (loops < 2) loopTimer = setTimeout(function () { if (visible && playing === role) play(role, true); }, end + 5000);
        }, 260);
      };
      observe(demo, function () { visible = true; if (!playing) play(first); }, function () { visible = false; }, 0.3);
      var hover = Boolean(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
      Array.prototype.forEach.call(document.querySelectorAll('#goals [data-goal]'), function (link) {
        var preview = function () {
          var role = goals[link.getAttribute('data-goal')];
          if (!role || role === playing) return;
          clearTimeout(pending);
          pending = setTimeout(function () { play(role); }, 160);
        };
        if (hover) link.addEventListener('mouseenter', preview);
        link.addEventListener('focus', function () { if (hover) preview(); });
      });
    }).catch(function () { /* the static finished scene stays */ });
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
