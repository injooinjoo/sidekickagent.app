/* Static Web SDK owner: explicit consent, verified account, strict metadata. */
(function () {
  'use strict';
  const config = window.SidekickAnalyticsConfig || {};
  const contract = window.SidekickAnalytics;
  if (!contract) return;
  const key = 'sidekick:analytics:consent:v1';
  let consent = { enabled: false, replay: false }, known = null, revision = 0;
  let sdkLoad, manifestLoad, facade = contract.createAnalytics();
  let sourceRelease = null;
  const stored = name => { try { return localStorage.getItem(name); } catch (_) { return null; } };
  const surfaces = [['/account', 'web_account'], ['/membership', 'web_checkout'],
    ['/ai', 'web_oauth'], ['/privacy', 'web_settings'], ['/terms', 'web_settings']];
  const surface = (surfaces.find(([path]) => location.pathname.startsWith(path)) || ['', 'web_marketing'])[1];
  const safePage = () => !location.search && !location.hash;
  const permittedHost = () => Array.isArray(config.allowedHosts) && config.allowedHosts.includes(location.hostname);
  try {
      const saved = JSON.parse(stored(key));
    consent = { enabled: saved?.enabled === true, replay: saved?.enabled === true && saved?.replay === true };
  } catch (_) {}
  function saveLocal(value) {
    consent = { enabled: value.enabled === true, replay: value.enabled === true && value.replay === true };
    try { localStorage.setItem(key, JSON.stringify(consent)); } catch (_) {}
    window.dispatchEvent(new Event('sidekick-analytics-preference'));
  }
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
    await stop();
    if (!consent.enabled || config.enabled !== true || !permittedHost() || !safePage()) return;
    try {
      await Promise.all([script(), release()]);
      if (version !== revision || !consent.enabled || !safePage()) return;
      const replay = consent.replay && config.replayEnabled === true;
      facade = contract.createAnalytics({ key: config.key, host: config.host,
        environment: config.environment, enabled: true, consent: true,
        context: { surface, ...(sourceRelease ? { web_release: sourceRelease } : {}) },
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
              if (!consent.enabled || version !== revision || !safePage()) return null;
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
        saved = await request('/analytics/preference', { method: 'PUT', body: JSON.stringify(consent) });
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
        const saved = await request('/analytics/preference', { method: 'PUT', body: JSON.stringify(consent) });
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
      const status = settings.querySelector('[role="status"]');
      const refresh = () => { usage.checked = consent.enabled; replay.checked = consent.replay; replay.disabled = !consent.enabled; };
      refresh();
      window.addEventListener('sidekick-analytics-preference', refresh);
      usage.addEventListener('change', () => { replay.disabled = !usage.checked; if (!usage.checked) replay.checked = false; });
      settings.addEventListener('submit', async event => {
        event.preventDefault(); usage.disabled = true; replay.disabled = true;
        status.textContent = '저장하고 있어요.';
        try {
          await setConsent({ enabled: usage.checked, replay: replay.checked }, window.SidekickAuth?.api);
          status.textContent = '선택을 저장했어요.';
        } catch (_) { status.textContent = '저장하지 못했어요. 이 브라우저의 수집은 멈췄어요. 다시 시도해주세요.'; }
        finally { usage.disabled = false; refresh(); }
      });
    }
    if (!stored(key)) {
      const panel = document.createElement('aside'); panel.className = 'sidekick-consent';
      panel.setAttribute('aria-label','서비스 개선 참여');
      const copy = document.createElement('p'); copy.textContent = '사용 흐름과 오류 종류를 보내 서비스 개선에 참여할 수 있어요. 입력 내용과 대화는 보내지 않아요.';
      const allow = document.createElement('button'); allow.textContent = '사용 흐름 허용';
      const decline = document.createElement('button'); decline.textContent = '허용하지 않기';
      const privacy = document.createElement('a'); privacy.href = '/privacy/'; privacy.textContent = '개인정보 안내';
      allow.onclick = () => { setConsent({ enabled: true, replay: false }).catch(() => {}); panel.remove(); };
      decline.onclick = () => { setConsent({ enabled: false, replay: false }).catch(() => {}); panel.remove(); };
      panel.append(copy,allow,decline,privacy); document.body.append(panel);
    }
    initialize().catch(() => {});
  }
  window.addEventListener('error', () => facade.captureError({ name: 'Error' }));
  window.addEventListener('unhandledrejection', () => facade.captureError({ name: 'Error' }));
  // Deferred page owners first adopt auth callbacks and public selections.
  // An interactive document can still be executing those deferred scripts.
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
