/* sidekickagent.app landing — pricing, role scenarios and the motion layer.
 *
 * No library: CSS transitions and keyframes do the drawing, this file only
 * decides when. Every timeline is cancellable (a token per run) so a quick
 * second click never overlaps the first, and everything that loops starts
 * when its element enters the viewport and stops when it leaves. Under
 * prefers-reduced-motion the page keeps the static markup — which is always
 * the finished state of each scene — and plays nothing. */
(function () {
  'use strict';
  var API_ORIGIN = 'https://api.sidekickagent.app';
  var MODELS = 'DeepSeek·GPT·Claude·Grok·Gemini';
  var MODEL_LIST = ['DeepSeek', 'GPT', 'Claude', 'Grok', 'Gemini'];
  // One toggle moves all three plan cards. Set false to let cards differ.
  var SYNC_FUNDING = true;
  var REDUCED = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!REDUCED) document.documentElement.classList.add('js');
  var CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function money(value) { return Number(value).toLocaleString('ko-KR') + '\uc6d0'; }
  // Korean won, served by the backend. `catalog` stays empty until
  // /membership/toss/config answers, and an empty catalog prints no number at
  // all rather than a placeholder somebody could mistake for a price.
  var catalog = {};
  function priceOf(card, funding) {
    var amount = catalog[card.getAttribute('data-plan') + ':' + funding];
    return typeof amount === 'number' && amount > 0 ? amount : null;
  }
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

  // ---- Number roller: one slot per character, digits roll through a column --
  function Roller(host) {
    this.host = host;
    host.classList.add('roll');
    var value = host.textContent;
    host.textContent = '';
    // Assistive tech reads the value once; the digit columns are decoration.
    this.label = el('span', 'sr-only');
    this.vis = el('span', 'roll-vis');
    this.vis.setAttribute('aria-hidden', 'true');
    host.appendChild(this.label);
    host.appendChild(this.vis);
    this.set(value, true);
  }
  Roller.prototype.set = function (value, instant) {
    var chars = String(value).split(''), host = this.vis;
    this.label.textContent = String(value);
    var slots = Array.prototype.slice.call(host.querySelectorAll('.slot:not(.out)'));
    chars.forEach(function (ch, i) {
      var slot = slots[i], digit = /\d/.test(ch);
      if (!slot) {
        slot = el('span', 'slot');
        host.appendChild(slot);
        if (!instant) { slot.classList.add('in'); raf(function () { slot.classList.remove('in'); }); }
      }
      if (digit) {
        if (!slot.classList.contains('digit')) {
          slot.className = 'slot digit';
          var col = el('span', 'col');
          for (var d = 0; d < 10; d++) col.appendChild(el('span', '', String(d)));
          slot.replaceChildren(col);
        }
        if (instant) slot.classList.add('now');
        slot.style.setProperty('--n', ch);
        if (instant) raf(function () { slot.classList.remove('now'); });
      } else {
        slot.className = 'slot sym';
        slot.textContent = ch;
      }
    });
    slots.slice(chars.length).forEach(function (slot) {
      slot.classList.add('out');
      setTimeout(function () { if (slot.parentNode) slot.parentNode.removeChild(slot); }, 320);
    });
  };

  // ---- Pricing ---------------------------------------------------------------
  // No card carries a number. Every figure here comes from the KRW catalog the
  // backend serves, and sales stay "preview" until the server says checkout is
  // live, matching the fail-closed button on the membership page.
  var salesOpen = false;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.plan[data-plan]'));
  function swapText(node, value) {
    if (node.textContent === value) return;
    if (REDUCED) { node.textContent = value; return; }
    node.classList.add('swap-out');
    setTimeout(function () { node.textContent = value; node.classList.remove('swap-out'); node.classList.add('swap-in'); raf(function () { node.classList.remove('swap-in'); }); }, 180);
  }
  function crossfade(node, value) {
    if (node.textContent === value) return;
    if (REDUCED) { node.textContent = value; return; }
    node.classList.add('xf');
    setTimeout(function () { node.textContent = value; node.classList.remove('xf'); }, 130);
  }
  function moveSeg(card, funding, instant) {
    var seg = card.querySelector('.seg');
    var pill = seg.querySelector('.seg-pill');
    var button = seg.querySelector('[data-funding="' + funding + '"]');
    if (!pill || !button) return;
    if (instant) pill.classList.add('now');
    pill.style.width = button.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + (button.offsetLeft - 3) + 'px)';
    if (instant) raf(function () { pill.classList.remove('now'); });
  }
  function renderCard(card, instant) {
    var funding = card.getAttribute('data-funding-selected') || 'included';
    var amount = priceOf(card, funding);
    card.rollers.price.set(amount === null ? '\u2014' : money(amount), instant);
    card.querySelector('[data-role="price-sub"]').hidden = amount === null;
    var buy = card.querySelector('[data-role="buy"]');
    buy.setAttribute('href', '/membership/?plan=' + card.getAttribute('data-plan') + '&funding=' + funding);
    var label = salesOpen ? '구매하기' : '구성 미리 보기';
    if (instant) card.querySelector('[data-role="buy-label"]').textContent = label; else swapText(card.querySelector('[data-role="buy-label"]'), label);
    var mode = funding === 'included' ? 'Sidekick AI' : '내 AI 계정';
    if (instant) card.querySelector('[data-role="buy-mode"]').textContent = mode; else swapText(card.querySelector('[data-role="buy-mode"]'), mode);
    var aiLine = card.querySelector('[data-role="ai-line"] span');
    var aiText = funding === 'included' ? 'AI 사용료 멤버십에 포함' : 'AI 사용료는 내 계정에서 · ' + MODELS;
    if (instant) aiLine.textContent = aiText; else crossfade(aiLine, aiText);
    var saving = card.querySelector('[data-role="save"]');
    if (saving) {
      var included = priceOf(card, 'included');
      var connected = priceOf(card, 'connected');
      var known = included !== null && connected !== null && included > connected;
      if (known) saving.textContent = '월 ' + money(included - connected) + ' 절감';
      saving.hidden = funding !== 'connected' || !known;
    }
    Array.prototype.forEach.call(card.querySelectorAll('[data-funding]'), function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-funding') === funding));
    });
    moveSeg(card, funding, instant);
  }
  function selectFunding(card, funding) {
    var targets = SYNC_FUNDING ? cards : [card];
    targets.forEach(function (target) {
      target.setAttribute('data-funding-selected', funding);
      renderCard(target, false);
    });
  }
  cards.forEach(function (card) {
    card.rollers = { price: new Roller(card.querySelector('[data-role="price"]')) };
    var seg = card.querySelector('.seg');
    if (seg && !seg.querySelector('.seg-pill')) seg.insertBefore(el('i', 'seg-pill'), seg.firstChild);
    Array.prototype.forEach.call(card.querySelectorAll('[data-funding]'), function (button) {
      button.addEventListener('click', function () { selectFunding(card, button.getAttribute('data-funding')); });
    });
    renderCard(card, true);
  });
  window.addEventListener('resize', function () {
    cards.forEach(function (card) { moveSeg(card, card.getAttribute('data-funding-selected') || 'included', true); });
  });
  // The feature card quotes the same saving the plan card sells, read from the
  // plan card's attributes so the two can never disagree.
  function renderModelSaving() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-role="model-saving"]'), function (label) {
      var ref = document.querySelector('.plan[data-plan="' + label.getAttribute('data-plan-ref') + '"]');
      if (!ref) return;
      var included = priceOf(ref, 'included');
      var connected = priceOf(ref, 'connected');
      label.textContent = included === null || connected === null ? '' : money(included) + ' \u2192 ' + money(connected);
    });
  }
  renderModelSaving();
  if (window.fetch && cards.length) {
    fetch(API_ORIGIN + '/membership/toss/config').then(function (response) {
      return response.ok ? response.json() : {};
    }).then(function (config) {
      salesOpen = Boolean(config) && config.sales_enabled === true && config.mode === 'live';
      if (config && config.plans && typeof config.plans === 'object') catalog = config.plans;
      document.getElementById('pricing-closed').hidden = salesOpen;
      cards.forEach(function (card) { renderCard(card, true); });
      renderModelSaving();
    }).catch(function () { /* no catalog, no price, stays in preview */ });
  }

  // ---- Scroll reveal ---------------------------------------------------------
  // Everything marked data-reveal rises in as it enters the viewport and resets
  // when it leaves, so scrolling back up plays it again. Group children stagger.
  (function () {
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    if (!targets.length || REDUCED || !('IntersectionObserver' in window)) { targets.forEach(function (t) { t.classList.add('in'); }); return; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal-group]'), function (group) {
      Array.prototype.forEach.call(group.querySelectorAll('[data-reveal]'), function (child, i) { child.style.setProperty('--reveal-delay', (i * 80) + 'ms'); });
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('in');
        else if (entry.boundingClientRect.top > 0) entry.target.classList.remove('in'); // left below the fold: arm again
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  })();

  // ---- Scenario renderer (shared by the roles phone and the hero phone) ------
  function bubble(kind, text, from) {
    var node = el('div', 'msg ' + kind);
    if (from) node.appendChild(el('span', 'from', from));
    node.appendChild(document.createTextNode(text));
    return node;
  }
  function progressCard(msg) {
    var card = el('div', 'prog');
    var head = el('div', 'lbl');
    head.appendChild(el('span', '', msg.label));
    if (msg.model) head.appendChild(el('span', 'badge model', msg.model));
    card.appendChild(head);
    msg.steps.forEach(function (step) {
      var row = el('div');
      row.appendChild(el('span', '', step));
      var badge = el('span', 'badge idle', '대기');
      row.appendChild(badge);
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
    row.appendChild(el('span', 'ink', msg.approve || '승인'));
    row.appendChild(el('span', 'line', msg.hold || '보류'));
    card.appendChild(row);
    return card;
  }
  function resultCard(msg) {
    var card = el('div', 'res');
    card.appendChild(el('div', 'kicker', msg.kicker || '결과 도착'));
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
    head.appendChild(el('span', 'badge done', '일과 등록'));
    card.appendChild(head);
    card.appendChild(el('small', '', msg.cadence + (msg.model ? ' · ' + msg.model : '')));
    return card;
  }
  function noteLine(msg) { return el('p', 'note', msg.text); }
  // The finished state of a scene, drawn at once (reduced motion, or a page
  // that needs the end of the story without the wait).
  function renderFinished(screen, messages, who) {
    screen.replaceChildren();
    messages.forEach(function (msg) {
      var node = msg.type === 'me' ? bubble('me', msg.text) : msg.type === 'ai' ? bubble('ai', msg.text, who) : msg.type === 'note' ? noteLine(msg) : msg.type === 'routine' ? routineCard(msg) : msg.type === 'result' ? resultCard(msg) : msg.type === 'approval' ? approvalCard(msg) : progressCard(msg);
      if (msg.type === 'progress') Array.prototype.forEach.call(node.querySelectorAll('.badge.idle'), function (b) { b.className = 'badge done'; b.innerHTML = CHECK + '완료'; });
      if (msg.type === 'approval') { node.querySelector('.badge').className = 'badge done'; node.querySelector('.badge').textContent = '승인됨'; node.querySelector('.ink').classList.add('pressed'); }
      screen.appendChild(node);
    });
    screen.scrollTop = screen.scrollHeight;
  }

  // Plays `messages` into `screen`, one at a time. Returns the finish time.
  function playMessages(timeline, screen, messages, startAt, who) {
    var steps = [], t = startAt || 0;
    function add(node) {
      steps.push([t, function () {
        if (!REDUCED) node.classList.add('pop');
        screen.appendChild(node);
        screen.scrollTop = screen.scrollHeight;
      }]);
    }
    messages.forEach(function (msg, index) {
      t += index === 0 ? 0 : (msg.type === 'note' ? 900 : 1200);
      if (msg.type === 'me') add(bubble('me', msg.text));
      else if (msg.type === 'ai') add(bubble('ai', msg.text, who));
      else if (msg.type === 'note') add(noteLine(msg));
      else if (msg.type === 'routine') add(routineCard(msg));
      else if (msg.type === 'result') add(resultCard(msg));
      else if (msg.type === 'progress') {
        var card = progressCard(msg);
        add(card);
        msg.steps.forEach(function (_, i) {
          var rows = card.querySelectorAll('div:not(.lbl)');
          var at = t + 500 + i * 900;
          steps.push([at, function () { var b = rows[i].querySelector('.badge'); b.className = 'badge work spin-badge'; b.innerHTML = '<span class="spin" aria-hidden="true"></span>진행 중'; }]);
          steps.push([at + 800, function () { var b = rows[i].querySelector('.badge'); b.className = 'badge done'; b.innerHTML = CHECK + '완료'; }]);
        });
        t += 500 + msg.steps.length * 900;
      } else if (msg.type === 'approval') {
        var appr = approvalCard(msg);
        add(appr);
        var pressAt = t + 1600;
        steps.push([pressAt, function () { appr.querySelector('.ink').classList.add('pressed'); appr.querySelector('.badge').className = 'badge done'; appr.querySelector('.badge').textContent = '승인됨'; }]);
        t = pressAt + 200;
      }
    });
    timeline.run(steps);
    return t;
  }

  // ---- Roles: pills, description transition, phone demo ----------------------
  var pills = document.getElementById('role-pills');
  var desc = document.getElementById('role-desc');
  var roleHead = document.getElementById('role-head');
  var roleScreen = document.getElementById('role-screen');
  var roleMore = document.getElementById('role-more');
  var roleTimeline = new Timeline();
  var roles = [];
  var currentRole = -1;
  var roleSwap = 0;

  function setDescription(role) {
    var next = el('span', 'rd');
    var lead = el('b', 'rd-lead', role.lead + ' ');
    var rest = el('span', 'rd-rest', role.rest);
    next.appendChild(lead); next.appendChild(rest);
    var old = desc.querySelector('.rd');
    if (REDUCED || !old) { desc.replaceChildren(next); return; }
    old.classList.add('rd-out');
    setTimeout(function () {
      desc.replaceChildren(next);
      next.classList.add('rd-in');
      raf(function () { next.classList.remove('rd-in'); });
    }, 180);
  }
  function setHead(role) {
    roleHead.replaceChildren();
    roleHead.appendChild(el('span', 'avatar', role.name.charAt(0)));
    var who = el('div');
    who.appendChild(el('b', '', role.name));
    who.appendChild(el('small', '', role.role));
    roleHead.appendChild(who);
    roleHead.appendChild(el('span', 'badge work', role.status));
  }
  function renderRole(index) {
    if (index === currentRole || !roles[index]) return;
    currentRole = index;
    var role = roles[index];
    Array.prototype.forEach.call(pills.children, function (pill, i) { pill.setAttribute('aria-pressed', String(i === index)); });
    setDescription(role);
    if (roleMore) roleMore.setAttribute('href', '/use/' + role.slug + '/');
    roleTimeline.cancel();
    var phone = roleScreen.parentNode;
    if (REDUCED) {
      setHead(role);
      renderFinished(roleScreen, role.messages, role.name);
      return;
    }
    phone.classList.add('fade');
    var mine = ++roleSwap;
    setTimeout(function () {
      if (mine !== roleSwap) return; // a later click owns the phone now
      setHead(role);
      roleScreen.replaceChildren();
      phone.classList.remove('fade');
      playMessages(roleTimeline, roleScreen, role.messages, 350, role.name);
    }, 300);
  }
  function buildPills() {
    pills.replaceChildren();
    roles.forEach(function (role, index) {
      var pill = el('button', 'role-pill');
      pill.type = 'button';
      pill.setAttribute('aria-pressed', 'false');
      pill.appendChild(el('span', 'rp-av', role.name.charAt(0)));
      pill.appendChild(document.createTextNode(role.pill));
      pill.addEventListener('click', function () { renderRole(index); });
      pills.appendChild(pill);
    });
    pills.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      var next = (currentRole + (event.key === 'ArrowRight' ? 1 : -1) + roles.length) % roles.length;
      renderRole(next);
      pills.children[next].focus();
    });
  }
  if (pills && roleScreen && window.fetch) {
    fetch('/roles.json').then(function (response) { return response.ok ? response.json() : null; }).then(function (data) {
      if (!data || !data.roles) return;
      roles = data.roles;
      buildPills();
      var wanted = (location.hash || '').replace('#use-', '');
      var start = 0;
      roles.forEach(function (role, i) { if (role.slug === wanted) start = i; });
      // The first scenario plays when the section scrolls into view, so a
      // visitor arriving from the hero sees it from the first message.
      var section = document.getElementById('roles');
      if (REDUCED || !section) renderRole(start);
      else observe(section, function () { if (currentRole === -1) renderRole(start); }, null, 0.2);
    }).catch(function () { /* the static card stays */ });
  }

  // ---- Hero: three phones -----------------------------------------------------
  var hero = document.getElementById('demo');
  var stage = hero ? hero.querySelector('.stage') : null;
  var phones = stage ? Array.prototype.slice.call(stage.querySelectorAll('.phone')) : [];
  var heroTimeline = new Timeline();
  var heroPlayed = false;

  function countUp(node, target, duration) {
    var start = null, suffix = String(node.textContent).replace(/^\d+/, '');
    function frame(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / duration);
      p = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(target * p) + suffix;
      if (p < 1) raf(frame);
    }
    raf(frame);
  }
  function startLeftPhone() {
    if (!phones[0] || REDUCED) return;
    Array.prototype.forEach.call(phones[0].querySelectorAll('.tile b'), function (b) {
      var target = parseInt(b.textContent, 10);
      if (!isNaN(target)) countUp(b, target, 600);
    });
  }
  var APPROVALS = [
    { title: '리뷰 3편 예약 발행', text: '초안 3편을 목·금·토 9시에 예약 발행할까요?', files: ['캠핑 의자 리뷰_초안', '썸네일 3장'], approve: '발행 승인', hold: '수정 요청' },
    { title: '스토어 답변 5건 보내기', text: '교환 1건은 정책 확인이 필요해 따로 표시했어요.', files: ['답변 초안 5건'], approve: '5건 보내기', hold: '보류' },
    { title: '인스타 게시물 3개 예약', text: '월·수·금 11시에 올릴까요? 문구를 확인해 주세요.', files: ['문구·해시태그 3개'], approve: '예약 승인', hold: '보류' },
    { title: '경비표 확인 필요 2건', text: '영수증이 없는 2건을 확인 필요로 넣을까요?', files: ['8월 경비표'], approve: '확인 필요로', hold: '보류' }
  ];
  var approvalTimer = null, approvalIndex = 0;
  function rotateApprovals() {
    var stackHost = phones[2] ? phones[2].querySelector('.appr-stack') : null;
    if (!stackHost || REDUCED) return;
    clearInterval(approvalTimer);
    approvalTimer = setInterval(function () {
      approvalIndex = (approvalIndex + 1) % APPROVALS.length;
      var card = approvalCard(APPROVALS[approvalIndex]);
      card.classList.add('pop');
      stackHost.insertBefore(card, stackHost.firstChild);
      var extra = Array.prototype.slice.call(stackHost.children).slice(2);
      extra.forEach(function (old) { old.classList.add('fade-out'); setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 600); });
    }, 3000);
  }
  function stopApprovals() { clearInterval(approvalTimer); approvalTimer = null; }

  var HERO_SCENARIO = [
    { type: 'me', text: '이번 주 캠핑용품 리뷰 글 3개 써서 예약 발행해줘.' },
    { type: 'ai', text: '키워드 조사 → 초안 3개 → 썸네일 → 발행 예약 순서로 갈게요. 발행 전에 확인 요청 드릴게요.' },
    { type: 'progress', label: '진행 중 · 3단계', model: 'Claude로 작성 중', steps: ['키워드 조사', '초안 3개 작성', '썸네일 문구'] },
    { type: 'approval', title: '리뷰 3편 예약 발행', text: '초안 3편을 목·금·토 9시에 예약 발행할까요?', files: ['캠핑 의자 리뷰_초안', '썸네일 3장'], approve: '발행 승인', hold: '수정 요청' },
    { type: 'result', kicker: '결과 도착', title: '리뷰 3편 예약 발행 완료', rows: [['발행 일정', '목·금·토 09:00'], ['준비된 자료', '초안 3편 · 썸네일 3장']] }
  ];
  function employeeListScreen() {
    var screen = el('div', 'list-screen');
    var head = el('div', 'scr-head');
    head.appendChild(el('span', 'scr-title', '직원'));
    head.appendChild(el('span', 'pill-free', '3명'));
    screen.appendChild(head);
    var list = el('div', 'roster emp');
    [['현', '현진', '블로그 담당', 'work'], ['예', '예린', '가격 감시 담당', 'work'], ['하', '하린', '스토어 CS 담당', '']].forEach(function (row, i) {
      var item = el('div');
      item.appendChild(el('span', 'avatar', row[0]));
      var who = el('div');
      who.appendChild(el('b', '', row[1]));
      who.appendChild(el('small', '', row[2]));
      item.appendChild(who);
      item.appendChild(el('span', 'dot ' + row[3]));
      if (i === 0) item.classList.add('target');
      list.appendChild(item);
    });
    screen.appendChild(list);
    return screen;
  }
  function playHero() {
    var phone = phones[1];
    if (!phone || REDUCED) return;
    heroPlayed = true;
    var sbar = phone.querySelector('.sbar');
    var body = phone.querySelector('.phone-body');
    if (!body) return;
    heroTimeline.cancel();
    var steps = [];
    body.classList.add('fade');
    steps.push([300, function () {
      body.replaceChildren(employeeListScreen());
      body.classList.remove('fade');
    }]);
    steps.push([2400, function () { var t = body.querySelector('.target'); if (t) t.classList.add('tapped'); }]);
    steps.push([3000, function () { body.classList.add('fade'); }]);
    steps.push([3300, function () {
      body.replaceChildren();
      var head = el('div', 'thread-head');
      head.appendChild(el('span', 'avatar', '현'));
      var who = el('div'); who.appendChild(el('b', '', '현진')); who.appendChild(el('small', '', '블로그 담당'));
      head.appendChild(who);
      head.appendChild(el('span', 'badge work', '작업 중'));
      body.appendChild(head);
      var screen = el('div', 'thread-screen');
      body.appendChild(screen);
      body.classList.remove('fade');
      // Voice first: a waveform bubble, then the text it became.
      var wave = el('div', 'msg me wave pop');
      for (var i = 0; i < 9; i++) wave.appendChild(el('i'));
      screen.appendChild(wave);
    }]);
    // 5.0s: the waveform becomes the message and the scenario runs on.
    steps.push([5000, function () {
      var screen = body.querySelector('.thread-screen');
      if (!screen) return;
      screen.replaceChildren();
      var tl = new Timeline();
      heroTimeline.child = tl;
      playMessages(tl, screen, HERO_SCENARIO, 0, '현진');
    }]);
    heroTimeline.run(steps);
    void sbar;
  }
  var originalCancel = heroTimeline.cancel;
  heroTimeline.cancel = function () { originalCancel.call(this); if (this.child) { this.child.cancel(); this.child = null; } };

  if (stage && !REDUCED) {
    stage.classList.add('mount');
    var demoCta = document.getElementById('demo-cta');
    if (demoCta) demoCta.addEventListener('click', function (event) {
      event.preventDefault();
      hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(playHero, 400);
    });
    observe(hero, function () {
      startLeftPhone();
      rotateApprovals();
      if (!heroPlayed) playHero();
    }, function () { stopApprovals(); }, 0.3);
    // Scroll 0 → 300px: the side phones spread outward and settle to full opacity.
    var ticking = false;
    function spread() {
      var p = Math.max(0, Math.min(1, window.scrollY / 300));
      if (phones[0]) { phones[0].style.transform = 'translateX(' + (-24 * p) + 'px) scale(0.92)'; phones[0].style.opacity = String(0.7 + 0.3 * p); }
      if (phones[2]) { phones[2].style.transform = 'translateX(' + (24 * p) + 'px) scale(0.92)'; phones[2].style.opacity = String(0.7 + 0.3 * p); }
      ticking = false;
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(spread); } }, { passive: true });
    spread();
  }

  // ---- Features: four nine-second loops ----------------------------------------
  function loop(card, build, restore) {
    if (REDUCED) return;
    var timeline = new Timeline(), running = false, timer = null;
    function cycle() {
      card.classList.remove('reset');
      card.classList.add('play');
      var length = build(timeline);
      timer = setTimeout(function () {
        card.classList.add('reset');
        setTimeout(function () { if (running) cycle(); }, 600);
      }, Math.max(0, length - 600));
    }
    observe(card, function () { if (running) return; running = true; cycle(); }, function () {
      if (!running) return;
      running = false; timeline.cancel(); clearTimeout(timer);
      card.classList.remove('reset'); card.classList.remove('play');
      if (restore) restore();
    });
  }
  var modelsCard = document.querySelector('[data-feature="models"]');
  if (modelsCard) loop(modelsCard, function (tl) {
    var chips = modelsCard.querySelectorAll('.mchip');
    var now = modelsCard.querySelector('[data-role="model-now"]');
    var save = modelsCard.querySelector('.model-save');
    var saving = modelsCard.querySelector('[data-role="model-saving"]');
    var steps = [];
    save.classList.remove('show');
    MODEL_LIST.forEach(function (name, i) {
      steps.push([i * 1800, function () {
        Array.prototype.forEach.call(chips, function (chip, j) { chip.classList.toggle('on', j === i); });
        crossfade(now, name);
      }]);
    });
    steps.push([7200, function () {
      save.classList.add('show');
      var ref = document.querySelector('.plan[data-plan="' + saving.getAttribute('data-plan-ref') + '"]');
      if (!ref) return;
      var from = priceOf(ref, 'included'), to = priceOf(ref, 'connected');
      // No catalog yet means no figure to roll. The animation is decoration;
      // inventing a number to decorate with is not.
      if (from === null || to === null) { saving.textContent = ''; return; }
      saving.textContent = money(from) + ' → ' + money(from);
      setTimeout(function () { saving.textContent = money(from) + ' → ' + money(to); saving.classList.add('rolled'); }, 250);
      setTimeout(function () { saving.classList.remove('rolled'); }, 900);
    }]);
    tl.run(steps);
    return 9000;
  }, function () {
    Array.prototype.forEach.call(modelsCard.querySelectorAll('.mchip'), function (chip, j) { chip.classList.toggle('on', j === 2); });
    modelsCard.querySelector('[data-role="model-now"]').textContent = 'Claude';
  });
  var serverCard = document.querySelector('[data-feature="server"]');
  if (serverCard) loop(serverCard, function (tl) {
    var old = serverCard.querySelector('.srv-old');
    var box = serverCard.querySelector('.srv-card');
    var bars = serverCard.querySelectorAll('.bar b');
    var badge = serverCard.querySelector('.srv-head .badge');
    old.classList.remove('gone'); box.classList.remove('show'); badge.classList.remove('show');
    Array.prototype.forEach.call(bars, function (b) { b.style.width = '0%'; });
    tl.run([
      [600, function () { old.classList.add('gone'); }],
      [1200, function () { box.classList.add('show'); }],
      [1600, function () { bars[0].style.width = '100%'; }],
      [2500, function () { bars[1].style.width = '100%'; }],
      [3400, function () { bars[2].style.width = '100%'; }],
      [4400, function () { badge.classList.add('show'); }]
    ]);
    return 9000;
  }, function () {
    serverCard.querySelector('.srv-old').classList.remove('gone');
    Array.prototype.forEach.call(serverCard.querySelectorAll('.bar b'), function (b) { b.style.width = '100%'; });
  });
  var isoCard = document.querySelector('[data-feature="isolation"]');
  if (isoCard) loop(isoCard, function (tl) {
    var art = isoCard.querySelector('.iso-art');
    art.classList.remove('draw', 'items', 'guard');
    tl.run([
      [50, function () { art.classList.add('draw'); }],
      [1400, function () { art.classList.add('items'); }],
      [3000, function () { art.classList.add('guard'); }],
      [6000, function () { art.classList.remove('guard'); }],
      [6100, function () { art.classList.add('guard'); }]
    ]);
    return 9000;
  }, function () { isoCard.querySelector('.iso-art').classList.remove('draw', 'items', 'guard'); });
  var routineCardEl = document.querySelector('[data-feature="routine"]');
  if (routineCardEl) loop(routineCardEl, function (tl) {
    var rows = routineCardEl.querySelectorAll('.ui-row');
    var result = routineCardEl.querySelector('.rt-result');
    var labels = [['결과 도착', 'done'], ['변동 없음', 'idle'], ['결과 도착', 'done']];
    var initial = [['결과 도착', 'done'], ['지켜보는 중', 'work'], ['예정', 'idle']];
    var steps = [];
    result.classList.remove('show');
    Array.prototype.forEach.call(rows, function (row, i) { var b = row.querySelector('.badge'); b.className = 'badge ' + initial[i][1]; b.textContent = initial[i][0]; });
    [0, 1, 2].forEach(function (i) {
      var at = 600 + i * 2700;
      steps.push([at, function () { var b = rows[i].querySelector('.badge'); b.className = 'badge work spin-badge'; b.innerHTML = '<span class="spin" aria-hidden="true"></span>실행 중'; }]);
      steps.push([at + 1800, function () { var b = rows[i].querySelector('.badge'); b.className = 'badge ' + labels[i][1]; b.innerHTML = (labels[i][1] === 'done' ? CHECK : '') + labels[i][0]; if (i === 0) result.classList.add('show'); }]);
    });
    tl.run(steps);
    return 9000;
  }, function () {
    var rows = routineCardEl.querySelectorAll('.ui-row');
    [['결과 도착', 'done'], ['지켜보는 중', 'work'], ['예정', 'idle']].forEach(function (pair, i) { var b = rows[i].querySelector('.badge'); b.className = 'badge ' + pair[1]; b.textContent = pair[0]; });
  });

  // Shared with /use/<slug>/ (use.js): the same renderer draws the story phone.
  window.SidekickDemo = {
    el: el, observe: observe, Timeline: Timeline, playMessages: playMessages, renderFinished: renderFinished,
    bubble: bubble, progressCard: progressCard, approvalCard: approvalCard, resultCard: resultCard, routineCard: routineCard, noteLine: noteLine,
    CHECK: CHECK, REDUCED: REDUCED
  };
})();
