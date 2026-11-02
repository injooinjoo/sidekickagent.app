/* Static Web SDK owner: explicit consent, verified account, strict metadata.
   Two separate opt-ins share one panel: product analytics (PostHog, `enabled`) and ad measurement
   (GA4/Meta in the opaque /measurement/frame.html, `ads`, kept in this browser only). */
(function () {
  'use strict';
  const config = window.SidekickAnalyticsConfig || {};
  const contract = window.SidekickAnalytics;
  if (!contract) return;
  const key = 'sidekick:analytics:consent:v1';
  let consent = { enabled: false, replay: false, ads: false }, known = null, revision = 0;
  let sdkLoad, manifestLoad, facade = contract.createAnalytics();
  let sourceRelease = null;
  const stored = name => { try { return localStorage.getItem(name); } catch (_) { return null; } };
  const surfaces = [['/account', 'web_account'], ['/membership', 'web_checkout'],
    ['/ai', 'web_oauth'], ['/privacy', 'web_settings'], ['/terms', 'web_settings']];
  const surface = (surfaces.find(([path]) => location.pathname.startsWith(path)) || ['', 'web_marketing'])[1];
  const safePage = () => {
    if (location.hash) return false;
    if (!location.search) return true;
    // A public, enumerated goal is navigation state, never the visitor's input. Each of the five
    // campaign keys may appear once; their values are filtered before anything is sent.
    const params = new URLSearchParams(location.search);
    const campaign = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
    if (campaign.some(name => params.getAll(name).length > 1)) return false;
    const rest = [...params.keys()].filter(name => !campaign.includes(name));
    if (!rest.length) return true;
    return location.pathname === '/' && rest.length === 1 && params.getAll('goal').length === 1
      && ['youtube','blog','instagram','store-cs','briefing','price-watch','real-estate','tax'].includes(params.get('goal'));
  };
  const permittedHost = () => Array.isArray(config.allowedHosts) && config.allowedHosts.includes(location.hostname);
  // Do Not Track, Global Privacy Control and automation block every collection, whatever was chosen.
  const blocked = () => navigator.webdriver === true || navigator.doNotTrack === '1' || window.doNotTrack === '1'
    || navigator.globalPrivacyControl === true;
  const session = { get: name => { try { return sessionStorage.getItem(name); } catch (_) { return null; } },
    set: (name, value) => { try { sessionStorage.setItem(name, value); } catch (_) {} },
    drop: name => { try { sessionStorage.removeItem(name); } catch (_) {} } };
  // Entry facts are read from structure only: this site's own page list, the referrer's host, and five utm values.
  const entryKey = 'sidekick:analytics:entry:v1', clientKey = 'sidekick:measurement:client:v1';
  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const page = (() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const label = parts.length === 1 && parts[0] === 'i' ? 'invite' : parts.join('/') || 'home';
    return contract.validValue('page', label) ? label : 'not_found';
  })();
  const deviceType = () => {
    try {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      return coarse ? (Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'tablet') : 'desktop';
    } catch (_) { return 'desktop'; }
  };
  const arrival = (() => {
    const record = { landing_page: page };
    let params; try { params = new URLSearchParams(location.search); } catch (_) { params = new URLSearchParams(); }
    for (const name of campaignKeys) {
      const value = (params.get(name) || '').trim().slice(0, 64);
      if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) record[name] = value;
    }
    let host = '';
    try { const from = new URL(document.referrer); if (/^https?:$/.test(from.protocol)) host = from.hostname.toLowerCase(); } catch (_) {}
    if (host && contract.validValue('referrer_host', host)) record.referrer_host = host;
    const internal = !!host && (host === location.hostname || (config.allowedHosts || []).includes(host));
    record.entry_type = campaignKeys.some(name => params.has(name)) ? 'campaign'
      : internal ? 'internal' : record.referrer_host ? 'referral' : 'direct';
    return record;
  })();
  const entryFields = ['landing_page', 'entry_type', 'referrer_host', ...campaignKeys];
  // The browser session's first consented page is its first touch; later pages carry it unchanged.
  function entry() {
    try {
      const saved = JSON.parse(session.get(entryKey));
      if (saved && typeof saved === 'object' && Object.keys(saved).every(name => entryFields.includes(name)
        && contract.validValue(name, saved[name])) && saved.landing_page && saved.entry_type) return saved;
    } catch (_) {}
    session.set(entryKey, JSON.stringify(arrival));
    return arrival;
  }
  const firstTouch = record => Object.fromEntries(Object.entries(record).map(([name, value]) => ['first_' + name, value]));
  try {
      const saved = JSON.parse(stored(key));
    consent = { enabled: saved?.enabled === true, replay: saved?.enabled === true && saved?.replay === true, ads: saved?.ads === true };
  } catch (_) {}
  function saveLocal(value) {
    consent = { enabled: value.enabled === true, replay: value.enabled === true && value.replay === true,
      ads: typeof value.ads === 'boolean' ? value.ads : consent.ads };
    try { localStorage.setItem(key, JSON.stringify(consent)); } catch (_) {}
    if (!consent.ads) session.drop(clientKey);
    if (!consent.enabled && !consent.ads) { session.drop(entryKey); session.drop(entryKey + ':posthog'); session.drop(entryKey + ':ads'); }
    window.dispatchEvent(new Event('sidekick-analytics-preference'));
  }
  // The server keeps the account's product-analytics choice only; ad measurement stays in this browser.
  const serverChoice = () => JSON.stringify({ enabled: consent.enabled, replay: consent.replay });
  // GA4 and Meta run only inside a sandboxed, opaque-origin frame: no access to this page's DOM, cookies or storage.
  // The page hands it a page label, a random per-session id, the first-touch entry and fixed CTA categories.
  let frame = null, frameReady = false, framePending = [];
  const adsAllowed = () => consent.ads && config.ads?.enabled === true && location.protocol === 'https:'
    && permittedHost() && safePage() && !blocked();
  function removeFrame() { frame?.remove(); frame = null; frameReady = false; framePending = []; }
  function syncAds() {
    if (!adsAllowed()) { removeFrame(); return; }
    if (frame || !document.body) return;
    const record = entry();
    let client = session.get(clientKey);
    if (!contract.validValue('anonymous_id', client)) { client = crypto.randomUUID(); session.set(clientKey, client); }
    const first = session.get(entryKey + ':ads') !== 'sent';
    const current = frame = document.createElement('iframe');
    current.hidden = true; current.title = '방문·광고 측정'; current.setAttribute('sandbox', 'allow-scripts');
    current.referrerPolicy = 'no-referrer'; current.src = '/measurement/frame.html';
    current.addEventListener('load', () => {
      if (frame !== current || !adsAllowed()) return;
      current.contentWindow.postMessage({ kind: 'sidekick-measure-init', client, page, first, entry: record }, '*');
      session.set(entryKey + ':ads', 'sent');
    });
    document.body.append(current);
  }
  function adsEvent(data) {
    if (!adsAllowed()) { removeFrame(); return; }
    if (frameReady) frame.contentWindow.postMessage(data, '*');
    else if (frame && framePending.length < 10) framePending.push(data);
  }
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.kind !== 'sidekick-measure-ready') return;
    frameReady = true;
    for (const data of framePending.splice(0)) adsEvent(data);
  });
  // A fixed set of CTA categories, read from the element's structure, never from its text or address.
  function ctaTarget(element) {
    const el = element?.closest?.('a[href],button');
    if (!el) return null;
    if (el.matches('[data-platform="ios"]')) return 'app_store';
    if (el.matches('[data-platform="android"]')) return 'play_store';
    if (el.id === 'account-pill') return el.classList.contains('is-signed-in') ? null : 'login';
    if (el.matches('[data-login-option]')) return 'signup';
    if (el.id === 'open-app') return 'invite_accept';
    if (el.matches('[data-buy]')) return 'membership';
    if (el.tagName !== 'A') return null;
    let url; try { url = new URL(el.getAttribute('href'), location.href); } catch (_) { return null; }
    if (url.protocol === 'mailto:') return 'contact';
    if (url.hostname === 'apps.apple.com') return 'app_store';
    if (url.hostname === 'play.google.com') return 'play_store';
    if (url.origin !== location.origin) return null;
    if (url.hash.startsWith('#download')) return 'download';
    return { '/membership/': 'membership', '/support/': 'contact', '/login/': 'login' }[url.pathname] || null;
  }
  let pageSent = false;
  function script() {
    if (!sdkLoad) sdkLoad = new Promise((resolve, reject) => {
      if (window.posthog?.init) { resolve(); return; }
      const tag = document.createElement('script');
      tag.src = 'https://us-assets.i.posthog.com/static/array.js';
      tag.async = true; tag.onload = resolve; tag.onerror = reject;
      document.head.append(tag);
    });
    return sdkLoad;
  }
  function release() {
    if (!manifestLoad) manifestLoad = fetch('/publish-manifest.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (/^[a-f0-9]{40}$/.test(value?.source_sha || '')) sourceRelease = value.source_sha; })
      .catch(() => {});
    return manifestLoad;
  }
  async function stop() {
    const old = facade; facade = contract.createAnalytics();
    await old.dispose();
  }
  async function initialize() {
    const version = ++revision;
    syncAds();
    await stop();
    if (!consent.enabled || config.enabled !== true || !permittedHost() || !safePage() || blocked()) return;
    try {
      await Promise.all([script(), release()]);
      if (version !== revision || !consent.enabled || !safePage()) return;
      const replay = consent.replay && config.replayEnabled === true;
      const record = entry();
      facade = contract.createAnalytics({ key: config.key, host: config.host,
        environment: config.environment, enabled: true, consent: true,
        context: { surface, device_type: deviceType(), ...firstTouch(record),
          ...(sourceRelease ? { web_release: sourceRelease } : {}) },
        randomUUID: () => crypto.randomUUID(),
        sdkFactory: ({ key: token, host, beforeSend }) => {
          const options = { api_host: host, autocapture: false, capture_pageview: false,
            capture_pageleave: false, capture_dead_clicks: false, capture_performance: false,
            capture_exceptions: false, disable_session_recording: !replay,
            enable_recording_console_log: false, disable_geoip: true,
            save_referrer: false, save_campaign_params: false, request_batching: false,
            person_profiles: 'identified_only', persistence_name: 'sidekick_analytics',
            property_denylist: ['$current_url','$initial_current_url','$referrer','$initial_referrer',
              '$pathname','$initial_pathname','$host','$initial_host','$initial_referring_domain'],
            session_recording: { maskAllInputs: true, maskTextSelector: '*', maskAllElementAttributes: true,
              blockSelector: 'a,img,video,audio,canvas,iframe,svg,[data-private]',
              recordCanvas: false, recordCrossOriginIframes: false,
              capturePerformance: { network_timing: false, web_vitals: false },
              recordHeaders: false, recordBody: false, sampleRate: config.replaySampleRate },
            before_send: event => {
              if (!consent.enabled || version !== revision || !safePage() || blocked()) return null;
              if (event?.event === '$snapshot' && replay) {
                const raw = event.properties || {}, id = raw.distinct_id;
                if (!contract.canonicalId(id) && !contract.validValue('anonymous_id', id)) return null;
                const allowed = ['$snapshot_data','$snapshot_bytes','$session_id','$window_id','distinct_id','$lib','$lib_version'];
                event.properties = Object.fromEntries(allowed.filter(name => raw[name] !== undefined).map(name => [name,raw[name]]));
                if (raw.token === config.key) event.properties.token = config.key; // public ingest envelope
                Object.assign(event.properties, { environment: config.environment, surface,
                  ...(sourceRelease ? { web_release: sourceRelease } : {}) });
                return event;
              }
              return beforeSend(event);
            } };
          // A disposed instance has stopped its recorder and persistence.
          // A fresh optional instance avoids reviving a stale recorder after
          // consent/account changes; the old before_send generation stays shut.
          const client = window.posthog.init(token, options, `sidekick_analytics_${version}`);
          client.opt_in_capturing();
          return client;
        } });
      if (known) facade.identify(known);
      if (session.get(entryKey + ':posthog') !== 'sent' && facade.track('site_entered', record)) session.set(entryKey + ':posthog', 'sent');
      if (!pageSent && facade.track('page_viewed', { page })) pageSent = true;
      if (surface === 'web_marketing') facade.track('landing_viewed', {}, { onceKey: 'landing_viewed' });
      if (surface === 'web_checkout') facade.track('subscription_viewed', {}, { onceKey: 'subscription_viewed' });
    } catch (_) { facade = contract.createAnalytics(); }
  }
  async function accountKnown(user, request) {
    const id = user?.analytics_user_id;
    if (!contract.canonicalId(id)) { known = null; await stop(); return; }
    const changed = known !== id; known = id;
    const version = revision;
    try {
      let saved = await request('/analytics/preference', { method: 'GET' });
      if (known !== id || version !== revision) return;
      // Explicit anonymous choice becomes this verified account's choice once.
      const priorReplay = consent.replay;
      if (changed && consent.enabled && stored(key + ':pending') === 'true') {
        saved = await request('/analytics/preference', { method: 'PUT', body: serverChoice() });
        localStorage.removeItem(key + ':pending');
      }
      if (known !== id || version !== revision) return;
      if (stored(key + ':denied') === 'true') saved = { enabled: false, replay: false };
      saveLocal(saved);
      if (facade.enabled && consent.enabled && priorReplay === consent.replay) facade.identify(id);
      else await initialize();
    } catch (_) { if (known === id && version === revision) await stop(); }
  }
  async function setConsent(value, request) {
    const owner = known;
    // A failed server withdrawal must remain denied after a browser restart.
    try { localStorage.setItem(key + ':denied', 'true'); } catch (_) {}
    saveLocal(value);
    if (!consent.enabled) { ++revision; await stop(); }
    const version = revision;
    if (known && request) {
      try {
        const saved = await request('/analytics/preference', { method: 'PUT', body: serverChoice() });
        if (known !== owner || revision !== version) return;
        saveLocal(saved);
        if (consent.enabled) localStorage.removeItem(key + ':denied');
      }
      catch (error) { if (known === owner && revision === version) { saveLocal({ enabled: false, replay: false }); await stop(); } throw error; }
    } else {
      try { localStorage.setItem(key + ':pending', 'true'); } catch (_) {}
      if (consent.enabled) { try { localStorage.removeItem(key + ':denied'); } catch (_) {} }
    }
    await initialize();
  }
  window.SidekickWebAnalytics = {
    track: (...args) => facade.track(...args), captureError: (...args) => facade.captureError(...args),
    startTransition: (...args) => facade.startTransition(...args),
    adoptTransition: (...args) => facade.adoptTransition(...args),
    completeTransition: (...args) => facade.completeTransition(...args),
    getFeatureFlag: (...args) => facade.getFeatureFlag(...args), accountKnown, setConsent,
    preference: () => ({ ...consent }),
    logout: (completed = true) => { if (completed) facade.track('logout_completed'); known = null; saveLocal({ enabled: false, replay: false }); ++revision; return stop(); },
  };
  function mount() {
    const settings = document.querySelector('[data-analytics-preference]');
    if (settings) {
      const usage = settings.querySelector('[name="analytics-enabled"]');
      const replay = settings.querySelector('[name="analytics-replay"]');
      const ads = settings.querySelector('[name="analytics-ads"]');
      const status = settings.querySelector('[role="status"]');
      const refresh = () => { usage.checked = consent.enabled; replay.checked = consent.replay; replay.disabled = !consent.enabled;
        if (ads) ads.checked = consent.ads; };
      refresh();
      window.addEventListener('sidekick-analytics-preference', refresh);
      usage.addEventListener('change', () => { replay.disabled = !usage.checked; if (!usage.checked) replay.checked = false; });
      settings.addEventListener('submit', async event => {
        event.preventDefault(); usage.disabled = true; replay.disabled = true;
        status.textContent = '저장하고 있어요.';
        try {
          await setConsent({ enabled: usage.checked, replay: replay.checked, ...(ads ? { ads: ads.checked } : {}) },
            window.SidekickAuth?.api);
          status.textContent = '선택을 저장했어요.';
        } catch (_) { status.textContent = '저장하지 못했어요. 이 브라우저의 수집은 멈췄어요. 다시 시도해주세요.'; }
        finally { usage.disabled = false; refresh(); }
      });
    }
    if (!stored(key)) {
      // One panel, two separate choices, both off until the visitor turns one on.
      const panel = document.createElement('aside'); panel.className = 'sidekick-consent';
      panel.setAttribute('aria-label','서비스 개선과 방문 측정');
      const copy = document.createElement('p'); copy.textContent = '허용한 항목만 보내요. 입력 내용·대화·계정·연락처·결제 정보는 보내지 않아요.';
      const toggle = (name, text) => {
        const label = document.createElement('label'); const box = document.createElement('input');
        box.type = 'checkbox'; box.name = name; label.append(box, ' ' + text); return [label, box];
      };
      const [usageLabel, usage] = toggle('consent-usage', '사용 흐름·오류 종류 (PostHog)');
      const [adsLabel, ads] = toggle('consent-ads', '방문·광고 측정 (Google Analytics·Meta)');
      const all = document.createElement('button'); all.textContent = '모두 허용';
      const save = document.createElement('button'); save.textContent = '선택 저장';
      const decline = document.createElement('button'); decline.textContent = '허용하지 않기';
      const privacy = document.createElement('a'); privacy.href = '/privacy/'; privacy.textContent = '개인정보 안내';
      const choose = value => { setConsent({ enabled: value.enabled, replay: false, ads: value.ads }).catch(() => {}); panel.remove(); };
      all.onclick = () => choose({ enabled: true, ads: true });
      save.onclick = () => choose({ enabled: usage.checked, ads: ads.checked });
      decline.onclick = () => choose({ enabled: false, ads: false });
      panel.append(copy, usageLabel, adsLabel, all, save, decline, privacy); document.body.append(panel);
    }
    initialize().catch(() => {});
  }
  document.addEventListener('click', event => {
    const target = ctaTarget(event.target);
    if (!target) return;
    facade.track('cta_clicked', { cta_target: target, page });
    adsEvent({ kind: 'sidekick-measure-cta', target });
  }, true);
  // A choice made in another tab applies here too: revoking there removes this tab's frame and stops PostHog.
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    let saved = null; try { saved = JSON.parse(event.newValue); } catch (_) {}
    consent = { enabled: saved?.enabled === true, replay: saved?.enabled === true && saved?.replay === true, ads: saved?.ads === true };
    initialize().catch(() => {});
  });
  window.addEventListener('error', () => facade.captureError({ name: 'Error' }));
  window.addEventListener('unhandledrejection', () => facade.captureError({ name: 'Error' }));
  // Deferred page owners first adopt auth callbacks and public selections.
  // An interactive document can still be executing those deferred scripts.
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
