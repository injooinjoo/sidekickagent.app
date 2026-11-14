(() => {
  'use strict';

  // Connect an AI account or key for the person, on the web.
  //
  // The AI is the person's, not one project's (owner, 2026-10-07): it is connected once and every project they own
  // runs on it, a project made later too, so the page has no project picker. The backend keeps one copy per project and
  // answers every AI-engine route with the account's connection whichever ready project is named
  // (apps/backend/app/ai_engine_account.py); the page names one (state.workspaceId) and never shows it: no AI-connection
  // screen shows a project (owner, 2026-11-14: "LLM 연동은 계정 단위야"), so there is no per-project setting here either.
  //
  // Sign-in is the shared /auth.js. Everything else is the backend's AI-engine
  // routes, the same ones the app calls: the project list, the provider catalog,
  // the account logins (a device code, or a redirect that returns here), the key
  // and cloud forms, and the account's connections with
  // their model choice and disconnect. No secret stays on this page: a key goes
  // out once in a request body, and nothing this page keeps in sessionStorage is
  // a token or a code. After a ChatGPT sign-in it also offers to make that same
  // ChatGPT account the person's AI (auth.js holds the one-time claim).
  //
  // Keys are typed here, so the page loads no analytics and no other site's script (owner 2026-10-25), and measures
  // nothing. A key field is cleared the moment it is submitted, and a connected key can be changed in place
  // (다시 연결 on its row: the same provider is connected again; the server retires the old key). /connections/ lists every
  // connection of the account, this AI among them.
  const auth = window.SidekickAuth;
  const { api } = auth;
  // OpenRouter sends the person back here with ?code=. The backend is told this
  // exact address at start and compares it again at complete.
  const CALLBACK_URL = 'https://sidekickagent.app/ai/';
  // What must survive that round trip: which login it is and which project it
  // was asked through. Never a token and never a code.
  const FLOW_KEY = 'sidekick_web_ai_pending_flow';
  const FLOW_MAX_AGE_MS = 30 * 60 * 1000;
  // The project this tab asks the AI routes through, so a reload keeps asking through the same one. Never shown.
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
    fireworks: 'Fireworks', novita: 'NovitaAI', xiaomi: 'Xiaomi MiMo', 'tencent-tokenhub': 'Tencent TokenHub',
    huggingface: 'Hugging Face', stepfun: 'StepFun', kilocode: 'Kilo Code', 'ollama-cloud': 'Ollama Cloud', 'ai-gateway': 'AI Gateway',
    'azure-foundry': 'Azure AI Foundry', '9router': '9Router', omniroute: 'OmniRoute'
  };
  // The providers whose official mark is published with this site, at /assets/ai/<id>.png: the same transparent
  // artwork the app bundles (apps/mobile/app/assets/ai-engines/), 192x192, drawn here at 40x40. The ids are the
  // catalog's own. A provider that is not listed keeps the text-only card; nothing is ever asked of another host.
  const PROVIDER_LOGOS = [
    'anthropic', 'copilot', 'deepseek', 'gemini', 'kimi', 'meta', 'minimax', 'mistral',
    'nous', 'nvidia', 'openai', 'openrouter', 'qwen', 'xai', 'zai',
    'ai-gateway', 'fireworks', 'huggingface', 'kilocode', 'novita', 'ollama-cloud', 'stepfun', 'tencent-tokenhub', 'xiaomi'
  ];
  const PROVIDER_LOGO_SIZE = 20;
  // The order of the providers (owner, 2026-10-26): ChatGPT, Claude, Gemini and Grok first, then every other one in the
  // server's order. Which providers exist is still the server's answer; this only orders them.
  const AI_ENGINE_LIST_ORDER = ['openai', 'anthropic', 'gemini', 'xai'];
  // A model's name as people read it ('claude-sonnet-5' -> 'Sonnet 5', 'gpt-5.6-terra' -> 'GPT-5.6 Terra'): the same rules,
  // word for word, as the app's names for models (apps/mobile/app/data/aiEngineIdentity.js MODEL_LABEL_RULES;
  // apps/site/test_ai_connect_page.py holds the two together). A model no rule names is shown by its id.
  const SNAPSHOT_SEGMENTS = /(?:^|[-_:])(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{3,8})(?=$|[-_:])/g;
  // OpenAI 가 소문자로 쓰는 크기 낱말('GPT-4o mini', 'o3 pro'). 그 밖의 낱말은 첫 글자를 대문자로 쓴다('Terra', 'Sol', 'Turbo').
  const OPENAI_LOWER_WORDS = (['mini', 'nano', 'pro']);

  function variantSuffix(rest, lowerWords = []) {
    return String(rest || '')
      .replace(SNAPSHOT_SEGMENTS, '')
      .split(/[-_:\s]+/)
      .filter(Boolean)
      .map((word) => {
        if (lowerWords.includes(word.toLowerCase())) return ` ${word.toLowerCase()}`;
        return /^[a-z]/i.test(word) ? ` ${word[0].toUpperCase()}${word.slice(1)}` : ` ${word}`;
      })
      .join('');
  }

  // 정확한 이름표. 순서가 곧 우선순위라 앞의 규칙이 이긴다. 규칙은 (맞은 조각, 맞은 뒤에 남은 식별자)를 받는다. 작은 버전은 한두
  // 자리뿐이라 'claude-opus-4-20250514' 의 날짜가 버전(4.20250514)으로 읽히지 않는다.
  const MODEL_LABEL_RULES = ([
    [/^claude-opus-(\d+)(?:[.-](\d{1,2})(?!\d))?/i, (m) => `Opus ${m[1]}${m[2] ? `.${m[2]}` : ''}`],
    [/^claude-sonnet-(\d+)(?:[.-](\d{1,2})(?!\d))?/i, (m) => `Sonnet ${m[1]}${m[2] ? `.${m[2]}` : ''}`],
    [/^claude-haiku-(\d+)(?:[.-](\d{1,2})(?!\d))?/i, (m) => `Haiku ${m[1]}${m[2] ? `.${m[2]}` : ''}`],
    [/^claude-(\d+)(?:[.-](\d+))?-(opus|sonnet|haiku)/i, (m) => `${m[3][0].toUpperCase()}${m[3].slice(1)} ${m[1]}${m[2] ? `.${m[2]}` : ''}`],
    [/^claude$/i, () => 'Claude'],
    [/^gpt-oss-(\d+)b/i, (m) => `GPT-OSS ${m[1]}B`],
    [/^gpt-(\d+(?:\.\d+)?)(o)?(?![a-z0-9])/i, (m, rest) => `GPT-${m[1]}${m[2] ? 'o' : ''}${variantSuffix(rest, OPENAI_LOWER_WORDS)}`],
    [/^o(\d+)(?![a-z0-9])/i, (m, rest) => `o${m[1]}${variantSuffix(rest, OPENAI_LOWER_WORDS)}`],
    [/^gemini-(\d+(?:\.\d+)?)(?![a-z0-9])/i, (m, rest) => `Gemini ${m[1]}${variantSuffix(rest)}`],
    [/^grok-(\d+)(?:[.-](\d{1,2})(?!\d))?(?![a-z0-9])/i, (m, rest) => `Grok ${m[1]}${m[2] ? `.${m[2]}` : ''}${variantSuffix(rest)}`],
    [/^deepseek-(?:v)?(\d+(?:\.\d+)?)/i, (m) => `DeepSeek ${m[1]}`],
    [/^deepseek-(chat|reasoner)/i, (m) => `DeepSeek ${m[1] === 'chat' ? 'V3' : 'R1'}`],
    [/^deepseek-r(\d+)/i, (m) => `DeepSeek R${m[1]}`],
    [/^qwen(\d+(?:\.\d+)?)/i, (m) => `Qwen ${m[1]}`],
    [/^kimi-k(\d+)/i, (m) => `Kimi K${m[1]}`],
    [/^glm-(\d+(?:\.\d+)?)/i, (m) => `GLM ${m[1]}`],
    [/^minimax-(m\d+)/i, (m) => `MiniMax ${m[1].toUpperCase()}`],
    [/^llama-(\d+(?:\.\d+)?)/i, (m) => `Llama ${m[1]}`],
    [/^mistral-(\w+)/i, (m) => `Mistral ${m[1][0].toUpperCase()}${m[1].slice(1)}`],
  ]);

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
      { id: 'endpoint_url', label: '연결 주소', hint: "Azure 포털의 '엔드포인트'나 '대상 URI'를 그대로 붙여넣어요. 예: https://내리소스.openai.azure.com", secret: false, multiline: false },
      { id: 'api_key', label: '연결 키', hint: "Azure 포털의 '키 1' 또는 '키 2' 값이에요.", secret: true, multiline: false }
    ]
  };
  // Azure addresses a model by the name its owner gave the deployment. The server's cloud credential has no field for it,
  // so it travels as the request's `model`, which is what the server stores and shows as this connection's model.
  const AZURE_DEPLOYMENT_FIELD = { id: 'deployment_name', label: '배포 이름', hint: 'Azure에서 배포에 직접 지어준 이름이에요. 모델 이름과 다를 수 있어요. 예: gpt-4o-prod', secret: false, multiline: false };
  // The same sentences the server's binding uses (ai_engine_binding.AZURE_INPUT_PROBLEMS), said before anything is sent.
  const AZURE_PROBLEMS = {
    endpoint: '연결 주소는 Azure 포털의 https 엔드포인트(예: https://내리소스.openai.azure.com)를 그대로 넣어 주세요.',
    endpoint_claude: '연결 주소가 Claude(/anthropic) 배포라서 아직 연결할 수 없어요. Azure OpenAI 배포의 주소를 넣어 주세요.',
    api_key: "연결 키는 Azure 포털의 '키 1' 값을 공백 없이 그대로 붙여넣어 주세요.",
    deployment_missing: '배포 이름을 입력해 주세요. Azure 포털의 배포 목록에 있는 이름이에요.',
    deployment_invalid: '배포 이름에는 영문, 숫자, -, _, . 만 쓸 수 있어요.'
  };
  // What the server's codes mean for an Azure connection, in the words of its three fields.
  const AZURE_CODE_COPY = {
    AI_ENGINE_CONNECTION_VERIFICATION_FAILED: 'Azure 연결 정보를 확인하지 못했어요. 연결 주소, 연결 키, 배포 이름을 Azure 포털에서 다시 복사해 주세요.',
    AI_ENGINE_CONNECTION_ANSWER_FAILED: 'Azure가 테스트 답변을 하지 못했어요. 배포 이름이 Azure 포털의 배포 이름과 같은지, 연결 키가 같은 리소스의 키인지 확인해 주세요.',
    AI_ENGINE_CONNECTION_NOT_SUPPORTED: AZURE_PROBLEMS.endpoint_claude
  };
  const AZURE_KEY_PREFIX = /^(bearer\s+|api-key(\s*:\s*|\s+))/i;
  // The catalog's way-to-connect entries this page can run end to end.
  const METHOD_KINDS = ['account', 'api_key', 'free', 'cloud'];
  // How a connection was made, as its row says it: an account login is a subscription (구독), a key is API.
  const CONNECTION_METHODS = { oauth: '구독', credential: 'API', cloud: '클라우드' };

  // Every failure is told in Korean the page chose. The server's code only
  // picks which sentence; its own wording is never shown.
  const CODE_COPY = {
    AI_ENGINE_CONNECTION_NOT_READY: '이 AI 연결을 지금 쓸 수 없어요. 다시 연결한 뒤 골라 주세요.',
    AI_ENGINE_CHOICE_UNAVAILABLE: '지금은 AI를 바꿀 수 없어요. 잠시 후 다시 시도해 주세요.',
    AI_ENGINE_PROFILE_NOT_READY: '프로젝트의 AI 직원 공간을 아직 준비하고 있어요. 준비가 끝나면 여기서 연결할 수 있어요.',
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
    403: '이 프로젝트에 접근할 수 없어요. 이 페이지를 새로고침해 주세요.',
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
  // In the place of a row's button while there is no project to connect through (#3913).
  const NO_PROJECT_ROW = '앱에서 첫 프로젝트를 시작하면 연결할 수 있어요.';
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
  const state = {
    user: null,
    workspaces: [],
    // The project the AI-engine routes are asked through. The account's AI is the same in every project, so any ready
    // project answers for it: the preferred project below when that one is ready, else the first ready one. Never shown.
    workspaceId: '',
    // The project the page would rather ask through, never chosen on this page and never shown: the one /account/
    // linked here with ?workspace=, else the one this tab was already asking through, else the one the server marks
    // `recent` (the project the app handed the person over from, else their most recently active one). See loadWorkspaces.
    projectId: '',
    catalog: [],
    connections: [],
    // The engine choice (D79 POLISH): 'sidekick' runs on Sidekick AI while the connection stays saved, from
    // /workspaces/ai-engine-targets' `ai_engine` and PUT /ai-engine-connections/active. null otherwise: the list then
    // picks by whether an AI is connected, as before.
    engineChoice: null,
    // The one connection being made in the panel: its provider, method and,
    // for an account login, the flow the server started.
    flow: null,
    busy: false,
    pageActive: true,
    flowGeneration: 0,
    connectionRead: 0,
    // Bumped by every reload, so a late answer cannot paint over a newer one.
    seq: 0,

    // /account/ links here as /ai/?workspace=<id>. Read before the address bar
    // is cleaned below; it only picks which project the AI routes are asked through, out of sight.
    requestedWorkspace: readRequestedWorkspace(),
    // The app's AI information page links here as /ai/?provider=<id>. Read
    // before the address bar is cleaned below; once the providers are on the
    // page, that provider's card is marked and brought into view. It never
    // starts a connection by itself.
    requestedProvider: readRequestedProvider(),
    returnedCode: readReturnedCode()
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
  async function longCall(path, options, flow) {
    const controller = new AbortController();
    if (flow) flow.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), PROOF_WAIT_MS);
    try {
      return await api(path, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (flow) flow.controllers.delete(controller);
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
    return keyless ? '무료' : connection.method;
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
      workspaces.push({ id, name: cleanText(row.name, 120) || '이름 없는 프로젝트', ready: row.ready === true, recent: row.recent === true });
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

  // The account's connections only. An employee's own AI (agent_id) belongs to one project's employee and is managed in
  // the app; the list here is the AI every project runs on.
  function sanitizeConnections(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const connections = [];
    value.forEach((row) => {
      if (!row || typeof row !== 'object' || row.agent_id || !['connected', 'needs_reconnect'].includes(row.status)) return;
      const id = String(row.id || '');
      const provider = String(row.provider || '');
      if (!SAFE_ID.test(id) || !PROVIDER_ID.test(provider) || seen.has(id)) return;
      seen.add(id);
      const model = typeof row.model === 'string' && SAFE_ID.test(row.model) ? row.model : '';
      connections.push({
        id,
        provider,
        method: CONNECTION_METHODS[row.auth_method] || '연결',
        kind: row.auth_method === 'oauth' || row.auth_method === 'cloud' ? row.auth_method : 'credential',
        model,
        models: modelList([model, ...modelList(row.models)]).filter(Boolean),
        candidates: modelList(row.candidate_models),
        connected: row.status === 'connected' && row.readiness === 'ready'
      });
    });
    return connections;
  }

  function sanitizeEngineChoice(value) {
    if (!value || typeof value !== 'object') return null;
    // A provider's model that was run on Sidekick credits (named by `provider`) is Sidekick running, as plain Sidekick is.
    if (value.engine === 'sidekick') return { engine: 'sidekick', connectionId: '' };
    if (value.engine !== 'connected') return null;
    const id = String(value.connection_id || '');
    return { engine: 'connected', connectionId: SAFE_ID.test(id) ? id : '' };
  }

  // Sidekick while a connected AI runs, or a connected AI back while Sidekick runs. Nothing is disconnected.
  async function selectEngine(engine, connection, controls) {
    if (state.busy || !state.user) return;
    const ticket = scopeTicket();
    setBusy(true, controls);
    setStatus('providers-status', '처리할 AI를 바꾸고 있어요.', false);
    try {
      const choice = sanitizeEngineChoice(await api('/ai-engine-connections/active', {
        method: 'PUT',
        body: JSON.stringify({ ...scope(), engine, ...(connection ? { connection_id: connection.id } : {}) })
      }));
      if (!scopeCurrent(ticket)) return;
      state.engineChoice = choice;
      setStatus('providers-status', '', false);
    } catch (error) {
      if (scopeCurrent(ticket)) showFailure(error, 'providers-status');
    } finally {
      if (scopeCurrent(ticket)) setBusy(false, controls);
    }
    if (scopeCurrent(ticket)) await reloadConnections();
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
    ['account-catalog-step', 'workspace-step', 'handoff-step', 'connect-step', 'providers-step', 'connect-aside', 'models-step'].forEach((id) => { $(id).hidden = true; });
    $('provider-list').replaceChildren($('sidekick-ai-card'));
    $('provider-groups').replaceChildren();
    $('model-default-control').replaceChildren();
    showNext(null);
  }

  function showSignedOut() {
    renderWho();
    hideProjectSteps();
    $('signin-step').hidden = false;
  }

  // The next step under the line about the person's projects, or nothing.
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
    state.projectId = '';
    state.catalog = [];
    state.connections = [];
    state.engineChoice = null;
    showSignedOut();
    setStatus('signin-status', message || '', isError);
  }

  async function boot() {
    if (state.flow) stopFlow(state.flow);
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
      const targets = await api('/workspaces/ai-engine-targets', { method: 'GET' });
      if (seq !== state.seq || state.pageActive === false) return;
      workspaces = sanitizeWorkspaces(targets);
      // D79 POLISH: the server says `ai_engine` only while the person chose Sidekick AI (their connection stays saved).
      state.engineChoice = sanitizeEngineChoice(targets && targets.ai_engine);
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
    const returning = state.returnedCode && pending ? pending.workspace_id : '';
    const known = (id) => id && workspaces.some((workspace) => workspace.id === id);
    // Which project is preferred -- there is no picker and it is never shown. A login coming back from its provider returns
    // to the project it was started from; then the project the person came from; then the one this tab was showing; then the one the
    // server marks `recent` (the app's last hand-off, else the most recently active).
    state.projectId = [
      returning,
      state.requestedWorkspace,
      readStore(WORKSPACE_KEY),
      (workspaces.find((workspace) => workspace.recent) || {}).id,
      (workspaces.find((workspace) => workspace.ready) || {}).id,
      (workspaces[0] || {}).id
    ].find(known) || '';
    state.requestedWorkspace = '';
    if (state.projectId) writeStore(WORKSPACE_KEY, state.projectId);
    // Which project the AI routes are asked through: the preferred project when it is ready, else any ready project --
    // the AI is the account's, so every ready project answers the same.
    const project = state.workspaces.find((workspace) => workspace.id === state.projectId) || null;
    state.workspaceId = [
      returning,
      project && project.ready ? project.id : '',
      (workspaces.find((workspace) => workspace.ready) || {}).id,
      state.projectId
    ].find(known) || '';
    await loadWorkspaceData();
    if (state.returnedCode || pending) await completeReturnedFlow(pending);
  }

  function currentWorkspace() {
    return state.workspaces.find((workspace) => workspace.id === state.workspaceId) || null;
  }

  async function loadWorkspaceData() {
    const seq = ++state.seq;
    closeFlow();
    $('handoff-step').hidden = true;
    $('provider-list').replaceChildren($('sidekick-ai-card'));
    state.connections = [];
    $('providers-step').hidden = true;
    $('connect-aside').hidden = true;
    $('models-step').hidden = true;
    setStatus('connections-status', '', false);
    setStatus('providers-status', '', false);
    setStatus('model-status', '', false);
    showNext(null);
    const workspace = currentWorkspace();
    if (!workspace || !workspace.ready) loadAccountCatalog(seq);
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
    // Reached only when none of the person's projects is ready (any ready one answers for the account's AI).
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
    renderProviders();
    renderHandoffOffer();
  }

  // ---- The AI list without a project (#3913) -----------------------------------------------------------------------------
  //
  // GET /ai-engine-providers without a project: the same catalog, each row `scope: "account"` and `connected` from the
  // person's own AI. Connected rows first, then the rest; a row's button is one line until a project can connect it.
  // `summary` is the server's one Korean line about the AI, the same line the app's AI list shows (#3909).
  function sanitizeAccountCatalog(value) {
    const rows = Array.isArray(value) ? value : [];
    return orderedCatalog(sanitizeCatalog(value)).map((provider) => {
      const row = rows.find((entry) => entry && entry.id === provider.id) || {};
      return { ...provider, connected: row.connected === true, description: cleanText(row.summary || row.description, 160) };
    });
  }

  function accountCatalogRow(provider) {
    return el('li', { className: 'provider-card catalog-row', 'data-provider': provider.id }, [
      el('div', { className: 'provider-head' }, [providerLogo(provider.id), el('strong', { text: provider.name })]),
      provider.description ? el('span', { className: 'catalog-line', text: provider.description }) : null,
      el('span', { className: 'provider-method catalog-note', text: provider.connected ? '연결됨' : NO_PROJECT_ROW })
    ]);
  }

  function renderAccountCatalog(providers) {
    const connected = providers.filter((provider) => provider.connected);
    const available = providers.filter((provider) => !provider.connected);
    [['account-connected', connected], ['account-available', available]].forEach(([id, rows]) => {
      fill($(id), rows.map(accountCatalogRow));
      $(id).hidden = !rows.length;
      $(`${id}-title`).hidden = !rows.length;
    });
    setStatus('account-catalog-status', providers.length ? '' : '지금 연결할 수 있는 AI가 없어요. 잠시 뒤 다시 시도해 주세요.', !providers.length);
    $('account-catalog-step').hidden = false;
  }

  async function loadAccountCatalog(seq) {
    const user = state.user;
    try {
      const catalog = await api(`/ai-engine-providers?${new URLSearchParams({ user_id: String(user.id) })}`, { method: 'GET' });
      if (seq !== state.seq || user !== state.user) return;
      renderAccountCatalog(sanitizeAccountCatalog(catalog));
    } catch (error) {
      if (seq !== state.seq || user !== state.user) return;
      $('account-catalog-step').hidden = false;
      showFailure(error, 'account-catalog-status');
    }
  }

  async function reloadConnections(flow) {
    if (!state.user || !state.workspaceId) return;
    const ticket = scopeTicket();
    const read = ++state.connectionRead;
    try {
      const connections = await api(`/ai-engine-connections?${scopeQuery()}`, { method: 'GET' });
      if (!scopeCurrent(ticket) || read !== state.connectionRead || (flow && !ownsFlow(flow))) return;
      state.connections = sanitizeConnections(connections);
      renderProviders();
    } catch (error) {
      if (!scopeCurrent(ticket) || read !== state.connectionRead || (flow && !ownsFlow(flow))) return;
      showFailure(error, 'connections-status');
    }
  }

  // ---- Keys go only into a page that runs this site's own scripts -----------------------------------------------------
  //
  // The sign-in sheet's security check is another site's script; once it has run in this tab, a key waits for a fresh page.
  function foreignScript() {
    return Array.from(document.querySelectorAll('script[src]')).some((tag) => {
      try { return new URL(tag.getAttribute('src'), window.location.href).origin !== window.location.origin; } catch (_) { return true; }
    });
  }

  function reopenNotice() {
    return el('div', { className: 'connect-form' }, [
      el('p', { className: 'ai-note', text: '로그인 확인에 쓴 다른 사이트의 코드가 이 페이지에 남아 있어요. 키를 안전하게 넣으려면 페이지를 새로 열어 주세요.' }),
      el('button', { className: 'ai-button', type: 'button', text: '새로 열기', onClick: () => window.location.reload() })
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
    setStatus('model-status', tryingNew
      ? `${modelDisplayName(model)}로 바꾸기 전에 테스트 답변을 받아 보고 있어요. 최대 3분까지 걸릴 수 있어요.`
      : '모델을 바꾸고 있어요.', false);
    try {
      await longCall(`/ai-engine-connections/${encodeURIComponent(connection.id)}/model`, {
        method: 'PUT',
        body: JSON.stringify({ ...scope(), connection_id: connection.id, model })
      });
      setStatus('model-status', `${modelDisplayName(model)}로 바꿨어요.`, false);
    } catch (error) {
      showFailure(error, 'model-status');
    } finally {
      setBusy(false, controls);
    }
    if (state.user) await reloadConnections();
  }

  async function disconnectConnection(connection, controls) {
    if (state.busy) return;
    const name = connectionProviderName(connection.provider);
    if (!window.confirm(`${name} 연결을 해제할까요? 내 모든 프로젝트의 새 업무가 이 AI를 쓰지 않아요.`)) return;
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

  // ---- 제공자: Sidekick, the connected providers, and + 연결하기 ----------------------------------------------------------
  //
  // Owner, 2026-10-28 (v2, after a "Models" settings page): one card of rows. Sidekick (기본 제공) first -- it is what runs
  // when nothing else does, never sold as an option -- then every provider the person connected, then "+ 연결하기". A row is
  // a black-and-white mark, the name and how it is connected; on the right only the circle that says which one runs (and
  // makes it run) and "···" with 다시 연결 and 연결 해제. A provider that is not connected is found only through
  // "+ 연결하기", grouped by how it connects (구독: an account login; API: a key or another credential).

  // The catalog in the owner's order: AI_ENGINE_LIST_ORDER first, in that order, then the rest as the server sent them.
  function orderedCatalog(catalog) {
    const rank = (id) => (AI_ENGINE_LIST_ORDER.includes(id) ? AI_ENGINE_LIST_ORDER.indexOf(id) : AI_ENGINE_LIST_ORDER.length);
    return catalog.map((provider, index) => ({ provider, index }))
      .sort((a, b) => rank(a.provider.id) - rank(b.provider.id) || a.index - b.index)
      .map((entry) => entry.provider);
  }

  // Sidekick runs while no AI of the person's is connected, or while they chose it (D79 POLISH: the connection stays). A
  // connection that was lost is not Sidekick being chosen: while it stands in for the person's AI (lostConnection), the
  // Sidekick row is not marked.
  function sidekickInUse() {
    if (state.engineChoice && state.engineChoice.engine === 'sidekick') return true;
    return !state.connections.some((connection) => connection.connected) && !lostConnection();
  }

  // The person's AI when it is a lost connection (the server lists it as `needs_reconnect`): with no working connection and
  // Sidekick not chosen, the one they chose if it is lost, else the first lost one. null otherwise.
  function lostConnection() {
    const choice = state.engineChoice;
    if ((choice && choice.engine === 'sidekick') || state.connections.some((connection) => connection.connected)) return null;
    const lost = state.connections.filter((connection) => !connection.connected);
    return (choice && choice.connectionId && lost.find((connection) => connection.id === choice.connectionId)) || lost[0] || null;
  }

  // The connection the person's work runs on now, or null while Sidekick does: the one they chose, else -- the owner's rule,
  // the person's own working connection first -- their most recently made or changed working connection, which is the
  // first connected row (the server lists them newest first, the order it picks by).
  function activeConnection() {
    if (sidekickInUse()) return null;
    const choice = state.engineChoice;
    const working = state.connections.filter((connection) => connection.connected);
    return (choice && choice.connectionId && working.find((connection) => connection.id === choice.connectionId)) || working[0] || null;
  }

  // The provider's mark, for a provider that has one published (PROVIDER_LOGOS); null for any other. It is decoration:
  // the name stands right beside it, so it has no alt text. Its width and height fix its box, so the row does not move
  // when the file arrives, and a file that does not load is taken out again instead of leaving a broken-image icon. The
  // stylesheet preserves official colour and shape; the asset registry supplies dark variants.
  function providerLogo(id) {
    const registry = window.SidekickProviderLogos;
    const entry = registry && registry[id];
    const safe = (path) => typeof path === 'string' && /^\/assets\/[A-Za-z0-9_/-]+\.(?:png|svg|webp)$/.test(path);
    const themed = entry && safe(entry.light) && safe(entry.dark);
    // An installed registry deliberately omits unverified variants; keep the readable provider name.
    if (registry && !themed && id !== 'sidekick') return null;
    if (!themed && id !== 'sidekick' && !PROVIDER_LOGOS.includes(id)) return null;
    const logo = el('img', {
      className: themed ? '' : 'provider-logo', alt: '', width: PROVIDER_LOGO_SIZE, height: PROVIDER_LOGO_SIZE, decoding: 'async'
    });
    const picture = themed ? el('picture', { className: 'provider-logo' }, [
      el('source', { media: '(prefers-color-scheme: dark)', srcset: entry.dark }), logo
    ]) : logo;
    logo.addEventListener('error', () => picture.remove(), { once: true });
    logo.setAttribute('src', themed ? entry.light : id === 'sidekick' ? '/assets/sidekick-mark.svg' : `/assets/ai/${id}.png`);
    return picture;
  }

  // The way a connection is made again: the method it was made with.
  function reconnectMethod(provider, connection) {
    const kind = connection.kind === 'oauth' ? 'account' : connection.kind === 'cloud' ? 'cloud' : 'api_key';
    return provider.methods.find((method) => method.kind === kind)
      || provider.methods.find((method) => method.kind === 'free')
      || provider.methods[0] || null;
  }

  // The circle on the right of a row: filled for the one that runs; pressed, it makes that one run (nothing is disconnected).
  function useButton(name, inUse, disabled, onClick) {
    return el('button', {
      className: inUse ? 'provider-use is-on' : 'provider-use', type: 'button', 'aria-pressed': inUse ? 'true' : 'false',
      'aria-label': `${name} 쓰기`, disabled: disabled || inUse, onClick
    });
  }

  // "···": 다시 연결 and 연결 해제, nothing else; one menu open at a time, closed by Escape or a click anywhere else.
  function rowMenu(provider, connection) {
    const name = provider ? provider.name : connectionProviderName(connection.provider);
    const menuId = `provider-menu-${connection.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const toggle = el('button', {
      className: 'provider-menu-button', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId,
      'aria-label': `${name} 메뉴`
    });
    const method = provider ? reconnectMethod(provider, connection) : null;
    const again = el('button', { className: 'provider-menu-item', type: 'button', role: 'menuitem', text: '다시 연결', disabled: !method });
    const remove = el('button', { className: 'provider-menu-item is-danger', type: 'button', role: 'menuitem', text: '연결 해제' });
    const menu = el('div', { className: 'provider-menu', id: menuId, role: 'menu', hidden: true }, [again, remove]);
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeMenus();
      if (opening) { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); again.focus({ preventScroll: true }); }
    });
    again.addEventListener('click', () => { closeMenus(); if (method) openFlow(provider, method); });
    remove.addEventListener('click', () => { closeMenus(); disconnectConnection(connection, [toggle]); });
    return el('div', { className: 'provider-menu-wrap' }, [toggle, menu]);
  }

  function closeMenus(refocus) {
    Array.from(document.querySelectorAll('.provider-menu')).forEach((menu) => {
      if (menu.hidden) return;
      menu.hidden = true;
      const toggle = menu.parentNode.querySelector('.provider-menu-button');
      toggle.setAttribute('aria-expanded', 'false');
      if (refocus) toggle.focus({ preventScroll: true });
    });
  }

  // One connected provider's row. A lost one says so and offers 다시 연결 right on the row, the same way "···" does.
  function connectionRow(connection, running) {
    const provider = state.catalog.find((row) => row.id === connection.provider) || null;
    const name = provider ? provider.name : connectionProviderName(connection.provider);
    const inUse = Boolean(running) && running.id === connection.id;
    const method = provider ? reconnectMethod(provider, connection) : null;
    return el('li', { className: 'provider-card', 'data-provider': connection.provider, 'data-connection-id': connection.id, tabindex: '-1' }, [
      el('div', { className: 'provider-head' }, [
        providerLogo(connection.provider),
        el('strong', { text: name })
      ]),
      connection.connected
        ? el('span', { className: 'provider-method', text: connectionMethodLabel(connection) })
        : el('span', { className: 'provider-method is-warn' }, [
          el('span', { text: '연결이 끊겼어요' }),
          method ? el('span', { 'aria-hidden': 'true', text: ' · ' }) : null,
          method ? el('button', { className: 'provider-reconnect', type: 'button', text: '다시 연결', onClick: () => openFlow(provider, method) }) : null
        ]),
      useButton(name, inUse, !connection.connected, (event) => selectEngine('connected', connection, [event.currentTarget])),
      rowMenu(provider, connection)
    ]);
  }

  function renderSidekickRow() {
    const inUse = sidekickInUse();
    const select = $('sidekick-ai-select');
    select.className = inUse ? 'provider-use is-on' : 'provider-use';
    select.setAttribute('aria-pressed', inUse ? 'true' : 'false');
    select.disabled = inUse;
    if (!select.dataset.bound) {
      select.dataset.bound = '1';
      select.addEventListener('click', () => selectEngine('sidekick', null, [select]));
    }
  }

  // The rows the person connected, and the picker of the rest.
  function renderProviders() {
    renderSidekickRow();
    const running = activeConnection();
    const rows = state.connections.map((connection) => connectionRow(connection, running));
    keepPanelFocus(() => {
      $('provider-list').replaceChildren($('sidekick-ai-card'), ...rows);
      renderPicker();
    });
    renderModels(running);
    $('providers-step').hidden = false;
    $('connect-aside').hidden = false;
    $('models-step').hidden = false;
    setStatus('providers-status', state.catalog.length ? '' : '지금 연결할 수 있는 AI가 없어요. 잠시 뒤 다시 시도해 주세요.', !state.catalog.length);
    showRequestedProvider();
  }

  // ---- + 연결하기: the providers not connected yet, by how they connect -------------------------------------------------

  // 구독 lists a provider that signs in with its account; API one that takes a key, a cloud credential or nothing at all
  // (a free model). A provider with both is in both, and is connected the way of the group it was picked from.
  const PICKER_GROUPS = [
    { title: '구독', kinds: ['account'] },
    { title: 'API', kinds: ['api_key', 'cloud', 'free'] }
  ];

  function pickerQuery() {
    return String($('provider-search').value || '').trim().toLowerCase();
  }

  function renderPicker() {
    const taken = new Set(state.connections.map((connection) => connection.provider));
    const query = pickerQuery();
    const shown = orderedCatalog(state.catalog).filter((provider) => !taken.has(provider.id)
      && (!query || provider.name.toLowerCase().includes(query) || provider.id.includes(query)));
    const groups = PICKER_GROUPS.map((group) => {
      const rows = shown.map((provider) => ({ provider, method: provider.methods.find((method) => group.kinds.includes(method.kind)) }))
        .filter((entry) => entry.method)
        .map(({ provider, method }) => el('li', {}, [el('button', {
          className: 'picker-row', type: 'button', 'data-provider': provider.id, 'data-way': method.kind,
          onClick: () => openFlow(provider, method)
        }, [providerLogo(provider.id), el('span', { text: provider.name })])]));
      return rows.length ? el('div', { className: 'picker-group' }, [el('p', { className: 'picker-title', text: group.title }), el('ul', {}, rows)]) : null;
    });
    fill($('provider-groups'), groups);
    $('picker-empty').hidden = groups.some(Boolean);
  }

  // A phone shows the picker under the card only once "+ 연결하기" is pressed; a wide window keeps it beside the card.
  function setPickerOpen(open) {
    $('connect-aside').classList.toggle('is-open', open);
    $('connect-open').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openPicker() {
    setPickerOpen(true);
    closeFlow();
    smoothScroll($('connect-aside'));
    $('provider-search').focus({ preventScroll: true });
  }

  // /ai/?provider=<id>: the first time the catalog is drawn, that provider is shown -- its connected row, else its rows in
  // the picker, which opens -- marked and brought into view with its first button focused. It never starts a connection by
  // itself. Once only; a provider this catalog does not list is ignored.
  function showRequestedProvider() {
    const id = state.requestedProvider;
    if (!id) return;
    state.requestedProvider = '';
    if (!state.catalog.some((item) => item.id === id)) return;
    const row = Array.from(document.querySelectorAll('#provider-list .provider-card')).find((node) => node.getAttribute('data-provider') === id);
    const picks = Array.from(document.querySelectorAll('#provider-groups .picker-row')).filter((node) => node.getAttribute('data-provider') === id);
    const marked = row ? [row] : picks;
    if (!marked.length) return;
    if (!row) setPickerOpen(true);
    marked.forEach((node) => node.classList.add('is-requested'));
    smoothScroll(marked[0]);
    const action = marked[0].matches('button') ? marked[0] : marked[0].querySelector('button');
    if (action) action.focus({ preventScroll: true });
  }

  function modelDisplayName(model) {
    const text = typeof model === 'string' ? model.trim() : '';
    const slash = text.lastIndexOf('/');
    const id = (slash >= 0 ? text.slice(slash + 1) : text).replace(/:free$/i, '');
    for (const [pattern, format] of MODEL_LABEL_RULES) {
      const match = id.match(pattern);
      if (match) return format(match, id.slice(match[0].length));
    }
    return text;
  }

  // ---- 작업별 모델 ------------------------------------------------------------------------------------------------------
  //
  // Only what the server has today: the model of the connection that runs (PUT /ai-engine-connections/{id}/model). Tiers by
  // task and an image model have no setting behind them, so they are not drawn.
  function renderModels(running) {
    const control = $('model-default-control');
    const lost = running ? null : lostConnection();
    if (lost) {
      const mark = providerLogo(lost.provider);
      fill(control, [el('span', { className: 'model-value' }, [mark ? Object.assign(mark, { className: 'model-mark' }) : null,
        el('span', { text: `${connectionProviderName(lost.provider)} 연결이 끊겼어요` })])]);
      return;
    }
    if (!running) {
      const mark = providerLogo('sidekick');
      mark.className = 'model-mark';
      fill(control, [el('span', { className: 'model-value' }, [mark, el('span', { text: 'Sidekick 기본' })])]);
      return;
    }
    const name = connectionProviderName(running.provider);
    const candidates = running.candidates.filter((model) => !running.models.includes(model));
    const select = el('select', { className: 'model-select', 'aria-label': `${name} 모델` }, [
      el('optgroup', { label: '확인된 모델' }, running.models.map((model) => el('option', { value: model, text: modelDisplayName(model), selected: model === running.model }))),
      candidates.length ? el('optgroup', { label: '새로 시험할 모델' }, candidates.map((model) => el('option', { value: model, text: modelDisplayName(model) }))) : null
    ]);
    select.addEventListener('change', () => changeModel(running, select.value, [select]));
    const mark = providerLogo(running.provider);
    fill(control, [el('label', { className: 'model-value' }, [mark ? Object.assign(mark, { className: 'model-mark' }) : null, select])]);
  }

  // ---- Where the connect panel sits ------------------------------------------------------------------------------------
  //
  // #connect-step lives in the aside, under the picker; while it is open it stands in for the picker. A redraw keeps the
  // person's place: a control in the panel keeps its focus.
  function keepPanelFocus(move) {
    const panel = $('connect-step');
    const active = document.activeElement;
    const held = active && active !== document.body && panel && panel.contains(active) ? active : null;
    move();
    if (held && held.isConnected && document.activeElement !== held) held.focus({ preventScroll: true });
  }

  function showPanelIn() {
    setPickerOpen(true);
  }

  // ---- The connect panel -------------------------------------------------------------

  function scopeTicket() {
    return { seq: state.seq, user: state.user, workspaceId: state.workspaceId, projectId: state.projectId };
  }

  function scopeCurrent(ticket) {
    return state.pageActive && ticket.seq === state.seq && ticket.user === state.user
      && ticket.workspaceId === state.workspaceId && ticket.projectId === state.projectId;
  }

  function newFlow(provider, method, flowId = '') {
    return { provider, method, flowId, authorizationUrl: '', timer: null, successTimer: null,
      controllers: new Set(), inFlight: false, stopped: false, generation: ++state.flowGeneration, ticket: scopeTicket() };
  }

  function ownsFlow(flow) {
    return Boolean(flow) && state.flow === flow && flow.generation === state.flowGeneration && scopeCurrent(flow.ticket);
  }

  function verificationStatus(flow, checking) {
    if (!ownsFlow(flow)) return;
    const status = $('connect-status');
    status.setAttribute('aria-busy', String(checking));
    status.classList.toggle('is-checking', checking);
    if (flow.confirm) flow.confirm.disabled = checking;
    setStatus('connect-status', checking ? '연결 확인 중… 실제 테스트 답변을 기다리고 있어요.' : '로그인을 기다리고 있어요.', false);
  }

  function openFlow(provider, method) {
    if (state.busy) return;
    closeFlow();
    const flow = newFlow(provider, method);
    state.flow = flow;
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-step').hidden = false;
    showPanelIn(provider);
    setStatus('connect-status', '', false);
    if (method.kind === 'account') startAccount(flow);
    else if (method.kind === 'api_key') $('connect-body').replaceChildren(foreignScript() ? reopenNotice() : keyForm(flow));
    else if (method.kind === 'free') $('connect-body').replaceChildren(freeForm(flow));
    else if (method.kind === 'cloud') $('connect-body').replaceChildren(foreignScript() ? reopenNotice() : cloudForm(flow));
    smoothScroll($('connect-step'));
  }

  function stopFlow(flow) {
    flow.stopped = true;
    if (flow.timer) clearTimeout(flow.timer);
    if (flow.successTimer) clearTimeout(flow.successTimer);
    flow.controllers.forEach((controller) => controller.abort());
    flow.controllers.clear();
  }

  function closeFlow() {
    if (state.flow) stopFlow(state.flow);
    state.flow = null;
    state.flowGeneration += 1;
    state.connectionRead += 1;
    state.busy = false;
    $('connect-status').setAttribute('aria-busy', 'false');
    $('connect-status').classList.remove('is-checking');
    hideFlowPanel();
  }

  function hideFlowPanel() {
    const panel = $('connect-step');
    // The focus was in the panel (its 취소 or 닫기): it goes back to the picker the panel stood in for.
    const focused = panel.contains(document.activeElement);
    panel.hidden = true;
    $('connect-body').replaceChildren();
    $('connect-cancel').textContent = '취소';
    setStatus('connect-status', '', false);
    if (focused) $('provider-search').focus({ preventScroll: true });
  }

  function live(flow) {
    return ownsFlow(flow) && !flow.stopped;
  }

  // ---- Back to the app -----------------------------------------------------------------------------
  //
  // The app opens this page in the device browser (?in_app=1) and refreshes its AI connections when it is brought back to
  // the front, so the way back only has to bring the app forward. It is a button that navigates, never a link:
  // /app-mode.js un-links every anchor that is not http(s) or mailto, so a link to the app's scheme would be dead.
  function appReturnAddress(providerId) {
    const connected = typeof providerId === 'string' && PROVIDER_ID.test(providerId)
      && state.catalog.some((provider) => provider.id === providerId);
    return connected ? `${APP_RETURN_URL}?provider=${providerId}&status=connected` : APP_RETURN_URL;
  }

  function returnToApp(providerId) {
    window.location.assign(appReturnAddress(providerId));
  }

  // ---- The finished state --------------------------------------------------------------------------

  function subjectOf(provider) {
    return `${provider.name}${SUBJECT_WITH_I.includes(provider.id) ? '이' : '가'}`;
  }

  // Every successful method uses the same short notice. The persistent header owns app return.
  function showConnected(provider, reconnect, flow) {
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-cancel').textContent = '닫기';
    $('connect-step').hidden = false;
    showPanelIn(provider);
    verificationStatus(flow, false);
    setStatus('connect-status', '', false);
    fill($('connect-body'), [el('div', { className: reconnect ? 'connect-done is-warn' : 'connect-done', 'aria-live': 'polite' }, [
      el(reconnect ? 'p' : 'h3', { id: reconnect ? false : 'connect-done-title', text: reconnect
        ? `${provider.name} 연결을 저장했지만 다시 연결이 필요해요. 한 번 더 연결해 주세요.`
        : `${subjectOf(provider)} 연결됐어요` })
    ])]);
    if (!reconnect) flow.successTimer = setTimeout(() => {
      if (!ownsFlow(flow)) return;
      flow.successTimer = null;
      hideFlowPanel();
      setPickerOpen(false);
      const row = $('provider-list').querySelector(`[data-provider="${provider.id}"]`);
      if (row) row.focus({ preventScroll: true });
    }, 3000);
  }

  async function finishFlow(flow, connection) {
    if (!live(flow)) return;
    const reconnect = Boolean(connection && connection.status === 'needs_reconnect');
    stopFlow(flow);
    setStatus('connections-status', reconnect ? `${flow.provider.name} 연결을 저장했지만 다시 연결이 필요해요. 한 번 더 연결해 주세요.` : '', false);
    showConnected(flow.provider, reconnect, flow);
    await reloadConnections(flow);
    if (!ownsFlow(flow)) return;
    renderProviders();
  }

  // Key, free and cloud connections all end in the same POST, which checks the
  // credential with one real answer before anything is saved.
  async function submitConnection(flow, body, controls, codeCopy) {
    if (!live(flow) || state.busy) return;
    setBusy(true, controls);
    verificationStatus(flow, true);
    try {
      const connection = await longCall('/ai-engine-connections', {
        method: 'POST',
        body: JSON.stringify({ ...scope(), provider: flow.provider.id, ...body })
      }, flow);
      if (!live(flow)) return;
      setBusy(false, controls);
      await finishFlow(flow, connection);
    } catch (error) {
      if (!live(flow)) return;
      setBusy(false, controls);
      verificationStatus(flow, false);
      // A provider's own words for a code (Azure names its three fields); anything else as every form says it.
      const own = codeCopy && error && error.status !== 401 && !error.network && !error.aborted && error.code ? codeCopy[error.code] : '';
      if (live(flow)) { if (own) setStatus('connect-status', own, true); else showFailure(error, 'connect-status'); }
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
      field(`${flow.provider.name} API 키`, key, '발급받은 키 전체를 붙여넣어요. 키는 이 확인 요청에만 실려 사이드킥으로 가고, 이 페이지에는 남지 않아요.'),
      endpoint ? field('연결 주소', endpoint, '운영 중인 AI 연결 주소(https)를 넣어요.') : null,
      el('p', { className: 'ai-note', text: PROOF_NOTE }),
      submit
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // Out of the field at once, whatever happens next.
      const credential = key.value.trim();
      key.value = '';
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

  // The obvious mistakes in an Azure form, found before anything is sent, in the order the form asks. The server
  // normalises every endpoint shape the portal shows; this only refuses what it would refuse. A deployment named in a
  // pasted Target URI (…/deployments/<name>/…) counts as typed. Returns { problem } or { deployment }.
  function azureCheck(endpointUrl, apiKey, typedDeployment) {
    const raw = endpointUrl.replace(/^[<"']+|[>"']+$/g, '');
    let url = null;
    try { url = /\s/.test(raw) ? null : new URL(raw.includes('://') ? raw : `https://${raw}`); } catch (_) { url = null; }
    if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password || (url.port && url.port !== '443')) {
      return { problem: AZURE_PROBLEMS.endpoint };
    }
    const segments = url.pathname.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch (_) { return part; } });
    const lowered = segments.map((part) => part.toLowerCase());
    if (/\.(openai|services\.ai|cognitiveservices)\.azure\.com$/i.test(url.hostname) && lowered.includes('anthropic')) {
      return { problem: AZURE_PROBLEMS.endpoint_claude };
    }
    const key = apiKey.replace(AZURE_KEY_PREFIX, '').trim();
    if (key.length < 8 || /[^\x21-\x7e]/.test(key)) return { problem: AZURE_PROBLEMS.api_key };
    const at = lowered.indexOf('deployments');
    const deployment = typedDeployment || (at >= 0 && segments[at + 1] ? segments[at + 1].trim() : '');
    if (!deployment) return { problem: AZURE_PROBLEMS.deployment_missing };
    if (!SAFE_ID.test(deployment) || deployment.includes('..')) return { problem: AZURE_PROBLEMS.deployment_invalid };
    return { deployment };
  }

  function cloudForm(flow) {
    const azure = flow.provider.id === 'azure-foundry';
    const specs = CLOUD_FIELDS[flow.provider.id] || [];
    const extra = azure ? [AZURE_DEPLOYMENT_FIELD] : [];
    const inputs = [...specs, ...extra].map((spec) => ({
      spec,
      input: spec.multiline
        ? el('textarea', { className: 'ai-input', id: `cloud-${spec.id}`, rows: '5', autocomplete: 'off', spellcheck: 'false', required: true })
        : el('input', { className: 'ai-input', id: `cloud-${spec.id}`, type: spec.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false',
          // A Target URI already names the deployment, so this one field may stay empty.
          required: spec !== AZURE_DEPLOYMENT_FIELD })
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
      const typed = {};
      for (const { spec, input } of inputs) typed[spec.id] = input.value.trim();
      // The secret fields are emptied at once, whatever happens next; the rest stay to be corrected.
      for (const { spec, input } of inputs) if (spec.secret) input.value = '';
      for (const { spec } of inputs) {
        const value = typed[spec.id];
        if (spec === AZURE_DEPLOYMENT_FIELD) continue;
        if (!value) { setStatus('connect-status', azure ? AZURE_PROBLEMS[spec.id === 'api_key' ? 'api_key' : 'endpoint'] : `${spec.label}을 입력해 주세요.`, true); return; }
        credential[spec.id] = value;
      }
      let model = null;
      if (azure) {
        const checked = azureCheck(typed.endpoint_url, typed.api_key, typed.deployment_name);
        if (checked.problem) { setStatus('connect-status', checked.problem, true); return; }
        model = checked.deployment;
      }
      submitConnection(flow, { auth_method: 'cloud', cloud_credential: credential, ...(model ? { model } : {}) },
        [submit, ...inputs.map(({ input }) => input)], azure ? AZURE_CODE_COPY : null);
    });
    return form;
  }

  // ---- Account logins ---------------------------------------------------------------

  async function startAccount(flow) {
    const body = $('connect-body');
    body.replaceChildren(el('p', { className: 'ai-note', text: `${flow.provider.name} 로그인을 준비하고 있어요.` }));
    let started;
    const controller = new AbortController();
    flow.controllers.add(controller);
    try {
      // A browser round trip (OpenRouter) needs to know where to come back to;
      // a device code does not.
      started = await api('/ai-engine-oauth/start', {
        method: 'POST', signal: controller.signal,
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
    } finally { flow.controllers.delete(controller); }
    if (!live(flow)) return;
    flow.flowId = String(started.flow_id || '');
    flow.authorizationUrl = auth.httpsUrl(started.authorization_url);
    if (!SAFE_ID.test(flow.flowId) || !flow.authorizationUrl) {
      body.replaceChildren();
      setStatus('connect-status', '로그인 페이지 주소를 받지 못했어요. 다시 시도해 주세요.', true);
      return;
    }
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
    flow.confirm = el('button', { className: 'ai-button', type: 'button', text: '연결 확인', onClick: () => pollAccount(flow) });
    actions.append(flow.confirm);
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
    // Returning to the tab may advance the first check, but never a wait the
    // authorization service requested after a previous check.
    if (Date.now() < (flow.nextPollAt || 0)) {
      setStatus('connect-status', '로그인을 기다리고 있어요. 다음 확인 시간에 다시 확인할게요.', false);
      schedulePoll(flow, flow.nextPollAt - Date.now());
      return;
    }
    if (flow.timer) clearTimeout(flow.timer);
    flow.inFlight = true;
    verificationStatus(flow, true);
    let result = null;
    let failure = null;
    try {
      result = await longCall(`/ai-engine-oauth/${encodeURIComponent(flow.flowId)}/poll`, {
        method: 'POST',
        body: JSON.stringify({ ...scope(), provider: flow.provider.id, flow_id: flow.flowId })
      }, flow);
    } catch (error) {
      failure = error;
    } finally {
      flow.inFlight = false;
    }
    if (!live(flow)) return;
    verificationStatus(flow, false);
    if (result && result.status === 'complete') { await finishFlow(flow, result.connection); return; }
    const temporary = failure && ((failure.network && !failure.aborted)
      || (failure.status === 503 && failure.code === 'AI_ENGINE_ACCOUNT_CONNECTION_UNAVAILABLE'));
    if (failure && !temporary) {
      stopFlow(flow);
      showFailure(failure, 'connect-status');
      // The server says the code ran out: the same way on as a code that ran out here.
      if ((failure.status === 410 || failure.code === 'AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED') && flow.onExpire) flow.onExpire();
      return;
    }
    const requested = Number(result && result.poll_interval_seconds);
    if (result && result.slow_down) flow.interval += 5000;
    if (Number.isFinite(requested) && requested >= 2) flow.interval = Math.max(flow.interval, requested * 1000);
    const delay = Math.min(flow.interval, Math.max(1, flow.expiresAt - Date.now() + 1));
    flow.nextPollAt = Date.now() + delay;
    schedulePoll(flow, delay);
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

  async function completeAccount(flow, code, callbackUrl, controls) {
    if (!live(flow) || state.busy) return;
    setBusy(true, controls);
    verificationStatus(flow, true);
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
      }, flow);
      if (!live(flow)) return;
      verificationStatus(flow, false);
      setBusy(false, controls);
      if (result && result.status === 'complete') { await finishFlow(flow, result.connection); return; }
      if (live(flow)) setStatus('connect-status', CODE_COPY.AI_ENGINE_ACCOUNT_CONNECTION_FAILED, true);
    } catch (error) {
      if (!live(flow)) return;
      verificationStatus(flow, false);
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
    const flow = newFlow(provider, method, pending.flow_id);
    state.flow = flow;
    $('connect-heading').textContent = `${provider.name} 연결`;
    $('connect-step').hidden = false;
    showPanelIn(provider);
    $('connect-body').replaceChildren(el('p', { className: 'ai-note', text: `${provider.name} 로그인에서 돌아왔어요. ${PROOF_NOTE}` }));
    smoothScroll($('connect-step'));
    await completeAccount(flow, code, CALLBACK_URL, []);
  }

  // ---- The ChatGPT account the person just signed in with --------------------------

  // Offered as the person's AI once a project of theirs is ready to be asked
  // through, and only to the account that signed in (auth.js checks both the
  // tab and the account). The claim checks the account with one real answer
  // before it is saved, like every other connection on this page.
  function renderHandoffOffer() {
    const workspace = currentWorkspace();
    const offer = state.user && workspace && workspace.ready ? auth.chatGptHandoff() : null;
    if (!offer) { $('handoff-step').hidden = true; return; }
    $('handoff-note').textContent = '방금 로그인한 ChatGPT 계정을 내 모든 프로젝트의 AI로 바로 연결할 수 있어요. ChatGPT에 다시 로그인하지 않아도 돼요.';
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
    closeFlow();
    const flow = newFlow({ id: 'openai', name: 'ChatGPT' }, { kind: 'account' });
    state.flow = flow;
    const workspaceId = workspace.id;
    setBusy(true, controls);
    setStatus('handoff-status', PROOF_PROGRESS, false);
    let result = null;
    try {
      result = await longCall('/ai-engine/login-handoff/claim', {
        method: 'POST',
        body: JSON.stringify({ ...scope(), state: offer.state, code: offer.code })
      }, flow);
    } catch (error) {
      if (!live(flow)) return;
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
    if (!live(flow)) return;
    setBusy(false, controls);
    dropHandoff('', false);
    flow.provider = handoffProvider(result && result.connection);
    await finishFlow(flow, result && result.connection);
  }

  // The provider a claimed ChatGPT account connected: the connection's own id when it names one the page can use,
  // ChatGPT otherwise.
  function handoffProvider(connection) {
    const id = connection && PROVIDER_ID.test(String(connection.provider || '')) ? String(connection.provider) : 'openai';
    return state.catalog.find((provider) => provider.id === id)
      || { id, name: providerName(id), featured: false, endpointRequired: false, methods: [] };
  }

  // ---- Wiring ----------------------------------------------------------------------

  window.addEventListener('pagehide', () => { closeFlow(); state.pageActive = false; state.seq += 1; });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { state.pageActive = true; boot(); } });

  const sidekickMark = document.getElementById('sidekick-logo');
  if (sidekickMark) sidekickMark.replaceWith(Object.assign(providerLogo('sidekick'), { id: 'sidekick-logo' }));

  $('connect-cancel').addEventListener('click', closeFlow);
  $('connect-open').addEventListener('click', () => {
    if ($('connect-aside').classList.contains('is-open') && $('connect-step').hidden) setPickerOpen(false);
    else openPicker();
  });
  $('provider-search').addEventListener('input', renderPicker);
  document.addEventListener('click', (event) => { if (!event.target.closest || !event.target.closest('.provider-menu')) closeMenus(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(true); });
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
  }).then(() => boot()).then(() => auth.requireSignIn());
})();
