(() => {
  'use strict';
  const auth = window.SidekickAuth;
  const $ = (id) => document.getElementById(id);
  const inApp = () => document.documentElement.classList.contains('in-app');
  const ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const SERVICE_ID = /^[a-z][a-z0-9_]{0,119}$/;
  const categories = ['자료 가져오기', '일정 챙기기', '메시지·알림 보내기', '개발 작업 맡기기', '콘텐츠 만들기', '자동으로 확인하기', '고급 연결'];
  const state = { generation: 0, read: 0, user: '', bearer: '', workspace: '', projects: [], catalog: [], records: [], flow: null, busy: null, requests: new Set() };

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
    $(id).textContent = copy; $(id).classList.toggle('is-error', error);
  }
  function closeFlow() {
    const input = $('connection-secret');
    if (input) input.value = '';
    state.flow = null;
    $('action-body').replaceChildren(); $('action-panel').hidden = true;
    status('action-status');
  }
  function invalidate() {
    state.generation += 1; state.read += 1;
    for (const controller of state.requests) controller.abort();
    state.requests.clear(); state.busy = null; closeFlow();
  }
  function clearCatalog() {
    state.catalog = []; state.records = [];
    $('service-groups').replaceChildren(); $('catalog-panel').hidden = true;
  }
  function snapshot(service = '') {
    return { generation: state.generation, bearer: state.bearer, user: state.user, workspace: state.workspace, service };
  }
  function current(scope) {
    const handoff = auth.webHandoffWorkspace();
    return (!scope.workspace || !handoff?.required || Boolean(handoff.workspaceId))
      && scope.generation === state.generation && scope.bearer === auth.token()
      && scope.bearer === state.bearer && scope.user === String(auth.user()?.id || '')
      && scope.user === state.user && scope.workspace === state.workspace;
  }
  function actionable(scope) {
    return current(scope) && scope.workspace && state.projects.some((project) => project.id === scope.workspace)
      && state.catalog.some((service) => service.id === scope.service);
  }
  function query(scope) {
    return new URLSearchParams({ workspace_id: scope.workspace, user_id: scope.user }).toString();
  }
  async function request(path, options, scope) {
    const controller = new AbortController(); state.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 240000);
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
        : ['MANAGED_CONNECTION_VERIFY_FAILED', 'MCP_CONNECTION_VERIFY_FAILED'].includes(code) ? '입력한 연결 정보로 확인하지 못했어요. 정보를 다시 확인해 주세요.'
        : code === 'MCP_CREDENTIAL_REQUIRED' ? '연결 정보를 입력해 주세요.'
        : ['HERMES_BUSY', 'HERMES_CONNECT_BUSY', 'HERMES_CONNECT_FINISHING'].includes(code) ? '다른 연결을 마무리하는 중이에요. 잠시 뒤 다시 시도해 주세요.'
        : error.status === 404 ? '찾는 프로젝트가 더 이상 없어요. 다시 확인을 눌러 목록을 새로 불러와 주세요.'
        : error.status === 409 ? '그사이 연결 상태가 바뀌었어요. 다시 확인해 주세요.'
          : error.status === 503 ? '지금은 연결을 준비하고 있어요. 잠시 뒤 다시 시도해 주세요.'
            : '연결을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    status(target, copy, true);
  }
  function supportedCatalog(rows) {
    if (!Array.isArray(rows)) throw new Error('invalid_catalog');
    const found = new Set();
    return rows.flatMap((row) => {
      if (!row || !SERVICE_ID.test(row.service || '') || found.has(row.service)) return [];
      if (!['ready_for_catalog', 'official_api'].includes(row.catalogStatus)) return [];
      const route = row.connectionMethod;
      const method = row.connectionAuthMethod;
      if (!['mcp', 'managed'].includes(route) && !(route === 'oauth' && row.service === 'youtube')) return [];
      if (!['oauth', 'none', 'api_key', 'one_time_token'].includes(method)) return [];
      if (route === 'managed' && method !== 'api_key' || route === 'oauth' && method !== 'oauth') return [];
      found.add(row.service);
      const name = text(row.displayName, 80).replace(/\b(?:MCP|API key|server|token|provider)\b/gi, '서비스');
      return [{ id: row.service, name: name || '서비스', route, method,
        category: categories.includes(row.category) ? row.category : categories[0],
        ready: row.connectionReady === true && !['planned', 'not_ready'].includes(row.adapterStatus) }];
    });
  }
  function connectionRecords(rows, scope, catalog) {
    if (!Array.isArray(rows)) throw new Error('invalid_connections');
    const found = new Set();
    if (rows.some((row) => row && catalog.some((service) => service.id === row.service)
      && (row.user_id !== scope.user || row.workspace_id !== scope.workspace))) throw new Error('invalid_scope');
    return rows.flatMap((row) => {
      if (!row || row.user_id !== scope.user || row.workspace_id !== scope.workspace || found.has(row.service)
        || !catalog.some((service) => service.id === row.service) || !['connected', 'needs_reconnect'].includes(row.status)) return [];
      found.add(row.service);
      return [{ service: row.service, status: row.status, label: text(row.external_identity_label) }];
    });
  }
  async function refresh(scope = snapshot()) {
    if (!current(scope) || !scope.workspace) return;
    const read = ++state.read; status('page-status', '연결 상태를 확인하고 있어요.');
    try {
      const [catalog, records] = await Promise.all([
        request(`/connections/catalog?${query(scope)}`, { method: 'GET' }, scope),
        request(`/connections?${query(scope)}`, { method: 'GET' }, scope)
      ]);
      if (!current(scope) || read !== state.read) return;
      const services = supportedCatalog(catalog);
      const connections = connectionRecords(records, scope, services);
      state.catalog = services; state.records = connections;
      renderCatalog(); status('page-status');
      if (state.flow?.pending && state.records.some((row) => row.service === state.flow.service.id && row.status === 'connected')) {
        closeFlow(); status('page-status', '연결을 확인했어요.');
      }
      return true;
    } catch (error) { if (read === state.read) failure(error, scope); return false; }
  }
  function renderProjects() {
    const select = $('workspace-select'); select.replaceChildren();
    const placeholder = node('option', '프로젝트를 골라 주세요'); placeholder.value = ''; select.append(placeholder);
    for (const project of state.projects) {
      const option = node('option', project.name); option.value = project.id; select.append(option);
    }
    select.value = state.workspace;
  }
  async function boot() {
    $('signin-gate').classList.remove('is-connecting');
    invalidate(); clearCatalog();
    state.user = ''; state.bearer = auth.token(); state.workspace = ''; state.projects = [];
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
        seen.add(row.id); return [{ id: row.id, name: text(row.name, 120) || '이름 없는 프로젝트' }];
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
  function renderCatalog() {
    const search = $('service-search').value.trim().toLocaleLowerCase('ko');
    const visible = state.catalog.filter((service) => service.name.toLocaleLowerCase('ko').includes(search));
    const groups = $('service-groups'); groups.replaceChildren();
    for (const category of categories) {
      const services = visible.filter((service) => service.category === category);
      if (!services.length) continue;
      const section = node(category === '고급 연결' ? 'details' : 'section', '', 'service-group');
      section.append(node(category === '고급 연결' ? 'summary' : 'h2', category));
      const grid = node('div', '', 'service-grid');
      for (const service of services) {
        const record = state.records.find((row) => row.service === service.id);
        const card = node('article', '', 'service-card'); card.dataset.service = service.id;
        card.append(node('h3', service.name));
        const label = record?.status === 'connected' ? '연결됨' : record?.status === 'needs_reconnect' ? '다시 연결 필요' : service.ready ? '연결 안 됨' : '준비 중';
        card.append(node('span', label, `service-state${record?.status === 'connected' ? ' connected' : ''}`));
        if (record?.label) card.append(node('p', record.label));
        if (!service.ready) card.append(node('p', '지금은 새 연결을 준비하고 있어요.'));
        const actions = node('div', '', 'service-actions');
        if (record?.status !== 'connected') {
          const connect = button(record ? '다시 연결' : '연결', () => connectService(service));
          connect.disabled = !service.ready || Boolean(state.busy); actions.append(connect);
        }
        if (record) {
          const disconnect = button('연결 해제', () => confirmDisconnect(service), true);
          disconnect.disabled = Boolean(state.busy); actions.append(disconnect);
        }
        card.append(actions); grid.append(card);
      }
      section.append(grid); groups.append(section);
    }
    $('catalog-panel').hidden = false; $('catalog-empty').hidden = visible.length > 0;
  }
  function setBusy(scope) {
    state.busy = scope; $('refresh-services').disabled = Boolean(scope); renderCatalog();
    const submit = $('submit-connection'); if (submit) submit.disabled = Boolean(scope);
  }
  function flowFor(service) {
    if (state.busy) return null;
    const scope = snapshot(service.id);
    if (!actionable(scope)) { if (auth.token() !== state.bearer) boot(); return null; }
    closeFlow();
    const flow = { scope, service, pending: false }; state.flow = flow;
    $('action-heading').textContent = `${service.name} 연결`;
    $('action-panel').hidden = false; return flow;
  }
  function connectService(service) {
    if (!service.ready) return;
    const flow = flowFor(service); if (!flow) return;
    if (!['api_key', 'one_time_token'].includes(service.method)) { start(flow); return; }
    $('action-body').append(node('p', '서비스에서 발급받은 연결 정보를 입력해 주세요. 입력한 정보는 이 페이지에 보관하지 않아요.'));
    const form = node('form');
    const label = node('label', '연결 정보'); label.htmlFor = 'connection-secret';
    const input = node('input'); input.id = 'connection-secret'; input.type = 'password'; input.autocomplete = 'off'; input.required = true; input.maxLength = 4096;
    const submit = node('button', '연결 확인', 'service-button'); submit.id = 'submit-connection'; submit.type = 'submit';
    form.append(label, input, node('div', '', 'service-actions')); form.lastChild.append(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const credential = input.value.trim(); input.value = '';
      if (!credential || /[\r\n]/.test(credential)) { status('action-status', '발급받은 연결 정보를 확인해 주세요.', true); return; }
      start(flow, credential);
    }); $('action-body').append(form); input.focus();
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
  async function start(flow, credential) {
    const { scope, service } = flow;
    if (state.flow !== flow || !actionable(scope) || state.busy || !service.ready) return;
    setBusy(scope); status('action-status', '연결을 확인하고 있어요.');
    try {
      const body = { authMethod: service.method }; if (credential) body.credential = credential;
      const pending = request(`/connections/${encodeURIComponent(service.id)}/${service.route}/connect?${query(scope)}`, { method: 'POST', body: JSON.stringify(body) }, scope);
      credential = null; delete body.credential;
      const answer = await pending;
      if (!actionable(scope) || state.flow !== flow) return;
      if (answer?.service !== service.id || answer.authMethod !== service.method) throw new Error('invalid_start');
      if (answer.status === 'connected') {
        const reloaded = await refresh(scope); if (!current(scope)) return;
        const confirmed = reloaded && state.records.some((row) => row.service === service.id && row.status === 'connected');
        closeFlow(); status('page-status', confirmed ? '연결을 확인했어요.' : '연결 상태를 아직 확인하지 못했어요. 다시 확인해 주세요.', !confirmed);
      } else if (answer.status === 'authorization_required' && service.method === 'oauth') {
        const url = safeUrl(answer.connectionUrl); if (!url) throw new Error('invalid_url');
        flow.pending = true; $('action-body').replaceChildren();
        $('action-body').append(node('p', '새 창에서 서비스 연결을 마친 뒤 이 페이지로 돌아와 다시 확인해 주세요. 앱으로 돌아가라는 안내가 나와도 이 페이지에서 상태를 확인할 수 있어요.'));
        const link = node('a', '서비스 로그인 열기', 'service-button'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.addEventListener('click', (event) => { if (!actionable(scope) || state.flow !== flow) event.preventDefault(); });
        $('action-body').append(link, button('연결 상태 확인', () => { if (actionable(scope) && state.flow === flow) refresh(scope); }, true));
        status('action-status', '아직 연결 완료를 확인하지 않았어요.');
      } else throw new Error('invalid_start');
    } catch (error) { failure(error, scope, 'action-status'); }
    finally { if (current(scope) && state.busy === scope) setBusy(null); }
  }
  function confirmDisconnect(service) {
    const flow = flowFor(service); if (!flow) return;
    $('action-heading').textContent = `${service.name} 연결 해제`;
    $('action-body').append(node('p', '이 계정의 다른 프로젝트에서도 이 서비스 연결을 사용할 수 없게 돼요. 진행 중인 일에 영향을 줄 수 있어요.'));
    $('action-body').append(button('해제하기', () => disconnect(flow)));
  }
  async function disconnect(flow) {
    const scope = flow.scope;
    if (state.flow !== flow || !actionable(scope) || state.busy) return;
    setBusy(scope); status('action-status', '연결을 해제하고 있어요.');
    try {
      const answer = await request(`/connections/${encodeURIComponent(scope.service)}`, { method: 'PUT',
        body: JSON.stringify({ workspace_id: scope.workspace, user_id: scope.user, status: 'disabled' }) }, scope);
      if (!actionable(scope) || state.flow !== flow) return;
      if (answer?.service !== scope.service || answer.status !== 'disabled' || answer.user_id !== scope.user || answer.workspace_id !== scope.workspace) throw new Error('invalid_disconnect');
      const reloaded = await refresh(scope); if (!current(scope)) return;
      const removed = reloaded && !state.records.some((row) => row.service === scope.service);
      closeFlow(); status('page-status', removed ? '연결 해제를 확인했어요.' : '해제 상태를 아직 확인하지 못했어요. 다시 확인해 주세요.', !removed);
    } catch (error) { failure(error, scope, 'action-status'); }
    finally { if (current(scope) && state.busy === scope) setBusy(null); }
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
  $('cancel-action').addEventListener('click', () => { invalidate(); $('refresh-services').disabled = false; renderCatalog(); });
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
  window.addEventListener('focus', () => { if (state.flow?.pending && !state.busy) refresh(state.flow.scope); });
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('pageshow', () => { if (inApp() && auth.webHandoffWorkspace()?.required) boot(); });
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
