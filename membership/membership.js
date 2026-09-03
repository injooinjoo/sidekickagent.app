(() => {
  'use strict';

  const API_ORIGIN = 'https://api.sidekickagent.app';
  // Google and Apple are Supabase logins in the app, and the backend accepts a
  // Supabase JWT as a bearer for any authenticated route. So the web uses the
  // same door rather than a second one: no SDK is loaded here — this page takes
  // card details next door and every extra third-party script on it is a
  // liability — just a redirect to Supabase's authorize endpoint and a token
  // read back out of the URL fragment.
  const SUPABASE_ORIGIN = 'https://wdjlokfsehsnvcipkods.supabase.co';
  const SUPABASE_PROVIDERS = { google: 'Google', apple: 'Apple' };
  const RETURN_URL = 'https://sidekickagent.app/membership/';
  const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
  // Plan identity only. What each combination costs is Korean won held in the
  // backend's own catalog and served by /membership/toss/config, so this page
  // has no price table to drift from — it renders what the server said or it
  // renders nothing. `sold` is here because the page must know before the
  // backend answers whether a plan may open a card window at all.
  //
  // D76 removed the permanent Free tier: these three paid plans are the whole
  // catalog. Free entry is the one cardless account trial, which the app starts
  // at the first real work execution — it is not a plan, so it is not here.
  const PLANS = {
    birdie: { label: 'Birdie', storage: '5GB', sold: true },
    eagle: { label: 'Eagle', storage: '25GB', sold: true },
    albatross: { label: 'Albatross', storage: '100GB', sold: true }
  };
  // The first paid plan, and the landing place for any plan value this page does
  // not sell — including the removed `free`, which older links still carry.
  const DEFAULT_PLAN = 'birdie';
  // The app offers six ways in and each mints its own account id, so the web
  // must offer the same door rather than guess which account a purchase belongs
  // to. Email and phone are both plain OTP through /auth/start, so they cost one
  // field each; the social providers redirect into the app and still need a web
  // callback before they can appear here.
  // Every way in the app offers, so a purchase can be attached to the account
  // the person already has instead of minting a second one on the desktop.
  const AUTH_METHODS = {
    email: {
      label: '이메일',
      inputType: 'email',
      autocomplete: 'email',
      placeholder: '',
      note: '구글이나 애플로 시작했다면 위 버튼을 쓰는 편이 확실해요. 같은 이메일을 넣어도 같은 계정으로 이어져요.',
      heading: '이메일로 로그인'
    },
    phone: {
      label: '휴대폰',
      inputType: 'tel',
      autocomplete: 'tel',
      placeholder: '010-1234-5678',
      note: '앱에서 휴대폰 번호로 시작했다면 같은 번호로 로그인해요. 잇기가 필요 없는 같은 계정이에요.',
      heading: '휴대폰으로 로그인'
    }
  };
  // The one thing that has to survive Toss's redirect. It is the same public
  // choice the person already made on this page — never an amount, an account,
  // an order or an entitlement, because none of those would be believed by the
  // backend anyway.
  const SELECTION_KEY = 'sidekick_toss_selection';

  const state = {
    method: 'email',
    plan: DEFAULT_PLAN,
    funding: 'included',
    storage: 'managed',
    challengeId: null,
    token: sessionStorage.getItem('sidekick_web_access_token') || '',
    user: null,
    billing: { sales_enabled: false, mode: 'unavailable', client_key: '', plans: {} },
    subscription: null,
    busy: false
  };

  const $ = (id) => document.getElementById(id);
  const planCards = [...document.querySelectorAll('.plan-card')];
  const methodTabs = [...document.querySelectorAll('[data-method]')];
  // 로그인 화면은 구매를 누른 순간에만 열린다. 그때 무엇을 사려던
  // 중이었는지 기억해 두었다가, 로그인이 끝나면 사람이 다시 누르지
  // 않아도 그 구매를 이어서 시작한다.
  let pendingPurchase = null;

  function won(value) { return `${Number(value).toLocaleString('ko-KR')}원`; }
  function priceOf(plan, funding) {
    const amount = state.billing.plans[`${plan}:${funding}`];
    return typeof amount === 'number' && amount > 0 ? amount : null;
  }


  function setPriceBlock(id, primary, secondary) {
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = primary;
    small.textContent = secondary;
    $(id).replaceChildren(strong, small);
  }


  function publicCheckoutReady() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return Boolean(state.billing.sales_enabled)
      && Boolean(state.billing.client_key)
      && (state.billing.mode === 'live' || (local && state.billing.mode === 'test'));
  }

  function renderSubscription() {
    const panel = $('subscription-panel');
    const subscription = state.subscription;
    const visible = Boolean(state.token && subscription && subscription.active);
    panel.hidden = !visible;
    if (!visible) return;
    const plan = PLANS[subscription.plan_id];
    const fundingLabel = subscription.funding_mode === 'included' ? 'Sidekick AI' : '내 AI 계정';
    $('subscription-line').textContent = `${plan ? plan.label : subscription.plan_id} · ${fundingLabel}`;
    const until = new Date(subscription.current_period_end * 1000).toLocaleDateString('ko-KR');
    $('subscription-renewal').textContent = subscription.cancel_at_period_end
      ? `해지했어요. ${until}까지 그대로 쓸 수 있고 이후에는 결제되지 않아요.`
      : `${until}에 다음 달 금액이 결제돼요.`;
    $('cancel-button').hidden = Boolean(subscription.cancel_at_period_end);
  }

  function render() {
    if (!PLANS[state.plan]) state.plan = DEFAULT_PLAN;
    const authenticated = Boolean(state.token);
    const subscribed = Boolean(state.subscription && state.subscription.active);

    planCards.forEach((card) => {
      const id = card.dataset.plan;
      const plan = PLANS[id];
      const amount = plan && plan.sold ? priceOf(id, state.funding) : null;
      const priceNode = card.querySelector(`[data-price="${id}"]`);
      const next = amount === null ? '—' : won(amount);
      if (priceNode.textContent !== next) {
        priceNode.textContent = next;
        // 금액이 바뀐 카드만 짧게 짚어 준다. 토글 한 번에 세 장이 모두
        // 뛰면 무엇이 달라졌는지가 오히려 안 보인다.
        priceNode.classList.remove('just-changed');
        void priceNode.offsetWidth;
        priceNode.classList.add('just-changed');
      }
      card.querySelector(`[data-sub="${id}"]`).textContent = !plan.sold
        ? '지금은 웹에서 구매할 수 없어요.'
        : amount === null ? '금액을 불러오고 있어요.'
        : state.funding === 'connected' ? '내 AI 계정 연결 시 · 매월 결제'
        : 'Sidekick AI 포함 · 매월 결제';

      const button = card.querySelector('[data-buy]');
      const ready = publicCheckoutReady() && plan.sold && amount !== null && !subscribed && !state.busy;
      // 로그인은 여기서 요구하지 않는다. 누르면 로그인 화면이 열리고,
      // 끝나면 이 구매가 이어진다.
      button.disabled = !ready;
      button.hidden = subscribed;
      button.textContent = state.busy && state.plan === id ? '연결 중…'
        : !plan.sold ? '지금은 구매할 수 없어요'
        : ready ? `${plan.label} 시작하기` : '결제 준비 중';
      card.classList.toggle('is-current', subscribed && state.plan === id);
    });

    $('account-pill').textContent = authenticated ? '로그인됨' : '로그인 전';
    $('account-line').hidden = authenticated;
    $('open-signin').hidden = authenticated;
    if (authenticated) $('auth-status').textContent = '';
    renderSubscription();

    if (!$('checkout-status').dataset.pinned) {
      const status = !publicCheckoutReady()
        ? '지금은 웹에서 구매할 수 없어요. 앱에서 계속 사용할 수 있어요.'
        : subscribed ? '이미 구독 중이에요.'
        : '카드는 토스페이먼츠 등록창에서 입력해요.';
      $('checkout-status').textContent = status;
    }
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(`${API_ORIGIN}${path}`, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch (_) { /* fail with bounded message below */ }
    if (!response.ok) {
      const error = new Error('request_failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function loadBillingConfig() {
    try {
      const config = await api('/membership/toss/config', { method: 'GET' });
      state.billing = {
        sales_enabled: config.sales_enabled === true,
        mode: config.mode === 'live' || config.mode === 'test' ? config.mode : 'unavailable',
        client_key: typeof config.client_key === 'string' ? config.client_key : '',
        // Korean won, server-owned. The page prints these and knows no others.
        plans: config.plans && typeof config.plans === 'object' ? config.plans : {}
      };
    } catch (_) {
      state.billing = { sales_enabled: false, mode: 'unavailable', client_key: '', plans: {} };
    }
    render();
  }

  async function loadSubscription() {
    if (!state.token) { state.subscription = null; return render(); }
    try {
      // Deliberately not gated on sales being open: someone who already bought
      // must be able to read and cancel even after new sales close.
      state.subscription = await api('/membership/toss/status', { method: 'GET' });
    } catch (_) {
      state.subscription = null;
    }
    render();
  }

  let sdkPromise = null;
  function loadTossSdk() {
    // Fetched only when a card window is actually about to open, so a visit
    // that never buys loads no third-party script at all.
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TOSS_SDK_URL;
      script.onload = () => (window.TossPayments ? resolve(window.TossPayments) : reject(new Error('sdk_unavailable')));
      script.onerror = () => reject(new Error('sdk_unavailable'));
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  function applyAuthMethod(method) {
    const chosen = AUTH_METHODS[method] ? method : 'email';
    state.method = chosen;
    state.challengeId = null;
    const config = AUTH_METHODS[chosen];
    const input = $('email');

    methodTabs.forEach((tab) => {
      const selected = tab.dataset.method === chosen;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });

    input.type = config.inputType;
    input.autocomplete = config.autocomplete;
    input.placeholder = config.placeholder;
    input.value = '';
    // Switching method abandons any code already sent, so the second form must
    // not stay open offering to verify a code for the other identity.
    $('code-form').hidden = true;
    $('code').value = '';
    $('auth-status').textContent = '';
    $('auth-status').classList.remove('is-error');
    input.focus();
  }

  function showSocialStatus(message, isError) {
    const node = $('social-status');
    node.hidden = !message;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }

  // Supabase's implicit flow returns the session in the fragment. Reading it
  // here and clearing it immediately keeps the token out of history and out of
  // anything that later logs a URL.
  async function adoptSupabaseRedirect() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) {
      if (hash.includes('error=')) {
        const failed = new URLSearchParams(hash.slice(1));
        showSocialStatus(failed.get('error_description') || '로그인이 완료되지 않았어요.', true);
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return false;
    }
    const params = new URLSearchParams(hash.slice(1));
    const token = String(params.get('access_token') || '').trim();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!token) return false;
    state.token = token;
    sessionStorage.setItem('sidekick_web_access_token', token);
    try {
      // The backend is the authority on who this is; the provider only proved
      // the person holds the account.
      const session = await api('/auth/session', { method: 'GET' });
      state.user = session.user || null;
      showSocialStatus('', false);
      return true;
    } catch (_) {
      state.token = '';
      sessionStorage.removeItem('sidekick_web_access_token');
      showSocialStatus('로그인은 됐지만 계정을 확인하지 못했어요. 다시 시도해 주세요.', true);
      return false;
    }
  }

  function startSupabaseLogin(provider) {
    if (!SUPABASE_PROVIDERS[provider]) return;
    showSocialStatus(`${SUPABASE_PROVIDERS[provider]}으로 이동하고 있어요.`, false);
    const url = new URL(`${SUPABASE_ORIGIN}/auth/v1/authorize`);
    url.searchParams.set('provider', provider);
    url.searchParams.set('redirect_to', RETURN_URL);
    window.location.assign(url.toString());
  }

  $('google-button').addEventListener('click', () => startSupabaseLogin('google'));
  $('apple-button').addEventListener('click', () => startSupabaseLogin('apple'));

  // ChatGPT is a device code, not a redirect: the backend starts it, the person
  // approves in a new tab, and this page polls until the approval lands.
  $('chatgpt-button').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    showSocialStatus('ChatGPT 승인 창을 여는 중이에요.', false);
    try {
      const started = await api('/auth/oauth/chatgpt/start', { method: 'POST', body: JSON.stringify({}) });
      const approvalUrl = started.verification_uri_complete || started.verification_uri || started.url;
      if (!approvalUrl) throw new Error('no approval url');
      window.open(approvalUrl, '_blank', 'noopener');
      showSocialStatus('새 창에서 승인하면 이 페이지가 이어서 로그인해요.', false);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const polled = await api('/auth/oauth/chatgpt/poll', {
          method: 'POST',
          body: JSON.stringify({ challenge_id: started.challenge_id || started.id })
        });
        if (polled.access_token) {
          state.token = polled.access_token;
          state.user = polled.user || null;
          sessionStorage.setItem('sidekick_web_access_token', state.token);
          showSocialStatus('', false);
          await afterSignIn();
          return;
        }
      }
      showSocialStatus('승인이 확인되지 않았어요. 다시 시도해 주세요.', true);
    } catch (_) {
      showSocialStatus('ChatGPT 로그인을 시작하지 못했어요.', true);
    } finally {
      state.busy = false;
      render();
    }
  });

  methodTabs.forEach((tab) => tab.addEventListener('click', () => applyAuthMethod(tab.dataset.method)));

  $('funding-toggle').addEventListener('click', () => {
    state.funding = state.funding === 'connected' ? 'included' : 'connected';
    const on = state.funding === 'connected';
    $('funding-toggle').classList.toggle('is-on', on);
    $('funding-toggle').setAttribute('aria-checked', String(on));
    $('mode-note').textContent = on
      ? '내 AI 계정을 쓰면 AI 사용료가 멤버십 금액에서 빠지고, 그만큼 AI 제공업체가 직접 청구해요.'
      : 'Sidekick AI가 포함돼요. 따로 준비할 것 없이 바로 시작해요.';
    render();
  });

  function openSignin(plan) {
    pendingPurchase = plan || null;
    const sheet = $('signin-sheet');
    sheet.hidden = false;
    // 두 프레임을 기다렸다가 클래스를 붙인다: hidden을 벗기자마자
    // 붙이면 브라우저가 시작 상태를 그리기 전이라 전환이 통째로 생략된다.
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
    document.body.style.overflow = 'hidden';
    const first = sheet.querySelector('.door');
    if (first) first.focus({ preventScroll: true });
  }

  function closeSignin() {
    const sheet = $('signin-sheet');
    sheet.classList.remove('is-open');
    document.body.style.overflow = '';
    const done = () => { sheet.hidden = true; sheet.removeEventListener('transitionend', done); };
    // 전환이 꺼져 있거나 잘려도 화면이 반쯤 덮인 채 남지는 않게 한다.
    sheet.addEventListener('transitionend', done);
    setTimeout(done, 400);
  }

  planCards.forEach((card) => {
    const button = card.querySelector('[data-buy]');
    if (!button) return;
    button.addEventListener('click', () => {
      state.plan = card.dataset.plan;
      render();
      if (!state.token) { openSignin(card.dataset.plan); return; }
      startCheckout();
    });
  });

  $('open-signin').addEventListener('click', () => openSignin(null));
  $('close-signin').addEventListener('click', closeSignin);
  $('signin-sheet').addEventListener('click', (event) => {
    if (event.target === $('signin-sheet')) closeSignin();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('signin-sheet').hidden) closeSignin();
  });
  $('otp-toggle').addEventListener('click', () => {
    const block = $('otp-block');
    block.hidden = !block.hidden;
    if (!block.hidden) $('email').focus();
  });

  // 로그인 직후 확인 화면을 한 장 더 끼우지 않는다: 고른 플랜 그대로
  // 토스 결제창이 바로 열린다.
  async function afterSignIn() {
    closeSignin();
    render();
    await loadSubscription();
    await completePendingAuthorization();
    const subscribed = Boolean(state.subscription && state.subscription.active);
    if (pendingPurchase && !subscribed) {
      state.plan = pendingPurchase;
      pendingPurchase = null;
      render();
      await startCheckout();
    }
  }

  $('email-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('auth-status').classList.remove('is-error');
    $('auth-status').textContent = '인증번호를 보내고 있어요.';
    try {
      const result = await api('/auth/start', {
        method: 'POST',
        body: JSON.stringify({ method: state.method, value: $('email').value.trim() })
      });
      state.challengeId = result.challenge_id;
      $('code-form').hidden = false;
      $('code').focus();
      $('auth-status').textContent = `${result.value_masked || `입력한 ${AUTH_METHODS[state.method].label}`}로 인증번호를 보냈어요.`;
    } catch (_) {
      $('auth-status').classList.add('is-error');
      $('auth-status').textContent = '인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    }
  });

  $('code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.challengeId) return;
    $('auth-status').classList.remove('is-error');
    $('auth-status').textContent = '인증번호를 확인하고 있어요.';
    try {
      const result = await api('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: state.challengeId, code: $('code').value.trim() })
      });
      state.token = result.access_token;
      state.user = result.user || null;
      sessionStorage.setItem('sidekick_web_access_token', state.token);
      await afterSignIn();
    } catch (_) {
      $('auth-status').classList.add('is-error');
      $('auth-status').textContent = '인증번호가 맞지 않거나 만료됐어요.';
    }
  });

  async function startCheckout() {
    const plan = PLANS[state.plan];
    if (!publicCheckoutReady() || !state.token || !plan.sold || state.busy) return;
    state.busy = true;
    render();
    try {
      // The backend derives the customerKey from the signed-in account. The
      // browser never chooses it, and it carries no amount or order: this
      // hand-off registers a card and cannot move money however it is edited.
      const intent = await api('/membership/toss/authorization', {
        method: 'POST',
        body: JSON.stringify({ plan_id: state.plan, funding_mode: state.funding, storage_mode: state.storage })
      });
      sessionStorage.setItem(SELECTION_KEY, JSON.stringify({
        plan_id: state.plan, funding_mode: state.funding, storage_mode: state.storage
      }));
      const TossPayments = await loadTossSdk();
      const payment = TossPayments(intent.client_key).payment({ customerKey: intent.customer_key });
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: intent.success_url,
        failUrl: intent.fail_url
      });
    } catch (_) {
      state.busy = false;
      sessionStorage.removeItem(SELECTION_KEY);
      say('카드 등록 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
      render();
    }
  }

  $('cancel-button').addEventListener('click', async () => {
    if (!state.token || state.busy) return;
    state.busy = true;
    render();
    try {
      state.subscription = await api('/membership/toss/cancel', { method: 'POST' });
      say('해지했어요. 이미 결제한 이번 달은 끝날 때까지 그대로 쓸 수 있어요.', false);
    } catch (_) {
      say('해지 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    }
    state.busy = false;
    render();
  });

  const query = new URLSearchParams(location.search);

  async function completePendingAuthorization() {
    // Coming back from Toss. The redirect proves nothing: it carries a one-time
    // authKey the backend still has to exchange, and the entitlement shown
    // afterwards is whatever the backend answered, never what this URL says.
    if (query.get('billing') !== 'authorized') return;
    const authKey = query.get('authKey');
    const customerKey = query.get('customerKey');
    let selection = null;
    try { selection = JSON.parse(sessionStorage.getItem(SELECTION_KEY) || 'null'); } catch (_) { selection = null; }
    if (!authKey || !customerKey || !selection) return;
    if (!state.token) return say('결제를 마치려면 같은 계정으로 다시 로그인해 주세요.', true);

    state.busy = true;
    say('카드 등록을 확인하고 첫 달을 결제하고 있어요.', false);
    render();
    try {
      const result = await api('/membership/toss/complete', {
        method: 'POST',
        body: JSON.stringify({
          auth_key: authKey,
          customer_key: customerKey,
          plan_id: selection.plan_id,
          funding_mode: selection.funding_mode,
          storage_mode: selection.storage_mode
        })
      });
      sessionStorage.removeItem(SELECTION_KEY);
      state.subscription = result;
      say(result.active ? '구독이 시작됐어요. 앱에서 바로 쓸 수 있어요.' : '결제를 확인하지 못했어요. 청구되지 않았어요.', !result.active);
    } catch (_) {
      say('결제를 확인하지 못했어요. 중복 청구되지 않으니 잠시 뒤 이 페이지를 다시 열어 주세요.', true);
    }
    state.busy = false;
    render();
  }

  // The app opens this page in the default browser with no session of its own
  // (D75), so the only thing it can hand over is the fact that it sent someone.
  if (query.get('from') === 'app') $('app-hint').hidden = false;
  if (query.get('billing') === 'failed') {
    sessionStorage.removeItem(SELECTION_KEY);
    say('카드 등록을 마치지 못했어요. 청구되지 않았어요.', true);
  }
  // The landing page's plan cards link here with the plan and AI-account choice
  // already made (/membership/?plan=eagle&funding=connected). Preselect exactly
  // that and nothing more: a value this page does not sell falls back to the
  // defaults — which is what a bookmarked `?plan=free` now does — and no
  // authorisation starts without the person clicking the button.
  const requestedPlan = query.get('plan');
  if (requestedPlan && Object.prototype.hasOwnProperty.call(PLANS, requestedPlan)) state.plan = requestedPlan;
  const requestedFunding = query.get('funding');
  if (requestedFunding === 'included' || requestedFunding === 'connected') state.funding = requestedFunding;

  render();
  // The Supabase redirect has to be adopted before anything asks the backend who
  // this is, or the first call goes out unauthenticated and the page renders the
  // signed-out state over a session that already exists.
  adoptSupabaseRedirect()
    .then(() => { render(); return loadBillingConfig(); })
    .then(loadSubscription)
    .then(completePendingAuthorization);
})();
