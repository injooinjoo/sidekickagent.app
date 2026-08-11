(() => {
  'use strict';

  const API_ORIGIN = 'https://api.sidekickagent.app';
  // [첫 3개월, 이후] USD. Must equal PLAN_CATALOG in web_membership_billing.py,
  // which is what Stripe actually charges; apps/site/test_domain_contract.py
  // fails if the two drift. Store prices for the app live elsewhere and are
  // higher, because the store takes its cut out of them.
  const PLANS = {
    free: { label: 'Free', storage: '500MB', included: [0, 0], connected: null },
    birdie: { label: 'Birdie', storage: '5GB', included: [14, 19], connected: [9, 13] },
    eagle: { label: 'Eagle', storage: '25GB', included: [36, 49], connected: [21, 29] },
    albatross: { label: 'Albatross', storage: '100GB', included: [74, 99], connected: [36, 49] }
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

  const state = {
    method: 'email',
    plan: 'birdie',
    funding: 'included',
    storage: 'managed',
    challengeId: null,
    token: sessionStorage.getItem('sidekick_web_access_token') || '',
    user: null,
    billing: { sales_enabled: false, mode: 'unavailable' },
    busy: false
  };

  const $ = (id) => document.getElementById(id);
  const planButtons = [...document.querySelectorAll('[data-plan]')];
  const fundingButtons = [...document.querySelectorAll('[data-funding]')];
  const methodTabs = [...document.querySelectorAll('[data-method]')];

  function money(value) { return `$${value}`; }

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

  // One renderer for both AI-account options. The intro offer used to be
  // connected-only, so `included` had a hardcoded "매월 동일" line; that would
  // now hide the launch discount on exactly the option most people pick.
  function setOptionPrice(id, pair, unavailableNote) {
    if (!pair) return setPriceBlock(id, '—', unavailableNote);
    const [first, after] = pair;
    if (first === after) return setPriceBlock(id, money(after), unavailableNote || '/ 월 · 매월 동일');
    setPriceBlock(id, `첫 3개월 ${money(first)}`, `이후 ${money(after)} / 월`);
  }

  function publicCheckoutReady() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return Boolean(state.billing.sales_enabled) && (state.billing.mode === 'live' || (local && state.billing.mode === 'test'));
  }

  function render() {
    const plan = PLANS[state.plan];
    if (state.plan === 'free' && state.funding === 'connected') state.funding = 'included';
    const prices = plan[state.funding];
    const connectedButton = document.querySelector('[data-funding="connected"]');
    connectedButton.disabled = state.plan === 'free';
    connectedButton.classList.toggle('is-disabled', state.plan === 'free');
    connectedButton.setAttribute('aria-disabled', String(state.plan === 'free'));

    setSelected(planButtons, 'plan', state.plan);
    setSelected(fundingButtons, 'funding', state.funding);
    setOptionPrice('included-price', plan.included, state.plan === 'free' ? 'Free 포함' : null);
    setOptionPrice('connected-price', plan.connected, 'Birdie 이상에서 사용');

    const fundingLabel = state.funding === 'included' ? 'Sidekick AI' : '내 AI 계정';
    $('summary-line').textContent = `${plan.label} · ${fundingLabel} · Sidekick에 보관`;
    $('summary-storage').textContent = plan.storage;
    $('summary-ai-fee').textContent = state.funding === 'included' ? '멤버십에 포함' : '제공업체에서 별도 청구';
    $('price-label').textContent = prices[0] === prices[1] ? '매월' : '첫 3개월';
    $('summary-price').textContent = money(prices[0]);
    $('after-price').textContent = prices[0] === prices[1] ? '이후에도 같은 금액이에요.' : `4개월 이후 ${money(prices[1])} / 월`;

    const authenticated = Boolean(state.token);
    $('auth-panel').classList.toggle('is-authenticated', authenticated);
    $('account-pill').textContent = authenticated ? '로그인됨' : '로그인 전';
    if (authenticated) $('auth-status').textContent = 'Sidekick 계정으로 로그인했어요.';

    const checkoutButton = $('checkout-button');
    const ready = publicCheckoutReady() && authenticated && state.plan !== 'free' && !state.busy;
    checkoutButton.disabled = !ready;
    checkoutButton.textContent = state.busy ? '연결 중…' : state.plan === 'free' ? 'Free는 결제 없이 시작해요' : ready ? '안전한 결제로 계속' : '결제 준비 중';
    $('portal-button').hidden = !authenticated || !publicCheckoutReady();

    let status = '안전한 결제 연결을 확인하고 있어요.';
    if (state.billing.mode === 'test' && !publicCheckoutReady()) status = '실결제 오픈 전 테스트 검증 중이에요.';
    if (state.billing.mode === 'live' && state.billing.sales_enabled && !authenticated) status = '먼저 Sidekick 계정으로 로그인해 주세요.';
    if (ready) status = '카드 정보는 Sidekick이 아닌 Stripe 결제 화면에서 입력해요.';
    $('checkout-status').textContent = status;
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
      const config = await api('/membership/stripe/config', { method: 'GET' });
      state.billing = {
        sales_enabled: config.sales_enabled === true,
        mode: config.mode === 'live' || config.mode === 'test' ? config.mode : 'unavailable'
      };
    } catch (_) {
      state.billing = { sales_enabled: false, mode: 'unavailable' };
    }
    render();
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
    } catch (_) {
      $('auth-status').classList.add('is-error');
      $('auth-status').textContent = '인증번호가 맞지 않거나 만료됐어요.';
    }
  });

  $('checkout-button').addEventListener('click', async () => {
    if (!publicCheckoutReady() || !state.token || state.plan === 'free' || state.busy) return;
    state.busy = true;
    render();
    try {
      const result = await api('/membership/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan_id: state.plan, funding_mode: state.funding, storage_mode: state.storage })
      });
      if (typeof result.checkout_url !== 'string' || !result.checkout_url.startsWith('https://checkout.stripe.com/')) throw new Error('invalid_checkout_url');
      window.location.assign(result.checkout_url);
    } catch (_) {
      state.busy = false;
      $('checkout-status').classList.add('is-error');
      $('checkout-status').textContent = '결제 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      render();
    }
  });

  $('portal-button').addEventListener('click', async () => {
    if (!publicCheckoutReady() || !state.token || state.busy) return;
    state.busy = true;
    render();
    try {
      const result = await api('/membership/stripe/portal', { method: 'POST', body: '{}' });
      if (typeof result.portal_url !== 'string' || !result.portal_url.startsWith('https://billing.stripe.com/')) throw new Error('invalid_portal_url');
      window.location.assign(result.portal_url);
    } catch (_) {
      state.busy = false;
      $('checkout-status').classList.add('is-error');
      $('checkout-status').textContent = '구독 관리 화면을 열지 못했어요.';
      render();
    }
  });

  const query = new URLSearchParams(location.search);
  if (query.get('checkout') === 'success') $('checkout-status').textContent = '결제를 확인하고 있어요. 구독 권한은 안전한 확인이 끝난 뒤 반영돼요.';
  if (query.get('checkout') === 'cancelled') $('checkout-status').textContent = '결제를 취소했어요. 청구되지 않았어요.';

  render();
  loadBillingConfig();
})();
