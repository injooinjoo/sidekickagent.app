(() => {
  'use strict';

  // The account page: who is signed in, the membership state the server holds
  // for this account, the account's projects with a way into AI 연결, and
  // 로그아웃. Signed out, it is a sign-in gate on the shared sheet; Google and
  // Apple come back here (auth.js RETURN_PATHS).
  //
  // It reads three routes and writes none: GET /auth/session (through
  // auth.js), GET /membership/status and GET /workspaces/ai-engine-targets.
  // It sells nothing -- there is no purchase or checkout path here -- and the
  // only way off it to a store or a web subscription is the `manage_url` the
  // server derived for a paid membership the person already holds.
  const auth = window.SidekickAuth;
  const { api } = auth;
  const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const PLAN_LABELS = { birdie: 'Birdie', eagle: 'Eagle', albatross: 'Albatross' };
  const SOURCE_LABELS = { toss: '웹', apple: 'App Store', google: 'Google Play' };
  const FUNDING_LABELS = { connected: '내 AI 계정 사용', included: 'Sidekick AI 포함' };
  const STATUS_LABELS = { active: '이용 중', cancel_at_period_end: '해지 예약 · 기간 끝까지 이용', grace: '결제 확인 중' };
  // Where a subscription is managed is the server's answer, never this page's;
  // these are the only hosts it may point at.
  const MANAGE_HOSTS = ['apps.apple.com', 'play.google.com', 'sidekickagent.app'];
  const NETWORK_COPY = auth.NETWORK_COPY;
  const MEMBERSHIP_FAILED_COPY = '멤버십 상태를 불러오지 못했어요.';
  const PROJECTS_FAILED_COPY = '프로젝트 목록을 불러오지 못했어요.';
  const EXPIRED_COPY = '로그인이 만료됐어요. 다시 로그인해 주세요.';

  // `notice` is what /auth.js said while the page was starting (a session that
  // ended, a dropped connection), kept so the gate can still say it.
  const state = { seq: 0, notice: null };
  const $ = (id) => document.getElementById(id);

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'className') node.className = value;
      else if (key === 'onClick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    (children || []).forEach((child) => { if (child) node.append(child); });
    return node;
  }

  function fill(node, children) {
    node.replaceChildren(...children.filter(Boolean));
  }

  function setStatus(id, message, isError) {
    const node = $(id);
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError && message));
  }

  function cleanText(value, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  function dateOf(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '';
    return new Date(value * 1000).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function retryButton(text, handler) {
    return el('button', { className: 'account-button secondary', type: 'button', text, onClick: handler });
  }

  // ---- Signed out -------------------------------------------------------------

  function showGate(message, isError) {
    state.seq += 1;
    $('account-loading').hidden = true;
    $('account-view').hidden = true;
    $('account-gate').hidden = false;
    setStatus('gate-status', message || '', isError);
  }

  // A 401 on any read: the session ended while this page was open.
  function sessionEnded() {
    auth.signOut({ server: false, silent: true });
    showGate(EXPIRED_COPY, true);
  }

  // ---- Signed in ----------------------------------------------------------------

  function renderProfile(person, user) {
    const id = String(user && user.id ? user.id : person.id || '');
    $('profile-method').textContent = person.methodLabel || '확인하지 못했어요';
    const contact = person.email || person.phone;
    $('profile-contact-row').hidden = !contact;
    $('profile-contact-label').textContent = person.email ? '이메일' : '휴대폰 번호';
    $('profile-contact').textContent = contact;
    $('profile-id').textContent = person.shortId || id;
    $('profile-id').title = id;
  }

  function manageLink(membership) {
    const url = auth.httpsUrl(membership.manage_url);
    if (!url) return null;
    const host = new URL(url).hostname;
    if (!MANAGE_HOSTS.includes(host)) return null;
    const external = host !== 'sidekickagent.app';
    return el('a', {
      className: 'account-button secondary',
      href: url,
      text: `${SOURCE_LABELS[membership.purchase_source] || ''}에서 구독 관리`.trim(),
      target: external ? '_blank' : null,
      rel: external ? 'noopener' : null
    });
  }

  // Rows for what the server said, in words. A paid plan first; otherwise the
  // one account trial; otherwise no membership. Nothing here offers to buy.
  function renderMembership(membership) {
    const rows = [];
    let note = '';
    let action = null;
    const plan = PLAN_LABELS[membership.plan_id];
    const trial = membership.trial && typeof membership.trial === 'object' ? membership.trial : {};
    if (plan && STATUS_LABELS[membership.status]) {
      rows.push(['플랜', plan]);
      rows.push(['상태', STATUS_LABELS[membership.status]]);
      if (SOURCE_LABELS[membership.purchase_source]) rows.push(['구독한 곳', SOURCE_LABELS[membership.purchase_source]]);
      if (FUNDING_LABELS[membership.funding_mode]) rows.push(['AI 사용', FUNDING_LABELS[membership.funding_mode]]);
      const until = dateOf(membership.current_period_end);
      if (until) rows.push([membership.status === 'cancel_at_period_end' ? '이용 종료일' : '다음 결제일', until]);
      note = '구독은 구독한 곳에서만 바꾸거나 해지할 수 있어요.';
      action = manageLink(membership);
    } else if (trial.status === 'active') {
      rows.push(['플랜', '7일 무료 체험']);
      rows.push(['상태', '체험 중']);
      const ends = dateOf(trial.ends_at);
      if (ends) rows.push(['체험 종료', ends]);
      note = '체험이 끝나면 앱에서 멤버십을 이어서 시작할 수 있어요.';
    } else {
      rows.push(['플랜', '없음']);
      rows.push(['상태', trial.status === 'expired' ? '무료 체험이 끝났어요' : '이용 중인 멤버십이 없어요']);
      note = trial.status === 'eligible'
        ? '7일 무료 체험은 사이드킥 앱에서 시작할 수 있어요.'
        : '멤버십은 사이드킥 앱에서 시작할 수 있어요.';
    }
    fill($('membership-rows'), rows.map(([label, value]) => el('div', {}, [el('dt', { text: label }), el('dd', { text: value })])));
    $('membership-rows').hidden = false;
    $('membership-note').textContent = note;
    $('membership-note').hidden = !note;
    fill($('membership-actions'), [action]);
    $('membership-actions').hidden = !action;
    setStatus('membership-status', '', false);
  }

  async function loadMembership(seq) {
    $('membership-rows').hidden = true;
    $('membership-note').hidden = true;
    $('membership-actions').hidden = true;
    setStatus('membership-status', '멤버십 상태를 불러오고 있어요.', false);
    let membership = null;
    try {
      membership = await api('/membership/status', { method: 'GET' });
    } catch (error) {
      if (seq !== state.seq) return;
      if (error.status === 401) { sessionEnded(); return; }
      setStatus('membership-status', error.network ? NETWORK_COPY : MEMBERSHIP_FAILED_COPY, true);
      fill($('membership-actions'), [retryButton('다시 불러오기', () => loadMembership(state.seq))]);
      $('membership-actions').hidden = false;
      return;
    }
    if (seq !== state.seq) return;
    if (!membership || typeof membership !== 'object') {
      setStatus('membership-status', MEMBERSHIP_FAILED_COPY, true);
      return;
    }
    renderMembership(membership);
  }

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

  function projectItem(workspace) {
    return el('li', { className: 'project-item' }, [
      el('div', { className: 'project-head' }, [
        el('strong', { text: workspace.name }),
        el('span', { className: workspace.ready ? 'project-tag is-ok' : 'project-tag is-warn', text: workspace.ready ? 'AI 연결 가능' : '준비 중' })
      ]),
      workspace.ready ? null : el('p', { className: 'account-note', text: '앱에서 이 프로젝트를 한 번 열면 준비돼요.' }),
      el('a', {
        className: workspace.ready ? 'account-button' : 'account-button secondary',
        href: `/ai/?workspace=${encodeURIComponent(workspace.id)}`,
        text: 'AI 연결'
      })
    ]);
  }

  function signInAnotherWay() {
    auth.signOut({ silent: true });
    showGate('', false);
    auth.open();
  }

  async function loadProjects(seq) {
    $('project-list').hidden = true;
    $('projects-next').hidden = true;
    setStatus('projects-status', '프로젝트를 불러오고 있어요.', false);
    let workspaces = null;
    try {
      workspaces = sanitizeWorkspaces(await api('/workspaces/ai-engine-targets', { method: 'GET' }));
    } catch (error) {
      if (seq !== state.seq) return;
      if (error.status === 401) { sessionEnded(); return; }
      setStatus('projects-status', error.network ? NETWORK_COPY : PROJECTS_FAILED_COPY, true);
      fill($('projects-next'), [retryButton('다시 불러오기', () => loadProjects(state.seq))]);
      $('projects-next').hidden = false;
      return;
    }
    if (seq !== state.seq) return;
    if (!workspaces) { setStatus('projects-status', PROJECTS_FAILED_COPY, true); return; }
    if (!workspaces.length) {
      setStatus('projects-status', '아직 프로젝트가 없어요. 사이드킥 앱에서 첫 프로젝트를 시작하면 여기에 보여요.', false);
      fill($('projects-next'), [
        el('p', { text: '앱에서 이미 쓰고 있다면, 앱과 다른 방법으로 로그인했을 수 있어요. 앱에서 쓰는 방법으로 다시 로그인해 보세요.' }),
        el('div', { className: 'account-actions' }, [
          el('button', { className: 'account-button', type: 'button', text: '다른 방법으로 로그인', onClick: signInAnotherWay }),
          el('a', { className: 'account-button secondary', href: '/support/', text: '도움말 보기' })
        ])
      ]);
      $('projects-next').hidden = false;
      return;
    }
    fill($('project-list'), workspaces.map(projectItem));
    $('project-list').hidden = false;
    setStatus('projects-status', '', false);
  }

  async function boot() {
    const seq = ++state.seq;
    if (!auth.token()) {
      const notice = state.notice;
      state.notice = null;
      showGate(notice ? notice.message : '', notice ? notice.isError : false);
      return;
    }
    $('account-gate').hidden = true;
    $('account-loading').hidden = false;
    setStatus('account-loading', '계정을 확인하고 있어요.', false);
    // /auth.js has asked the server who this is on this page load; ask again
    // only if that answer did not arrive.
    let user = auth.user();
    try {
      if (!user) user = await auth.whoami();
    } catch (error) {
      if (seq !== state.seq) return;
      if (error.status === 401 || error.status === 403) { sessionEnded(); return; }
      setStatus('account-loading', error.network ? NETWORK_COPY : '계정을 확인하지 못했어요.', true);
      $('account-loading').append(' ', retryButton('다시 시도', () => boot()));
      return;
    }
    if (seq !== state.seq) return;
    if (!user || !SAFE_ID.test(String(user.id || ''))) { sessionEnded(); return; }
    $('account-loading').hidden = true;
    $('account-view').hidden = false;
    renderProfile(auth.account() || {}, user);
    await Promise.all([loadMembership(seq), loadProjects(seq)]);
  }

  $('gate-signin').addEventListener('click', () => auth.open());
  $('signout-button').addEventListener('click', () => auth.signOut());

  auth.init({
    onSignedIn: () => boot(),
    onSignedOut: () => showGate('로그아웃했어요.', false),
    onNotice: (message, isError) => {
      state.notice = { message, isError };
      if (auth.token()) setStatus('account-loading', message, isError);
      else showGate(message, isError);
    }
  }).then(() => boot());
})();
