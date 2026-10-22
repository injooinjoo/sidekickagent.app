(function () {
  'use strict';
  var motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window)) return;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('#hero h1, .section-h, .band-line').forEach(function (el) {
    if (el.dataset.split) return;
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [], i = 0;
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { fragment.append(part); return; }
        var span = document.createElement('span');
        span.className = 'w'; span.setAttribute('aria-hidden', 'true');
        span.style.setProperty('--i', i++); span.textContent = part; fragment.append(span);
      });
      node.replaceWith(fragment);
    });
    el.dataset.split = '1'; observer.observe(el);
  });
})();
