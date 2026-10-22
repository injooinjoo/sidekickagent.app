/* Dismiss only this notice; no input or conversation is stored. */
(function () {
  'use strict';
  var toast = document.getElementById('availability-toast');
  if (!toast) return;
  var dismissed = false;
  try { dismissed = localStorage.getItem('sidekick-release-notice-dismissed') === '1'; } catch (_) {}
  toast.hidden = dismissed;
  document.getElementById('availability-close').addEventListener('click', function () {
    toast.hidden = true;
    try { localStorage.setItem('sidekick-release-notice-dismissed', '1'); } catch (_) {}
  });
  var agent = navigator.userAgent || '';
  if (/Android/i.test(agent)) document.documentElement.dataset.platform = 'android';
  else if (/iPad|iPhone|iPod/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) document.documentElement.dataset.platform = 'ios';
})();
