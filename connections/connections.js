(() => {
  'use strict';
  // 연동 관리 (owner 2026-10-25): every connection of the signed-in account on one page, the same list the app shows.
  //
  // The server is the one source of truth, keyed to the account. The page reads GET /integrations ({version, items},
  // the controller's integrations contract). While that route answers 404 the page builds the same rows, in one place
  // (fallbackItems), from today's routes: /connections/catalog + /connections, and /ai-engine-providers +
  // /ai-engine-connections for the AI. Every change goes to the server and is shown only after a fresh read.
  //
  // Sync: a read on load, on window focus and when the tab becomes visible again; while the tab is visible,
  // GET /integrations/version every 15 seconds and a read when it changes (never in the fallback, which has no version).
  //
  // Nothing secret stays here: a key is typed into a password field, taken out of it at submit, and leaves once in a
  // request body. It is never put in an address, in storage, on the screen or in a log.
  const auth = window.SidekickAuth;
  const $ = (id) => document.getElementById(id);
  const inApp = () => document.documentElement.classList.contains('in-app');
  const ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const SERVICE_ID = /^[a-z][a-z0-9_]{0,119}$/;
  const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const CONNECT_PATH = /^\/connections\/([a-z][a-z0-9_]{0,119})\/(mcp|managed|oauth)\/connect$/;
  const POLL_MS = 15000;
  const WAIT_MS = 240000;
  const KINDS = ['ai_engine', 'service', 'external_account', 'browser_login', 'store', 'notification', 'claude_code', 'free_api'];
  // 무료 API 키 (owner 2026-10-26, FREE-5): the person's own free-tier keys. Sidekick uses them first, inside their free
  // quota. Connected through the managed key route; GET /integrations lists them as kind 'free_api' with
  // free_quota {limit, used, resets_at}. The same table as the app (apps/mobile/app/data/integrations.js FREE_API_SERVICES).
  const FREE_API_SERVICES = [
    { id: 'gemini_api', name: 'Gemini API', what: '글·이미지 이해' },
    { id: 'groq', name: 'Groq', what: '빠른 글 처리' },
    { id: 'cloudflare_ai', name: 'Cloudflare Workers AI', what: '글·이미지', accountId: true },
    { id: 'mistral', name: 'Mistral', what: '글 처리' },
    { id: 'google_cloud_tts', name: 'Google Cloud 음성 합성', what: '음성' },
    { id: 'azure_speech', name: 'Azure 음성', what: '음성·받아쓰기' }
  ];
  const FREE_API_IDS = FREE_API_SERVICES.map((service) => service.id);
  const METHODS = ['oauth', 'api_key', 'login', 'device_code', 'none'];
  const STATUSES = ['connected', 'expired', 'error', 'disconnected', 'unavailable'];
  const ACTIONS = ['connect', 'reconnect', 'change_key', 'test', 'disconnect'];
  // Kinds that are always connected on the phone: the person signs in inside the app's own browser.
  const DEVICE_KINDS = ['browser_login'];
  // Account sign-ins today's routes can start from the web: the provider's page opens in a new tab and this page
  // reads the result when the person comes back.
  const WEB_OAUTH = ['youtube', 'x', 'naver'];
  const GROUPS = [
    { id: 'ai', title: 'AI 엔진', line: '내 AI 계정으로 하는 일에는 사이드킥 크레딧이 들지 않아요.' },
    { id: 'free', title: '무료 API 키', line: '내 무료 API 키로 하는 일에는 사이드킥 크레딧이 들지 않아요. 무료 한도를 다 쓰면 정한 실행 방식대로 해요.' },
    { id: 'tools', title: '미디어·도구', line: '내 키로 연결한 서비스를 쓰는 일에는 사이드킥 크레딧이 들지 않아요.' },
    { id: 'accounts', title: '외부 계정', line: '내 계정으로 하는 일에는 사이드킥 크레딧이 들지 않아요.' },
    { id: 'app', title: '앱에서만 연결', line: '휴대폰에서 로그인해야 하는 연결이에요. 연결한 내 계정으로 하는 일에는 크레딧이 들지 않아요.' }
  ];
  const STATUS_COPY = { connected: '연결됨', expired: '만료', error: '오류', disconnected: '연결 안 됨', unavailable: '준비 중' };
  const ACTION_COPY = { connect: '연결', reconnect: '다시 연결', change_key: '키 바꾸기', test: '테스트', disconnect: '해제' };
  const APP_REASON = {
    browser_login: '앱 안의 브라우저에서 직접 로그인해야 해서 앱에서 연결해요.',
    claude_code: '이 기기에서 로그인 코드를 받아야 해서 앱에서 연결해요.',
    other: '지금은 앱에서 연결할 수 있어요. 여기서는 상태를 보고 해제할 수 있어요.'
  };
  // The Korean product names the app and /ai/ use; anything else keeps the server's name.
  const PROVIDER_NAMES = {
    openai: 'ChatGPT', anthropic: 'Claude', xai: 'Grok', gemini: 'Gemini', openrouter: 'OpenRouter',
    minimax: 'MiniMax', deepseek: 'DeepSeek', qwen: 'Qwen', kimi: 'Kimi', zai: 'Z.AI',
    copilot: 'GitHub Copilot', nous: 'Nous Portal', vertex: 'Google Vertex AI', bedrock: 'AWS Bedrock',
    'azure-foundry': 'Azure AI Foundry', '9router': '9Router', omniroute: 'OmniRoute'
  };
  const TEST_COPY = {
    healthy: '잘 연결돼 있어요.',
    changed: '연결은 되지만 쓸 수 있는 기능이 바뀌었어요. 목록을 새로 불러왔어요.',
    unauthorized: '연결이 만료됐어요. 다시 연결해 주세요.',
    unreachable: '지금은 서비스에 닿지 않아요. 잠시 뒤 다시 해 주세요.',
    not_connected: '연결돼 있지 않아요.'
  };
  const state = {
    generation: 0, read: 0, user: '', bearer: '', workspace: '', projects: [], items: [], aiNote: '',
    // 'integrations' once GET /integrations answered, 'fallback' once it answered 404 (kept for this page load).
    mode: '', version: '', pollOff: false, poll: null, reading: false, flow: null, busy: null, requests: new Set(),
    // The groups whose "more to connect" list is open: it stays as the person left it across reads.
    expanded: new Set()
  };

  function text(value, max = 160) {
    return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
  }
  function node(tag, copy, className) {
    const el = document.createElement(tag);
    if (copy) el.textContent = copy;
    if (className) el.className = className;
    return el;
  }
  function button(copy, handler, secondary = false) {
    const el = node('button', copy, `service-button${secondary ? ' secondary' : ''}`);
    el.type = 'button'; el.addEventListener('click', handler); return el;
  }
  function status(id, copy = '', error = false) {
    const target = $(id); if (!target) return;
    target.textContent = copy; target.classList.toggle('is-error', error);
  }
  // A key is typed only into a document that runs this site's own scripts. The sign-in sheet's security check is
  // another site's script; once it has run in this tab, the key field waits for a fresh page.
  function foreignScript() {
    return Array.from(document.querySelectorAll('script[src]')).some((tag) => {
      try { return new URL(tag.getAttribute('src'), window.location.href).origin !== window.location.origin; } catch (_) { return true; }
    });
  }
  function clearSecret() {
    if (state.flow && state.flow.input) state.flow.input.value = '';
    const input = $('connection-secret');
    if (input) input.value = '';
  }
  function closeFlow() {
    clearSecret();
    if (state.flow && state.flow.node) state.flow.node.remove();
    state.flow = null;
  }
  function stopPoll() {
    if (state.poll) clearTimeout(state.poll);
    state.poll = null;
  }
  function invalidate() {
    state.generation += 1; state.read += 1; state.reading = false; stopPoll();
    for (const controller of state.requests) controller.abort();
    state.requests.clear(); state.busy = null; closeFlow();
  }
  function clearCatalog() {
    state.items = []; state.version = ''; state.aiNote = '';
    $('service-groups').replaceChildren(); $('catalog-panel').hidden = true;
  }
  function snapshot(item = null) {
    return { generation: state.generation, bearer: state.bearer, user: state.user, workspace: state.workspace, item: item ? item.id : '' };
  }
  function current(scope) {
    const handoff = auth.webHandoffWorkspace();
    return (!scope.workspace || !handoff?.required || Boolean(handoff.workspaceId))
      && scope.generation === state.generation && scope.bearer === auth.token()
      && scope.bearer === state.bearer && scope.user === String(auth.user()?.id || '')
      && scope.user === state.user && scope.workspace === state.workspace;
  }
  function itemOf(scope) {
    return state.items.find((item) => item.id === scope.item) || null;
  }
  function actionable(scope) {
    return current(scope) && scope.workspace && state.projects.some((project) => project.id === scope.workspace) && Boolean(itemOf(scope));
  }
  function query(scope, workspace = scope.workspace, extra = {}) {
    return new URLSearchParams({ workspace_id: workspace, user_id: scope.user, ...extra }).toString();
  }
  async function request(path, options, scope, ms = WAIT_MS) {
    const controller = new AbortController(); state.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await auth.api(path, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${scope.bearer}` } });
    } finally { clearTimeout(timer); state.requests.delete(controller); }
  }
  function failure(error, scope, target = 'page-status') {
    if (!current(scope)) return;
    if (error.status === 401 || error.status === 423) {
      auth.signOut({ server: false, silent: true });
      boot(); status('signin-status', error.status === 423 ? auth.DELETION_PENDING_COPY : auth.EXPIRED_COPY, true); return;
    }
    if (error.status === 403) {
      invalidate(); clearCatalog(); state.workspace = '';
      renderProjects(); status('page-status', '이 프로젝트에 접근할 수 없어요. 다른 프로젝트를 골라 주세요.', true); return;
    }
    // The server's short reason picks the sentence; its own wording never shows.
    const code = String(error.code || error.detail || '');
    const copy = error.aborted ? '확인이 오래 걸렸어요. 다시 확인해 주세요.'
      : error.network ? auth.NETWORK_COPY
        : ['MANAGED_CONNECTION_VERIFY_FAILED', 'MCP_CONNECTION_VERIFY_FAILED', 'AI_ENGINE_CONNECTION_VERIFICATION_FAILED'].includes(code) ? '입력한 연결 정보로 확인하지 못했어요. 정보를 다시 확인해 주세요.'
          : code === 'AI_ENGINE_CONNECTION_ANSWER_FAILED' ? '연결은 됐지만 AI가 테스트 답변을 하지 못했어요. 계정의 사용 한도를 확인한 뒤 다시 해 주세요.'
            : code === 'MCP_CREDENTIAL_REQUIRED' ? '연결 정보를 입력해 주세요.'
              : ['HERMES_BUSY', 'HERMES_CONNECT_BUSY', 'HERMES_CONNECT_FINISHING'].includes(code) ? '다른 연결을 마무리하는 중이에요. 잠시 뒤 다시 시도해 주세요.'
                : error.status === 404 ? '찾는 연결이나 프로젝트가 더 이상 없어요. 다시 확인을 눌러 목록을 새로 불러와 주세요.'
                  : error.status === 409 ? '그사이 연결 상태가 바뀌었어요. 다시 확인해 주세요.'
                    : error.status === 503 ? '지금은 연결을 준비하고 있어요. 잠시 뒤 다시 시도해 주세요.'
                      : '연결을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    status(target, copy, true);
  }

  // ---- Rows: one shape, whichever route answered -------------------------------------------------------------------

  function groupOf(kind, webManageable) {
    if (DEVICE_KINDS.includes(kind) || !webManageable) return 'app';
    if (kind === 'ai_engine') return 'ai';
    if (kind === 'free_api') return 'free';
    return kind === 'service' ? 'tools' : 'accounts';
  }
  function hintOf(value) {
    const hint = text(value, 16);
    return /^[•*.…]*[A-Za-z0-9_-]{2,8}$/.test(hint) ? hint.replace(/^[•*.…]+/, '') : '';
  }
  // How the web starts a connection: the AI page for an AI, else one of today's per-kind connect routes, rebuilt from
  // the row's own validated id -- never an address taken as given.
  function connectPlan(kind, serviceId, connect) {
    if (kind === 'ai_engine') return PROVIDER_ID.test(serviceId) ? { type: 'ai' } : null;
    const route = connect && typeof connect.route === 'string' ? connect.route : '';
    const method = connect && typeof connect.method === 'string' ? connect.method : '';
    let way = ['mcp', 'managed', 'oauth'].includes(route) ? route : '';
    const found = CONNECT_PATH.exec(route);
    if (found && found[1] === serviceId) way = found[2];
    const authMethod = ['oauth', 'none', 'api_key', 'one_time_token'].includes(method) ? method : '';
    if (!way || !authMethod || !SERVICE_ID.test(serviceId)) return null;
    if ((way === 'managed' && authMethod !== 'api_key') || (way === 'oauth' && authMethod !== 'oauth')) return null;
    return { type: 'route', way, authMethod };
  }
  // What a row offers: what the server allows, that this page can run, and that fits the row's status.
  function offered(row, wanted) {
    const live = ['connected', 'expired', 'error'].includes(row.status);
    return ACTIONS.filter((action) => wanted.includes(action) && (
      action === 'connect' ? row.webManageable && Boolean(row.connect) && ['disconnected', 'unavailable'].includes(row.status)
        : action === 'reconnect' ? row.webManageable && Boolean(row.connect) && ['expired', 'error'].includes(row.status)
          // A lapsed key is replaced through 다시 연결; 키 바꾸기 is for a key that works.
          : action === 'change_key' ? row.webManageable && row.status === 'connected' && row.method === 'api_key' && row.keyChange
            : action === 'test' ? row.webManageable && row.status === 'connected' && row.kind === 'service' && row.testable
              : live));
  }
  function finish(row, wanted) {
    const done = { detail: '', reason: '', info: false, keyChange: true, testable: true, ...row };
    done.group = groupOf(done.kind, done.webManageable);
    if (done.group === 'app' && !done.reason) done.reason = APP_REASON[done.kind] || APP_REASON.other;
    done.actions = done.info ? [] : offered(done, wanted);
    return done;
  }
  function providerName(id, row) {
    if (PROVIDER_NAMES[id]) return PROVIDER_NAMES[id];
    return text(row && (row.label || row.company), 60) || id;
  }
  function serviceName(value) {
    return text(value, 80).replace(/\b(?:MCP|API key|server|token|provider)\b/gi, '서비스') || '서비스';
  }

  // A free key's quota: a whole limit above 0 and a whole amount used, or nothing (no bar is guessed).
  function freeQuota(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const limit = Number.isSafeInteger(value.limit) && value.limit > 0 ? value.limit : 0;
    const used = Number.isSafeInteger(value.used) && value.used >= 0 ? value.used : -1;
    if (!limit || used < 0) return null;
    const resets = typeof value.resets_at === 'string' && Number.isFinite(Date.parse(value.resets_at)) ? value.resets_at : null;
    return { limit, used, resetsAt: resets };
  }
  // The same sentence as the app (integrations.freeQuotaPresentation): a percentage only, no request counts (owner 2026-10-27).
  function quotaCopy(quota) {
    const remaining = Math.max(0, quota.limit - quota.used);
    const percent = Math.min(100, Math.round((quota.used / quota.limit) * 100));
    let reset = '';
    const at = quota.resetsAt ? Date.parse(quota.resetsAt) : NaN;
    if (Number.isFinite(at)) {
      const day = new Date(at + 9 * 3600000);
      reset = `${day.getUTCMonth() + 1}월 ${day.getUTCDate()}일에 다시 채워져요`;
    }
    return { remaining, reset, label: remaining > 0 ? `무료 한도 ${percent}% 사용`
      : `무료 한도를 다 썼어요${reset ? ` · ${reset}` : ''}` };
  }
  function freeService(id) {
    return FREE_API_SERVICES.find((service) => service.id === id) || null;
  }

  // GET /integrations. Rows that do not parse are left out; an answer that is not the contract's shape is a failure.
  function integrationItems(answer) {
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.items)) throw new Error('invalid_integrations');
    const seen = new Set();
    return answer.items.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const id = String(row.id || ''), kind = row.kind, serviceId = String(row.service_id || '');
      if (!ID.test(id) || seen.has(id) || !KINDS.includes(kind) || !(kind === 'ai_engine' ? PROVIDER_ID : SERVICE_ID).test(serviceId)) return [];
      if (kind === 'ai_engine' && inApp()) return [];
      seen.add(id);
      const webManageable = row.web_manageable === true && !DEVICE_KINDS.includes(kind);
      return [finish({
        id, kind, serviceId, source: 'integrations',
        name: kind === 'ai_engine' ? providerName(serviceId, { label: row.name }) : serviceName(row.name),
        method: METHODS.includes(row.method) ? row.method : 'none',
        status: STATUSES.includes(row.status) ? row.status : 'disconnected',
        keyHint: hintOf(row.key_hint), accountLabel: text(row.account_label, 120),
        webManageable, connect: webManageable ? connectPlan(kind, serviceId, row.connect) : null,
        notFree: row.uses_own_account_credits_free === false,
        ...(kind === 'free_api' ? { freeQuota: freeQuota(row.free_quota) } : {})
      }, Array.isArray(row.actions) ? row.actions : [])];
    });
  }

  // Today's routes, into the same rows. The catalog admits what this page can connect (MCP, the managed key services
  // and the web account sign-ins); a connection the person already has through the app shows under 앱에서만 연결.
  function catalogItems(catalog, records, scope) {
    if (!Array.isArray(catalog) || !Array.isArray(records)) throw new Error('invalid_connections');
    const admitted = new Map();
    for (const row of catalog) {
      if (!row || !SERVICE_ID.test(row.service || '') || admitted.has(row.service)) continue;
      if (!['ready_for_catalog', 'official_api'].includes(row.catalogStatus)) continue;
      const way = row.connectionMethod, method = row.connectionAuthMethod;
      if (!['mcp', 'managed', 'oauth'].includes(way) || !['oauth', 'none', 'api_key', 'one_time_token'].includes(method)) continue;
      if ((way === 'managed' && method !== 'api_key') || (way === 'oauth' && method !== 'oauth')) continue;
      admitted.set(row.service, row);
    }
    // A connection of a listed service that names another account or project is not this page's to draw.
    if (records.some((row) => row && admitted.has(row.service) && (row.user_id !== scope.user || row.workspace_id !== scope.workspace))) {
      throw new Error('invalid_scope');
    }
    const mine = new Map();
    for (const row of records) {
      if (row && admitted.has(row.service) && ['connected', 'needs_reconnect'].includes(row.status) && !mine.has(row.service)) mine.set(row.service, row);
    }
    return [...admitted.values()].flatMap((row) => {
      const way = row.connectionMethod, method = row.connectionAuthMethod;
      const record = mine.get(row.service);
      const web = way !== 'oauth' || WEB_OAUTH.includes(row.service);
      if (!web && !record) return [];
      const ready = row.connectionReady === true && !['planned', 'not_ready'].includes(row.adapterStatus);
      const freeApi = FREE_API_IDS.includes(row.service) && way === 'managed';
      return [finish({
        id: `service:${row.service}`, kind: freeApi ? 'free_api' : way === 'oauth' ? 'external_account' : 'service', serviceId: row.service, source: 'connections',
        name: serviceName(row.displayName),
        method: method === 'oauth' ? 'oauth' : method === 'none' ? 'none' : 'api_key',
        status: record ? (record.status === 'connected' ? 'connected' : 'expired') : ready ? 'disconnected' : 'unavailable',
        keyHint: method === 'api_key' && record ? hintOf(record.credentialHint) : '',
        accountLabel: record ? text(record.external_identity_label, 120) : '',
        webManageable: web, connect: web ? { type: 'route', way, authMethod: method } : null, ready,
        keyChange: method === 'api_key', testable: way === 'mcp',
        ...(freeApi ? { freeQuota: null } : {})
      }, ['connect', 'reconnect', 'change_key', 'test', 'disconnect'])];
    });
  }

  function aiItems(providers, connections) {
    const catalog = new Map((Array.isArray(providers) ? providers : []).flatMap((row) => (
      row && PROVIDER_ID.test(String(row.id || '')) ? [[row.id, row]] : [])));
    const seen = new Set();
    return (Array.isArray(connections) ? connections : []).flatMap((row) => {
      // An employee's own AI belongs to one project's employee and is managed in the app.
      if (!row || typeof row !== 'object' || row.agent_id) return [];
      const id = String(row.id || ''), provider = String(row.provider || '');
      if (!ID.test(id) || !PROVIDER_ID.test(provider) || seen.has(id)) return [];
      seen.add(id);
      const listed = catalog.get(provider);
      const methods = !listed ? [] : [
        ...(Array.isArray(listed.methods) ? listed.methods.map((entry) => entry && entry.kind) : []),
        ...(Array.isArray(listed.auth_methods) ? listed.auth_methods.map((way) => (way === 'credential' ? 'api_key' : way)) : [])
      ];
      const model = text(row.model, 160);
      return [finish({
        id: `ai:${id}`, kind: 'ai_engine', serviceId: provider, source: 'ai', connectionId: id,
        name: providerName(provider, listed),
        method: row.auth_method === 'oauth' ? 'oauth' : row.auth_method === 'credential' ? 'api_key' : 'login',
        status: row.status === 'connected' && row.readiness === 'ready' ? 'connected' : 'expired',
        keyHint: '', accountLabel: '', detail: model ? `지금 모델 ${model}` : '',
        webManageable: true, connect: { type: 'ai' },
        // A key that is the whole credential can be changed here; a gateway also needs its address, and a keyless
        // model has no key, so those change on /ai/.
        keyChange: row.auth_method === 'credential' && methods.includes('api_key') && listed.endpoint_required !== true
      }, ['reconnect', 'change_key', 'disconnect'])];
    });
  }

  function infoItems() {
    return [finish({ id: 'app:browser_login', kind: 'browser_login', serviceId: 'browser_login', source: 'info', info: true,
      name: '웹사이트 로그인 연결', method: 'login', status: 'unavailable', keyHint: '', accountLabel: '', webManageable: false,
      connect: null }, [])];
  }

  // The AI is the account's: any ready project answers for it (the chosen one first).
  function aiWorkspace() {
    const ready = state.projects.filter((project) => project.ready);
    return (ready.find((project) => project.id === state.workspace) || ready[0] || {}).id || '';
  }

  async function fallbackItems(scope) {
    const q = query(scope);
    const ai = inApp() ? '' : aiWorkspace();
    // A failure of the AI half is said in its group; only a lost sign-in stops the page.
    const soft = (error) => { if (error.status === 401 || error.status === 423) throw error; return null; };
    const aq = ai ? query(scope, ai) : '';
    const [catalog, records, providers, connections] = await Promise.all([
      request(`/connections/catalog?${q}`, { method: 'GET' }, scope),
      request(`/connections?${q}`, { method: 'GET' }, scope),
      ai ? request(`/ai-engine-providers?${aq}`, { method: 'GET' }, scope).catch(soft) : null,
      ai ? request(`/ai-engine-connections?${aq}`, { method: 'GET' }, scope).catch(soft) : null
    ]);
    const note = inApp() ? '' : !ai ? '프로젝트를 준비하고 있어 AI 연결은 아직 불러오지 못했어요.'
      : providers === null || connections === null ? 'AI 연결을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.' : '';
    return { items: [...aiItems(providers, connections), ...catalogItems(catalog, records, scope), ...infoItems()], note };
  }

  async function readItems(scope) {
    if (state.mode !== 'fallback') {
      try {
        const answer = await request(`/integrations?${query(scope)}`, { method: 'GET' }, scope);
        return { mode: 'integrations', version: text(answer && answer.version, 200), items: integrationItems(answer), note: '' };
      } catch (error) {
        if (error.status !== 404) throw error;
        if (current(scope)) state.mode = 'fallback';
      }
    }
    return { mode: 'fallback', version: '', ...(await fallbackItems(scope)) };
  }

  async function refresh(scope = snapshot()) {
    if (!current(scope) || !scope.workspace) return false;
    const read = ++state.read; state.reading = true; stopPoll();
    if (!state.items.length) status('page-status', '연결 상태를 확인하고 있어요.');
    try {
      const answer = await readItems(scope);
      if (read !== state.read) return false;
      state.reading = false;
      if (!current(scope)) return false;
      state.mode = answer.mode; state.version = answer.version; state.items = answer.items; state.aiNote = answer.note;
      if (state.flow && !state.items.some((item) => item.id === state.flow.item.id)) closeFlow();
      renderCatalog(); status('page-status');
      const flow = state.flow;
      if (flow && flow.pending && state.items.some((item) => item.id === flow.item.id && item.status === 'connected')) {
        closeFlow(); renderCatalog(); status('page-status', '연결을 확인했어요.');
      }
      schedulePoll();
      return true;
    } catch (error) {
      if (read === state.read) { state.reading = false; failure(error, scope); }
      return false;
    }
  }

  // ---- Keeping in step with the app -----------------------------------------------------------------------------------

  function schedulePoll() {
    stopPoll();
    if (state.mode !== 'integrations' || state.pollOff || document.visibilityState !== 'visible' || !state.workspace) return;
    const scope = snapshot();
    state.poll = setTimeout(() => pollOnce(scope), POLL_MS);
  }
  async function pollOnce(scope) {
    state.poll = null;
    if (!current(scope) || state.mode !== 'integrations' || document.visibilityState !== 'visible') return;
    try {
      const answer = await request(`/integrations/version?${query(scope)}`, { method: 'GET' }, scope, POLL_MS);
      if (!current(scope)) return;
      const version = text(answer && answer.version, 200);
      if (version && version !== state.version && !state.busy && !state.reading) await refresh(scope);
      else schedulePoll();
    } catch (error) {
      if (!current(scope)) return;
      if (error.status === 404) { state.pollOff = true; return; }
      if (error.status === 401 || error.status === 423) { failure(error, scope); return; }
      schedulePoll();
    }
  }
  function resync() {
    if (!state.user || state.busy) return;
    if (auth.token() !== state.bearer) { boot(); return; }
    if (state.workspace && !state.reading) refresh();
  }

  // ---- Drawing -------------------------------------------------------------------------------------------------------------

  function renderProjects() {
    const select = $('workspace-select'); select.replaceChildren();
    const placeholder = node('option', '프로젝트를 골라 주세요'); placeholder.value = ''; select.append(placeholder);
    for (const project of state.projects) {
      const option = node('option', project.name); option.value = project.id; select.append(option);
    }
    select.value = state.workspace;
  }
  function rowNode(item) {
    const card = node('article', '', 'service-card');
    card.dataset.integration = item.id; card.dataset.service = item.serviceId; card.dataset.kind = item.kind; card.dataset.group = item.group;
    const head = node('div', '', 'service-card-head');
    head.append(node('h3', item.name));
    if (item.info) head.append(node('span', '앱에서 연결', 'service-state app-only'));
    else head.append(node('span', STATUS_COPY[item.status], `service-state${item.status === 'connected' ? ' connected' : ['expired', 'error'].includes(item.status) ? ' attention' : ''}`));
    card.append(head);
    if (item.accountLabel) card.append(node('p', item.accountLabel));
    if (item.keyHint) card.append(node('p', `키 끝자리 ${item.keyHint}`));
    if (item.detail) card.append(node('p', item.detail));
    if (item.status === 'expired' && !item.info) card.append(node('p', '연결이 만료됐어요. 다시 연결하면 이어서 써요.'));
    if (item.status === 'error' && !item.info) card.append(node('p', '연결에 문제가 있어요. 다시 연결해 주세요.'));
    if (item.status === 'unavailable' && !item.info) card.append(node('p', '지금은 새 연결을 준비하고 있어요.'));
    if (item.notFree) card.append(node('p', '이 연결로 하는 일에는 크레딧이 들어요.'));
    if (item.kind === 'free_api') {
      const service = freeService(item.serviceId);
      if (service) card.append(node('p', service.what, 'service-free-what'));
      if (item.freeQuota) {
        const copy = quotaCopy(item.freeQuota);
        const bar = node('progress', '', 'service-quota');
        bar.setAttribute('max', String(item.freeQuota.limit));
        bar.setAttribute('value', String(Math.min(item.freeQuota.used, item.freeQuota.limit)));
        bar.setAttribute('aria-label', copy.label);
        card.append(bar, node('p', copy.label, 'service-quota-line'));
        if (copy.reset && copy.remaining > 0) card.append(node('p', copy.reset, 'service-quota-line'));
      }
    }
    if (item.group === 'app') {
      card.append(node('p', `앱에서 연결 · ${item.reason}`, 'service-app-reason'));
    }
    const actions = node('div', '', 'service-actions');
    // 연결 on a row that is not ready yet stays visible and disabled.
    for (const action of item.actions) {
      const control = button(ACTION_COPY[action], () => act(item.id, action), action === 'disconnect' || action === 'test');
      control.disabled = Boolean(state.busy) || (action === 'connect' && item.status === 'unavailable');
      actions.append(control);
    }
    if (actions.childNodes.length) card.append(actions);
    if (state.flow && state.flow.item.id === item.id && state.flow.node) card.append(state.flow.node);
    return card;
  }
  function renderCatalog() {
    const search = $('service-search').value.trim().toLocaleLowerCase('ko');
    const visible = state.items.filter((item) => item.name.toLocaleLowerCase('ko').includes(search));
    const groups = $('service-groups'); groups.replaceChildren();
    for (const group of GROUPS) {
      const rows = visible.filter((item) => item.group === group.id);
      const aiDoor = group.id === 'ai' && !inApp() && !search;
      if (!rows.length && !aiDoor) continue;
      const section = node('section', '', 'service-group'); section.dataset.group = group.id;
      section.append(node('h2', group.title), node('p', group.line, 'service-group-line'));
      const mine = rows.filter((item) => item.info || !['disconnected', 'unavailable'].includes(item.status));
      const rest = rows.filter((item) => !mine.includes(item));
      if (mine.length) { const list = node('div', '', 'service-grid'); mine.forEach((item) => list.append(rowNode(item))); section.append(list); }
      if (rest.length) {
        const more = node('details', '', 'service-more');
        if (!mine.length) state.expanded.add(group.id);
        more.open = Boolean(search) || state.expanded.has(group.id) || Boolean(state.flow && rest.some((item) => item.id === state.flow.item.id));
        more.addEventListener('toggle', () => { if (search) return; if (more.open) state.expanded.add(group.id); else state.expanded.delete(group.id); });
        more.append(node('summary', `연결할 수 있는 ${group.id === 'ai' ? 'AI' : group.id === 'free' ? '무료 API 키' : '서비스'} ${rest.length}개`));
        const list = node('div', '', 'service-grid'); rest.forEach((item) => list.append(rowNode(item))); more.append(list);
        section.append(more);
      }
      if (group.id === 'ai' && state.aiNote) section.append(node('p', state.aiNote, 'service-group-line'));
      if (aiDoor) {
        const door = node('a', '다른 AI 연결하기', 'service-button secondary'); door.href = '/ai/';
        const actions = node('div', '', 'service-actions'); actions.append(door); section.append(actions);
      }
      groups.append(section);
    }
    $('catalog-empty').textContent = search ? '찾는 연동이 없어요.' : '아직 연결할 수 있는 연동이 없어요.';
    $('catalog-panel').hidden = false; $('catalog-empty').hidden = visible.length > 0;
  }
  function setBusy(scope) {
    state.busy = scope; $('refresh-services').disabled = Boolean(scope); renderCatalog();
    const submit = $('submit-connection'); if (submit) submit.disabled = Boolean(scope);
  }

  // ---- Acting on one row, in its own card -------------------------------------------------------------------------------

  function flowFor(item, purpose) {
    if (state.busy) return null;
    const scope = snapshot(item);
    if (!actionable(scope)) { if (auth.token() !== state.bearer) boot(); return null; }
    closeFlow();
    const box = node('div', '', 'service-flow'); box.id = 'service-flow';
    const flow = { scope, item, purpose, pending: false, node: box };
    state.flow = flow;
    const line = node('p', '', 'services-status'); line.id = 'action-status'; line.setAttribute('role', 'status');
    flow.line = line;
    renderCatalog();
    return flow;
  }
  function show(flow, ...parts) {
    flow.node.replaceChildren(...parts.filter(Boolean), flow.line);
  }
  function cancel(flow) {
    return button('취소', () => {
      if (state.flow !== flow) return;
      if (!state.busy) { closeFlow(); renderCatalog(); return; }
      // A request still out is stopped; what it may have changed is read again.
      invalidate(); $('refresh-services').disabled = false; renderCatalog(); refresh();
    }, true);
  }
  function act(id, action) {
    const item = state.items.find((row) => row.id === id);
    if (!item || !item.actions.includes(action) || (action === 'connect' && item.status === 'unavailable')) return;
    if (action === 'disconnect') { confirmDisconnect(item); return; }
    if (action === 'test') { runTest(item); return; }
    if (action === 'change_key') { keyForm(item, 'change_key'); return; }
    if (item.connect && item.connect.type === 'ai') { aiDoor(item); return; }
    if (item.connect && ['api_key', 'one_time_token'].includes(item.connect.authMethod)) { keyForm(item, action); return; }
    // A connection with nothing to type starts at once; its progress and any failure are said in the row.
    const flow = flowFor(item, action); if (!flow) return;
    show(flow, cancel(flow)); start(flow);
  }
  function aiDoor(item) {
    const flow = flowFor(item, 'connect'); if (!flow) return;
    const door = node('a', `${item.name} 연결하러 가기`, 'service-button');
    door.href = `/ai/?provider=${encodeURIComponent(item.serviceId)}`;
    show(flow, node('p', 'AI 계정 로그인과 키 확인은 AI 연결 페이지에서 해요. 연결하면 이 목록에도 바로 보여요.'), door, cancel(flow));
  }
  function keyForm(item, purpose) {
    const flow = flowFor(item, purpose); if (!flow) return;
    if (foreignScript()) {
      show(flow, node('p', '로그인 확인에 쓴 다른 사이트의 코드가 이 페이지에 남아 있어요. 키를 안전하게 넣으려면 페이지를 새로 열어 주세요.'),
        button('새로 열기', () => window.location.reload()), cancel(flow));
      return;
    }
    const changing = purpose === 'change_key';
    const form = node('form', '', 'service-key-form');
    const label = node('label', changing ? '새 키' : '연결 정보'); label.htmlFor = 'connection-secret';
    const input = node('input'); input.id = 'connection-secret'; input.type = 'password'; input.required = true; input.maxLength = 4096;
    flow.input = input;
    // Cloudflare Workers AI also needs the account id; it is not a secret, so it is a plain field before the token.
    const needsAccount = item.kind === 'free_api' && Boolean(freeService(item.serviceId)?.accountId);
    let account = null;
    if (needsAccount) {
      account = node('input'); account.id = 'connection-account'; account.type = 'text'; account.required = true; account.maxLength = 64;
      account.setAttribute('autocomplete', 'off'); account.setAttribute('autocapitalize', 'off'); account.setAttribute('spellcheck', 'false');
      label.textContent = 'API 토큰';
    } else if (item.kind === 'free_api') label.textContent = changing ? '새 API 키' : 'API 키';
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false');
    const submit = node('button', changing ? '바꾸기' : '연결 확인', 'service-button'); submit.id = 'submit-connection'; submit.type = 'submit';
    const actions = node('div', '', 'service-actions'); actions.append(submit, cancel(flow));
    if (account) {
      const accountLabel = node('label', '계정 ID'); accountLabel.htmlFor = 'connection-account';
      form.append(accountLabel, account);
    }
    form.append(label, input, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // Out of the field at once, whatever happens next.
      const credential = input.value.trim(); input.value = '';
      if (!credential || /[\r\n]/.test(credential)) { status('action-status', '발급받은 키를 확인해 주세요.', true); return; }
      if (flow.item.kind === 'ai_engine' && credential.length < 20) { status('action-status', '키가 너무 짧아요. 발급받은 키 전체를 붙여넣어 주세요.', true); return; }
      if (account) {
        const accountId = account.value.trim();
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) { status('action-status', '계정 ID를 확인해 주세요.', true); return; }
        flow.accountId = accountId;
      }
      start(flow, credential);
    });
    show(flow, node('p', changing
      ? '새 키로 바꾸면 이전 키는 더 쓰지 않아요. 입력한 키는 이 페이지에 남지 않아요.'
      : '서비스에서 발급받은 연결 정보를 입력해 주세요. 입력한 정보는 이 페이지에 보관하지 않아요.'),
    item.kind === 'ai_engine' ? node('p', '바꾸기 전에 새 키로 실제 테스트 답변을 한 번 받아 봐요. 최대 3분까지 걸릴 수 있어요.') : null, form);
    input.focus();
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      // This is a service-provider login, never a Sidekick account/AI/checkout
      // return door. The shared app-mode owner also guards later DOM changes.
      if (inApp() && ['sidekickagent.app', 'www.sidekickagent.app', window.location.hostname].includes(url.hostname)) return '';
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash
        && !url.searchParams.has('access_token') && !url.searchParams.has('token') ? url.href : '';
    } catch (_) { return ''; }
  }
  // The request a change makes. Built from the row's own validated ids; the key rides only in the body.
  function changeRequest(flow, credential) {
    const { scope, item, purpose } = flow;
    const own = `/integrations/${encodeURIComponent(item.id)}`;
    if (purpose === 'disconnect') {
      if (item.source === 'integrations') return [`${own}/disconnect?${query(scope)}`, { method: 'POST', body: '{}' }];
      if (item.source === 'ai') return [`/ai-engine-connections/${encodeURIComponent(item.connectionId)}?${query(scope, aiWorkspace() || scope.workspace, { connection_id: item.connectionId })}`, { method: 'DELETE' }];
      return [`/connections/${encodeURIComponent(item.serviceId)}`, { method: 'PUT',
        body: JSON.stringify({ workspace_id: scope.workspace, user_id: scope.user, status: 'disabled' }) }];
    }
    if (purpose === 'change_key' && item.source === 'integrations') return [`${own}/key?${query(scope)}`, { method: 'POST', body: JSON.stringify({ api_key: credential }) }];
    if (item.source === 'ai') {
      return ['/ai-engine-connections', { method: 'POST', body: JSON.stringify({ workspace_id: aiWorkspace() || scope.workspace, user_id: scope.user,
        provider: item.serviceId, auth_method: 'credential', credential }) }];
    }
    const body = { authMethod: item.connect.authMethod }; if (credential) body.credential = credential;
    if (item.kind === 'free_api' && flow.accountId) body.account_id = flow.accountId;
    return [`/connections/${encodeURIComponent(item.serviceId)}/${item.connect.way}/connect?${query(scope)}`, { method: 'POST', body: JSON.stringify(body) }];
  }
  function connectedNow(item) {
    return item.kind === 'ai_engine'
      ? state.items.some((row) => row.kind === 'ai_engine' && row.serviceId === item.serviceId && row.status === 'connected')
      : state.items.some((row) => row.id === item.id && row.status === 'connected');
  }
  async function confirmAfter(flow, check, done, unsure) {
    const reloaded = await refresh(flow.scope); if (!current(flow.scope)) return;
    const confirmed = reloaded && check(state.items.find((item) => item.id === flow.item.id));
    closeFlow(); renderCatalog(); status('page-status', confirmed ? done : unsure, !confirmed);
  }
  async function start(flow, credential) {
    const { scope, item, purpose } = flow;
    if (state.flow !== flow || !actionable(scope) || state.busy) return;
    setBusy(scope);
    status('action-status', item.kind === 'ai_engine' ? '새 키로 실제 테스트 답변을 받아 보고 있어요. 최대 3분까지 걸릴 수 있어요.'
      : purpose === 'change_key' ? '새 키를 확인하고 있어요.' : '연결을 확인하고 있어요.');
    try {
      const [path, options] = changeRequest(flow, credential);
      const pending = request(path, options, scope);
      credential = null; options.body = '';
      const answer = await pending;
      if (!actionable(scope) || state.flow !== flow) return;
      // The key routes answer nothing to compare: the fresh list is the answer.
      if (item.source === 'ai' || (purpose === 'change_key' && item.source === 'integrations')) {
        setBusy(null);
        await confirmAfter(flow, () => connectedNow(item), '키를 바꿨어요.', '키를 바꿨는지 아직 확인하지 못했어요. 다시 확인해 주세요.');
        return;
      }
      if (answer?.service !== item.serviceId || answer.authMethod !== item.connect.authMethod) throw new Error('invalid_start');
      if (answer.status === 'connected') {
        setBusy(null);
        await confirmAfter(flow, () => connectedNow(item), purpose === 'change_key' ? '키를 바꿨어요.' : '연결을 확인했어요.',
          '연결 상태를 아직 확인하지 못했어요. 다시 확인해 주세요.');
      } else if (answer.status === 'authorization_required' && item.connect.authMethod === 'oauth') {
        const url = safeUrl(answer.connectionUrl); if (!url) throw new Error('invalid_url');
        flow.pending = true;
        const link = node('a', '로그인 열기', 'service-button'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.addEventListener('click', (event) => { if (!actionable(scope) || state.flow !== flow) event.preventDefault(); });
        show(flow, node('p', '새 창에서 로그인을 마치고 이 페이지로 돌아오면 상태가 바로 바뀌어요. 앱으로 돌아가라는 안내가 나와도 여기서 확인할 수 있어요.'),
          link, button('연결 상태 확인', () => { if (actionable(scope) && state.flow === flow) refresh(scope); }, true), cancel(flow));
        status('action-status', '아직 연결 완료를 확인하지 않았어요.');
      } else throw new Error('invalid_start');
    } catch (error) { failure(error, scope, 'action-status'); }
    finally { if (current(scope) && state.busy === scope) setBusy(null); }
  }
  function confirmDisconnect(item) {
    const flow = flowFor(item, 'disconnect'); if (!flow) return;
    show(flow, node('p', item.kind === 'ai_engine'
      ? `${item.name} 연결을 해제하면 내 모든 프로젝트의 새 업무가 이 AI를 쓰지 않아요.`
      : '이 계정의 다른 프로젝트에서도 이 서비스 연결을 사용할 수 없게 돼요. 진행 중인 일에 영향을 줄 수 있어요.'),
    (() => { const row = node('div', '', 'service-actions'); row.append(button('해제하기', () => disconnect(flow)), cancel(flow)); return row; })());
  }
  async function disconnect(flow) {
    const { scope, item } = flow;
    if (state.flow !== flow || !actionable(scope) || state.busy) return;
    setBusy(scope); status('action-status', '연결을 해제하고 있어요.');
    try {
      const [path, options] = changeRequest(flow);
      const answer = await request(path, options, scope);
      if (!actionable(scope) || state.flow !== flow) return;
      if (item.source === 'connections' && (answer?.service !== item.serviceId || answer.status !== 'disabled'
        || answer.user_id !== scope.user || answer.workspace_id !== scope.workspace)) throw new Error('invalid_disconnect');
      setBusy(null);
      await confirmAfter(flow, (now) => !now || ['disconnected', 'unavailable'].includes(now.status), '연결 해제를 확인했어요.',
        '해제 상태를 아직 확인하지 못했어요. 다시 확인해 주세요.');
    } catch (error) { failure(error, scope, 'action-status'); }
    finally { if (current(scope) && state.busy === scope) setBusy(null); }
  }
  async function runTest(item) {
    const flow = flowFor(item, 'test'); if (!flow) return;
    const { scope } = flow;
    show(flow, cancel(flow));
    setBusy(scope); status('action-status', '연결을 시험하고 있어요.');
    try {
      const answer = await request(`/connections/${encodeURIComponent(item.serviceId)}/test?${query(scope)}`, { method: 'POST', body: '{}' }, scope);
      if (!actionable(scope) || state.flow !== flow) return;
      const copy = TEST_COPY[answer && answer.state] || (answer && answer.ok === true ? TEST_COPY.healthy : '시험 결과를 확인하지 못했어요. 다시 해 주세요.');
      setBusy(null);
      const good = Boolean(answer && answer.ok === true);
      await refresh(scope); if (!current(scope)) return;
      closeFlow(); renderCatalog(); status('page-status', `${item.name}: ${copy}`, !good);
    } catch (error) { failure(error, scope, 'action-status'); }
    finally { if (current(scope) && state.busy === scope) setBusy(null); }
  }

  // ---- Who, which project -------------------------------------------------------------------------------------------------

  async function boot() {
    $('signin-gate').classList.remove('is-connecting');
    invalidate(); clearCatalog();
    state.user = ''; state.bearer = auth.token(); state.workspace = ''; state.projects = []; state.mode = ''; state.pollOff = false;
    state.expanded.clear();
    $('services-who').hidden = true; $('services-who').textContent = '';
    $('project-panel').hidden = true; $('signin-gate').hidden = !state.bearer;
    $('refresh-services').disabled = false;
    if (!state.bearer) {
      $('signin-gate').hidden = false;
      // In the app's viewer this means the hand-over did not arrive: say so,
      // and the retry button beside it asks the app once more.
      if (inApp()) status('signin-status', '앱 계정으로 열지 못했어요. 다시 시도하거나, 앱으로 돌아가 서비스 연결을 다시 열어 주세요.', true);
      return;
    }
    const generation = state.generation, bearer = state.bearer;
    const unchanged = () => generation === state.generation && bearer === auth.token();
    try {
      const user = auth.user() || await auth.whoami();
      if (!unchanged()) return;
      if (!ID.test(String(user?.id || ''))) throw new Error('invalid_user');
      state.user = String(user.id);
      const scope = snapshot();
      const answer = await request('/workspaces/ai-engine-targets', { method: 'GET' }, scope);
      if (!current(scope)) return;
      if (!Array.isArray(answer?.workspaces)) throw new Error('invalid_projects');
      const seen = new Set();
      state.projects = answer.workspaces.flatMap((row) => {
        if (!row || !ID.test(row.id || '') || seen.has(row.id)) return [];
        seen.add(row.id); return [{ id: row.id, name: text(row.name, 120) || '이름 없는 프로젝트', ready: row.ready === true }];
      });
      const handoff = auth.webHandoffWorkspace();
      const requested = handoff?.required ? handoff.workspaceId : new URLSearchParams(window.location.search).get('workspace');
      const owned = state.projects.find((row) => row.id === requested)?.id;
      if (handoff?.required && !owned) {
        $('signin-gate').hidden = false;
        status('signin-status', '선택한 프로젝트를 확인하지 못했어요. 앱에서 다시 열어 주세요.', true);
        return;
      }
      state.workspace = owned || state.projects[0]?.id || '';
      renderProjects(); $('project-panel').hidden = false; $('signin-gate').hidden = true;
      const account = auth.account();
      $('services-who').textContent = [account?.phrase, account?.email || account?.phone || account?.name].filter(Boolean).join(' · ');
      $('services-who').hidden = !$('services-who').textContent;
      if (state.workspace) await refresh();
      else status('page-status', '아직 프로젝트가 없어요. 앱에서 첫 프로젝트를 시작한 뒤 다시 확인해 주세요.');
    } catch (error) {
      if (!unchanged()) return;
      $('signin-gate').hidden = false;
      failure(error, snapshot(), 'signin-status');
    }
  }

  $('workspace-select').addEventListener('change', (event) => {
    invalidate(); clearCatalog(); state.workspace = state.projects.some((row) => row.id === event.target.value) ? event.target.value : '';
    $('refresh-services').disabled = false; refresh();
  });
  $('refresh-services').addEventListener('click', () => {
    if (auth.token() !== state.bearer || !state.workspace) boot();
    else if (!state.busy) refresh();
  });
  $('service-search').addEventListener('input', renderCatalog);
  $('open-signin').addEventListener('click', () => { if (!inApp()) auth.open(); });
  $('retry-handoff').addEventListener('click', async () => {
    if (!inApp()) return;
    $('signin-gate').classList.add('is-connecting'); status('signin-status', '', false);
    await auth.appWebHandoff();
    boot();
  });
  // The app's viewer opens this page signed out and hands its account over
  // right after; until that ends, the gate says it is connecting.
  if (inApp() && !auth.token()) $('signin-gate').classList.add('is-connecting');
  // Back from a provider's sign-in, another tab or the app: read again. Hidden: no polling.
  window.addEventListener('focus', resync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); else stopPoll(); });
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('pageshow', (event) => {
    if (inApp() && auth.webHandoffWorkspace()?.required) boot();
    else if (event && event.persisted) resync();
  });
  const notice = (copy, error) => status('signin-status', inApp() && !auth.token()
    ? '서비스 연결을 이어가려면 앱에서 다시 열어 주세요.' : copy, error);
  // Opened by the signed-in app: continue as that account before the first draw
  // (SidekickAuth.appWebHandoff). Nothing happens outside the app's own viewer.
  auth.init({ onSignedIn: boot, onSignedOut: () => { boot(); notice('로그아웃했어요.'); },
    onNotice: notice }).then(async () => {
    if (inApp()) await auth.appWebHandoff();
    await boot();
    auth.requireSignIn();
  });
})();
