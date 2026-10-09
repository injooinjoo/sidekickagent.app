(function () {
  'use strict';

  // Page transitions (/styles.css, #1857): when this page is left or entered
  // mid-transition (a policy link opened from /connections/, then straight
  // back), Chromium rejects a transition promise the page never receives and
  // reports "AbortError: Transition was skipped" as an uncaught page error.
  // Only that rejection is marked handled; every other one reports as before.
  // This runs first and in every mode; only a host without window events
  // skips it.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', function (event) {
      var reason = event.reason;
      var error = reason instanceof Error || (typeof DOMException === 'function' && reason instanceof DOMException);
      if (error && reason.name === 'AbortError' && String(reason.message).indexOf('Transition was skipped') !== -1) {
        event.preventDefault();
      }
    });
  }

  // In-app navigation for policy pages and the approved service-connections
  // entry. It limits navigation, not authentication or service authority.
  // The app opens them with ?in_app=1; this tab then
  // remembers the mode (sessionStorage), so a policy link followed from here
  // stays in it too.
  //
  // In this mode the page is the policy and nothing that leads further into the
  // site: no header menu, no account slot or its menu (which reaches /ai/), no
  // wordmark link home, and no link to /, /membership/, /ai/, /account/ or /use/
  // anywhere. What stays: the policy text, links among the four policy pages,
  // mailto links, and references outside sidekickagent.app that the policy
  // itself cites. App Review reads a policy page opened from the app as part of
  // the app, and a web checkout or web AI-account login two taps away from it
  // is steering (owner decision 2026-09-29/30). The same goes for words: what a
  // page says about buying on the website (the web membership, its Toss
  // checkout, prices and refunds, and the store purchases beside them) is
  // marked data-web-sale in the page and leaves with the chrome (App Review
  // 3.1.1/3.1.3, 2026-10-09). Everything else in the policy stays word for word.
  //
  // The first file in <head> (only the hashed inline frame guard runs before
  // it), so the mode needs no inline script of its own and nothing in the
  // page's CSP. The class goes on <html> at once, before the body is
  // drawn, and /styles.css hides the header chrome from that first paint. Once
  // the page is parsed the chrome is taken out of the document, before
  // /auth.js (deferred) binds the account slot: with no slot, auth.js builds
  // neither its menu nor its sheet. Without in_app nothing here runs and the
  // page keeps its header and footer.
  var MODE_KEY = 'sidekick_in_app';
  var POLICY_PATHS = ['/privacy/', '/terms/', '/support/', '/delete-account/'];
  var SITE_HOSTS = ['sidekickagent.app', 'www.sidekickagent.app'];
  var CHROME = ['.nav', '.account-slot', '.account-menu', '[data-web-sale]'];

  function remembered() {
    try { return window.sessionStorage.getItem(MODE_KEY) === '1'; } catch (_) { return false; }
  }

  function remember() {
    try { window.sessionStorage.setItem(MODE_KEY, '1'); } catch (_) { /* the link parameter below still carries it */ }
  }

  var asked = false;
  try { asked = new URLSearchParams(window.location.search).get('in_app') === '1'; } catch (_) { asked = false; }
  if (asked) remember();
  if (!asked && !remembered()) return;
  document.documentElement.classList.add('in-app');

  function ownSite(url) {
    return url.host === window.location.host || SITE_HOSTS.indexOf(url.hostname) !== -1;
  }

  // A link that must not lead anywhere keeps its words but stops being a link.
  function unlink(link) {
    link.removeAttribute('href');
    link.removeAttribute('target');
  }

  function strip() {
    CHROME.forEach(function (selector) {
      Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (node) { node.remove(); });
    });
    Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) === '#') return;
      var url;
      try { url = new URL(href, window.location.href); } catch (_) { unlink(link); return; }
      if (url.protocol === 'mailto:') return;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') { unlink(link); return; }
      if (!ownSite(url)) return;
      if (POLICY_PATHS.indexOf(url.pathname) !== -1) {
        url.searchParams.set('in_app', '1');
        var target = url.pathname + url.search + url.hash;
        if (href !== target) link.setAttribute('href', target);
        return;
      }
      if (link.closest('.footer')) { link.remove(); return; }
      if (link.classList.contains('brand')) {
        var mark = link.querySelector('img');
        if (mark) mark.setAttribute('alt', '사이드킥');
      }
      unlink(link);
    });
  }

  function ready() {
    strip();
    // Account changes and service responses may add links after page startup.
    // Keep the same navigation rule on those actual DOM updates too.
    if (typeof window.MutationObserver === 'function') {
      new window.MutationObserver(strip).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href']
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
