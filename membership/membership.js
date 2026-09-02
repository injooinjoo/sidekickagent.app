(() => {
  'use strict';

  const API_ORIGIN = 'https://api.sidekickagent.app';
  const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
  // Plan identity only. What each combination costs is Korean won held in the
  // backend's own catalog and served by /membership/toss/config, so this page
  // has no price table to drift from — it renders what the server said or it
  // renders nothing. `sold` is here because the page must know before the
  // backend answers that Free never opens a card window.
  const PLANS = {
    free: { label: 'Free', storage: '500MB', sold: false },
    birdie: { label: 'Birdie', storage: '5GB', sold: true },
    eagle: { label: 'Eagle', storage: '25GB', sold: true },
    albatross: { label: 'Albatross', storage: '100GB', sold: true }
  };
  // The app offers six ways in and each mints its own account id, so the web
  // must offer the same door rather than guess which account a purchase belongs
  // to. Email and phone are both plain OTP through /auth/start, so they cost one
  // field each; the social providers redirect into the app and still need a web
  // callback before they can appear here.
  const AUTH_METHODS = {
    email: {
      label: '이메일',
      inputType: 'email',
      autocomplete: 'email',
      placeholder: '',
      note: '구글·애플·카카오로 시작했다면 같은 이메일을 넣으면 같은 계정이에요. 네이버로만 시작한 계정은 아직 연결되지 않아요.',
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
    plan: 'birdie',
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
  const planButtons = [...document.querySelectorAll('[data-plan]')];
  const fundingButtons = [...document.querySelectorAll('[data-funding]')];
  const methodTabs = [...document.querySelectorAll('[data-method]')];

  function won(value) { return `${Number(value).toLocaleString('ko-KR')}원`; }
  function priceOf(plan, funding) {
    const amount = state.billing.plans[`${plan}:${funding}`];
    return typeof amount === 'number' && amount > 0 ? amount : null;
  }

  function setSelected(buttons, attribute, value) {
    buttons.forEach((button) => {
      const selected = button.dataset[attribute] === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
  }

  function setPriceBlock(id, primary, secondary) {
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = primary;
    small.textContent = secondary;
    $(id).replaceChildren(strong, small);
  }

  function setOptionPrice(id, plan, funding, unavailableNote) {
    if (!PLANS[plan].sold) return setPriceBlock(id, '—', unavailableNote || 'Free 포함');
    const amount = priceOf(plan, funding);
    if (amount === null) return setPriceBlock(id, '—', '금액 확인 중');
    setPriceBlock(id, won(amount), '/ 월');
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
    if (state.plan === 'free' && state.funding === 'connected') state.funding = 'included';
    const plan = PLANS[state.plan];
    const connectedButton = document.querySelector('[data-funding="connected"]');
    connectedButton.disabled = state.plan === 'free';
    connectedButton.classList.toggle('is-disabled', state.plan === 'free');
    connectedButton.setAttribute('aria-disabled', String(state.plan === 'free'));

    setSelected(planButtons, 'plan', state.plan);
    setSelected(fundingButtons, 'funding', state.funding);
    setOptionPrice('included-price', state.plan, 'included', null);
    setOptionPrice('connected-price', state.plan, 'connected', state.plan === 'free' ? 'Birdie 이상에서 사용' : null);

    const fundingLabel = state.funding === 'included' ? 'Sidekick AI' : '내 AI 계정';
    $('summary-line').textContent = `${plan.label} · ${fundingLabel}`;
    $('summary-storage').textContent = plan.storage;
    $('summary-ai-fee').textContent = state.funding === 'included' ? '멤버십에 포함' : '제공업체에서 별도 청구';
    const amount = plan.sold ? priceOf(state.plan, state.funding) : null;
    $('price-label').textContent = '매월';
    $('summary-price').textContent = amount === null ? '—' : won(amount);
    $('after-price').textContent = plan.sold
      ? (amount === null ? '금액을 불러오고 있어요.' : '매월 같은 금액이 자동으로 결제돼요.')
      : 'Free는 결제 없이 앱에서 시작해요.';

    const authenticated = Boolean(state.token);
    $('auth-panel').classList.toggle('is-authenticated', authenticated);
    $('account-pill').textContent = authenticated ? '로그인됨' : '로그인 전';
    if (authenticated) $('auth-status').textContent = 'Sidekick 계정으로 로그인했어요.';
    renderSubscription();

    const subscribed = Boolean(state.subscription && state.subscription.active);
    const checkoutButton = $('checkout-button');
    const ready = publicCheckoutReady() && authenticated && plan.sold && amount !== null
      && !subscribed && !state.busy;
    checkoutButton.disabled = !ready;
    checkoutButton.hidden = subscribed;
    checkoutButton.textContent = state.busy
      ? '연결 중…'
      : !plan.sold ? 'Free는 결제 없이 시작해요'
      : ready ? '카드 등록하고 구독 시작' : '결제 준비 중';

    if (!$('checkout-status').dataset.pinned) {
      let status = '안전한 결제 연결을 확인하고 있어요.';
      if (!publicCheckoutReady()) status = '웹 결제는 아직 열리지 않았어요. 지금은 구성만 미리 볼 수 있어요.';
      if (publicCheckoutReady() && !authenticated) status = '먼저 Sidekick 계정으로 로그인해 주세요.';
      if (subscribed) status = '이미 구독 중이에요. 아래에서 확인하고 해지할 수 있어요.';
      if (ready) status = '카드 정보는 Sidekick이 아닌 토스페이먼츠 카드 등록창에 입력해요.';
      $('checkout-status').textContent = status;
    }
  }

  function say(message, isError) {
    const node = $('checkout-status');
    node.dataset.pinned = '1';
    node.classList.toggle('is-error', Boolean(isError));
    node.textContent = message;
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

    $('auth-panel').querySelector('strong').textContent = config.heading;
    $('value-label').textContent = config.label;
    $('auth-note').textContent = config.note;
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

  methodTabs.forEach((tab) => tab.addEventListener('click', () => applyAuthMethod(tab.dataset.method)));

  planButtons.forEach((button) => button.addEventListener('click', () => {
    state.plan = button.dataset.plan;
    render();
  }));
  fundingButtons.forEach((button) => button.addEventListener('click', () => {
    if (!button.disabled) state.funding = button.dataset.funding;
    render();
  }));

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
      render();
      // Logging in is not buying. All it does is let the page ask the backend
      // what this account already has.
      await loadSubscription();
      await completePendingAuthorization();
    } catch (_) {
      $('auth-status').classList.add('is-error');
      $('auth-status').textContent = '인증번호가 맞지 않거나 만료됐어요.';
    }
  });

  $('checkout-button').addEventListener('click', async () => {
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
  });

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
  // defaults, Free still cannot take a connected account (render() keeps that
  // rule), and no authorisation starts without the person clicking the button.
  const requestedPlan = query.get('plan');
  if (requestedPlan && Object.prototype.hasOwnProperty.call(PLANS, requestedPlan)) state.plan = requestedPlan;
  const requestedFunding = query.get('funding');
  if (requestedFunding === 'included' || requestedFunding === 'connected') state.funding = requestedFunding;

  render();
  loadBillingConfig().then(loadSubscription).then(completePendingAuthorization);
})();
