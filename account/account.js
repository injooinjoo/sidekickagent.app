(() => {
  'use strict';

  // The account page: who is signed in, the membership state the server holds
  // for this account, the account's projects with a way into AI 연결, and
  // 로그아웃. Signed out, it is a sign-in gate on the shared sheet; Google and
  // Apple come back here (auth.js RETURN_PATHS).
  //
  // It reads two routes and writes none. GET /account answers who is signed in
  // -- how, the address or the masked phone number, the display name, since
  // when, which ways in are linked -- and the membership summary, in one
  // answer. GET /workspaces/ai-engine-targets lists the projects. No account id
  // is shown: a phone account's id carries the whole number.
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
  const ACCOUNT_FAILED_COPY = '계정 정보를 불러오지 못했어요.';
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

  // `created_at` is an ISO timestamp; anything else shows nothing.
  function dayOf(iso) {
    const value = Date.parse(cleanText(iso, 64));
    return Number.isFinite(value) ? dateOf(value / 1000) : '';
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

  // A 401/403 on any read: the session ended while this page was open. 423:
  // the account is being deleted.
  function sessionEnded(message) {
    auth.signOut({ server: false, silent: true });
    showGate(message || EXPIRED_COPY, true);
  }

  function refused(error) {
    if (error.status === 401 || error.status === 403) { sessionEnded(EXPIRED_COPY); return true; }
    if (error.status === 423) { sessionEnded(auth.DELETION_PENDING_COPY); return true; }
    return false;
  }

  // ---- Signed in ----------------------------------------------------------------

  // Only the fields the page shows, each checked. A phone number only as the
  // server masked it.
  function sanitizeAccount(value) {
    if (!value || typeof value !== 'object' || !SAFE_ID.test(String(value.id || ''))) return null;
    const email = cleanText(value.email, 254);
    const phone = cleanText(value.phone_masked, 32);
    const identities = Array.isArray(value.identities) ? value.identities : [];
    return {
      method: cleanText(value.method, 40),
      email: email.includes('@') ? email : '',
      phoneMasked: /^[0-9*+ -]{4,32}$/.test(phone) && phone.includes('*') ? phone : '',
      displayName: cleanText(value.display_name, 80),
      joined: dayOf(value.created_at),
      linked: [...new Set(identities.map((method) => auth.methodLabel(cleanText(method, 40))).filter(Boolean))],
      membership: value.membership && typeof value.membership === 'object' ? value.membership : null
    };
  }

  function renderProfile(account) {
    const rows = [['로그인 방법', auth.methodLabel(account.method) || '확인하지 못했어요']];
    if (account.email) rows.push(['이메일', account.email]);
    if (account.phoneMasked) rows.push(['휴대폰 번호', account.phoneMasked]);
    if (account.displayName) rows.push(['표시 이름', account.displayName]);
    if (account.joined) rows.push(['가입일', account.joined]);
    if (account.linked.length) rows.push(['연결된 로그인 방법', account.linked.join(' · ')]);
    fill($('profile-rows'), rows.map(([label, value]) => el('div', {}, [el('dt', { text: label }), el('dd', { text: value })])));
    $('profile-rows').hidden = false;
    setStatus('profile-status', '', false);
    $('profile-retry').hidden = true;
    renderKept();
  }

  // How long this browser keeps the sign-in, said where 로그아웃 is.
  function renderKept() {
    const person = auth.account();
    const until = person ? dateOf(person.expiresAt) : '';
    $('profile-kept').textContent = until
      ? `이 브라우저에서는 ${until}까지 로그인이 유지돼요. 공용 컴퓨터라면 다 쓴 뒤 로그아웃해 주세요.`
      : '공용 컴퓨터라면 다 쓴 뒤 로그아웃해 주세요.';
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

  // One GET /account fills the account card and the membership card.
  async function loadAccount(seq) {
    $('profile-rows').hidden = true;
    $('profile-retry').hidden = true;
    $('membership-rows').hidden = true;
    $('membership-note').hidden = true;
    $('membership-actions').hidden = true;
    setStatus('profile-status', '계정 정보를 불러오고 있어요.', false);
    setStatus('membership-status', '멤버십 상태를 불러오고 있어요.', false);
    let answer = null;
    try {
      answer = await api('/account', { method: 'GET' });
    } catch (error) {
      if (seq !== state.seq) return;
      if (refused(error)) return;
      setStatus('profile-status', error.network ? NETWORK_COPY : ACCOUNT_FAILED_COPY, true);
      fill($('profile-retry'), [retryButton('다시 불러오기', () => loadAccount(state.seq))]);
      $('profile-retry').hidden = false;
      setStatus('membership-status', error.network ? NETWORK_COPY : MEMBERSHIP_FAILED_COPY, true);
      return;
    }
    if (seq !== state.seq) return;
    const account = sanitizeAccount(answer);
    if (!account) {
      setStatus('profile-status', ACCOUNT_FAILED_COPY, true);
      setStatus('membership-status', MEMBERSHIP_FAILED_COPY, true);
      return;
    }
    // The header menu says what this card says.
    auth.learnAccount(answer);
    renderProfile(account);
    if (account.membership) renderMembership(account.membership);
    else setStatus('membership-status', MEMBERSHIP_FAILED_COPY, true);
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
      if (refused(error)) return;
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
    // /auth.js has already checked the stored session with the server on this
    // page load; GET /account answers again, with everything this page shows.
    state.notice = null;
    $('account-gate').hidden = true;
    $('account-loading').hidden = true;
    $('account-view').hidden = false;
    await Promise.all([loadAccount(seq), loadProjects(seq)]);
  }

  $('gate-signin').addEventListener('click', () => auth.open());
  $('signout-button').addEventListener('click', () => auth.signOut());

  auth.init({
    onSignedIn: () => boot(),
    onSignedOut: () => showGate('로그아웃했어요.', false),
    onNotice: (message, isError) => {
      state.notice = { message, isError };
      if (!auth.token()) showGate(message, isError);
      else setStatus($('account-view').hidden ? 'account-loading' : 'profile-status', message, isError);
    }
  }).then(() => boot());
})();
