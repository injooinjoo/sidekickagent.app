/* /use/<slug>/ — the scroll story. The phone stays put (position: sticky) and
 * the step that is nearest the middle of the viewport decides what it shows.
 * Screens are built from the same scenario renderer as the landing
 * (window.SidekickDemo, from /landing.js). */
(function () {
  'use strict';
  var demo = window.SidekickDemo;
  var data = document.getElementById('use-scenario');
  var screen = document.getElementById('story-screen');
  var steps = document.getElementById('story-steps');
  if (!demo || !data || !screen || !steps) return;
  var role = JSON.parse(data.textContent);
  var el = demo.el, REDUCED = demo.REDUCED;
  var timeline = new demo.Timeline();
  var current = 0;
  var MODEL_LIST = ['DeepSeek', 'GPT', 'Claude', 'Grok', 'Gemini'];

  function header(title, right) {
    var head = el('div', 'scr-head');
    head.appendChild(el('span', 'scr-title', title));
    if (right) head.appendChild(right);
    return head;
  }
  function threadHead() {
    var head = el('div', 'thread-head');
    head.appendChild(el('span', 'avatar', role.name.charAt(0)));
    var who = el('div');
    who.appendChild(el('b', '', role.name));
    who.appendChild(el('small', '', role.role));
    head.appendChild(who);
    head.appendChild(el('span', 'badge work', role.status));
    return head;
  }
  function screenCreate() {
    var box = el('div');
    box.appendChild(header('직원 만들기', el('span', 'pill-free', '1/2')));
    var form = el('div', 'req');
    form.appendChild(el('div', 'who', '이름'));
    form.appendChild(el('h5', '', role.name));
    form.appendChild(el('div', 'who', '역할'));
    var list = el('div', 'roster emp');
    [role.role, '아침 브리핑 담당', '가격 감시 담당'].forEach(function (name, i) {
      if (i > 0 && name === role.role) return;
      var row = el('div');
      row.appendChild(el('span', 'dot ' + (i === 0 ? 'work' : '')));
      row.appendChild(el('b', '', name));
      row.appendChild(el('span', '', i === 0 ? '선택됨' : ''));
      list.appendChild(row);
    });
    form.appendChild(list);
    box.appendChild(form);
    var btn = el('div', 'btn-row');
    btn.appendChild(el('span', 'ink', '직원 만들기'));
    box.appendChild(btn);
    return box;
  }
  function screenConnect() {
    var box = el('div');
    box.appendChild(header('서비스 연결', el('span', 'badge done', '내 서버에 저장')));
    var ui = el('div', 'ui');
    role.connections.forEach(function (name, i) {
      var row = el('div', 'ui-row');
      row.appendChild(el('span', 'ui-ico', name.charAt(0)));
      var body = el('div');
      body.appendChild(el('b', '', name));
      body.appendChild(el('small', '', i === 0 ? '읽기 · 쓰기' : '읽기'));
      row.appendChild(body);
      row.appendChild(el('span', 'badge done', '연결됨'));
      ui.appendChild(row);
    });
    box.appendChild(ui);
    box.appendChild(el('p', 'note', '로그인 정보는 내 전용 서버 밖으로 나가지 않아요.'));
    return box;
  }
  function screenModel() {
    var box = el('div');
    box.appendChild(header('모델 선택', el('span', 'badge model', role.model)));
    var ui = el('div', 'ui models');
    var chips = el('div', 'model-chips');
    MODEL_LIST.forEach(function (name) { chips.appendChild(el('span', 'mchip' + (name === role.model ? ' on' : ''), name)); });
    ui.appendChild(chips);
    var now = el('div', 'model-now');
    now.appendChild(document.createTextNode('이번 작업: '));
    now.appendChild(el('b', '', role.model));
    now.appendChild(document.createTextNode('로 진행'));
    ui.appendChild(now);
    var save = el('div', 'model-save show');
    save.appendChild(el('span', 'badge done', '내 계정 연결'));
    save.appendChild(el('span', '', '멤버십이 더 저렴해져요'));
    ui.appendChild(save);
    box.appendChild(ui);
    return box;
  }
  function threadScreen(messages) {
    var box = el('div');
    box.appendChild(threadHead());
    var thread = el('div', 'thread-screen');
    box.appendChild(thread);
    return { box: box, thread: thread, messages: messages };
  }
  function show(step) {
    if (step === current) return;
    current = step;
    timeline.cancel();
    var phone = screen.parentNode;
    function swap() {
      screen.replaceChildren();
      if (step === 1) screen.appendChild(screenCreate());
      else if (step === 2) screen.appendChild(screenConnect());
      else if (step === 3) screen.appendChild(screenModel());
      else {
        var firstHalf = role.messages.filter(function (m) { return m.type === 'me' || m.type === 'ai' || m.type === 'progress' || m.type === 'routine'; });
        var secondHalf = role.messages.filter(function (m) { return m.type === 'approval' || m.type === 'result' || m.type === 'note'; });
        var view = threadScreen(step === 4 ? firstHalf : secondHalf);
        screen.appendChild(view.box);
        if (REDUCED) {
          var tl = new demo.Timeline();
          demo.playMessages(tl, view.thread, view.messages, 0, role.name);
          tl.cancel();
          demo.renderFinished(view.thread, view.messages, role.name);
        } else {
          demo.playMessages(timeline, view.thread, view.messages, 250, role.name);
        }
      }
      phone.classList.remove('fade');
    }
    if (REDUCED) { swap(); return; }
    phone.classList.add('fade');
    setTimeout(swap, 300);
  }
  var items = Array.prototype.slice.call(steps.querySelectorAll('.story-step'));
  function pick() {
    var mid = window.innerHeight / 2, best = 1, bestDist = Infinity;
    items.forEach(function (item, i) {
      var rect = item.getBoundingClientRect();
      var dist = Math.abs(rect.top + rect.height / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i + 1; }
    });
    items.forEach(function (item, i) { item.classList.toggle('active', i + 1 === best); });
    show(best);
  }
  var ticking = false;
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; (window.requestAnimationFrame || setTimeout)(function () { ticking = false; pick(); }); } }, { passive: true });
  window.addEventListener('resize', pick);
  pick();

  // Weekly grid: dots land one after another when the grid scrolls into view.
  var week = document.getElementById('week-grid');
  if (week) {
    if (REDUCED) week.classList.add('in');
    else { week.classList.add('js'); demo.observe(week, function () { week.classList.add('in'); }, null, 0.4); }
  }
})();
