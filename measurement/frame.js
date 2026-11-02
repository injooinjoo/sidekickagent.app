/* GA4 and Meta, opted into on the site's consent panel, inside an opaque-origin sandbox (sandbox="allow-scripts",
   no allow-same-origin): they cannot read the site's DOM, cookies or storage, and see only what the page posts here --
   a page label from the site's page list, a random per-session id, the first-touch entry and fixed CTA categories. */
(() => {
  'use strict';
  const config = window.SidekickAnalyticsConfig || {}, ads = config.ads || {}, contract = window.SidekickAnalytics;
  const hosts = Array.isArray(config.allowedHosts) ? config.allowedHosts : [];
  if (window.parent === window || !contract || ads.enabled !== true || !hosts.includes(location.hostname)
    || navigator.webdriver === true || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  const google = /^G-[A-Z0-9]{6,20}$/.test(ads.gaId || ''), meta = /^\d{10,20}$/.test(ads.pixelId || '');
  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  let page = null;
  const vendor = src => { const tag = document.createElement('script'); tag.async = true; tag.referrerPolicy = 'no-referrer'; tag.src = src; document.head.append(tag); };
  function cta(target) {
    if (google) window.gtag('event', 'cta_clicked', { send_to: ads.gaId, cta_target: target, page_label: page });
    if (meta) window.fbq('trackCustom', 'CtaClicked', { cta_target: target, page_label: page });
  }
  function start(data) {
    const entry = {};
    for (const [name, value] of Object.entries(data.entry || {})) {
      if (['landing_page', 'entry_type', 'referrer_host', ...campaignKeys].includes(name) && contract.validValue(name, value)
        && (!campaignKeys.includes(name) || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value))) entry[name] = value;
    }
    page = data.page;
    // The page address GA4 sees is rebuilt from the label and the filtered campaign values, never copied.
    const query = new URLSearchParams(campaignKeys.filter(name => entry[name]).map(name => [name, entry[name]])).toString();
    const pageLocation = 'https://' + hosts[0] + (page === 'home' ? '/' : '/' + page + '/') + (query ? '?' + query : '');
    const pageReferrer = data.first === true && entry.referrer_host ? 'https://' + entry.referrer_host + '/' : '';
    const labels = { page_label: page, ...(entry.landing_page ? { landing_page: entry.landing_page } : {}),
      ...(entry.entry_type ? { entry_type: entry.entry_type } : {}), ...(entry.referrer_host ? { referrer_host: entry.referrer_host } : {}) };
    if (google) {
      window.dataLayer = [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      window.gtag('js', new Date());
      window.gtag('config', ads.gaId, { send_page_view: false, client_id: data.client, client_storage: 'none',
        allow_google_signals: false, allow_ad_personalization_signals: false, page_location: pageLocation,
        page_referrer: pageReferrer, page_title: 'Sidekick' });
      window.gtag('event', 'page_view', { send_to: ads.gaId, page_location: pageLocation, page_referrer: pageReferrer, page_title: 'Sidekick', ...labels });
      vendor('https://www.googletagmanager.com/gtag/js?id=' + ads.gaId);
    }
    if (meta) {
      const fbq = window.fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
      window._fbq = fbq; fbq.queue = []; fbq.loaded = true; fbq.version = '2.0'; fbq.disablePushState = true;
      fbq('set', 'autoConfig', false, ads.pixelId);
      fbq('consent', 'grant');
      fbq('init', ads.pixelId);
      fbq('track', 'PageView', { ...labels, ...Object.fromEntries(campaignKeys.filter(name => entry[name]).map(name => [name, entry[name]])) });
      vendor('https://connect.facebook.net/en_US/fbevents.js');
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !hosts.some(host => event.origin === 'https://' + host)) return;
    const data = event.data || {};
    if (data.kind === 'sidekick-measure-init' && page === null) {
      if (!contract.validValue('page', data.page) || !contract.validValue('anonymous_id', data.client)) return;
      start(data);
      window.parent.postMessage({ kind: 'sidekick-measure-ready' }, event.origin);
    } else if (data.kind === 'sidekick-measure-cta' && page !== null && contract.validValue('cta_target', data.target)) cta(data.target);
  });
})();
