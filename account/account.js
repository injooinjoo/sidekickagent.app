(() => {
  'use strict';

  // The account page: who is signed in, the membership state the server holds
  // for this account, its credits, reset tickets and invites (D79), the account's
  // one AI connection with the way into AI 연결, and 로그아웃. Signed out, it is a
  // sign-in gate on the shared sheet; Google and Apple come back here (auth.js
  // RETURN_PATHS).
  //
  // It reads six routes and changes one setting: the tickets' auto-use switch
  // (PUT /usage/tickets/auto-use). GET /usage/credits and GET /usage/tickets give
  // the numbers, GET /usage/breakdown where the credits went (사용량, owner
  // 2026-10-25: everything, refreshed while the page is looked at); a route an
  // older server does not have yet leaves its card saying so, never a guess. GET /account answers who is
  // signed in -- how, the address or the masked phone number, the display name,
  // since when, which ways in are linked -- and the membership summary, in one
  // answer. The AI is the account's, not one project's (owner, 2026-10-07): it is
  // connected once and every project of the account runs on it, so the page shows
  // it once -- GET /workspaces/ai-engine-targets names a project that can answer
  // for it, and GET /ai-engine-connections through that project is the account's
  // connection, the same answer /ai/ lists. No account id is shown: a phone
  // account's id carries the whole number.
  // No payment starts here. Subscribers use the server-derived manage_url;
  // everyone else is on Free and can view plans and top-ups on the membership page.
  const auth = window.SidekickAuth;
  const { api } = auth;
  const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
  const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  // The names /ai/ gives the AI services (ai/ai.js PROVIDER_NAMES); any other keeps the server's id.
  const PROVIDER_NAMES = {
    openai: 'ChatGPT', anthropic: 'Claude', xai: 'Grok', gemini: 'Gemini', openrouter: 'OpenRouter',
    minimax: 'MiniMax', deepseek: 'DeepSeek', qwen: 'Qwen', kimi: 'Kimi', zai: 'Z.AI',
    copilot: 'GitHub Copilot', nous: 'Nous Portal', vertex: 'Google Vertex AI', bedrock: 'AWS Bedrock',
    'azure-foundry': 'Azure AI Foundry', '9router': '9Router', omniroute: 'OmniRoute'
  };
  const PLAN_LABELS = { birdie: 'Birdie', eagle: 'Eagle', albatross: 'Albatross' };
  // The credits card names the plan the credits come from, Free included.
  const CREDIT_PLAN_LABELS = { free: 'Free', ...PLAN_LABELS };
  const SOURCE_LABELS = { toss: '웹', apple: 'App Store', google: 'Google Play' };
  const STATUS_LABELS = { active: '이용 중', cancel_at_period_end: '해지 예약 · 기간 끝까지 이용', grace: '결제 확인 중' };
  // Where a subscription is managed is the server's answer, never this page's;
  // these are the only hosts it may point at.
  const MANAGE_HOSTS = ['apps.apple.com', 'play.google.com', 'sidekickagent.app'];
  const NETWORK_COPY = auth.NETWORK_COPY;
  const ACCOUNT_FAILED_COPY = '계정 정보를 불러오지 못했어요.';
  const MEMBERSHIP_FAILED_COPY = '멤버십 상태를 불러오지 못했어요.';
  const AI_FAILED_COPY = 'AI 연결을 불러오지 못했어요.';
  const CREDITS_FAILED_COPY = '크레딧을 불러오지 못했어요.';
  const CREDITS_UNAVAILABLE_COPY = '지금은 크레딧을 볼 수 없어요.';
  const TICKETS_FAILED_COPY = '티켓을 불러오지 못했어요.';
  const TICKETS_UNAVAILABLE_COPY = '지금은 티켓을 쓸 수 없어요.';
  const EXPIRED_COPY = '로그인이 만료됐어요. 다시 로그인해 주세요.';
  const USAGE_FAILED_COPY = '사용량을 불러오지 못했어요.';
  const USAGE_UNAVAILABLE_COPY = '지금은 사용량을 볼 수 없어요.';
  // 사용량 is read again on focus, when the tab is shown again, and every 30 s while it is visible -- never while hidden.
  const USAGE_REFRESH_MS = 30000;
  const USAGE_PERIODS = ['current', 'previous'];
  // The services, in the order the owner listed them; `tts` is every voice use.
  const SPEND_LABELS = [['text', '텍스트'], ['image', '이미지'], ['video', '영상'], ['tts', '음성'], ['music', '음악'],
    ['search', '검색'], ['server', '서버'], ['storage', '저장소']];
  const SERVER_LABELS = { compute: '서버', storage: '저장소' };

  // `notice` is what /auth.js said while the page was starting (a session that
  // ended, a dropped connection), kept so the gate can still say it. `account` and
  // `ai` are this load's two answers the AI card is drawn from, whichever comes first.
  const state = { seq: 0, notice: null, account: null, ai: null, tickets: null, creditsBusy: false };
  // 사용량: the period shown, its last good answer and when it came, the 30-second timer, and `ask`, which makes an
  // answer to an older question (another period, an earlier refresh) count for nothing.
  const usage = { period: 'current', data: null, updatedAt: 0, timer: null, busy: false, ask: 0, unavailable: false };
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

  // An ISO timestamp or epoch seconds, as milliseconds; 0 when it is neither.
  function whenOf(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * 1000 : 0;
    const parsed = Date.parse(cleanText(value, 64));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Refills happen at 09:00 in Korea, so the time is said in Korea's time.
  function koreanTime(ms) {
    return ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }

  function count(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function number(value) {
    return Number(value).toLocaleString('ko-KR');
  }

  function rowsOf(pairs) {
    return pairs.map(([label, value]) => el('div', {}, [el('dt', { text: label }), el('dd', { text: value })]));
  }

  function retryButton(text, handler) {
    return el('button', { className: 'account-button secondary', type: 'button', text, onClick: handler });
  }

  // ---- Signed out -------------------------------------------------------------

  function showGate(message, isError) {
    state.seq += 1;
    stopUsageRefresh();
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
      text: '구독 관리',
      target: external ? '_blank' : null,
      rel: external ? 'noopener' : null
    });
  }

  // Rows for what the server said, in words. A paid plan first; otherwise the
  // account is on Free (D79: there is no trial any more). Only the membership page can start checkout.
  function renderMembership(membership) {
    const rows = [];
    let note = '';
    let action = null;
    const plan = PLAN_LABELS[membership.plan_id];
    if (plan && STATUS_LABELS[membership.status]) {
      rows.push(['플랜', plan]);
      rows.push(['상태', STATUS_LABELS[membership.status]]);
      if (SOURCE_LABELS[membership.purchase_source]) rows.push(['구독한 곳', SOURCE_LABELS[membership.purchase_source]]);
      const until = dateOf(membership.current_period_end);
      if (until) rows.push([membership.status === 'cancel_at_period_end' ? '이용 종료일' : '다음 결제일', until]);
      note = '';
      action = manageLink(membership);
    } else {
      rows.push(['플랜', 'Free']);
      rows.push(['상태', '이용 중']);
      note = '결제수단 없이 계속 쓸 수 있어요.';
      action = el('a', { className: 'account-button', href: '/membership/', text: '요금제 보기' });
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
    state.account = account;
    renderAi();
    if (account.membership) renderMembership(account.membership);
    else setStatus('membership-status', MEMBERSHIP_FAILED_COPY, true);
  }

  // GET /usage/credits, checked field by field. Only what the card shows.
  function sanitizeCredits(answer) {
    const credits = answer && typeof answer === 'object' && answer.credits && typeof answer.credits === 'object' ? answer.credits : null;
    if (!credits || count(credits.remaining) === null || count(credits.allowance) === null) return null;
    const runs = answer.daily_work_runs && typeof answer.daily_work_runs === 'object' ? answer.daily_work_runs : null;
    return {
      plan: CREDIT_PLAN_LABELS[cleanText(credits.plan_id, 40)] || '',
      daily: credits.period === 'daily',
      allowance: credits.allowance,
      remaining: credits.remaining,
      nextRefill: whenOf(credits.next_refill_at),
      periodEnd: whenOf(credits.period_end),
      topup: count(credits.topup_remaining),
      runs: runs && count(runs.limit) !== null && count(runs.used) !== null ? { limit: runs.limit, used: runs.used } : null
    };
  }

  // Free with a fifth or less of today's credits left (not none): the app's and the server notice's sentence,
  // with when they come back -- '오늘 크레딧이 거의 다 떨어졌어요. 내일 오전 9시에 30크레딧으로 채워져요.'
  function freeNearLimitNotice(credits, now = Date.now()) {
    if (!credits.daily || !credits.allowance || credits.remaining <= 0 || credits.remaining * 5 > credits.allowance) return '';
    const head = '오늘 크레딧이 거의 다 떨어졌어요.';
    if (!credits.nextRefill) return head;
    const days = kstDay(credits.nextRefill) - kstDay(now);
    const day = days <= 0 ? '오늘' : days === 1 ? '내일' : koreanTime(credits.nextRefill).replace(/\s*(오전|오후).*$/, '');
    const clock = new Date(credits.nextRefill).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' })
      .replace(/:00$/, '시').replace(/:(\d\d)$/, '시 $1분');
    return `${head} ${day} ${clock}에 ${number(credits.allowance)}크레딧으로 채워져요.`;
  }

  // Remaining plan credits, when they come back (Free: every day at 09:00), the
  // top-up balance and, on Free, today's work runs.
  function renderCredits(credits) {
    const rows = [];
    if (credits.plan) rows.push(['플랜', credits.plan]);
    rows.push(['남은 크레딧', `${number(credits.remaining)} / ${number(credits.allowance)}`]);
    if (credits.daily) rows.push(['다음 충전', koreanTime(credits.nextRefill) || '매일 오전 9시']);
    else if (credits.periodEnd || credits.nextRefill) rows.push(['다음 초기화', dateOf((credits.periodEnd || credits.nextRefill) / 1000)]);
    if (credits.topup !== null) rows.push(['충전 크레딧', number(credits.topup)]);
    if (credits.runs) rows.push(['오늘 업무 실행', `${number(credits.runs.used)} / ${number(credits.runs.limit)}회`]);
    fill($('credits-rows'), rowsOf(rows));
    $('credits-rows').hidden = false;
    const note = credits.daily
      ? '매일 오전 9시에 다시 채워지고, 남은 크레딧은 쌓이지 않아요. 충전 크레딧은 플랜 크레딧을 다 쓴 뒤에 써요.'
      : '충전 크레딧은 플랜 크레딧을 다 쓴 뒤에 쓰고, 해지해도 남아요.';
    const nearLimit = freeNearLimitNotice(credits);
    $('credits-note').textContent = nearLimit ? `${nearLimit} ${note}` : note;
    $('credits-note').hidden = false;
    fill($('credits-actions'), [el('a', { className: 'account-button secondary', href: '/membership/#topup', text: '추가 충전 보기' })]);
    $('credits-actions').hidden = false;
    setStatus('credits-status', '', false);
  }

  // `quiet` is the 30-second refresh beside 사용량: the card is redrawn only from a good answer, so it never blinks and
  // its numbers stay the ones 사용량 shows.
  async function loadCredits(seq, quiet) {
    if (quiet && state.creditsBusy) return;
    if (!quiet) {
      $('credits-rows').hidden = true;
      $('credits-note').hidden = true;
      $('credits-actions').hidden = true;
      setStatus('credits-status', '크레딧을 불러오고 있어요.', false);
    }
    state.creditsBusy = true;
    let credits = null;
    try {
      credits = sanitizeCredits(await api('/usage/credits', { method: 'GET' }));
    } catch (error) {
      state.creditsBusy = false;
      if (seq !== state.seq) return;
      if (refused(error)) return;
      if (quiet) return;
      if (error.status === 404) { setStatus('credits-status', CREDITS_UNAVAILABLE_COPY, false); return; }
      setStatus('credits-status', error.network ? NETWORK_COPY : CREDITS_FAILED_COPY, true);
      fill($('credits-actions'), [retryButton('다시 불러오기', () => loadCredits(state.seq))]);
      $('credits-actions').hidden = false;
      return;
    }
    state.creditsBusy = false;
    if (seq !== state.seq) return;
    if (!credits) { if (!quiet) setStatus('credits-status', CREDITS_FAILED_COPY, true); return; }
    renderCredits(credits);
  }

  // GET /usage/tickets (and the PUT's answer): the counts, the auto-use setting and the invites.
  function sanitizeTickets(answer) {
    if (!answer || typeof answer !== 'object') return null;
    const block = answer.tickets && typeof answer.tickets === 'object' ? answer.tickets : null;
    if (!block || count(block.full) === null || count(block.half) === null) return null;
    const invites = answer.invites && typeof answer.invites === 'object' ? answer.invites : null;
    const milestone = invites && invites.next_milestone && typeof invites.next_milestone === 'object' ? invites.next_milestone : null;
    return {
      full: block.full,
      half: block.half,
      autoUse: typeof block.auto_use === 'boolean' ? block.auto_use : answer.auto_use === true,
      invites: invites && count(invites.completed) !== null && count(invites.codes_remaining) !== null ? {
        completed: invites.completed,
        remaining: invites.codes_remaining,
        next: milestone && count(milestone.completed_invites) ? {
          at: milestone.completed_invites,
          tickets: count(milestone.full_tickets),
          credits: count(milestone.credits)
        } : null
      } : null
    };
  }

  function milestoneCopy(next) {
    if (next.tickets) return `${number(next.at)}명이 되면 전체 티켓 ${number(next.tickets)}장을 더 받아요.`;
    if (next.credits) return `${number(next.at)}명이 되면 충전 크레딧 ${number(next.credits)}을 더 받아요.`;
    return '';
  }

  function renderTickets() {
    const tickets = state.tickets;
    if (!tickets) return;
    fill($('tickets-rows'), rowsOf([['전체 초기화', `${number(tickets.full)}장`], ['절반 초기화', `${number(tickets.half)}장`]]));
    $('tickets-rows').hidden = false;
    const toggle = $('auto-use-toggle');
    toggle.setAttribute('aria-checked', String(tickets.autoUse));
    $('auto-use-row').hidden = false;
    $('tickets-note').hidden = false;
    const invites = tickets.invites;
    $('invites-card').hidden = !invites;
    if (!invites) return;
    fill($('invites-rows'), rowsOf([['초대를 마친 친구', `${number(invites.completed)}명`], ['남은 초대장', `${number(invites.remaining)}장`]]));
    const next = invites.next ? milestoneCopy(invites.next) : '';
    const note = `친구가 온보딩을 마칠 때마다 전체 티켓 1장을 받아요.${next ? ` ${next}` : ''}`;
    $('invites-note').textContent = note;
    $('invites-note').hidden = false;
  }

  async function loadTickets(seq) {
    state.tickets = null;
    $('tickets-rows').hidden = true;
    $('auto-use-row').hidden = true;
    $('tickets-note').hidden = true;
    $('invites-card').hidden = true;
    setStatus('tickets-status', '티켓을 불러오고 있어요.', false);
    let tickets = null;
    try {
      tickets = sanitizeTickets(await api('/usage/tickets', { method: 'GET' }));
    } catch (error) {
      if (seq !== state.seq) return;
      if (refused(error)) return;
      setStatus('tickets-status', error.status === 404 ? TICKETS_UNAVAILABLE_COPY : error.network ? NETWORK_COPY : TICKETS_FAILED_COPY,
        error.status !== 404);
      return;
    }
    if (seq !== state.seq) return;
    if (!tickets) { setStatus('tickets-status', TICKETS_FAILED_COPY, true); return; }
    state.tickets = tickets;
    setStatus('tickets-status', '', false);
    renderTickets();
  }

  // The one write on this page. The switch shows what the server stored, never what was pressed.
  async function setAutoUse() {
    const toggle = $('auto-use-toggle');
    if (!state.tickets || toggle.disabled) return;
    const seq = state.seq;
    const next = !state.tickets.autoUse;
    toggle.disabled = true;
    setStatus('tickets-status', '', false);
    try {
      const answer = sanitizeTickets(await api('/usage/tickets/auto-use', { method: 'PUT', body: JSON.stringify({ enabled: next }) }));
      if (seq !== state.seq) return;
      state.tickets = answer ? { ...answer, invites: answer.invites || state.tickets.invites } : { ...state.tickets, autoUse: next };
      setStatus('tickets-status', state.tickets.autoUse ? '자동으로 쓰기를 켰어요.' : '자동으로 쓰기를 껐어요.', false);
    } catch (error) {
      if (seq !== state.seq) return;
      if (refused(error)) return;
      setStatus('tickets-status', error.network ? NETWORK_COPY : '설정을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    }
    toggle.disabled = false;
    renderTickets();
  }

  // ---- 사용량 -------------------------------------------------------------------

  function objectOf(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function creditText(value) {
    return `${number(value)}크레딧`;
  }

  // The day in Korea, as a whole number, so "today" and "tomorrow" are Korea's.
  function kstDay(ms) {
    return Math.floor((ms + 9 * 3600000) / 86400000);
  }

  // `2026-10-24` (a day in Korea, as the server writes it) as 10월 24일.
  function dayLabel(text) {
    const [, month, day] = text.split('-');
    return `${Number(month)}월 ${Number(day)}일`;
  }

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  // GET /usage/breakdown?period=, field by field. The plan and the per-service numbers must all be whole and present, or
  // the answer counts as not read (never shown as zeros); any other part that is missing or malformed is left out.
  function sanitizeUsage(answer, period) {
    const value = objectOf(answer);
    if (!value || value.period !== period) return null;
    const plan = objectOf(value.plan);
    const spend = objectOf(value.spend);
    if (!plan || [plan.allowance, plan.used, plan.remaining].some((n) => count(n) === null)) return null;
    if (!spend || count(spend.total) === null || SPEND_LABELS.some(([key]) => count(spend[key]) === null)) return null;
    const topup = objectOf(value.topup);
    const tickets = objectOf(value.tickets);
    const bought = objectOf(value.purchases);
    const own = objectOf(value.own_account);
    const lines = Array.isArray(value.server) ? value.server.filter((line) => line && typeof line === 'object'
      && /^\d{4}-\d{2}-\d{2}$/.test(String(line.date)) && Object.hasOwn(SERVER_LABELS, String(line.category))
      && count(line.credits) !== null) : null;
    return {
      period,
      free: cleanText(plan.plan_id, 40) === 'free',
      starts: whenOf(value.starts_at),
      ends: whenOf(value.ends_at),
      plan: { allowance: plan.allowance, used: plan.used, remaining: plan.remaining, refill: whenOf(plan.next_refill_at) },
      topup: topup && count(topup.remaining) !== null ? topup.remaining : null,
      tickets: tickets && ['full', 'half', 'used_full', 'used_half'].every((key) => count(tickets[key]) !== null)
        ? { full: tickets.full, half: tickets.half, usedFull: tickets.used_full, usedHalf: tickets.used_half } : null,
      server: lines ? lines.map((line) => ({ date: String(line.date), category: String(line.category), credits: line.credits })) : null,
      spend: { ...Object.fromEntries(SPEND_LABELS.map(([key]) => [key, spend[key]])), total: spend.total },
      own: own && count(own.count) !== null && count(own.estimated_credits) !== null
        ? { count: own.count, estimated: own.estimated_credits } : null,
      purchases: bought && ['count', 'credits', 'refunds', 'refunded_credits'].every((key) => count(bought[key]) !== null)
        ? { count: bought.count, credits: bought.credits, refunds: bought.refunds, refunded: bought.refunded_credits } : null
    };
  }

  function usageBlock(title, pairs, note) {
    return el('div', { className: 'usage-block' }, [
      el('h3', { text: title }),
      pairs.length ? el('dl', { className: 'account-rows' }, rowsOf(pairs)) : null,
      note ? el('p', { className: 'account-note', text: note }) : null
    ]);
  }

  // When the plan credits come back, said in Korea's time (Free: every day at 09:00).
  function refillNote(data) {
    if (data.period !== 'current' || !data.plan.refill) return '';
    const amount = creditText(data.plan.allowance);
    if (data.free) {
      const days = kstDay(data.plan.refill) - kstDay(Date.now());
      if (days === 0) return `오늘 오전 9시에 ${amount}으로 채워져요.`;
      if (days === 1) return `내일 오전 9시에 ${amount}으로 채워져요.`;
    }
    return `${koreanTime(data.plan.refill)}에 ${amount}으로 ${data.free ? '' : '다시 '}채워져요.`;
  }

  // The server's daily settlement, newest day first: one row per day with what the server and the storage cost.
  function serverBlock(lines) {
    const days = new Map();
    lines.forEach((line) => {
      const day = days.get(line.date) || {};
      day[line.category] = (day[line.category] || 0) + line.credits;
      days.set(line.date, day);
    });
    const pairs = [...days.entries()].reverse().map(([date, day]) => [dayLabel(date),
      ['compute', 'storage'].filter((key) => Object.hasOwn(day, key)).map((key) => `${SERVER_LABELS[key]} ${creditText(day[key])}`).join(' · ')]);
    return usageBlock('서버 이용', pairs, pairs.length ? '하루치를 다음 날 정산해 날짜별로 보여 줘요.' : '아직 정산된 서버 이용이 없어요.');
  }

  function renderUsage() {
    const data = usage.data;
    if (!data) return;
    const [now, before] = data.free ? ['오늘', '어제'] : ['이번 달', '지난 달'];
    $('usage-current').textContent = now;
    $('usage-previous').textContent = before;
    const word = data.period === 'current' ? now : before;
    const range = data.starts && data.ends ? `${koreanTime(data.starts)} ~ ${koreanTime(data.ends)}` : '';
    $('usage-range').textContent = range;
    $('usage-range').hidden = !range;
    const blocks = [
      usageBlock('플랜 크레딧', [['받은 크레딧', creditText(data.plan.allowance)], ['쓴 크레딧', creditText(data.plan.used)],
        ['남은 크레딧', creditText(data.plan.remaining)]], refillNote(data)),
      data.topup !== null ? usageBlock('충전 크레딧', [['충전 크레딧 남음', creditText(data.topup)]], '플랜 크레딧을 다 쓴 뒤에 써요.') : null,
      data.tickets ? usageBlock('초기화 티켓', [['전체 초기화 남음', `${number(data.tickets.full)}장`],
        ['절반 초기화 남음', `${number(data.tickets.half)}장`],
        [`${word} 쓴 티켓`, `전체 ${number(data.tickets.usedFull)}장 · 절반 ${number(data.tickets.usedHalf)}장`]]) : null,
      data.server ? serverBlock(data.server) : null,
      usageBlock('서비스별 사용', [...SPEND_LABELS.map(([key, label]) => [label, creditText(data.spend[key])]),
        ['합계', creditText(data.spend.total)]]),
      data.own ? usageBlock('내 계정으로 처리', [['처리한 작업', `${number(data.own.count)}건 · 0크레딧`],
        ['사이드킥 크레딧이었다면', `약 ${creditText(data.own.estimated)}`]], '내 계정으로 처리한 작업은 크레딧이 들지 않아요.') : null,
      data.purchases ? usageBlock('구매·환불 내역', [['구매', `${number(data.purchases.count)}건 · ${creditText(data.purchases.credits)}`],
        ['환불', `${number(data.purchases.refunds)}건 · ${creditText(data.purchases.refunded)}`]]) : null
    ];
    fill($('usage-body'), blocks);
    $('usage-body').hidden = false;
    $('usage-actions').hidden = true;
    setStatus('usage-status', '', false);
    $('usage-updated').textContent = `${clock(usage.updatedAt)} 기준 · 이 화면을 보는 동안 30초마다 새로 불러와요.`;
    $('usage-updated').hidden = false;
  }

  // A server without the route (or with it switched off) says so once and is not asked again until the next load.
  // Any other failure says it plainly with a retry; numbers already on screen stay, under the time they were read.
  function usageFailed(error) {
    if (error && error.status === 404) {
      usage.unavailable = true;
      stopUsageRefresh();
      $('usage-body').hidden = true;
      $('usage-range').hidden = true;
      $('usage-updated').hidden = true;
      $('usage-actions').hidden = true;
      setStatus('usage-status', USAGE_UNAVAILABLE_COPY, false);
      return;
    }
    if (!usage.data) {
      $('usage-body').hidden = true;
      $('usage-range').hidden = true;
      $('usage-updated').hidden = true;
    }
    setStatus('usage-status', error && error.network ? NETWORK_COPY : USAGE_FAILED_COPY, true);
    fill($('usage-actions'), [retryButton('다시 불러오기', () => loadUsage(state.seq, false))]);
    $('usage-actions').hidden = false;
  }

  // `quiet` is a refresh: what is on screen stays until the new answer is in.
  async function loadUsage(seq, quiet) {
    if (quiet && usage.busy) return;
    const ask = ++usage.ask;
    const period = usage.period;
    usage.busy = true;
    if (!quiet) {
      usage.data = null;
      $('usage-body').hidden = true;
      $('usage-range').hidden = true;
      $('usage-updated').hidden = true;
      $('usage-actions').hidden = true;
      setStatus('usage-status', '사용량을 불러오고 있어요.', false);
    }
    let answer = null;
    let failure = null;
    try {
      answer = await api(`/usage/breakdown?period=${period}`, { method: 'GET' });
    } catch (error) {
      failure = error;
    }
    if (ask === usage.ask) usage.busy = false;
    if (seq !== state.seq || ask !== usage.ask) return;
    if (failure) {
      if (refused(failure)) return;
      usageFailed(failure);
      return;
    }
    const data = sanitizeUsage(answer, period);
    if (!data) { usageFailed(null); return; }
    usage.data = data;
    usage.updatedAt = Date.now();
    renderUsage();
  }

  function markPeriod() {
    USAGE_PERIODS.forEach((period) => $(`usage-${period}`).setAttribute('aria-pressed', String(period === usage.period)));
  }

  function choosePeriod(period) {
    if (!USAGE_PERIODS.includes(period) || (period === usage.period && usage.data)) return;
    usage.period = period;
    markPeriod();
    loadUsage(state.seq, false);
  }

  function pageVisible() {
    return document.visibilityState === 'visible';
  }

  function stopUsageRefresh() {
    if (usage.timer === null) return;
    window.clearInterval(usage.timer);
    usage.timer = null;
  }

  function startUsageRefresh() {
    if (usage.timer !== null || usage.unavailable || !pageVisible() || typeof window.setInterval !== 'function') return;
    usage.timer = window.setInterval(() => refreshUsage(), USAGE_REFRESH_MS);
  }

  // The plan numbers are read again with 사용량, so the two cards always agree.
  function refreshUsage() {
    if (!auth.token() || $('account-view').hidden || usage.unavailable || !pageVisible()) { stopUsageRefresh(); return; }
    loadUsage(state.seq, true);
    loadCredits(state.seq, true);
  }

  // Shown again or focused: read now and keep reading every 30 s. Hidden: stop.
  function onVisibility() {
    if (!pageVisible()) { stopUsageRefresh(); return; }
    if ($('account-view').hidden) return;
    refreshUsage();
    startUsageRefresh();
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
      workspaces.push({ id, ready: row.ready === true, recent: row.recent === true });
    });
    return workspaces;
  }

  // The account's connections only. An employee's own AI (agent_id) belongs to one project's employee and is the app's
  // to show; the card is the AI every project runs on.
  function sanitizeAiConnections(value) {
    if (!Array.isArray(value)) return null;
    return value
      .filter((row) => row && typeof row === 'object' && !row.agent_id && PROVIDER_ID.test(String(row.provider || '')))
      .map((row) => ({
        provider: String(row.provider),
        model: cleanText(row.model, 160),
        connected: row.status === 'connected' && row.readiness === 'ready'
      }));
  }

  function providerName(id) {
    return Object.hasOwn(PROVIDER_NAMES, id) ? PROVIDER_NAMES[id] : id;
  }

  // The account the AI is connected for, named the way /ai/ names who is signed in beside its title.
  function accountName(account) {
    return account ? account.email || account.phoneMasked || account.displayName : '';
  }

  function aiLink(text, primary) {
    return el('a', { className: primary ? 'account-button' : 'account-button secondary', href: '/ai/', text });
  }

  // One card for the account's AI, drawn once both answers are known enough: which AI and model, whether it works, the
  // account it is connected for, and one way to /ai/ -- AI 연결 when nothing is connected, AI 연결 관리 when something is.
  function renderAi() {
    const ai = state.ai;
    if (!ai) return;
    const connection = ai.connections.find((row) => row.connected) || ai.connections[0] || null;
    if (!connection) {
      $('ai-rows').hidden = true;
      setStatus('ai-status', '연결한 AI가 아직 없어요. 한 번 연결하면 내 모든 프로젝트에서 같이 써요.', false);
      fill($('ai-actions'), [aiLink('AI 연결', true)]);
      $('ai-actions').hidden = false;
      return;
    }
    const rows = [['AI', providerName(connection.provider)]];
    if (connection.model) rows.push(['모델', connection.model]);
    rows.push(['상태', connection.connected ? '연결됨' : '다시 연결 필요']);
    const owner = accountName(state.account);
    if (owner) rows.push(['사이드킥 계정', owner]);
    fill($('ai-rows'), rows.map(([label, value]) => el('div', {}, [el('dt', { text: label }), el('dd', { text: value })])));
    $('ai-rows').hidden = false;
    setStatus('ai-status', connection.connected ? '' : '새 업무만 잠시 멈춰요. AI 연결 관리에서 같은 AI를 다시 연결해 주세요.', false);
    fill($('ai-actions'), [aiLink('AI 연결 관리', false)]);
    $('ai-actions').hidden = false;
  }

  function aiFailed(error) {
    setStatus('ai-status', error && error.network ? NETWORK_COPY : AI_FAILED_COPY, true);
    fill($('ai-next'), [retryButton('다시 불러오기', () => loadAi(state.seq))]);
    $('ai-next').hidden = false;
  }

  function signInAnotherWay() {
    auth.signOut({ silent: true });
    showGate('', false);
    auth.open();
  }

  // The AI is the same in every project of the account, so any project that can answer for it is asked: the one the
  // server marks recent when it is ready, else the first ready one.
  async function loadAi(seq) {
    state.ai = null;
    $('ai-rows').hidden = true;
    $('ai-actions').hidden = true;
    $('ai-next').hidden = true;
    setStatus('ai-status', 'AI 연결을 불러오고 있어요.', false);
    let workspaces = null;
    try {
      workspaces = sanitizeWorkspaces(await api('/workspaces/ai-engine-targets', { method: 'GET' }));
    } catch (error) {
      if (seq !== state.seq) return;
      if (refused(error)) return;
      aiFailed(error);
      return;
    }
    if (seq !== state.seq) return;
    if (!workspaces) { aiFailed(null); return; }
    if (!workspaces.length) {
      setStatus('ai-status', '아직 프로젝트가 없어요. 앱에서 같은 계정으로 로그인하고 하고 싶은 일을 고르면, 여기서 AI를 연결할 수 있어요.', false);
      fill($('ai-next'), [
        el('p', { text: '앱에서 이미 쓰고 있다면, 앱과 다른 방법으로 로그인했을 수 있어요. 앱에서 쓰는 방법으로 다시 로그인해 보세요.' }),
        el('div', { className: 'account-actions' }, [
          el('button', { className: 'account-button', type: 'button', text: '다른 방법으로 로그인', onClick: signInAnotherWay }),
          el('a', { className: 'account-button secondary', href: '/support/', text: '도움말 보기' })
        ])
      ]);
      $('ai-next').hidden = false;
      return;
    }
    const project = workspaces.find((workspace) => workspace.ready && workspace.recent) || workspaces.find((workspace) => workspace.ready);
    if (!project) {
      setStatus('ai-status', '프로젝트의 AI 직원 공간을 아직 준비하고 있어요. 앱에서 프로젝트를 한 번 열면 여기서 AI를 연결할 수 있어요.', false);
      fill($('ai-actions'), [aiLink('AI 연결', false)]);
      $('ai-actions').hidden = false;
      return;
    }
    const user = auth.user();
    const userId = user && SAFE_ID.test(String(user.id || '')) ? String(user.id) : '';
    if (!userId) { aiFailed(null); return; }
    let connections = null;
    try {
      const query = new URLSearchParams({ workspace_id: project.id, user_id: userId }).toString();
      connections = sanitizeAiConnections(await api(`/ai-engine-connections?${query}`, { method: 'GET' }));
    } catch (error) {
      if (seq !== state.seq) return;
      if (refused(error)) return;
      aiFailed(error);
      return;
    }
    if (seq !== state.seq) return;
    if (!connections) { aiFailed(null); return; }
    state.ai = { connections };
    setStatus('ai-status', '', false);
    renderAi();
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
    state.account = null;
    $('account-gate').hidden = true;
    $('account-loading').hidden = true;
    $('account-view').hidden = false;
    stopUsageRefresh();
    usage.period = 'current';
    usage.unavailable = false;
    markPeriod();
    startUsageRefresh();
    await Promise.all([loadAccount(seq), loadAi(seq), loadCredits(seq), loadTickets(seq), loadUsage(seq, false)]);
  }

  $('gate-signin').addEventListener('click', () => auth.open());
  $('signout-button').addEventListener('click', () => auth.signOut());
  $('auto-use-toggle').addEventListener('click', () => setAutoUse());
  $('usage-current').addEventListener('click', () => choosePeriod('current'));
  $('usage-previous').addEventListener('click', () => choosePeriod('previous'));
  if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => onVisibility());
  if (typeof window.addEventListener === 'function') window.addEventListener('focus', () => onVisibility());

  auth.init({
    onSignedIn: () => boot(),
    onSignedOut: () => showGate('로그아웃했어요.', false),
    onNotice: (message, isError) => {
      state.notice = { message, isError };
      if (!auth.token()) showGate(message, isError);
      else setStatus($('account-view').hidden ? 'account-loading' : 'profile-status', message, isError);
    }
  }).then(() => boot()).then(() => auth.requireSignIn());
})();
