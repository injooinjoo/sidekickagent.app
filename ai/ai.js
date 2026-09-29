(() => {
  'use strict';

  // Connect an AI account or key to one project, on the web.
  //
  // Sign-in is the shared /auth.js. Everything else is the backend's AI-engine
  // routes, the same ones the app calls: the project list, the provider catalog,
  // the account logins (a device code, a code pasted back, or a redirect that
  // returns here), the key and cloud forms, and the project's connections with
  // their model choice and disconnect. No secret stays on this page: a key goes
  // out once in a request body, and nothing this page keeps in sessionStorage is
  // a token or a code.
  const auth = window.SidekickAuth;
  const { api } = auth;
  // OpenRouter sends the person back here with ?code=. The backend is told this
  // exact address at start and compares it again at complete.
  const CALLBACK_URL = 'https://sidekickagent.app/ai/';
  // What must survive that round trip: which login it is and which project it
  // is for. Never a token and never a code.
  const FLOW_KEY = 'sidekick_web_ai_pending_flow';
  const FLOW_MAX_AGE_MS = 30 * 60 * 1000;
  const WORKSPACE_KEY = 'sidekick_web_ai_workspace';
  // The server proves a connection by getting one real answer through it and
  // allows that up to 180 seconds; the page waits a little longer than that.
  const PROOF_WAIT_MS = 240000;
  const PROOF_NOTE = '연결을 확인하려고 이 정보로 실제 테스트 답변을 한 번 받아 봐요. 최대 3분까지 걸릴 수 있어요.';
  const PROOF_PROGRESS = '연결을 확인하고 있어요. 실제 테스트 답변을 받아 보는 중이라 최대 3분까지 걸릴 수 있어요.';
  const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  // The Korean product names the app already uses; anything else keeps the
  // server's name.
  const PROVIDER_NAMES = {
    openai: 'ChatGPT', anthropic: 'Claude', xai: 'Grok', gemini: 'Gemini', openrouter: 'OpenRouter',
    minimax: 'MiniMax', deepseek: 'DeepSeek', qwen: 'Qwen', kimi: 'Kimi', zai: 'Z.AI',
    copilot: 'GitHub Copilot', nous: 'Nous Portal', vertex: 'Google Vertex AI', bedrock: 'AWS Bedrock',
    'azure-foundry': 'Azure AI Foundry', '9router': '9Router', omniroute: 'OmniRoute'
  };
  // The cloud forms ask for exactly the fields the server's credential models
  // accept (schemas.py), in the order the app asks for them.
  const CLOUD_FIELDS = {
    vertex: [
      { id: 'project_id', label: '프로젝트 ID', hint: 'Google Cloud 프로젝트 ID', secret: false, multiline: false },
      { id: 'region', label: '리전', hint: '예: us-central1', secret: false, multiline: false },
      { id: 'service_account_json', label: '서비스 계정 키', hint: '받은 키 파일 내용을 그대로 붙여넣어요.', secret: true, multiline: true }
    ],
    bedrock: [
      { id: 'access_key_id', label: '액세스 키 ID', hint: 'AWS 액세스 키 ID', secret: true, multiline: false },
      { id: 'secret_access_key', label: '비밀 액세스 키', hint: 'AWS 비밀 액세스 키', secret: true, multiline: false },
      { id: 'region', label: '리전', hint: '예: us-east-1', secret: false, multiline: false }
    ],
    'azure-foundry': [
      { id: 'endpoint_url', label: '연결 주소', hint: '배포에서 받은 https 주소', secret: false, multiline: false },
      { id: 'api_key', label: '연결 키', hint: '배포에서 발급받은 키', secret: true, multiline: false }
    ]
  };
  // The catalog's way-to-connect entries this page can run end to end.
  const METHOD_KINDS = ['account', 'api_key', 'free', 'cloud'];
  const METHOD_ACTIONS = { account: '계정으로 로그인', api_key: 'API 키 입력', free: '무료로 사용', cloud: '정보 입력' };
  const METHOD_BADGES = { account: '계정 로그인', api_key: 'API 키', free: '무료', cloud: '클라우드' };
  const CONNECTION_METHODS = { oauth: '계정 로그인', credential: 'API 키', cloud: '클라우드' };

  // Every failure is told in Korean the page chose. The server's code only
  // picks which sentence; its own wording is never shown.
  const CODE_COPY = {
    AI_ENGINE_PROFILE_NOT_READY: '이 프로젝트는 아직 AI 직원 공간을 준비하고 있어요. 준비가 끝나면 여기서 연결할 수 있어요.',
    AI_ENGINE_CONNECTION_NOT_SUPPORTED: '아직 지원하지 않는 AI 연결이에요.',
    AI_ENGINE_ACCOUNT_CONNECTION_NOT_SUPPORTED: '이 AI는 계정 로그인 연결을 지원하지 않아요. API 키로 연결해 주세요.',
    AI_ENGINE_OAUTH_CODE_REQUIRED: '로그인 페이지에서 받은 코드를 붙여넣어 주세요.',
    AI_ENGINE_MODEL_NOT_VERIFIED: '이 연결에서 확인된 모델만 고를 수 있어요.',
    AI_ENGINE_MODELS_NOT_READY: '확인된 모델 목록이 아직 없어요. 잠시 뒤 다시 시도해 주세요.',
    AI_ENGINE_CONNECTION_VERIFICATION_FAILED: '연결 정보를 확인하지 못했어요. 키나 계정을 확인한 뒤 다시 시도해 주세요.',
    AI_ENGINE_CONNECTION_ANSWER_FAILED: '연결은 됐지만 AI가 테스트 답변을 하지 못했어요. 계정의 사용 한도와 모델을 확인한 뒤 다시 시도해 주세요.',
    AI_ENGINE_ACCOUNT_CONNECTION_DENIED: '로그인 페이지에서 연결을 허용하지 않았어요. 다시 시도하려면 허용해 주세요.',
    AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED: '로그인 코드가 만료됐어요. 처음부터 다시 연결해 주세요.',
    AI_ENGINE_ACCOUNT_CONNECTION_FAILED: '계정 연결을 마치지 못했어요. 처음부터 다시 연결해 주세요.',
    AI_ENGINE_ACCOUNT_CONNECTION_UNAVAILABLE: '지금은 계정으로 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
    AI_ENGINE_CONNECTION_STORAGE_UNAVAILABLE: '연결 정보를 안전하게 저장할 수 없어 연결하지 않았어요. 잠시 뒤 다시 시도해 주세요.',
    AI_ENGINE_CONNECTION_CHANGED: '그사이 연결이 바뀌었어요. 목록을 다시 불러왔어요.'
  };
  const STATUS_COPY = {
    400: '요청을 처리하지 못했어요. 다시 시도해 주세요.',
    401: '로그인이 만료됐어요. 다시 로그인해 주세요.',
    403: '이 프로젝트에 접근할 수 없어요. 다른 프로젝트를 골라 주세요.',
    404: '찾는 연결을 찾지 못했어요. 목록을 다시 불러왔어요.',
    409: '그사이 상태가 바뀌었어요. 다시 시도해 주세요.',
    410: '로그인 코드가 만료됐어요. 처음부터 다시 연결해 주세요.',
    422: '입력한 내용을 확인해 주세요. 키나 주소의 형식이 맞지 않거나, 아직 지원하지 않는 연결이에요.',
    423: '계정 삭제가 진행 중이라 연결할 수 없어요.',
    429: '요청이 잠시 많아요. 조금 뒤 다시 시도해 주세요.',
    503: '지금은 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.'
  };
  const FALLBACK_COPY = '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  const TIMEOUT_COPY = '확인이 오래 걸려 기다리기를 멈췄어요. 연결됐는지 위 목록에서 확인해 주세요.';
  const WORKSPACES_FAILED_COPY = '프로젝트 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';

  const state = {
    user: null,
    workspaces: [],
    workspaceId: '',
    catalog: [],
    connections: [],
    // The one connection being made in the panel: its provider, method and,
    // for an account login, the flow the server started.
    flow: null,
    busy: false,
    // Bumped by every reload, so a late answer cannot paint over a newer one.
    seq: 0,
    returnedCode: readReturnedCode()
  };

  const $ = (id) => document.getElementById(id);

  // OpenRouter returns with ?code=. It is read and taken out of the address bar
  // before anything else runs, so it never sits in history or a shared link.
  function readReturnedCode() {
    const query = new URLSearchParams(window.location.search);
    const code = String(query.get('code') || '').trim();
    if (window.location.search) history.replaceState(null, '', window.location.pathname);
    return code;
  }

  function readStore(key) {
    try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function writeStore(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch (_) { /* storage refused: this visit still works, a redirect login cannot resume */ }
  }

  function signedIn() {
    return Boolean(auth.token());
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'className') node.className = value;
      else if (key === 'onClick') node.addEventListener('click', value);
      else if (['value', 'disabled', 'hidden', 'readOnly', 'selected', 'required'].includes(key)) node[key] = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    (children || []).forEach((child) => { if (child) node.append(child); });
    return node;
  }

  function setStatus(id, message, isError) {
    const node = $(id);
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError && message));
  }

  function smoothScroll(node) {
    if (!node) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function errorCopy(error) {
    if (!error) return FALLBACK_COPY;
    if (error.aborted) return TIMEOUT_COPY;
    if (error.network) return auth.NETWORK_COPY;
    if (error.status === 401) return STATUS_COPY[401];
    if (error.code && CODE_COPY[error.code]) return CODE_COPY[error.code];
    if (STATUS_COPY[error.status]) return STATUS_COPY[error.status];
    return error.status >= 500 ? STATUS_COPY[503] : FALLBACK_COPY;
  }

  // A 401 anywhere means the bearer is gone: sign out here and say so, rather
  // than leaving a page that fails every button.
  function showFailure(error, statusId) {
    if (error && error.status === 401) {
      signOutHere(STATUS_COPY[401]);
      return;
    }
    setStatus(statusId, errorCopy(error), true);
  }

  function scope() {
    return { workspace_id: state.workspaceId, user_id: String(state.user.id) };
  }

  function scopeQuery(extra) {
    return new URLSearchParams({ ...scope(), ...(extra || {}) }).toString();
  }

  // A connection check runs a real answer on the server; wait for it, but not
  // forever.
  async function longCall(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROOF_WAIT_MS);
    try {
      return await api(path, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function providerName(id, row) {
    if (PROVIDER_NAMES[id]) return PROVIDER_NAMES[id];
    const label = row && typeof row.label === 'string' ? row.label.trim() : '';
    const company = row && typeof row.company === 'string' ? row.company.trim() : '';
    const name = label || company;
    return name && name.length <= 60 && !/[\u0000-\u001f]/.test(name) ? name : id;
  }

  // A connection names its provider by id; the catalog row, when there is one,
  // has the name the cards use.
  function connectionProviderName(id) {
    const row = state.catalog.find((provider) => provider.id === id);
    return row ? row.name : providerName(id);
  }

  function connectionMethodLabel(connection) {
    const row = state.catalog.find((provider) => provider.id === connection.provider);
    const keyless = row && row.methods.length === 1 && row.methods[0].kind === 'free';
    return keyless ? '무료 모델' : connection.method;
  }

  function cleanText(value, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  // ---- Server answers, sanitized ---------------------------------------------

  function sanitizeWorkspaces(value) {
    const rows = value && Array.isArray(value.workspaces) ? value.workspaces : null;
    if (!rows) return null;
    const seen = new Set();
    const workspaces = [];
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const id = String(row.id || '');
      if (!SAFE_ID.test(id) || seen.has(id)) return;
      seen.add(id);
      workspaces.push({ id, name: cleanText(row.name, 120) || '이름 없는 프로젝트', ready: row.ready === true });
    });
    return workspaces;
  }

  function methodsOf(row) {
    const entries = [];
    const seen = new Set();
    const add = (entry) => {
      if (!METHOD_KINDS.includes(entry.kind) || seen.has(entry.kind)) return;
      if (entry.kind === 'cloud' && !CLOUD_FIELDS[row.id]) return;
      seen.add(entry.kind);
      entries.push(entry);
    };
    if (Array.isArray(row.methods)) {
      row.methods.forEach((method) => {
        if (!method || typeof method !== 'object') return;
        add({
          kind: method.kind,
          flow: method.kind === 'account' && ['device_code', 'pkce'].includes(method.flow) ? method.flow : null,
          requirement: method.kind === 'account' ? cleanText(method.requirement, 160) : '',
          note: cleanText(method.note, 200)
        });
      });
      return entries;
    }
    // An older server row carries only auth_methods.
    (Array.isArray(row.auth_methods) ? row.auth_methods : []).forEach((method) => {
      if (method === 'oauth') add({ kind: 'account', flow: null, requirement: '', note: '' });
      if (method === 'credential') add({ kind: 'api_key', flow: null, requirement: '', note: '' });
      if (method === 'cloud') add({ kind: 'cloud', flow: null, requirement: '', note: '' });
    });
    return entries;
  }

  function sanitizeCatalog(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const providers = [];
    value.forEach((row) => {
      if (!row || typeof row !== 'object' || !PROVIDER_ID.test(String(row.id || '')) || seen.has(row.id)) return;
      if (row.connection_ready === false) return;
      const endpointRequired = row.endpoint_required === true;
      if (endpointRequired !== (row.connection_type === 'gateway')) return;
      const methods = methodsOf(row);
      if (!methods.length) return;
      seen.add(row.id);
      providers.push({ id: row.id, name: providerName(row.id, row), featured: row.featured === true, endpointRequired, methods });
    });
    return providers;
  }

  function modelList(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter((model) => typeof model === 'string' && SAFE_ID.test(model)))]
      : [];
  }

  function sanitizeConnections(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const connections = [];
    value.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const id = String(row.id || '');
      const provider = String(row.provider || '');
      if (!SAFE_ID.test(id) || !PROVIDER_ID.test(provider) || seen.has(id)) return;
      seen.add(id);
      const model = typeof row.model === 'string' && SAFE_ID.test(row.model) ? row.model : '';
      connections.push({
        id,
        provider,
        method: CONNECTION_METHODS[row.auth_method] || '연결',
        model,
        models: modelList([model, ...modelList(row.models)]).filter(Boolean),
        candidates: modelList(row.candidate_models),
        connected: row.status === 'connected' && row.readiness === 'ready'
      });
    });
    return connections;
  }

  // ---- Signed-in state -------------------------------------------------------

  function renderAccount() {
    const button = $('account-button');
    button.textContent = signedIn() ? '로그아웃' : '로그인';
  }

  function hideProjectSteps() {
    ['workspace-step', 'connections-step', 'connect-step', 'providers-step'].forEach((id) => { $(id).hidden = true; });
  }

  function showSignedOut() {
    renderAccount();
    hideProjectSteps();
    $('signin-step').hidden = false;
  }

  function signOutHere(message, isError = true) {
    closeFlow();
    auth.signOut();
    state.seq += 1;
    state.user = null;
    state.workspaces = [];
    state.workspaceId = '';
    state.catalog = [];
    state.connections = [];
    showSignedOut();
    setStatus('signin-status', message || '', isError);
  }

  async function boot() {
    const seq = ++state.seq;
    renderAccount();
    if (!signedIn()) {
      showSignedOut();
      if (state.returnedCode) setStatus('signin-status', '로그인하면 하던 AI 연결을 이어서 마칠게요.', false);
      return;
    }
    $('signin-step').hidden = true;
    setStatus('signin-status', '', false);
    let user = null;
    try {
      user = await auth.whoami();
    } catch (error) {
      if (seq !== state.seq) return;
      if (error.status === 401 || error.status === 423) { signOutHere(STATUS_COPY[error.status]); return; }
      $('signin-step').hidden = false;
      setStatus('signin-status', errorCopy(error), true);
      return;
    }
    if (seq !== state.seq) return;
    if (!user || !SAFE_ID.test(String(user.id || ''))) { signOutHere(STATUS_COPY[401]); return; }
    state.user = user;
    await loadWorkspaces(seq);
  }

  // ---- Projects ----------------------------------------------------------------

  async function loadWorkspaces(seq) {
    $('workspace-step').hidden = false;
    setStatus('workspace-status', '프로젝트를 불러오고 있어요.', false);
    let workspaces = null;
    try {
      workspaces = sanitizeWorkspaces(await api('/workspaces/ai-engine-targets', { method: 'GET' }));
    } catch (error) {
      if (seq !== state.seq) return;
      if (error.status === 401) { signOutHere(STATUS_COPY[401]); return; }
      setStatus('workspace-status', error.network ? auth.NETWORK_COPY : WORKSPACES_FAILED_COPY, true);
      return;
    }
    if (seq !== state.seq) return;
    if (!workspaces) { setStatus('workspace-status', WORKSPACES_FAILED_COPY, true); return; }
    state.workspaces = workspaces;
    const pending = readPendingFlow();
    const wanted = [
      state.returnedCode && pending ? pending.workspace_id : '',
      readStore(WORKSPACE_KEY),
      (workspaces.find((workspace) => workspace.ready) || {}).id,
      (workspaces[0] || {}).id
    ].find((id) => id && workspaces.some((workspace) => workspace.id === id));
    state.workspaceId = wanted || '';
    renderWorkspaces();
    await loadWorkspaceData();
    if (state.returnedCode || pending) await completeReturnedFlow(pending);
  }

  function currentWorkspace() {
    return state.workspaces.find((workspace) => workspace.id === state.workspaceId) || null;
  }

  function renderWorkspaces() {
    const select = $('workspace-select');
    select.replaceChildren(...state.workspaces.map((workspace) => el('option', {
      value: workspace.id,
      text: workspace.ready ? workspace.name : `${workspace.name} · 준비 중`,
      selected: workspace.id === state.workspaceId
    })));
    select.disabled = state.workspaces.length < 2;
  }

  async function loadWorkspaceData() {
    const seq = ++state.seq;
    closeFlow();
    $('connections-step').hidden = true;
    $('providers-step').hidden = true;
    setStatus('connections-status', '', false);
    setStatus('providers-status', '', false);
    const workspace = currentWorkspace();
    if (!workspace) {
      setStatus('workspace-status', '연결할 프로젝트가 아직 없어요. 프로젝트를 만들면 여기서 AI를 연결할 수 있어요.', false);
      return;
    }
    writeStore(WORKSPACE_KEY, workspace.id);
    if (!workspace.ready) {
      setStatus('workspace-status', CODE_COPY.AI_ENGINE_PROFILE_NOT_READY, true);
      return;
    }
    setStatus('workspace-status', '연결 정보를 불러오고 있어요.', false);
    try {
      const [catalog, connections] = await Promise.all([
        api(`/ai-engine-providers?${scopeQuery()}`, { method: 'GET' }),
        api(`/ai-engine-connections?${scopeQuery()}`, { method: 'GET' })
      ]);
      if (seq !== state.seq) return;
      state.catalog = sanitizeCatalog(catalog);
      state.connections = sanitizeConnections(connections);
    } catch (error) {
      if (seq !== state.seq) return;
      showFailure(error, 'workspace-status');
      return;
    }
    setStatus('workspace-status', '', false);
    renderConnections();
    renderProviders();
  }

  async function reloadConnections() {
    if (!state.user || !state.workspaceId) return;
    const workspaceId = state.workspaceId;
    try {
      const connections = await api(`/ai-engine-connections?${scopeQuery()}`, { method: 'GET' });
      if (workspaceId !== state.workspaceId) return;
      state.connections = sanitizeConnections(connections);
      renderConnections();
    } catch (error) {
      showFailure(error, 'connections-status');
    }
  }

  // ---- Connections of this project ----------------------------------------------

  function renderConnections() {
    const list = $('connection-list');
    list.replaceChildren(...state.connections.map(connectionItem));
    $('connections-empty').hidden = state.connections.length > 0;
    $('connections-step').hidden = false;
  }

  function connectionItem(connection) {
    const name = connectionProviderName(connection.provider);
    const candidates = connection.candidates.filter((model) => !connection.models.includes(model));
    const select = el('select', { className: 'ai-select', 'aria-label': `${name} 모델` }, [
      el('optgroup', { label: '확인된 모델' }, connection.models.map((model) => el('option', {
        value: model, text: model, selected: model === connection.model
      }))),
      candidates.length ? el('optgroup', { label: '새로 시험할 모델' }, candidates.map((model) => el('option', {
        value: model, text: model
      }))) : null
    ]);
    const note = el('p', {
      className: 'ai-note',
      text: '처음 쓰는 모델은 바꾸기 전에 실제 테스트 답변을 한 번 받아 봐요. 최대 3분까지 걸릴 수 있어요.',
      hidden: true
    });
    const change = el('button', { className: 'ai-button secondary', type: 'button', text: '모델 바꾸기', disabled: true });
    const disconnect = el('button', { className: 'ai-button quiet', type: 'button', text: '연결 해제' });
    select.addEventListener('change', () => {
      change.disabled = state.busy || !select.value || select.value === connection.model;
      note.hidden = !candidates.includes(select.value);
    });
    change.addEventListener('click', () => changeModel(connection, select.value, [change, disconnect, select]));
    disconnect.addEventListener('click', () => disconnectConnection(connection, [change, disconnect, select]));
    return el('li', { className: 'connection-item' }, [
      el('div', { className: 'connection-head' }, [
        el('strong', { text: name }),
        el('span', { className: connection.connected ? 'pill is-ok' : 'pill is-warn', text: connection.connected ? '연결됨' : '다시 연결 필요' })
      ]),
      el('p', { className: 'connection-meta', text: `${connectionMethodLabel(connection)} · 지금 모델 ${connection.model || '선택 필요'}` }),
      connection.connected ? null : el('p', {
        className: 'ai-note',
        text: '새 업무만 잠시 멈춰요. 아래에서 같은 AI를 다시 연결하면 이어서 써요.'
      }),
      el('div', { className: 'connection-actions' }, [select, change, disconnect]),
      note
    ]);
  }

  function setBusy(busy, controls) {
    state.busy = busy;
    (controls || []).forEach((control) => { control.disabled = busy; });
  }

  async function changeModel(connection, model, controls) {
    if (state.busy || !model || model === connection.model) return;
    const tryingNew = !connection.models.includes(model);
    setBusy(true, controls);
    setStatus('connections-status', tryingNew
      ? `${model}로 바꾸기 전에 테스트 답변을 받아 보고 있어요. 최대 3분까지 걸릴 수 있어요.`
      : '모델을 바꾸고 있어요.', false);
    try {
      await longCall(`/ai-engine-connections/${encodeURIComponent(connection.id)}/model`, {
        method: 'PUT',
        body: JSON.stringify({ ...scope(), connection_id: connection.id, model })
      });
      setStatus('connections-status', `${model}로 바꿨어요. 이 프로젝트의 새 업무부터 이 모델을 써요.`, false);
    } catch (error) {
      showFailure(error, 'connections-status');
    } finally {
      setBusy(false, controls);
    }
    if (state.user) await reloadConnections();
  }

  async function disconnectConnection(connection, controls) {
    if (state.busy) return;
    const name = connectionProviderName(connection.provider);
    if (!window.confirm(`${name} 연결을 해제할까요? 이 프로젝트의 새 업무는 이 AI를 쓰지 않아요.`)) return;
    setBusy(true, controls);
    setStatus('connections-status', '연결을 해제하고 있어요.', false);
    try {
      await api(`/ai-engine-connections/${encodeURIComponent(connection.id)}?${scopeQuery({ connection_id: connection.id })}`, {
        method: 'DELETE'
      });
      setStatus('connections-status', `${name} 연결을 해제했어요.`, false);
    } catch (error) {
      showFailure(error, 'connections-status');
    } finally {
      setBusy(false, controls);
    }
    if (state.user) await reloadConnections();
  }

  // ---- Provider catalog ------------------------------------------------------------

  function renderProviders() {
    const featured = state.catalog.filter((provider) => provider.featured);
    const top = featured.length ? featured : state.catalog;
    const rest = featured.length ? state.catalog.filter((provider) => !provider.featured) : [];
    $('provider-featured').replaceChildren(...top.map(providerCard));
    $('provider-rest').replaceChildren(...rest.map(providerCard));
    $('provider-more').hidden = rest.length === 0;
    $('provider-more-summary').textContent = `다른 AI 서비스 ${rest.length}개`;
    $('providers-step').hidden = false;
    setStatus('providers-status', state.catalog.length ? '' : '지금 연결할 수 있는 AI가 없어요. 잠시 뒤 다시 시도해 주세요.', !state.catalog.length);
  }

  function providerCard(provider) {
    const account = provider.methods.find((method) => method.kind === 'account');
    const noted = provider.methods.find((method) => method.note);
    const detail = (account && account.requirement) || (noted && noted.note) || '';
    const linked = state.connections.some((connection) => connection.provider === provider.id && connection.connected);
    return el('article', { className: 'provider-card' }, [
      el('div', { className: 'provider-head' }, [
        el('strong', { text: provider.name }),
        linked ? el('span', { className: 'pill is-ok', text: '연결됨' }) : null
      ]),
      el('div', { className: 'provider-badges' }, provider.methods.map((method) => el('span', {
        className: 'pill', text: METHOD_BADGES[method.kind]
      }))),
      provider.endpointRequired ? el('p', { className: 'provider-detail', text: '운영 중인 AI 연결 주소가 필요해요.' }) : null,
      detail ? el('p', { className: 'provider-detail', text: detail }) : null,
      el('div', { className: 'provider-actions' }, provider.methods.map((method, index) => el('button', {
        className: index === 0 ? 'ai-button' : 'ai-button secondary',
        type: 'button',
        text: METHOD_ACTIONS[method.kind],
        onClick: () => openFlow(provider, method)
      })))
    ]);
  }

  // ---- The connect panel -------------------------------------------------------------

  function openFlow(provider, method) {
    if (state.busy) return;
    closeFlow();
    const flow = { provider, method, flowId: '', authorizationUrl: '', timer: null, inFlight: false, stopped: false };
    state.flow = flow;
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-step').hidden = false;
    setStatus('connect-status', '', false);
    if (method.kind === 'account') startAccount(flow);
    else if (method.kind === 'api_key') $('connect-body').replaceChildren(keyForm(flow));
    else if (method.kind === 'free') $('connect-body').replaceChildren(freeForm(flow));
    else if (method.kind === 'cloud') $('connect-body').replaceChildren(cloudForm(flow));
    smoothScroll($('connect-step'));
  }

  function closeFlow() {
    const flow = state.flow;
    if (flow) {
      flow.stopped = true;
      if (flow.timer) clearTimeout(flow.timer);
    }
    state.flow = null;
    $('connect-step').hidden = true;
    $('connect-body').replaceChildren();
    setStatus('connect-status', '', false);
  }

  function live(flow) {
    return Boolean(flow) && !flow.stopped && state.flow === flow;
  }

  async function finishFlow(flow, connection) {
    const name = flow.provider.name;
    if (live(flow)) closeFlow();
    setStatus('connections-status', connection && connection.status === 'needs_reconnect'
      ? `${name} 연결을 저장했지만 다시 연결이 필요해요. 한 번 더 연결해 주세요.`
      : `${name} 연결됐어요. 이 프로젝트의 새 업무부터 이 AI로 일해요.`, false);
    await reloadConnections();
    renderProviders();
    smoothScroll($('connections-step'));
  }

  // Key, free and cloud connections all end in the same POST, which checks the
  // credential with one real answer before anything is saved.
  async function submitConnection(flow, body, controls) {
    if (!live(flow) || state.busy) return;
    setBusy(true, controls);
    setStatus('connect-status', PROOF_PROGRESS, false);
    try {
      const connection = await longCall('/ai-engine-connections', {
        method: 'POST',
        body: JSON.stringify({ ...scope(), provider: flow.provider.id, ...body })
      });
      setBusy(false, controls);
      await finishFlow(flow, connection);
    } catch (error) {
      setBusy(false, controls);
      if (live(flow)) showFailure(error, 'connect-status');
      if (error.aborted && state.user) await reloadConnections();
    }
  }

  function field(label, input, hint) {
    return el('div', { className: 'connect-field' }, [
      el('label', { className: 'ai-label', for: input.id, text: label }),
      input,
      hint ? el('p', { className: 'ai-hint', text: hint }) : null
    ]);
  }

  function keyForm(flow) {
    const key = el('input', { className: 'ai-input', id: 'connect-key', type: 'password', autocomplete: 'off', spellcheck: 'false', required: true });
    const endpoint = flow.provider.endpointRequired
      ? el('input', { className: 'ai-input', id: 'connect-endpoint', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://', required: true })
      : null;
    const submit = el('button', { className: 'ai-button', type: 'submit', text: '연결 확인' });
    const form = el('form', { className: 'connect-form' }, [
      field(`${flow.provider.name} API 키`, key, '발급받은 키 전체를 붙여넣어요. 키는 이 확인 요청에만 실려 서버로 가고, 이 페이지에는 남지 않아요.'),
      endpoint ? field('연결 주소', endpoint, '운영 중인 AI 연결 주소(https)를 넣어요.') : null,
      el('p', { className: 'ai-note', text: PROOF_NOTE }),
      submit
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const credential = key.value.trim();
      const endpointUrl = endpoint ? endpoint.value.trim() : '';
      if (credential.length < 20) { setStatus('connect-status', '키가 너무 짧아요. 발급받은 키 전체를 붙여넣어 주세요.', true); return; }
      if (endpoint && !auth.httpsUrl(endpointUrl)) { setStatus('connect-status', '연결 주소는 https://로 시작해야 해요.', true); return; }
      submitConnection(flow, {
        auth_method: 'credential',
        credential,
        ...(endpoint ? { endpoint_url: endpointUrl } : {})
      }, [submit, key, endpoint].filter(Boolean));
    });
    return form;
  }

  function freeForm(flow) {
    const submit = el('button', { className: 'ai-button', type: 'button', text: '무료로 연결' });
    // A keyless provider still goes through the credential route; the server
    // accepts this fixed marker for keyless providers only. It is not a secret.
    submit.addEventListener('click', () => submitConnection(flow, { auth_method: 'credential', credential: 'keyless' }, [submit]));
    return el('div', { className: 'connect-form' }, [
      el('p', { className: 'ai-note', text: flow.method.note || '키 없이 무료로 사용해요. 무료 모델은 속도나 사용량이 제한될 수 있어요.' }),
      el('p', { className: 'ai-note', text: PROOF_NOTE }),
      submit
    ]);
  }

  function cloudForm(flow) {
    const specs = CLOUD_FIELDS[flow.provider.id] || [];
    const inputs = specs.map((spec) => ({
      spec,
      input: spec.multiline
        ? el('textarea', { className: 'ai-input', id: `cloud-${spec.id}`, rows: '5', autocomplete: 'off', spellcheck: 'false', required: true })
        : el('input', { className: 'ai-input', id: `cloud-${spec.id}`, type: spec.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false', required: true })
    }));
    const submit = el('button', { className: 'ai-button', type: 'submit', text: '연결 확인' });
    const form = el('form', { className: 'connect-form' }, [
      ...inputs.map(({ spec, input }) => field(spec.label, input, spec.hint)),
      el('p', { className: 'ai-note', text: PROOF_NOTE }),
      submit
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const credential = { kind: flow.provider.id };
      for (const { spec, input } of inputs) {
        const value = input.value.trim();
        if (!value) { setStatus('connect-status', `${spec.label}을 입력해 주세요.`, true); return; }
        credential[spec.id] = value;
      }
      submitConnection(flow, { auth_method: 'cloud', cloud_credential: credential }, [submit, ...inputs.map(({ input }) => input)]);
    });
    return form;
  }

  // ---- Account logins ---------------------------------------------------------------

  async function startAccount(flow) {
    const body = $('connect-body');
    body.replaceChildren(el('p', { className: 'ai-note', text: `${flow.provider.name} 로그인을 준비하고 있어요.` }));
    let started;
    try {
      // A browser round trip (OpenRouter) needs to know where to come back to;
      // a device code does not.
      started = await api('/ai-engine-oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          ...scope(),
          provider: flow.provider.id,
          auth_method: 'oauth',
          ...(flow.method.flow === 'device_code' ? {} : { callback_url: CALLBACK_URL })
        })
      });
    } catch (error) {
      if (!live(flow)) return;
      body.replaceChildren();
      showFailure(error, 'connect-status');
      return;
    }
    if (!live(flow)) return;
    flow.flowId = String(started.flow_id || '');
    flow.authorizationUrl = auth.httpsUrl(started.authorization_url);
    if (!SAFE_ID.test(flow.flowId) || !flow.authorizationUrl) {
      body.replaceChildren();
      setStatus('connect-status', '로그인 페이지 주소를 받지 못했어요. 다시 시도해 주세요.', true);
      return;
    }
    // Claude has no device flow and no callback it can register: the person
    // copies a code from its page and pastes it here.
    if (started.authorization_mode === 'paste_code') { showPasteCode(flow); return; }
    if (flow.method.flow === 'device_code' || started.user_code) { showDeviceCode(flow, started); return; }
    redirectToProvider(flow);
  }

  function openLoginPageButton(flow) {
    // Opened from the click itself, so no pop-up blocker stands in the way, and
    // noopener keeps the provider's page from reaching back into this one.
    return el('button', {
      className: 'ai-button',
      type: 'button',
      text: `${flow.provider.name} 로그인 페이지 열기`,
      onClick: () => window.open(flow.authorizationUrl, '_blank', 'noopener')
    });
  }

  function requirementNote(flow) {
    return flow.method.requirement ? el('p', { className: 'provider-detail', text: flow.method.requirement }) : null;
  }

  function showDeviceCode(flow, started) {
    const code = cleanText(started.user_code, 64);
    const copy = code ? el('button', { className: 'ai-button secondary', type: 'button', text: '코드 복사' }) : null;
    if (copy) copy.addEventListener('click', () => auth.copyText(code, copy));
    $('connect-body').replaceChildren(
      el('p', { className: 'ai-note', text: code
        ? `${flow.provider.name} 로그인 페이지를 열어 아래 코드를 입력하면 연결돼요.`
        : `${flow.provider.name} 로그인 페이지에서 로그인하고 연결을 허용해 주세요.` }),
      code ? el('div', { className: 'device-code' }, [
        el('output', { className: 'device-code-value', 'aria-label': '로그인 코드', text: code }),
        copy
      ]) : null,
      el('div', { className: 'connect-actions' }, [openLoginPageButton(flow)]),
      requirementNote(flow),
      el('p', { className: 'ai-note', text: '로그인을 마치고 이 페이지로 돌아오면 바로 확인해요. 연결을 확인할 때 실제 테스트 답변을 한 번 받아 봐서 최대 3분까지 걸릴 수 있어요.' })
    );
    setStatus('connect-status', '로그인을 기다리고 있어요.', false);
    flow.interval = Math.max(2, Number(started.poll_interval_seconds) || 5) * 1000;
    flow.expiresAt = Date.now() + Math.max(60, Number(started.expires_in_seconds) || 900) * 1000;
    schedulePoll(flow, flow.interval);
  }

  function schedulePoll(flow, delay) {
    if (!live(flow)) return;
    if (flow.timer) clearTimeout(flow.timer);
    flow.timer = setTimeout(() => pollAccount(flow), delay);
  }

  async function pollAccount(flow) {
    if (!live(flow) || flow.inFlight) return;
    if (Date.now() > flow.expiresAt) {
      flow.stopped = true;
      setStatus('connect-status', CODE_COPY.AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED, true);
      return;
    }
    flow.inFlight = true;
    let result = null;
    let failure = null;
    try {
      result = await longCall(`/ai-engine-oauth/${encodeURIComponent(flow.flowId)}/poll`, {
        method: 'POST',
        body: JSON.stringify({ ...scope(), provider: flow.provider.id, flow_id: flow.flowId })
      });
    } catch (error) {
      failure = error;
    } finally {
      flow.inFlight = false;
    }
    if (result && result.status === 'complete') { await finishFlow(flow, result.connection); return; }
    if (!live(flow)) return;
    // A dropped connection is worth another try; any other failure ends this login.
    if (failure && !(failure.network && !failure.aborted)) {
      flow.stopped = true;
      showFailure(failure, 'connect-status');
      return;
    }
    schedulePoll(flow, flow.interval);
  }

  // Timers in a background tab are throttled, and the moment the person comes
  // back from the login tab is exactly when the answer is ready.
  document.addEventListener('visibilitychange', () => {
    const flow = state.flow;
    if (document.visibilityState !== 'visible' || !live(flow) || !flow.interval) return;
    if (flow.timer) clearTimeout(flow.timer);
    pollAccount(flow);
  });

  function showPasteCode(flow) {
    const input = el('input', { className: 'ai-input', id: 'connect-code', type: 'text', autocomplete: 'off', spellcheck: 'false', required: true });
    const submit = el('button', { className: 'ai-button', type: 'submit', text: '연결 확인' });
    const form = el('form', { className: 'connect-form' }, [
      field('받은 코드', input, '로그인 페이지가 보여 준 코드를 그대로 붙여넣어요.'),
      el('p', { className: 'ai-note', text: PROOF_NOTE }),
      submit
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = input.value.trim();
      if (!code) { setStatus('connect-status', CODE_COPY.AI_ENGINE_OAUTH_CODE_REQUIRED, true); return; }
      completeAccount(flow, code, '', [submit, input]);
    });
    $('connect-body').replaceChildren(
      el('p', { className: 'ai-note', text: `${flow.provider.name} 로그인 페이지에서 로그인한 뒤, 화면에 나온 코드를 복사해 아래에 붙여넣어 주세요.` }),
      el('div', { className: 'connect-actions' }, [openLoginPageButton(flow)]),
      requirementNote(flow),
      form
    );
    setStatus('connect-status', '', false);
  }

  async function completeAccount(flow, code, callbackUrl, controls) {
    if (!live(flow) || state.busy) return;
    setBusy(true, controls);
    setStatus('connect-status', PROOF_PROGRESS, false);
    try {
      const result = await longCall(`/ai-engine-oauth/${encodeURIComponent(flow.flowId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          ...scope(),
          provider: flow.provider.id,
          flow_id: flow.flowId,
          code,
          ...(callbackUrl ? { callback_url: callbackUrl } : {})
        })
      });
      setBusy(false, controls);
      if (result && result.status === 'complete') { await finishFlow(flow, result.connection); return; }
      if (live(flow)) setStatus('connect-status', CODE_COPY.AI_ENGINE_ACCOUNT_CONNECTION_FAILED, true);
    } catch (error) {
      setBusy(false, controls);
      if (live(flow)) showFailure(error, 'connect-status');
      if (error.aborted && state.user) await reloadConnections();
    }
  }

  // OpenRouter: this tab goes to its page and comes back to /ai/?code=.
  function redirectToProvider(flow) {
    writeStore(FLOW_KEY, JSON.stringify({
      flow_id: flow.flowId,
      provider: flow.provider.id,
      workspace_id: state.workspaceId,
      saved_at: Date.now()
    }));
    $('connect-body').replaceChildren(el('p', { className: 'ai-note', text: `${flow.provider.name} 로그인 페이지로 이동해요. 로그인을 마치면 이 페이지로 돌아와 연결을 확인해요.` }));
    window.location.assign(flow.authorizationUrl);
  }

  function readPendingFlow() {
    let pending = null;
    try { pending = JSON.parse(readStore(FLOW_KEY) || 'null'); } catch (_) { pending = null; }
    if (!pending || typeof pending !== 'object') return null;
    const fresh = Number(pending.saved_at) > Date.now() - FLOW_MAX_AGE_MS;
    const valid = SAFE_ID.test(String(pending.flow_id || ''))
      && PROVIDER_ID.test(String(pending.provider || ''))
      && SAFE_ID.test(String(pending.workspace_id || ''));
    return fresh && valid ? pending : null;
  }

  async function completeReturnedFlow(pending) {
    const code = state.returnedCode;
    state.returnedCode = '';
    writeStore(FLOW_KEY, '');
    if (!code) {
      // Back from the provider's page without a code: the login was not finished.
      if (pending) setStatus('providers-status', '로그인을 마치지 않아 연결하지 않았어요. 다시 연결하려면 아래에서 다시 시작해 주세요.', true);
      return;
    }
    if (!pending) {
      setStatus('workspace-status', '이어서 마칠 연결 정보를 찾지 못했어요. 처음부터 다시 연결해 주세요.', true);
      return;
    }
    if (pending.workspace_id !== state.workspaceId || !(currentWorkspace() || {}).ready) {
      setStatus('workspace-status', '연결하던 프로젝트를 찾지 못했어요. 처음부터 다시 연결해 주세요.', true);
      return;
    }
    const provider = state.catalog.find((item) => item.id === pending.provider)
      || { id: pending.provider, name: providerName(pending.provider), featured: false, endpointRequired: false, methods: [] };
    const method = provider.methods.find((item) => item.kind === 'account')
      || { kind: 'account', flow: 'pkce', requirement: '', note: '' };
    closeFlow();
    const flow = { provider, method, flowId: pending.flow_id, authorizationUrl: '', timer: null, inFlight: false, stopped: false };
    state.flow = flow;
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-step').hidden = false;
    $('connect-body').replaceChildren(el('p', { className: 'ai-note', text: `${provider.name} 로그인에서 돌아왔어요. ${PROOF_NOTE}` }));
    smoothScroll($('connect-step'));
    await completeAccount(flow, code, CALLBACK_URL, []);
  }

  // ---- Wiring ----------------------------------------------------------------------

  $('workspace-select').addEventListener('change', (event) => {
    if (state.busy) { event.target.value = state.workspaceId; return; }
    state.workspaceId = event.target.value;
    loadWorkspaceData();
  });
  $('connect-cancel').addEventListener('click', closeFlow);
  $('open-signin').addEventListener('click', () => auth.open());
  $('account-button').addEventListener('click', () => {
    if (signedIn()) signOutHere('로그아웃했어요.', false);
    else auth.open();
  });

  renderAccount();
  auth.init({
    onSignedIn: () => boot(),
    onNotice: (message, isError) => setStatus('signin-status', message, isError)
  }).then(() => boot());
})();
