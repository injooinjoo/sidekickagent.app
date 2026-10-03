/* /use/<slug>/ — the scroll story. The phone stays put (position: sticky) and
 * the step nearest the middle of the viewport decides which state of the same
 * run it shows: the team forming, the one question, the first task, then the
 * confirmation and the report. Screens are built from the same scenario
 * renderer as the landing (window.SidekickDemo, from /landing.js). */
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

  function only(types) {
    return role.messages.filter(function (msg) { return types.indexOf(msg.type) !== -1; });
  }
  // Step 1 is the project screen the team appears on; 2-4 are the lead's thread.
  var SCENES = {
    1: { head: false, messages: only(['team']) },
    2: { head: true, messages: only(['ai', 'me']) },
    3: { head: true, messages: only(['routine', 'progress']) },
    4: { head: true, messages: only(['approval', 'result', 'note']) }
  };

  function projectHeader() {
    var head = el('div', 'scr-head');
    head.appendChild(el('span', 'scr-title', role.goal));
    head.appendChild(el('span', 'badge work', '새 프로젝트'));
    return head;
  }
  function show(step) {
    if (step === current) return;
    current = step;
    timeline.cancel();
    var phone = screen.parentNode;
    var scene = SCENES[step] || SCENES[4];
    function swap() {
      screen.replaceChildren();
      var thread = el('div', 'thread-screen');
      if (scene.head) {
        var head = el('div', 'thread-head');
        demo.threadHead(head, role);
        screen.appendChild(head);
      } else {
        screen.appendChild(projectHeader());
      }
      screen.appendChild(thread);
      if (REDUCED) demo.renderFinished(thread, scene.messages, role);
      else demo.playMessages(timeline, thread, scene.messages, 250, role);
      phone.classList.remove('fade');
    }
    if (REDUCED) { swap(); return; }
    phone.classList.add('fade');
    setTimeout(swap, 280);
  }
  var items = Array.prototype.slice.call(steps.querySelectorAll('.story-step'));
  function pick() {
    var mid = window.innerHeight / 2, best = 1, bestDist = Infinity;
    items.forEach(function (item, i) {
      var rect = item.getBoundingClientRect();
      var dist = Math.abs(rect.top + rect.height / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i + 1; }
    });
    items.forEach(function (item, i) {
      var active = i + 1 === best;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    show(best);
  }
  var ticking = false;
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; (window.requestAnimationFrame || setTimeout)(function () { ticking = false; pick(); }); } }, { passive: true });
  window.addEventListener('resize', pick);
  pick();

  // Weekly grid: dots land one after another when the grid scrolls into view.
  // Each dot's place (data-i) becomes its --i delay here, through the CSSOM:
  // the page's CSP allows no style attribute (motion.css .week-dot).
  var week = document.getElementById('week-grid');
  if (week) {
    if (REDUCED) week.classList.add('in');
    else {
      Array.prototype.forEach.call(week.querySelectorAll('.week-dot[data-i]'), function (dot) {
        dot.style.setProperty('--i', dot.getAttribute('data-i'));
      });
      week.classList.add('js');
      demo.observe(week, function () { week.classList.add('in'); }, null, 0.4);
    }
  }
})();
