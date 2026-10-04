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
  // a token or a code. After a ChatGPT sign-in it also offers to make that same
  // ChatGPT account the project's AI (auth.js holds the one-time claim).
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
  // The providers whose official mark is published with this site, at /assets/ai/<id>.png: the same transparent
  // artwork the app bundles (apps/mobile/app/assets/ai-engines/), 192x192, drawn here at 40x40. The ids are the
  // catalog's own. A provider that is not listed keeps the text-only card; nothing is ever asked of another host.
  const PROVIDER_LOGOS = [
    'anthropic', 'copilot', 'deepseek', 'gemini', 'kimi', 'meta', 'minimax', 'mistral',
    'nous', 'nvidia', 'openai', 'openrouter', 'qwen', 'xai', 'zai'
  ];
  const PROVIDER_LOGO_SIZE = 40;
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
    404: '찾는 프로젝트나 연결이 더 이상 없어요. 이 페이지를 새로고침해서 목록을 다시 확인해 주세요.',
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
  // What to do next when there is nothing to connect yet. The web cannot create
  // or prepare a project; the app can, so the page says so and offers the two
  // things that do help from here.
  const NO_PROJECT_COPY = '연결할 프로젝트가 아직 없어요. 사이드킥 앱에서 첫 프로젝트를 시작하면 여기서 AI를 연결할 수 있어요.';
  const NO_PROJECT_HINT = '앱에서 이미 쓰고 있다면, 앱과 다른 방법으로 로그인했을 수 있어요. 앱에서 쓰는 로그인 방법으로 다시 로그인해 보세요.';
  const NOT_READY_HINT = '앱에서 이 프로젝트를 한 번 열면 준비돼요. 그다음 아래 다시 확인을 눌러 주세요.';
  // What ends a ChatGPT sign-in's claim for good (POST /ai-engine/login-handoff/claim):
  // spent, emptied, expired or changed. Anything else leaves the offer up to try again.
  const HANDOFF_SPENT_COPY = {
    AI_ENGINE_HANDOFF_ALREADY_CLAIMED: '이 ChatGPT 계정은 이미 연결했어요.',
    AI_ENGINE_HANDOFF_EMPTY: '로그인한 ChatGPT 계정 정보가 남아 있지 않아요. 아래에서 ChatGPT를 직접 연결해 주세요.'
  };
  const HANDOFF_EXPIRED_COPY = '로그인한 ChatGPT 계정으로 연결할 수 있는 시간이 지났어요. 아래에서 ChatGPT를 직접 연결해 주세요.';

  // The way back to the app (owner, 2026-10-04). The one address the page leaves for the app by: the app's own scheme and
  // one fixed path, and after a connection the catalog's id of the provider that was connected. Nothing else is ever put
  // in it -- no code, token, workspace or account.
  const APP_RETURN_URL = 'sidekick://ai/return';
  const RETURN_HINT = '앱이 열리지 않으면 사이드킥 앱을 직접 열어 주세요.';
  // The Korean subject particle follows how a name is said. These are the names the page knows that end in a consonant
  // sound (Grok, Qwen, Copilot, Portal, Bedrock, Mistral); every other name takes 가.
  const SUBJECT_WITH_I = ['xai', 'qwen', 'copilot', 'nous', 'bedrock', 'mistral'];
  const CODE_TIP = '로그인 중 문자나 메일로 받은 6자리 번호는 복사하지 말고, 키보드 위에 뜨는 제안을 눌러 입력하면 위 코드가 지워지지 않아요.';

  // AI 직원 실행 설정. The settings are the app's own (hermes_agent_ops.py: GET/PUT /hermes-agent/settings) and the tools
  // are the Hermes toolsets of the person's own server, reached through the owner-only relay the app uses
  // (POST /hermes-agent/native/request). The words for the settings are the app's (hermesAgentSettings.js), by value.
  const SETTINGS_READ_MS = 10000;
  const SETTINGS_WRITE_MS = 30000;
  const WAKE_WINDOW_MS = 20000;
  const REASONING_OPTIONS = [
    { id: 'low', label: '빠르게', line: '짧게 생각하고 바로 답해요' },
    { id: 'medium', label: '보통', line: '대부분의 일에 알맞아요' },
    { id: 'high', label: '깊게', line: '오래 생각하지만 더 꼼꼼해요' }
  ];
  const NATIVE_REASONING = new Map([['none', '생각 단계 없이 답하기'], ['minimal', '아주 빠르게'], ['xhigh', '아주 깊게'],
    ['max', '최대한 깊게'], ['ultra', '가장 깊게']]);
  const RUNTIME_OPTIONS = [{ id: 10, label: '10분' }, { id: 30, label: '30분' }, { id: 60, label: '60분' }];
  const APPROVAL_OPTIONS = [
    { id: 'external_only', label: '보내기 전에만', line: '메일 발송·게시·삭제처럼 밖으로 나가는 일 전에만 확인을 받아요' },
    { id: 'every_run', label: '모든 결과 전에', line: '결과를 적용하기 전에 매번 확인을 받아요' }
  ];
  // The only tools this page ever switches, in the order it shows them. The names are the dashboard's toolset names; they
  // never reach the screen. A name is put in a request path only from this list (toolsetPath), never from the server's
  // answer, the address or the page.
  const TOOLSETS_PATH = '/api/tools/toolsets';
  const TOOLSETS = [
    { name: 'computer_use', title: '컴퓨터 사용 (Computer Use)', line: '화면을 보고 직접 누르고 입력하며 일해요.' },
    { name: 'web', title: '웹 검색·읽기', line: '인터넷에서 찾고, 웹 페이지를 읽어 와요.' },
    { name: 'file', title: '파일 읽기·쓰기', line: '파일을 읽고, 새로 만들고, 고쳐요.' },
    { name: 'terminal', title: '터미널 명령 실행', line: '작업 공간에서 명령을 직접 실행해요.' },
    { name: 'code_execution', title: '코드 실행', line: '코드를 짜서 돌려 보며 계산하고 확인해요.' },
    { name: 'vision', title: '이미지 보기', line: '사진이나 화면 속 그림을 보고 이해해요.' },
    { name: 'image_gen', title: '이미지 만들기', line: '글로 설명한 대로 그림을 만들어 줘요.' },
    { name: 'tts', title: '음성 만들기', line: '글을 소리 내어 읽어 줘요.' },
    { name: 'delegation', title: '작업 나누기', line: '큰 일을 나눠서 여러 도우미에게 맡겨요.' }
  ];
  const AGENT_STATE_COPY = {
    loading: '불러오는 중…',
    slow: '설정을 불러오는 데 시간이 오래 걸리고 있어요. 잠시 뒤 다시 시도해 주세요',
    unavailable: 'AI 직원 공간이 아직 준비되지 않았어요. 켜 달라고 요청했으니 잠시 뒤 다시 시도해 주세요',
    network: auth.NETWORK_COPY,
    failed: '설정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요'
  };
  const OWNER_ONLY_COPY = '프로젝트 소유자만 바꿀 수 있어요';
  const CHANGE_COPY = {
    owner: OWNER_ONLY_COPY,
    slow: '시간이 오래 걸려 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요',
    unavailable: 'AI 직원 공간이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요',
    network: auth.NETWORK_COPY,
    failed: '설정을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요'
  };

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
    // /account/ links here as /ai/?workspace=<id>. Read before the address bar
    // is cleaned below; it only picks which project is selected first.
    requestedWorkspace: readRequestedWorkspace(),
    // The app's AI information page links here as /ai/?provider=<id>. Read
    // before the address bar is cleaned below; once the providers are on the
    // page, that provider's card is marked and brought into view. It never
    // starts a connection by itself.
    requestedProvider: readRequestedProvider(),
    returnedCode: readReturnedCode(),
    // The project's 실행 설정 (see "AI 직원 실행 설정" below): which read this is, what it came to and what the controls
    // may do. Nothing in it outlives a project change; every answer is checked against the read that asked for it.
    agent: { run: 0, phase: 'idle', settings: null, tools: null, busy: false, readOnly: false, wokeFor: '', wokeAt: 0 }
  };

  const $ = (id) => document.getElementById(id);

  function readRequestedWorkspace() {
    const id = String(new URLSearchParams(window.location.search).get('workspace') || '').trim();
    return SAFE_ID.test(id) ? id : '';
  }

  function readRequestedProvider() {
    const id = String(new URLSearchParams(window.location.search).get('provider') || '').trim();
    return PROVIDER_ID.test(id) ? id : '';
  }

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

  // replaceChildren() turns a null child into the text "null", so every panel
  // whose parts are optional is filled through here.
  function fill(node, children) {
    node.replaceChildren(...children.filter(Boolean));
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

  // Who is signed in, beside the page title. The header's account menu says the
  // same and holds 로그아웃.
  function renderWho() {
    const node = $('ai-who');
    const person = auth.account();
    if (!person || !signedIn()) { node.hidden = true; node.replaceChildren(); return; }
    const detail = person.email || person.phone || person.name;
    fill(node, [el('strong', { text: person.phrase }), detail ? el('span', { text: detail }) : null]);
    node.hidden = false;
  }

  function hideProjectSteps() {
    ['workspace-step', 'handoff-step', 'connections-step', 'execution-step', 'connect-step', 'providers-step', 'agent-settings-step'].forEach((id) => { $(id).hidden = true; });
    $('connection-list').replaceChildren();
    // What the last person's settings drew goes with them, not only out of sight.
    $('agent-settings-body').replaceChildren();
    setStatus('agent-settings-status', '', false);
    showNext(null);
  }

  function showSignedOut() {
    renderWho();
    hideProjectSteps();
    $('signin-step').hidden = false;
  }

  // The next step under the project picker, or nothing.
  function showNext(parts) {
    const node = $('workspace-next');
    if (!parts) { node.hidden = true; node.replaceChildren(); return; }
    fill(node, parts);
    node.hidden = false;
  }

  function signInAgain() {
    signOutHere('', false, true);
    auth.open();
  }

  function recheckWorkspaces() {
    if (!state.user || state.busy) return;
    loadWorkspaces(++state.seq);
  }

  // The page's own reset. `server` is true only when the person asked to sign
  // out; a token the server already refused has nothing left to revoke.
  function signOutHere(message, isError = true, server = false) {
    closeFlow();
    auth.signOut({ server, silent: true });
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
    hideProjectSteps();
    if (!signedIn()) {
      showSignedOut();
      if (state.returnedCode) setStatus('signin-status', '로그인하면 하던 AI 연결을 이어서 마칠게요.', false);
      return;
    }
    $('signin-step').hidden = true;
    setStatus('signin-status', '', false);
    // /auth.js has already asked the server who this is on this page load; ask
    // again only if that answer did not arrive.
    let user = auth.user();
    try {
      if (!user) user = await auth.whoami();
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
    renderWho();
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
      state.requestedWorkspace,
      readStore(WORKSPACE_KEY),
      (workspaces.find((workspace) => workspace.ready) || {}).id,
      (workspaces[0] || {}).id
    ].find((id) => id && workspaces.some((workspace) => workspace.id === id));
    state.workspaceId = wanted || '';
    state.requestedWorkspace = '';
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
    $('handoff-step').hidden = true;
    $('connections-step').hidden = true;
    $('execution-step').hidden = true;
    $('connection-list').replaceChildren();
    state.connections = [];
    $('providers-step').hidden = true;
    $('agent-settings-step').hidden = true;
    $('agent-settings-body').replaceChildren();
    setStatus('agent-settings-status', '', false);
    setStatus('connections-status', '', false);
    setStatus('providers-status', '', false);
    showNext(null);
    const workspace = currentWorkspace();
    if (!workspace) {
      setStatus('workspace-status', NO_PROJECT_COPY, false);
      showNext([
        el('p', { text: NO_PROJECT_HINT }),
        el('div', { className: 'ai-next-actions' }, [
          el('button', { className: 'ai-button', type: 'button', text: '다른 방법으로 로그인', onClick: signInAgain }),
          el('a', { className: 'ai-button secondary', href: '/support/', text: '도움말 보기' })
        ])
      ]);
      return;
    }
    writeStore(WORKSPACE_KEY, workspace.id);
    if (!workspace.ready) {
      setStatus('workspace-status', CODE_COPY.AI_ENGINE_PROFILE_NOT_READY, false);
      showNext([
        el('p', { text: NOT_READY_HINT }),
        el('div', { className: 'ai-next-actions' }, [
          el('button', { className: 'ai-button secondary', type: 'button', text: '다시 확인', onClick: recheckWorkspaces })
        ])
      ]);
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
    renderHandoffOffer();
    loadAgentSettings();
  }

  async function reloadConnections() {
    if (!state.user || !state.workspaceId) return;
    const seq = state.seq;
    const user = state.user;
    const workspaceId = state.workspaceId;
    try {
      const connections = await api(`/ai-engine-connections?${scopeQuery()}`, { method: 'GET' });
      if (seq !== state.seq || user !== state.user || workspaceId !== state.workspaceId) return;
      state.connections = sanitizeConnections(connections);
      renderConnections();
    } catch (error) {
      if (seq !== state.seq || user !== state.user || workspaceId !== state.workspaceId) return;
      showFailure(error, 'connections-status');
    }
  }

  // ---- Connections of this project ----------------------------------------------

  function renderConnections() {
    const list = $('connection-list');
    list.replaceChildren(...state.connections.map(connectionItem));
    $('connections-empty').hidden = state.connections.length > 0;
    $('connections-step').hidden = false;
    // No execution query is supported yet. Engine readiness cannot open it.
    $('execution-step').hidden = false;
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
    showRequestedProvider();
  }

  // /ai/?provider=<id>: the first time the catalog is drawn, the card of that
  // provider is marked, its group opened if it sits under "다른 AI 서비스", and
  // the page scrolls to it with its first button focused. Once only: a later
  // redraw (a project change, a finished connection) leaves the page alone. A
  // provider this catalog does not list is ignored.
  function showRequestedProvider() {
    const id = state.requestedProvider;
    if (!id) return;
    state.requestedProvider = '';
    const provider = state.catalog.find((item) => item.id === id);
    if (!provider) return;
    const card = Array.from(document.querySelectorAll('.provider-card'))
      .find((node) => node.getAttribute('data-provider') === provider.id);
    if (!card) return;
    if ($('provider-rest').contains(card)) $('provider-more').open = true;
    card.classList.add('is-requested');
    smoothScroll(card);
    const action = card.querySelector('button');
    if (action) action.focus({ preventScroll: true });
  }

  // The provider's mark, for a provider that has one published (PROVIDER_LOGOS); null for any other. It is decoration:
  // the name stands right beside it, so it has no alt text. Its width and height fix its box, so the card does not move
  // when the file arrives, and a file that does not load is taken out again instead of leaving a broken-image icon.
  function providerLogo(id) {
    if (!PROVIDER_LOGOS.includes(id)) return null;
    // src last: the image is asked for once every other attribute is in place.
    const logo = el('img', {
      className: 'provider-logo', alt: '', width: PROVIDER_LOGO_SIZE, height: PROVIDER_LOGO_SIZE, decoding: 'async',
      src: `/assets/ai/${id}.png`
    });
    logo.addEventListener('error', () => logo.remove(), { once: true });
    return logo;
  }

  function providerCard(provider) {
    const account = provider.methods.find((method) => method.kind === 'account');
    const noted = provider.methods.find((method) => method.note);
    const detail = (account && account.requirement) || (noted && noted.note) || '';
    const linked = state.connections.some((connection) => connection.provider === provider.id && connection.connected);
    return el('article', { className: 'provider-card', 'data-provider': provider.id }, [
      el('div', { className: 'provider-head' }, [
        providerLogo(provider.id),
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
    try { window.SidekickWebAnalytics?.track('ai_provider_connect_started',
      { provider: provider.id, connection_type: method.kind === 'account' ? 'oauth' : method.kind === 'free' ? 'none' : method.kind === 'cloud' ? 'cloud' : 'api_key' }); } catch (_) {}
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-step').hidden = false;
    setStatus('connect-status', '', false);
    if (method.kind === 'account') startAccount(flow);
    else if (method.kind === 'api_key') $('connect-body').replaceChildren(keyForm(flow));
    else if (method.kind === 'free') $('connect-body').replaceChildren(freeForm(flow));
    else if (method.kind === 'cloud') $('connect-body').replaceChildren(cloudForm(flow));
    smoothScroll($('connect-step'));
  }

  function stopFlow(flow) {
    flow.stopped = true;
    if (flow.timer) clearTimeout(flow.timer);
  }

  function closeFlow() {
    if (state.flow) stopFlow(state.flow);
    state.flow = null;
    $('connect-step').hidden = true;
    $('connect-body').replaceChildren();
    $('connect-cancel').textContent = '취소';
    setStatus('connect-status', '', false);
  }

  function live(flow) {
    return Boolean(flow) && !flow.stopped && state.flow === flow;
  }

  // ---- Back to the app -----------------------------------------------------------------------------
  //
  // The app opens this page in the device browser (?in_app=1) and refreshes its AI connections when it is brought back to
  // the front, so the way back only has to bring the app forward. It is a button that navigates, never a link:
  // /app-mode.js un-links every anchor that is not http(s) or mailto, so a link to the app's scheme would be dead.
  function inApp() {
    return document.documentElement.classList.contains('in-app');
  }

  function appReturnAddress(providerId) {
    const connected = typeof providerId === 'string' && PROVIDER_ID.test(providerId)
      && state.catalog.some((provider) => provider.id === providerId);
    return connected ? `${APP_RETURN_URL}?provider=${providerId}&status=connected` : APP_RETURN_URL;
  }

  function returnToApp(providerId) {
    try {
      window.SidekickWebAnalytics?.track('web_to_app_started', {
        transition_id: window.crypto.randomUUID(), from_surface: 'web_oauth',
        to_surface: /android/i.test(navigator.userAgent) ? 'android_app' : 'ios_app',
        reason: 'connect_ai_engine', return_expected: false, destination_type: 'app'
      });
    } catch (_) { /* a measurement never stands in the way of the way back */ }
    window.location.assign(appReturnAddress(providerId));
  }

  // ---- The finished state --------------------------------------------------------------------------

  function subjectOf(provider) {
    return `${provider.name}${SUBJECT_WITH_I.includes(provider.id) ? '이' : '가'}`;
  }

  function connectAnother() {
    closeFlow();
    smoothScroll($('providers-step'));
  }

  // The panel of a connection that ended well stays, and says so. A connection saved as needs_reconnect is not finished:
  // it keeps the warning the page has always shown, with no check mark and no way back to the app.
  function showConnected(provider, reconnect) {
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-cancel').textContent = '닫기';
    $('connect-step').hidden = false;
    setStatus('connect-status', '', false);
    if (reconnect) {
      fill($('connect-body'), [el('div', { className: 'connect-done is-warn', 'aria-live': 'polite' }, [
        el('p', { text: `${provider.name} 연결을 저장했지만 다시 연결이 필요해요. 한 번 더 연결해 주세요.` })
      ])]);
      return;
    }
    const back = inApp() ? el('button', {
      className: 'ai-button', type: 'button', text: '사이드킥 앱으로 돌아가기', onClick: () => returnToApp(provider.id)
    }) : null;
    const another = el('button', { className: 'ai-button secondary', type: 'button', text: '다른 AI 연결하기', onClick: connectAnother });
    const first = back || another;
    first.setAttribute('aria-describedby', 'connect-done-title connect-done-line');
    fill($('connect-body'), [el('div', { className: 'connect-done', 'aria-live': 'polite' }, [
      el('span', { className: 'connected-mark', 'aria-hidden': 'true' }),
      el('h3', { id: 'connect-done-title', text: `${subjectOf(provider)} 연결됐어요` }),
      el('p', { id: 'connect-done-line', text: '이 프로젝트의 새 업무부터 이 AI로 일해요.' }),
      el('div', { className: 'connect-actions' }, [back, another]),
      back ? el('p', { className: 'ai-note', text: RETURN_HINT }) : null
    ])]);
    first.focus({ preventScroll: true });
  }

  async function finishFlow(flow, connection) {
    const name = flow.provider.name;
    const reconnect = Boolean(connection && connection.status === 'needs_reconnect');
    // Only a panel the person is still looking at is kept open; one they closed while the last answer was on its way stays closed.
    const watching = live(flow);
    stopFlow(flow);
    setStatus('connections-status', reconnect
      ? `${name} 연결을 저장했지만 다시 연결이 필요해요. 한 번 더 연결해 주세요.`
      : `${name} 연결됐어요. 이 프로젝트의 새 업무부터 이 AI로 일해요.`, false);
    if (watching) showConnected(flow.provider, reconnect);
    await reloadConnections();
    renderProviders();
    if (watching && state.flow === flow) smoothScroll($('connect-step'));
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
    try { window.SidekickWebAnalytics?.track('ai_provider_oauth_started',
      { provider: flow.provider.id, connection_type: flow.method.flow === 'device_code' ? 'device_code' : 'oauth' }); } catch (_) {}
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

  // Copy `text` to the clipboard. This is called from a click, and the write BEGINS inside this call, before it returns,
  // so the click still counts as the person's own action; nothing here waits before it starts. The answer is true when the
  // text was copied. A browser without the clipboard API (or one that refuses it) is tried once more by selecting the text
  // in a scratch field, the way every browser has always allowed.
  function copyCode(text) {
    let write = null;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') write = navigator.clipboard.writeText(text);
    } catch (_) { write = null; }
    if (!write) return Promise.resolve(copyBySelection(text));
    return write.then(() => true, () => copyBySelection(text));
  }

  function copyBySelection(text) {
    const held = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'copy-scratch';
    document.body.append(area);
    let copied = false;
    try {
      area.select();
      area.setSelectionRange(0, text.length);
      copied = document.execCommand('copy');
    } catch (_) { copied = false; }
    area.remove();
    if (held && typeof held.focus === 'function') held.focus({ preventScroll: true });
    return copied;
  }

  // The code as the provider printed it, in groups the eye can hold. The text stays exactly the code (a hyphen is part of
  // it, and a selected or copied code must paste as the provider wrote it); only the space between groups is drawn.
  function codeGroups(code) {
    const hyphen = code.includes('-');
    const pieces = hyphen ? code.split('-') : code.length >= 8 ? code.match(/.{1,4}/g) : [code];
    const nodes = [];
    pieces.forEach((piece, index) => {
      if (index && hyphen) nodes.push(document.createTextNode('-'));
      nodes.push(el('span', { className: 'code-group', text: piece }));
    });
    return nodes;
  }

  // A code to type is the hard part of this login: the person leaves for the provider's page, is sent a six-digit number by
  // SMS or mail, copies it, and the code is gone from the clipboard. So the first button copies and opens in one click, the
  // second copies again at any time, and coming back to this tab says so and points at it. (A web page cannot put anything
  // into the keyboard's suggestion bar, and it cannot see what another app put on the clipboard.)
  function showDeviceCode(flow, started) {
    const code = cleanText(started.user_code, 64);
    const name = flow.provider.name;
    // Two lines a screen reader hears when they fill; they stay empty until there is something to say.
    const copied = el('p', { className: 'ai-note', 'aria-live': 'polite' });
    const hint = el('p', { className: 'ai-note', 'aria-live': 'polite' });
    const tell = (done) => {
      copied.textContent = done
        ? `코드를 복사했어요. ${name} 화면의 코드 칸을 길게 눌러 '붙여넣기'를 눌러 주세요.`
        : '코드를 직접 복사해 주세요.';
    };
    const shown = code ? el('output', { className: 'device-code-value', 'aria-label': '로그인 코드' }, codeGroups(code)) : null;
    const copyAndOpen = code ? el('button', { className: 'ai-button wrap', type: 'button', text: `코드 복사하고 ${name} 열기` }) : null;
    const recopy = code ? el('button', { className: 'ai-button secondary wrap', type: 'button', text: '코드 다시 복사' }) : null;
    const actions = el('div', { className: 'connect-actions' }, code ? [copyAndOpen, recopy] : [openLoginPageButton(flow)]);
    if (code) {
      // One click does both, and nothing is awaited between them: the copy is started first (the clipboard write begins in
      // that very call), then the provider's page opens from the same click, so no pop-up blocker stands in the way, and
      // noopener keeps that page from reaching back into this one. What the copy came to is told afterwards.
      copyAndOpen.addEventListener('click', () => {
        const pending = copyCode(code);
        window.open(flow.authorizationUrl, '_blank', 'noopener');
        pending.then(tell);
      });
      recopy.addEventListener('click', () => {
        recopy.classList.remove('is-emphasis');
        copyCode(code).then(tell);
      });
      // Back from the provider's page while the login is still waited for.
      flow.onReturn = () => {
        hint.textContent = `${name}의 코드 칸이 비어 있으면 '코드 다시 복사'를 누르고 붙여넣어 주세요.`;
        recopy.classList.add('is-emphasis');
      };
    }
    // The code ran out: what was shown can no longer be used, and a new one is one press away (the same login, again).
    flow.onExpire = () => {
      Array.from(actions.querySelectorAll('button')).forEach((button) => { button.disabled = true; });
      if (shown) shown.classList.add('is-expired');
      actions.append(el('button', {
        className: 'ai-button', type: 'button', text: '새 코드 받기', onClick: () => openFlow(flow.provider, flow.method)
      }));
    };
    fill($('connect-body'), [
      el('p', { className: 'ai-note', text: code
        ? `${name} 로그인 페이지를 열어 아래 코드를 입력하면 연결돼요.`
        : `${name} 로그인 페이지에서 로그인하고 연결을 허용해 주세요.` }),
      shown ? el('div', { className: 'device-code' }, [shown]) : null,
      actions,
      code ? copied : null,
      code ? hint : null,
      requirementNote(flow),
      code ? el('p', { className: 'ai-note', text: CODE_TIP }) : null,
      el('p', { className: 'ai-note', text: '로그인을 마치고 이 페이지로 돌아오면 바로 확인해요. 연결을 확인할 때 실제 테스트 답변을 한 번 받아 봐서 최대 3분까지 걸릴 수 있어요.' })
    ]);
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
      stopFlow(flow);
      setStatus('connect-status', CODE_COPY.AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED, true);
      if (flow.onExpire) flow.onExpire();
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
      stopFlow(flow);
      showFailure(failure, 'connect-status');
      // The server says the code ran out: the same way on as a code that ran out here.
      if ((failure.status === 410 || failure.code === 'AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED') && flow.onExpire) flow.onExpire();
      return;
    }
    schedulePoll(flow, flow.interval);
  }

  // Timers in a background tab are throttled, and the moment the person comes
  // back from the login tab is exactly when the answer is ready.
  document.addEventListener('visibilitychange', () => {
    const flow = state.flow;
    if (document.visibilityState !== 'visible' || !live(flow) || !flow.interval) return;
    if (flow.onReturn) flow.onReturn();
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
    fill($('connect-body'), [
      el('p', { className: 'ai-note', text: `${flow.provider.name} 로그인 페이지에서 로그인한 뒤, 화면에 나온 코드를 복사해 아래에 붙여넣어 주세요.` }),
      el('div', { className: 'connect-actions' }, [openLoginPageButton(flow)]),
      requirementNote(flow),
      form
    ]);
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

  // ---- The ChatGPT account the person just signed in with --------------------------

  // Offered for the selected project once it is ready, and only to the account
  // that signed in (auth.js checks both the tab and the account). The claim
  // checks the account with one real answer before it is saved, like every
  // other connection on this page.
  function renderHandoffOffer() {
    const workspace = currentWorkspace();
    const offer = state.user && workspace && workspace.ready ? auth.chatGptHandoff() : null;
    if (!offer) { $('handoff-step').hidden = true; return; }
    $('handoff-note').textContent = `방금 로그인한 ChatGPT 계정을 ‘${workspace.name}’ 프로젝트의 AI로 바로 연결할 수 있어요. ChatGPT에 다시 로그인하지 않아도 돼요.`;
    $('handoff-proof').textContent = PROOF_NOTE;
    setStatus('handoff-status', '', false);
    $('handoff-step').hidden = false;
  }

  function dropHandoff(message, isError) {
    auth.forgetChatGptHandoff();
    $('handoff-step').hidden = true;
    setStatus('handoff-status', '', false);
    if (message) setStatus('providers-status', message, isError);
  }

  async function claimHandoff() {
    const offer = auth.chatGptHandoff();
    const workspace = currentWorkspace();
    if (!offer || !state.user || !workspace || !workspace.ready || state.busy) return;
    const controls = [$('handoff-connect'), $('handoff-dismiss')];
    const workspaceId = workspace.id;
    setBusy(true, controls);
    setStatus('handoff-status', PROOF_PROGRESS, false);
    let result = null;
    try {
      result = await longCall('/ai-engine/login-handoff/claim', {
        method: 'POST',
        body: JSON.stringify({ ...scope(), state: offer.state, code: offer.code })
      });
    } catch (error) {
      setBusy(false, controls);
      if (error.status === 401) { showFailure(error, 'handoff-status'); return; }
      if (HANDOFF_SPENT_COPY[error.code]) { dropHandoff(HANDOFF_SPENT_COPY[error.code], error.code !== 'AI_ENGINE_HANDOFF_ALREADY_CLAIMED'); }
      // A check that ran and failed is not an expired offer: say what failed and
      // leave the offer up so the person can fix the account and try again.
      else if (error.code === 'AI_ENGINE_CONNECTION_VERIFICATION_FAILED' || error.code === 'AI_ENGINE_CONNECTION_ANSWER_FAILED') { setStatus('handoff-status', CODE_COPY[error.code], true); }
      else if (error.status === 400 || error.status === 410 || (error.status === 409 && !CODE_COPY[error.code])) { dropHandoff(HANDOFF_EXPIRED_COPY, true); }
      else setStatus('handoff-status', errorCopy(error), true);
      if (state.user && workspaceId === state.workspaceId) await reloadConnections();
      return;
    }
    setBusy(false, controls);
    dropHandoff('', false);
    const connection = result && result.connection;
    const reconnect = Boolean(connection && connection.status === 'needs_reconnect');
    setStatus('connections-status', reconnect
      ? 'ChatGPT 연결을 저장했지만 다시 연결이 필요해요. 아래에서 한 번 더 연결해 주세요.'
      : 'ChatGPT 연결됐어요. 이 프로젝트의 새 업무부터 이 AI로 일해요.', false);
    if (!state.user || workspaceId !== state.workspaceId) return;
    // The same finished state as every other way of connecting; a login being made in the panel is over.
    closeFlow();
    showConnected(handoffProvider(connection), reconnect);
    await reloadConnections();
    renderProviders();
    smoothScroll($('connect-step'));
  }

  // The provider a claimed ChatGPT account connected: the connection's own id when it names one the page can use,
  // ChatGPT otherwise.
  function handoffProvider(connection) {
    const id = connection && PROVIDER_ID.test(String(connection.provider || '')) ? String(connection.provider) : 'openai';
    return state.catalog.find((provider) => provider.id === id)
      || { id, name: providerName(id), featured: false, endpointRequired: false, methods: [] };
  }

  // ---- AI 직원 실행 설정 ----------------------------------------------------------------------------
  //
  // Shown under the provider cards for the chosen, ready project. Two groups, both read from the person's own server and
  // written back to it, each control one real setting:
  //   실행 방식 -- GET/PUT /hermes-agent/settings (anyone in the project reads; only the owner writes), and
  //   도구 -- the Hermes toolsets the nine names in TOOLSETS stand for, through the owner-only relay.
  // The rules this section keeps: it is drawn only when everything it shows has been read (one sentence and a retry
  // instead while it is read, slow, refused or unreachable); a change locks the controls, asks the server, and then draws
  // what the SERVER says -- the tools list is read again after every switch -- so a switch never shows a state the server
  // does not have; a change that fails puts the old value back with one short sentence; and the server's own sentences are
  // never shown.

  function malformed() {
    return Object.assign(new Error('malformed'), { status: 0, network: false });
  }

  // Every read or change is one ticket, checked when its answer arrives: an answer for another project, an earlier read
  // or a page that has since signed out paints nothing.
  function agentTicket() {
    return { run: ++state.agent.run, seq: state.seq, user: state.user, workspaceId: state.workspaceId };
  }

  function agentCurrent(ticket) {
    return ticket.run === state.agent.run && ticket.seq === state.seq && ticket.user === state.user
      && ticket.workspaceId === state.workspaceId;
  }

  async function agentCall(path, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await api(path, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function toolsetPath(name) {
    const tool = TOOLSETS.find((item) => item.name === name);
    return tool ? `${TOOLSETS_PATH}/${tool.name}` : '';
  }

  // The two requests this page sends through the relay, and no others: the list of toolsets, and one switch of one tool on
  // the page's own list. (Not /api/env, not /api/config/raw, not any other write.)
  async function relayToolsets(name, body, ms) {
    const reading = name === undefined;
    const path = reading ? TOOLSETS_PATH : toolsetPath(name);
    if (!path) throw malformed();
    const answer = await agentCall('/hermes-agent/native/request', {
      method: 'POST',
      body: JSON.stringify({ ...scope(), method: reading ? 'GET' : 'PUT', path, body: reading ? null : body, query: {} })
    }, ms);
    const status = answer && Number.isInteger(answer.status) ? answer.status : 0;
    if (status < 200 || status >= 300) throw Object.assign(new Error('relay_refused'), { status: 0, network: false, relay: status });
    return answer.data;
  }

  function sanitizeAgentSettings(value) {
    const raw = value && typeof value === 'object' && value.settings && typeof value.settings === 'object' ? value.settings : null;
    if (!raw) return null;
    return {
      reasoning: typeof raw.reasoning_level === 'string' ? raw.reasoning_level : '',
      runtime: Number.isInteger(raw.max_runtime_minutes) ? raw.max_runtime_minutes : 0,
      approval: typeof raw.approval_policy === 'string' ? raw.approval_policy : '',
      paused: value.paused === true,
      canPause: value.canPause !== false
    };
  }

  // The server's list, cut down to the nine tools this page knows: in the page's order, by the page's own names. A name
  // that is not on the page's list is dropped here, so nothing the server sends can become a row or a request path.
  function sanitizeToolsets(value) {
    if (!Array.isArray(value)) return null;
    const listed = new Map();
    value.forEach((row) => {
      if (row && typeof row === 'object' && typeof row.name === 'string' && !listed.has(row.name)) listed.set(row.name, row);
    });
    return TOOLSETS.filter((tool) => listed.has(tool.name)).map((tool) => ({
      ...tool, enabled: listed.get(tool.name).enabled === true, configured: listed.get(tool.name).configured !== false
    }));
  }

  async function readAgentSettings() {
    const settings = sanitizeAgentSettings(await agentCall(`/hermes-agent/settings?${scopeQuery()}`, { method: 'GET' }, SETTINGS_READ_MS));
    if (!settings) throw malformed();
    return settings;
  }

  async function readToolsets() {
    const tools = sanitizeToolsets(await relayToolsets(undefined, undefined, SETTINGS_READ_MS));
    if (!tools) throw malformed();
    return tools;
  }

  // What a failed request means to the person. The server's code only picks the sentence.
  function agentFailure(error) {
    if (error && error.status === 401) return 'signed-out';
    if (error && error.aborted) return 'slow';
    if (error && error.network) return 'network';
    if (error && error.status === 403) return 'owner';
    if (error && error.status === 503) return 'unavailable';
    return 'failed';
  }

  // The person's own server may be asleep. Asking it to wake is what the app does too (POST /hermes-agent/runtime-wake);
  // here it is asked once per window for a project, and the answer is not waited for.
  function wakeRuntime() {
    const agent = state.agent;
    const now = Date.now();
    if (agent.wokeFor === state.workspaceId && now - agent.wokeAt < WAKE_WINDOW_MS) return;
    agent.wokeFor = state.workspaceId;
    agent.wokeAt = now;
    api('/hermes-agent/runtime-wake', { method: 'POST', body: JSON.stringify(scope()) }).catch(() => {});
  }

  // How the two reads of one load came out, as the one state the section draws.
  function agentReadKind(settings, tools) {
    const kinds = [settings, tools].filter((result) => result.status === 'rejected').map((result) => agentFailure(result.reason));
    for (const kind of ['signed-out', 'slow', 'unavailable', 'network']) {
      if (kinds.includes(kind)) return kind;
    }
    if (settings.status === 'rejected') return 'failed';
    if (tools.status === 'rejected') return kinds[0] === 'owner' ? 'owner' : 'failed';
    return 'ready';
  }

  async function loadAgentSettings() {
    const agent = state.agent;
    const ticket = agentTicket();
    Object.assign(agent, { phase: 'loading', settings: null, tools: null, busy: false, readOnly: false });
    setStatus('agent-settings-status', '', false);
    $('agent-settings-step').hidden = false;
    drawAgent();
    const [settings, tools] = await Promise.allSettled([readAgentSettings(), readToolsets()]);
    if (!agentCurrent(ticket)) return;
    const kind = agentReadKind(settings, tools);
    if (kind === 'signed-out') { signOutHere(STATUS_COPY[401]); return; }
    if (kind === 'ready' || kind === 'owner') {
      // An owner-only refusal of the tools still shows the settings, read-only, with the tools group saying why.
      Object.assign(agent, { phase: 'ready', settings: settings.value, tools: kind === 'owner' ? 'owner' : tools.value, readOnly: kind === 'owner' });
    } else {
      agent.phase = kind;
      if (kind === 'unavailable') wakeRuntime();
    }
    drawAgent();
  }

  function drawAgent(keep) {
    const agent = state.agent;
    const body = $('agent-settings-body');
    body.setAttribute('aria-busy', agent.phase === 'loading' ? 'true' : 'false');
    if (agent.phase === 'ready') {
      fill(body, [agentRunGroup(), agentToolsGroup()]);
    } else {
      fill(body, [
        el('p', { className: 'settings-state', text: AGENT_STATE_COPY[agent.phase] || AGENT_STATE_COPY.failed }),
        agent.phase === 'loading' ? null : el('button', { className: 'ai-button secondary', type: 'button', text: '다시 시도', onClick: () => loadAgentSettings() })
      ]);
    }
    if (keep) focusAgentControl(keep);
  }

  // A redraw replaces the controls; the one the person was using gets the focus back, unless it has gone somewhere else.
  function focusAgentControl(key) {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const nodes = Array.from($('agent-settings-body').querySelectorAll('[data-control]')).filter((node) => node.getAttribute('data-control') === key);
    const target = nodes.find((node) => node.checked) || nodes[0];
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }

  function lockAgentControls() {
    Array.from($('agent-settings-body').querySelectorAll('[data-control]')).forEach((control) => { control.disabled = true; });
  }

  function switchRow(spec) {
    const input = el('input', {
      className: 'switch', type: 'checkbox', role: 'switch', disabled: spec.disabled, 'data-control': spec.control,
      'data-tool': spec.tool || false, 'aria-label': spec.title, 'aria-describedby': `${spec.id}-line`
    });
    input.checked = spec.checked;
    input.addEventListener('change', () => spec.onChange(input.checked));
    return el('label', { className: 'switch-row' }, [
      el('span', { className: 'switch-text' }, [
        el('strong', { text: spec.title }),
        el('span', { className: 'switch-line', id: `${spec.id}-line`, text: spec.line }),
        spec.need ? el('span', { className: 'switch-need', text: spec.need }) : null
      ]),
      input
    ]);
  }

  function segmentField(spec) {
    return el('fieldset', { className: 'setting' }, [
      el('legend', { text: spec.legend }),
      el('div', { className: 'segments' }, spec.options.map((option) => {
        const input = el('input', { type: 'radio', name: `agent-${spec.control}`, value: String(option.id), disabled: spec.disabled, 'data-control': spec.control });
        input.checked = option.id === spec.value;
        input.addEventListener('change', () => spec.onSelect(option.id));
        return el('label', { className: 'segment' }, [input, el('span', { text: option.label })]);
      })),
      el('p', { className: 'ai-note', text: spec.line })
    ]);
  }

  function agentRunGroup() {
    const agent = state.agent;
    const settings = agent.settings;
    const locked = agent.busy || agent.readOnly;
    const approval = APPROVAL_OPTIONS.find((option) => option.id === settings.approval);
    const depth = REASONING_OPTIONS.find((option) => option.id === settings.reasoning);
    return el('section', { className: 'settings-group' }, [
      el('h3', { text: '실행 방식' }),
      switchRow({
        id: 'agent-intake', control: 'paused', title: '새 작업 받기', checked: !settings.paused, disabled: locked || !settings.canPause,
        line: settings.paused ? '지금은 새 작업을 받지 않아요. 켜면 바로 다시 받아요' : '끄면 진행 중인 일은 끝까지 하고, 새 작업만 잠시 쉬어요',
        need: settings.canPause ? '' : '지금은 바꿀 수 없어요',
        onChange: (on) => changeSettings({ paused: !on }, 'paused')
      }),
      segmentField({
        control: 'reasoning_level', legend: '생각 깊이', options: REASONING_OPTIONS, value: settings.reasoning, disabled: locked,
        line: depth ? depth.line : `현재 설정: ${NATIVE_REASONING.get(settings.reasoning) || '확인 필요'}`,
        onSelect: (id) => changeSettings({ settings: { reasoning_level: id } }, 'reasoning_level')
      }),
      segmentField({
        control: 'max_runtime_minutes', legend: '한 작업에 쓰는 최대 시간', options: RUNTIME_OPTIONS, value: settings.runtime, disabled: locked,
        line: '이 시간을 넘기면 작업을 멈추고 거기까지의 결과를 알려줘요',
        onSelect: (id) => changeSettings({ settings: { max_runtime_minutes: id } }, 'max_runtime_minutes')
      }),
      segmentField({
        control: 'approval_policy', legend: '확인 요청 기준', options: APPROVAL_OPTIONS, value: settings.approval, disabled: locked,
        line: approval ? approval.line : '현재 설정: 확인 필요',
        onSelect: (id) => changeSettings({ settings: { approval_policy: id } }, 'approval_policy')
      })
    ]);
  }

  function agentToolsGroup() {
    const agent = state.agent;
    if (agent.tools === 'owner') {
      return el('section', { className: 'settings-group' }, [
        el('h3', { text: '도구' }),
        el('p', { className: 'settings-state', text: OWNER_ONLY_COPY })
      ]);
    }
    const locked = agent.busy || agent.readOnly;
    const rows = agent.tools.map((tool) => switchRow({
      id: `agent-tool-${tool.name.split('_').join('-')}`, control: `tool-${tool.name}`, tool: tool.name, title: tool.title, line: tool.line,
      need: tool.configured ? '' : '추가 설정이 필요해요', checked: tool.enabled, disabled: locked,
      onChange: (on) => changeTool(tool, on)
    }));
    return el('section', { className: 'settings-group' }, [
      el('h3', { text: '도구' }),
      rows.length ? el('p', { className: 'ai-note', text: '켜 둔 도구만 AI 직원이 써요.' }) : el('p', { className: 'settings-state', text: '지금 바꿀 수 있는 도구가 없어요.' }),
      ...rows
    ]);
  }

  const SETTING_FIELDS = { reasoning_level: 'reasoning', max_runtime_minutes: 'runtime', approval_policy: 'approval' };
  const KEPT_COPY = '바뀌지 않았어요. 지금 상태를 그대로 보여 드려요.';

  function settingsMatch(change, settings) {
    if (typeof change.paused === 'boolean' && settings.paused !== change.paused) return false;
    return Object.entries(change.settings || {}).every(([key, value]) => settings[SETTING_FIELDS[key]] === value);
  }

  // A change that did not go through: the controls come back with the values they had, and one short sentence says so.
  function agentChangeFailed(kind, control) {
    const agent = state.agent;
    if (kind === 'signed-out') { signOutHere(STATUS_COPY[401]); return; }
    agent.busy = false;
    if (kind === 'owner') agent.readOnly = true;
    if (kind === 'unavailable') wakeRuntime();
    drawAgent(control);
    setStatus('agent-settings-status', CHANGE_COPY[kind] || CHANGE_COPY.failed, true);
  }

  // A change that went through but whose result could not be read back: nothing is drawn that is not known.
  function agentUnconfirmed(kind) {
    const agent = state.agent;
    if (kind === 'signed-out') { signOutHere(STATUS_COPY[401]); return; }
    agent.busy = false;
    agent.phase = AGENT_STATE_COPY[kind] ? kind : 'failed';
    setStatus('agent-settings-status', '', false);
    if (agent.phase === 'unavailable') wakeRuntime();
    drawAgent();
  }

  async function changeSettings(change, control) {
    const agent = state.agent;
    if (agent.phase !== 'ready' || agent.busy || agent.readOnly) { drawAgent(control); return; }
    const ticket = agentTicket();
    agent.busy = true;
    lockAgentControls();
    setStatus('agent-settings-status', '저장하고 있어요…', false);
    let answer = null;
    try {
      answer = await agentCall('/hermes-agent/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...scope(), settings: change.settings || {}, ...(typeof change.paused === 'boolean' ? { paused: change.paused } : {}) })
      }, SETTINGS_WRITE_MS);
    } catch (error) {
      if (agentCurrent(ticket)) agentChangeFailed(agentFailure(error), control);
      return;
    }
    if (!agentCurrent(ticket)) return;
    // The server answers a change with the settings as they now are; that, not what was asked, is what is drawn.
    let settings = sanitizeAgentSettings(answer);
    if (!settings) {
      try {
        settings = await readAgentSettings();
      } catch (error) {
        if (agentCurrent(ticket)) agentUnconfirmed(agentFailure(error));
        return;
      }
      if (!agentCurrent(ticket)) return;
    }
    agent.busy = false;
    agent.settings = settings;
    drawAgent(control);
    const kept = settingsMatch(change, settings);
    setStatus('agent-settings-status', kept ? '' : KEPT_COPY, !kept);
  }

  async function changeTool(tool, enabled) {
    const agent = state.agent;
    const control = `tool-${tool.name}`;
    if (agent.phase !== 'ready' || agent.busy || agent.readOnly || !Array.isArray(agent.tools)) { drawAgent(control); return; }
    const ticket = agentTicket();
    agent.busy = true;
    lockAgentControls();
    setStatus('agent-settings-status', '바꾸고 있어요…', false);
    let answer = null;
    try {
      answer = await relayToolsets(tool.name, { enabled }, SETTINGS_WRITE_MS);
    } catch (error) {
      if (agentCurrent(ticket)) agentChangeFailed(agentFailure(error), control);
      return;
    }
    if (!agentCurrent(ticket)) return;
    // The page does not take its own word for it: the list is read again, and the switch shows what the server says now.
    let tools;
    try {
      tools = await readToolsets();
    } catch (error) {
      if (agentCurrent(ticket)) agentUnconfirmed(agentFailure(error));
      return;
    }
    if (!agentCurrent(ticket)) return;
    agent.busy = false;
    agent.tools = tools;
    drawAgent(control);
    const now = tools.find((item) => item.name === tool.name);
    if (!now || now.enabled !== enabled) setStatus('agent-settings-status', KEPT_COPY, true);
    else if (enabled && answer && answer.post_setup_started) setStatus('agent-settings-status', '켰어요. 준비에 몇 분 걸릴 수 있어요.', false);
    else setStatus('agent-settings-status', '', false);
  }

  // ---- Wiring ----------------------------------------------------------------------

  $('workspace-select').addEventListener('change', (event) => {
    if (state.busy) { event.target.value = state.workspaceId; return; }
    state.workspaceId = event.target.value;
    loadWorkspaceData();
  });
  $('connect-cancel').addEventListener('click', closeFlow);
  $('return-top').addEventListener('click', () => returnToApp());
  $('open-signin').addEventListener('click', () => auth.open());
  $('handoff-connect').addEventListener('click', claimHandoff);
  $('handoff-dismiss').addEventListener('click', () => dropHandoff('', false));

  auth.init({
    onSignedIn: () => boot(),
    // 로그아웃 from the header menu, in another tab, or an expiry: /auth.js has
    // already ended the session. What this page kept for this tab (the chosen
    // project, a login waiting on a redirect) belonged to that account.
    onSignedOut: () => {
      writeStore(WORKSPACE_KEY, '');
      writeStore(FLOW_KEY, '');
      signOutHere('로그아웃했어요.', false);
    },
    onNotice: (message, isError) => setStatus('signin-status', message, isError)
  }).then(() => boot());
})();
