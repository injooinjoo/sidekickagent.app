/* The approved day story reuses the existing sample renderer and goal data. */
(function () {
  'use strict';
  var day = document.getElementById('day'), D = window.SidekickDemo;
  if (!day || !D) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)'), wide = matchMedia('(min-width: 701px)');
  Promise.all([fetch('/day.json').then(function (r) { if (!r.ok) throw Error('day'); return r.json(); }), fetch('/roles.json').then(function (r) { if (!r.ok) throw Error('roles'); return r.json(); })]).then(function (values) {
    var stories = values[0], roles = values[1].roles, links = Array.from(day.querySelectorAll('#goals [data-goal]'));
    // A missing or unreviewed story leaves the original, usable goal links and demo in place.
    if (!roles.every(function (role) { var item = stories[role.slug]; return item && item.scenes.length === 3 && item.scenes.every(function (s) { return !s.draft; }); })) return;
    var parameter = new URLSearchParams(location.search).get('goal');
    var goal = roles.some(function (r) { return r.slug === parameter; }) ? parameter : roles[0].slug;
    var scene = 0, queued = false, articles = [], story = day.querySelector('.day-story');
    function sticky() { return wide.matches && !reduced.matches; }
    function sample(screen, role, index) {
      var types = index === 0 ? ['team','ai','me'] : index === 1 ? ['progress','approval','routine'] : ['result','note'];
      role.messages.filter(function (m) { return types.includes(m.type); }).forEach(function (msg) {
        var node;
        if (msg.type === 'approval') node = D.approvalCard(msg);
        else if (msg.type === 'routine') { node = D.routineCard(msg); node.querySelector('.badge').textContent = '확인할 내용'; }
        else { var box = D.el('div'); D.renderFinished(box, [msg], role); node = box.firstChild; }
        screen.appendChild(node);
      });
    }
    function replay(article) {
      if (!reduced.matches && article && article.animate) article.querySelector('.day-demo').animate([{opacity:.45,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:400,easing:'cubic-bezier(.22,1,.36,1)'});
    }
    function selectScene(index) {
      scene = index; day.dataset.scene = String(index);
      articles.forEach(function (article, i) { article.classList.toggle('is-active', i === index); });
      day.querySelectorAll('[data-day-scene]').forEach(function (button, i) { if (i === index) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current'); });
      var item = stories[goal].scenes[index];
      document.getElementById('day-live').textContent = stories[goal].label + ', ' + item.time + '. ' + item.title;
    }
    function render() {
      var role = roles.find(function (r) { return r.slug === goal; }), content = stories[goal], scenes = day.querySelector('.day-scenes');
      scenes.replaceChildren(); articles = [];
      content.scenes.forEach(function (item, index) {
        var article = D.el('article','day-scene'), copy = D.el('div','day-copy');
        article.id = 'day-scene-' + index;
        copy.appendChild(D.el('p','day-kicker',item.time + ' · ' + content.label));
        copy.appendChild(D.el('h3','',item.title)); copy.appendChild(D.el('p','day-body',item.body));
        var panel = D.el('div','day-demo'), screen = D.el('div','role-phone day-sample'); screen.setAttribute('aria-hidden','true');
        var head = D.el('div','thread-head'); D.threadHead(head,role); screen.appendChild(head);
        sample(screen,role,index); panel.appendChild(screen);
        var actions = D.el('div','day-actions'), go = D.el('a','goal-chip','이 일로 시작하기 ↗');
        go.href = content.href; go.dataset.goal = goal; go.dataset.source = 'landing_day';
        var again = D.el('button','goal-chip','다시 보기'); again.type = 'button'; again.addEventListener('click',function () { replay(article); });
        actions.append(go,again); panel.appendChild(actions); article.append(copy,panel); scenes.appendChild(article); articles.push(article);
      });
      links.forEach(function (link) { link.setAttribute('aria-pressed',String(link.dataset.goal === goal)); });
      selectScene(scene);
    }
    function update() {
      queued = false;
      if (!sticky()) { day.style.setProperty('--p','0'); return; }
      var rect = day.getBoundingClientRect(), range = Math.max(1,rect.height - innerHeight);
      var progress = Math.max(0,Math.min(1,-rect.top / range));
      day.style.setProperty('--p',progress.toFixed(4));
      var index = Math.min(2,Math.floor(progress * 3)); if (index !== scene) selectScene(index);
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    function scrollToScene(index) {
      if (!sticky()) { articles[index].scrollIntoView({behavior:'auto',block:'start'}); return; }
      var rect = day.getBoundingClientRect();
      window.scrollTo({top: scrollY + rect.top + (index ? (index + .02) / 3 * (rect.height - innerHeight) : 0),behavior:reduced.matches ? 'auto' : 'smooth'});
    }
    links.forEach(function (link) {
      link.setAttribute('role','button');
      link.addEventListener('keydown',function (event) { if (event.key === ' ') { event.preventDefault(); link.click(); } });
      link.addEventListener('click',function (event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); goal = link.dataset.goal; scene = 0; render();
        var url = new URL(location.href); url.searchParams.set('goal',goal);
        try { history.replaceState(null,'',url); } catch (_) {}
        scrollToScene(0);
      });
    });
    day.querySelectorAll('[data-day-scene]').forEach(function (button) { button.addEventListener('click',function () { scrollToScene(Number(button.dataset.dayScene)); }); });
    render(); story.hidden = false; day.querySelector('.day-overview').hidden = true; day.classList.add('day-enhanced');
    addEventListener('scroll',schedule,{passive:true}); addEventListener('resize',schedule);
    reduced.addEventListener('change',schedule); wide.addEventListener('change',schedule); schedule();
  }).catch(function () { /* Existing links and the interactive sample remain usable. */ });
})();
