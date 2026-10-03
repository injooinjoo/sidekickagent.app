(() => {
  'use strict';

  // Sign-in lives in /auth.js, shared with every page: the same doors the app
  // offers (Google, Apple, ChatGPT, email and phone code), the same 30-day
  // session this browser keeps, and the one `api()` every call here goes through.
  // No auth SDK is loaded — this page takes card details next door and every
  // extra third-party script on it is a liability.
  const auth = window.SidekickAuth;
  const { api } = auth;
  const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
  // Plan identity only. What each combination costs is Korean won held in the
  // backend's own catalog and served by /membership/toss/config, so this page
  // has no price table to drift from — it renders what the server said or it
  // renders nothing. `sold` is here because the page must know before the
  // backend answers whether a plan may open a card window at all.
  //
  // D76 removed the permanent Free tier: these three paid plans are the whole
  // catalog. Free entry is the one cardless account trial, which the backend
  // opens at signup — it is not a plan, so it is not here.
  const PLANS = {
    birdie: { label: 'Birdie', storage: '5GB', sold: true },
    eagle: { label: 'Eagle', storage: '25GB', sold: true },
    albatross: { label: 'Albatross', storage: '100GB', sold: true }
  };
  // The first paid plan, and the landing place for any plan value this page does
  // not sell — including the removed `free`, which older links still carry.
  const DEFAULT_PLAN = 'birdie';
  // The one thing that has to survive Toss's redirect. It is the same public
  // choice the person already made on this page — never an amount, an account,
  // an order or an entitlement, because none of those would be believed by the
  // backend anyway.
  const SELECTION_KEY = 'sidekick_toss_selection';

  const state = {
    plan: DEFAULT_PLAN,
    // Sidekick AI 포함이 기본이다 (2026-10-02 소유자 방향: 설정보다 결과가 먼저).
    // 내 AI 계정 연결은 더 싸지만 계정을 따로 준비해야 하므로, 바꾸고 싶은 사람이
    // 스위치로 고르는 두 번째 선택지로 둔다. 링크의 ?funding= 은 그대로 따른다.
    funding: 'included',
    storage: 'managed',
    // A copy of the shared sign-in's bearer, refreshed whenever it changes, so
    // every "is this person signed in" below reads one field.
    token: auth.token(),
    user: null,
    billing: { sales_enabled: false, mode: 'unavailable', client_key: '', plans: {}, review_checkout_allowed: false },
    subscription: null,
    // /membership/status 의 답. 이 계정이 웹에서 사도 되는지(can_purchase_on_web)와
    // 어디서 구독 중인지(subscription_state)는 서버만 안다. 아직 못 읽었으면 null 이다.
    membership: null,
    membershipChecked: false,
    // 플랜 변경 견적. 서버가 방금 낸 숫자만 들고 있고, 선택이 바뀌면 버린다 —
    // 어제 견적으로 오늘 결제 버튼을 만들 수는 없다.
    quote: null,
    busy: false
  };

  const $ = (id) => document.getElementById(id);
  const planCards = [...document.querySelectorAll('.plan-card')];
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


  // 판매는 열렸는데 이 주소에서는 못 파는 상태. "준비 중"과 구별해야
  // 하는 이유는, 사람이 기다리면 열리는 줄 알기 때문이다.
  function testModeHere() {
    return Boolean(state.billing.sales_enabled)
      && state.billing.mode === 'test'
      && !publicCheckoutReady();
  }

  function publicCheckoutReady() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return Boolean(state.billing.sales_enabled)
      && Boolean(state.billing.client_key)
      && (state.billing.mode === 'live'
        || (state.billing.mode === 'test' && (local || state.billing.review_checkout_allowed === true)));
  }

  // 한 계정의 구독은 한 곳에서만 산다. 로그인한 사람에게 웹 결제(새 구독·다시 시작하기)를
  // 열어도 되는지는 서버의 /membership/status 가 정하고, 이 페이지는 그 답을 따른다.
  // 답을 아직 못 받았거나 받지 못했으면 열지 않는다 — 결제는 서버가 한 번 더 막지만,
  // 막힐 결제 창을 여는 것부터 하지 않는다. 아직 로그인하지 않은 방문자에게는 가격과 버튼을 그대로 보여 준다.
  const WEB_PURCHASE_BLOCK_COPY = {
    pending: '구독 상태를 확인하고 있어요.',
    unconfirmed: '구독 상태를 확인하지 못해 결제를 열지 않았어요. 잠시 뒤 이 페이지를 다시 열어 주세요.',
    apple: '이미 App Store에서 구독 중이에요. 한 계정의 구독은 한 곳에서만 유지돼서 웹에서는 결제할 수 없어요. 구독 관리는 App Store에서 해요.',
    elsewhere: '이미 다른 곳에서 구독 중이라 웹에서는 결제할 수 없어요. 구독한 곳에서 관리해 주세요.'
  };

  function webPurchaseBlock() {
    if (!state.token) return null;
    if (!state.membershipChecked) return 'pending';
    const membership = state.membership;
    if (!membership) return 'unconfirmed';
    if (membership.subscription_state === 'APPLE_ACTIVE') return 'apple';
    if (membership.can_purchase_on_web !== true) return 'elsewhere';
    return null;
  }

  // 서버가 409 subscription_exists 로 결제를 거절했을 때의 문구. 일반 오류로 뭉뚱그리지 않는다.
  function subscriptionExistsCopy() {
    const current = state.membership && state.membership.subscription_state;
    if (typeof current === 'string' && current.indexOf('WEB_') === 0) {
      return '이미 웹에서 구독 중이에요. 새로 결제하지 않았고 청구되지 않았어요.';
    }
    return '이미 App Store에서 구독 중이에요. 한 계정의 구독은 한 곳에서만 유지돼서 웹에서는 결제하지 않았고 청구되지 않았어요. 구독 관리는 App Store에서 해요.';
  }

  function isSubscriptionExists(error) {
    return Boolean(error) && error.status === 409 && error.detail === 'subscription_exists';
  }

  // 서버가 거절한 이유를 사람이 할 다음 일로 바꾼다. 상태 숫자나 서버 문구는 화면에
  // 나오지 않는다. "청구되지 않았어요"는 서버가 결제 전에 멈췄다고 알 수 있을 때만
  // 붙인다 — 첫 달 결제(complete)처럼 결과를 모르는 경우(chargeUnknown)에는 쓰지 않는다.
  function failureCopy(error, fallback, options) {
    const chargeUnknown = Boolean(options && options.chargeUnknown);
    if (!error) return fallback;
    if (isSubscriptionExists(error)) return subscriptionExistsCopy();
    if (error.status === 401) return '로그인이 만료됐어요. 다시 로그인한 뒤 이어서 해 주세요.';
    if (error.status === 423) return auth.DELETION_PENDING_COPY;
    const code = String(error.code || error.detail || '');
    if (code === 'provider_rejected') return '카드사에서 결제를 승인하지 않았어요. 청구되지 않았어요. 다른 카드로 다시 시도해 주세요.';
    if (code === 'billing_key_missing') return '등록된 카드를 찾지 못했어요. 청구되지 않았어요. 카드를 다시 등록해 주세요.';
    if (code === 'test_checkout_not_allowed') return '지금은 테스트 모드라 이 주소에서는 결제할 수 없어요. 청구되지 않았어요.';
    if (code === 'sales_disabled' || code === 'selection_not_saleable' || code === 'schema_not_ready') return '지금은 웹에서 구매할 수 없어요. 청구되지 않았어요.';
    if (code === 'plan_unchanged') return '이미 이 플랜을 쓰고 있어요. 바뀐 것은 없어요.';
    if (code === 'subscription_inactive') return '이용 중인 웹 구독이 없어요. 새로 구독해 주세요.';
    if (error.network && !chargeUnknown) return '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    return fallback;
  }

  // 쓰기 요청에서 로그인이 끝난 것을 알았으면 이 브라우저의 로그인도 정리한다.
  // 그대로 두면 다음 버튼도 같은 이유로 실패한다.
  function endSessionIfRefused(error) {
    if (error && (error.status === 401 || error.status === 423)) auth.signOut({ server: false, silent: true });
  }

  function renderSubscription() {
    const panel = $('subscription-panel');
    const subscription = state.subscription;
    // 해지한 구독도 결제 기간이 남았으면 보여 준다 — 다시 시작하기가 여기 있다.
    const visible = Boolean(state.token && subscription && (subscription.active || subscription.resumable));
    panel.hidden = !visible;
    if (!visible) return;
    const plan = PLANS[subscription.plan_id];
    const fundingLabel = subscription.funding_mode === 'included' ? 'Sidekick AI' : '내 AI 계정';
    $('subscription-line').textContent = `${plan ? plan.label : subscription.plan_id} · ${fundingLabel}`;
    const until = new Date(subscription.current_period_end * 1000).toLocaleDateString('ko-KR');
    // 다른 곳(App Store)의 구독이 살아 있거나 서버가 웹 결제를 허락하지 않으면 다시 시작하기를
    // 내놓지 않는다. 해지는 언제나 할 수 있어야 하므로 해지 버튼은 이 조건과 무관하다.
    const resumeBlocked = Boolean(webPurchaseBlock());
    $('subscription-renewal').textContent = subscription.cancel_at_period_end
      ? (resumeBlocked
        ? '해지해서 이용이 중단됐어요. 지금은 웹에서 다시 시작할 수 없어요.'
        : `해지해서 이용이 중단됐어요. ${until} 전까지는 추가 결제 없이 다시 시작할 수 있어요.`)
      : `${until}에 다음 달 금액이 결제돼요.`;
    $('cancel-button').hidden = Boolean(subscription.cancel_at_period_end);
    $('resume-button').hidden = !subscription.resumable || resumeBlocked;
  }

  function render() {
    if (!PLANS[state.plan]) state.plan = DEFAULT_PLAN;
    const authenticated = Boolean(state.token);
    const subscribed = Boolean(state.subscription && state.subscription.active);
    const purchaseBlock = webPurchaseBlock();

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
      const current = subscribed && state.subscription.plan_id === id;
      // 구독 중이면 다른 플랜 카드의 버튼은 "바꾸기" 다. 견적을 받은 카드만
      // 결제 문구가 되고, 해지를 예약한 구독은 바꿀 수 없다 — 다음 달에 끝나는
      // 구독 위에 새 금액을 올리는 것은 사람이 원한 적 없는 일이다.
      const changeable = subscribed && !current && publicCheckoutReady() && plan.sold && amount !== null
        && !state.busy && !state.subscription.cancel_at_period_end;
      const quoted = state.quote && state.quote.to_plan_id === id && state.quote.funding_mode === state.funding
        ? state.quote : null;
      // 로그인은 여기서 요구하지 않는다. 누르면 로그인 화면이 열리고,
      // 끝나면 이 구매가 이어진다.
      // 서버가 웹 결제를 허락하지 않은 계정에는 결제·바꾸기 버튼을 모두 닫는다.
      button.disabled = Boolean(purchaseBlock) || !(ready || (changeable && (!quoted || quoted.applies_now)));
      button.hidden = current;
      button.textContent = state.busy && state.plan === id ? '연결 중…'
        : !plan.sold ? '지금은 구매할 수 없어요'
        : purchaseBlock === 'pending' && (ready || changeable) ? '구독 상태를 확인하는 중이에요'
        : purchaseBlock && (ready || changeable) ? '웹에서는 결제할 수 없어요'
        : ready ? `${plan.label} 시작하기`
        : changeable && quoted && quoted.applies_now ? (quoted.charge_krw > 0 ? `오늘 ${won(quoted.charge_krw)} 결제하고 바꾸기` : '추가 결제 없이 바꾸기')
        : changeable && quoted ? '지금은 바꿀 수 없어요'
        : changeable ? `${plan.label}로 바꾸기`
        : subscribed ? '지금은 바꿀 수 없어요'
        : testModeHere() ? '테스트 모드예요'
        : '금액을 불러오는 중이에요';
      card.classList.toggle('is-current', current);
    });

    // 토글의 겉모습은 여기서만 정해진다. 마크업에 켜짐을 적어 두고
    // 상태를 따로 두면, 스위치는 켜졌는데 가격은 꺼진 값인 화면이 나온다.
    const connected = state.funding === 'connected';
    const toggle = $('funding-toggle');
    toggle.classList.toggle('is-on', connected);
    toggle.setAttribute('aria-checked', String(connected));
    $('mode-note').textContent = connected
      ? '내 AI 계정을 연결하면 AI 사용료는 그 계정에서 나가고, 멤버십은 그만큼 저렴해져요.'
      : 'AI 사용료가 포함돼 있어요. 따로 준비할 것 없이 바로 시작해요.';

    // The header's account slot is /auth.js's: it reads the same bearer.
    $('account-line').hidden = authenticated;
    $('open-signin').hidden = authenticated;
    if (authenticated) $('auth-status').textContent = '';
    renderSubscription();

    if (!$('checkout-status').dataset.pinned) {
      const status = testModeHere()
        ? '지금은 테스트 모드라 이 주소에서는 결제할 수 없어요. 준비가 끝나면 바로 열려요.'
        : !publicCheckoutReady()
        ? '지금은 웹에서 구매할 수 없어요. 앱에서 계속 사용할 수 있어요.'
        : purchaseBlock ? WEB_PURCHASE_BLOCK_COPY[purchaseBlock]
        : subscribed ? '이미 구독 중이에요.'
        : '카드는 토스페이먼츠 등록창에서 입력해요.';
      $('checkout-status').textContent = status;
    }
  }

  // 결제 상태 한 줄. 여기서 적은 글자는 render() 가 덮어쓰지 않는다(pinned) —
  // "구독이 시작됐어요" 가 다음 렌더에서 "카드는 등록창에서 입력해요" 로 되돌아가면
  // 사람은 결제가 됐는지 알 수 없다.
  function say(message, isError) {
    const node = $('checkout-status');
    node.dataset.pinned = '1';
    node.classList.toggle('is-error', Boolean(isError));
    node.textContent = message;
  }

  // The server stopped accepting this bearer mid-visit (expired, revoked, signed
  // out elsewhere). The page drops to the signed-out view it would have drawn
  // for a new visitor: public prices, a 로그인 slot, no stale 내 계정.
  function signedOutByServer() {
    auth.signOut({ server: false, silent: true });
    state.token = '';
    state.user = null;
    state.subscription = null;
    state.membership = null;
    state.membershipChecked = false;
    state.quote = null;
    render();
  }

  // Signed out from the header menu: the same view, and the prices a visitor sees.
  async function afterSignOut() {
    pendingPurchase = null;
    signedOutByServer();
    const status = $('checkout-status');
    delete status.dataset.pinned;
    status.classList.remove('is-error');
    await loadBillingConfig();
  }

  async function loadBillingConfig() {
    try {
      const path = state.token ? '/membership/toss/config/authenticated' : '/membership/toss/config';
      const config = await api(path, { method: 'GET' });
      state.billing = {
        sales_enabled: config.sales_enabled === true,
        mode: config.mode === 'live' || config.mode === 'test' ? config.mode : 'unavailable',
        client_key: typeof config.client_key === 'string' ? config.client_key : '',
        // Korean won, server-owned. The page prints these and knows no others.
        plans: config.plans && typeof config.plans === 'object' ? config.plans : {},
        review_checkout_allowed: config.review_checkout_allowed === true
      };
    } catch (error) {
      if (error && error.status === 401 && state.token) {
        signedOutByServer();
        return loadBillingConfig();
      }
      state.billing = { sales_enabled: false, mode: 'unavailable', client_key: '', plans: {}, review_checkout_allowed: false };
    }
    render();
  }

  async function loadSubscription() {
    if (!state.token) {
      state.subscription = null;
      state.membership = null;
      state.membershipChecked = false;
      return render();
    }
    // Deliberately not gated on sales being open: someone who already bought
    // must be able to read and cancel even after new sales close. The account's
    // purchase permission is read alongside, because the Toss status only knows
    // about the web subscription and not one held on the App Store.
    let refused = false;
    const readOrNull = (path) => api(path, { method: 'GET' }).catch((error) => {
      if (error && error.status === 401) refused = true;
      return null;
    });
    const [subscription, membership] = await Promise.all([
      readOrNull('/membership/toss/status'),
      readOrNull('/membership/status')
    ]);
    if (refused) {
      signedOutByServer();
      return loadBillingConfig();
    }
    state.subscription = subscription;
    state.membership = membership && typeof membership === 'object' ? membership : null;
    state.membershipChecked = true;
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

  $('funding-toggle').addEventListener('click', () => {
    state.funding = state.funding === 'connected' ? 'included' : 'connected';
    state.quote = null;
    render();
  });

  // 로그인 화면은 /auth.js 가 연다. 여기서는 무엇을 사려던 중이었는지만 기억한다.
  function openSignin(plan) {
    pendingPurchase = plan || null;
    auth.open();
  }

  function closeSignin() {
    auth.close();
  }

  planCards.forEach((card) => {
    const button = card.querySelector('[data-buy]');
    if (!button) return;
    button.addEventListener('click', () => {
      state.plan = card.dataset.plan;
      if (state.plan !== (state.quote && state.quote.to_plan_id)) state.quote = null;
      render();
      if (!state.token) { openSignin(card.dataset.plan); return; }
      if (state.subscription && state.subscription.active) { changePlan(card.dataset.plan); return; }
      startCheckout();
    });
  });

  $('open-signin').addEventListener('click', () => openSignin(null));

  // 로그인 직후 확인 화면을 한 장 더 끼우지 않는다: 고른 플랜 그대로
  // 토스 결제창이 바로 열린다. 다른 탭에서 로그인한 것이면 이 탭은 화면만
  // 따라가고, 여기서 누르다 만 구매를 대신 시작하지 않는다.
  async function afterSignIn(user, context) {
    if (context && context.otherTab) pendingPurchase = null;
    state.token = auth.token();
    state.user = auth.user();
    closeSignin();
    render();
    await loadBillingConfig();
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

  async function startCheckout() {
    const plan = PLANS[state.plan];
    if (!publicCheckoutReady() || !state.token || !plan.sold || state.busy) return;
    const purchaseBlock = webPurchaseBlock();
    if (purchaseBlock) { say(WEB_PURCHASE_BLOCK_COPY[purchaseBlock], true); render(); return; }
    state.busy = true;
    render();
    try {
      // The backend derives the customerKey from the signed-in account. The
      window.SidekickWebAnalytics?.track('subscription_started', { plan: state.plan, payment_provider: 'toss', billing_period: 'monthly' });
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
    } catch (error) {
      state.busy = false;
      sessionStorage.removeItem(SELECTION_KEY);
      say(failureCopy(error, '카드 등록 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.'), true);
      endSessionIfRefused(error);
      render();
    }
  }

  // 플랜 변경은 두 번 누른다. 첫 번째는 견적(/plan/quote, 아무것도 움직이지 않음),
  // 두 번째는 그 견적 그대로 변경(/plan). 화면의 금액과 청구되는 금액이 같은
  // 함수에서 나오므로, 사람이 본 숫자가 곧 결제되는 숫자다.
  async function changePlan(planId) {
    const plan = PLANS[planId];
    const subscription = state.subscription;
    if (!publicCheckoutReady() || !state.token || !plan || !plan.sold || state.busy) return;
    if (!subscription || !subscription.active || subscription.plan_id === planId) return;
    if (webPurchaseBlock()) { say(WEB_PURCHASE_BLOCK_COPY[webPurchaseBlock()], true); return; }
    const body = JSON.stringify({ plan_id: planId, funding_mode: state.funding });
    const quoted = state.quote && state.quote.to_plan_id === planId && state.quote.funding_mode === state.funding
      ? state.quote : null;
    state.busy = true;
    render();
    try {
      if (!quoted) {
        const quote = await api('/membership/toss/plan/quote', { method: 'POST', body });
        state.quote = { ...quote, funding_mode: state.funding };
        if (quote.applies_now) {
          say(quote.charge_krw > 0
            ? `${plan.label}로 바꾸면 남은 ${quote.remaining_days}일만큼 ${won(quote.charge_krw)}을 오늘 결제하고 바로 바뀌어요. 지금 플랜의 남은 값 ${won(quote.unused_krw)}은 뺐어요. 버튼을 한 번 더 누르면 결제돼요.`
            : `${plan.label}로 바꾸면 남은 기간 추가 결제 없이 바로 바뀌어요. 버튼을 한 번 더 누르면 적용돼요.`, false);
        } else {
          // 서버가 낮은 플랜으로의 변경은 견적만 내고 적용하지 않는다. 그 사실을
          // 여기서 그대로 말한다 — 200 을 "바꿨어요" 로 읽지 않는다.
          say(`${plan.label}로 낮추는 변경은 아직 이 페이지에서 할 수 없어요. 지금 플랜은 이번 달 끝까지 그대로 쓸 수 있고, 낮은 플랜은 해지 뒤 다음 달에 새로 구독해 주세요.`, true);
        }
      } else if (quoted.applies_now) {
        const result = await api('/membership/toss/plan', { method: 'POST', body });
        state.quote = null;
        if (result.applied) {
          await loadSubscription();
          say(result.charged
            ? `${plan.label}로 바꿨어요. ${won(result.proration.charge_krw)}이 결제됐고 바로 적용됐어요.`
            : `${plan.label}로 바꿨어요. 추가 결제 없이 바로 적용됐어요.`, false);
        } else {
          say('플랜을 바꾸지 못했어요. 청구되지 않았어요.', true);
        }
      }
    } catch (error) {
      state.quote = null;
      say(failureCopy(error, '플랜 변경을 처리하지 못했어요. 중복 청구되지 않으니 잠시 뒤 다시 시도해 주세요.', { chargeUnknown: true }), true);
      endSessionIfRefused(error);
    }
    state.busy = false;
    render();
  }

  $('cancel-button').addEventListener('click', async () => {
    if (!state.token || state.busy) return;
    // 해지는 그 즉시 이용을 멈춘다. 실수로 누르지 않게 한 번 더 묻는다.
    if (!window.confirm('해지하면 바로 이용이 중단됩니다. 해지할까요?')) return;
    state.busy = true;
    render();
    try {
      state.subscription = await api('/membership/toss/cancel', { method: 'POST' });
      say('해지했어요. 이용이 바로 중단됐고 다음 결제는 청구되지 않아요.', false);
    } catch (error) {
      say(failureCopy(error, '해지 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'), true);
      endSessionIfRefused(error);
    }
    state.busy = false;
    render();
  });

  $('resume-button').addEventListener('click', async () => {
    if (!state.token || state.busy) return;
    const purchaseBlock = webPurchaseBlock();
    if (purchaseBlock) { say(WEB_PURCHASE_BLOCK_COPY[purchaseBlock], true); render(); return; }
    state.busy = true;
    render();
    try {
      state.subscription = await api('/membership/toss/resume', { method: 'POST' });
      say('다시 시작했어요. 추가로 결제되는 금액은 없어요.', false);
    } catch (error) {
      say(failureCopy(error, '다시 시작하지 못했어요. 결제 기간이 끝났다면 새로 구독해 주세요.'), true);
      endSessionIfRefused(error);
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
    // 카드 창을 여는 사이 App Store 구독이 생겼을 수 있다. 서버가 이미 막았다고 말한 계정은
    // 첫 달 결제를 요청하지 않는다. 확인하지 못한 경우는 서버의 재확인에 맡긴다.
    const purchaseBlock = webPurchaseBlock();
    if (purchaseBlock === 'apple' || purchaseBlock === 'elsewhere') {
      sessionStorage.removeItem(SELECTION_KEY);
      return say(`${WEB_PURCHASE_BLOCK_COPY[purchaseBlock]} 청구되지 않았어요.`, true);
    }

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
      say(result.active ? '구독이 시작됐어요. 앱에서 바로 쓸 수 있어요.'
        // 결제는 됐는데 구독이 켜지지 않은 경우를 "청구되지 않았어요"로 말하지 않는다.
        : result.charged ? '결제는 됐지만 구독을 바로 시작하지 못했어요. 중복 청구되지 않으니 잠시 뒤 이 페이지를 다시 열어 주세요.'
        : '결제를 확인하지 못했어요. 청구되지 않았어요.', !result.active);
    } catch (error) {
      if (isSubscriptionExists(error)) {
        sessionStorage.removeItem(SELECTION_KEY);
        say(subscriptionExistsCopy(), true);
      } else {
        say(failureCopy(error, '결제를 확인하지 못했어요. 중복 청구되지 않으니 잠시 뒤 이 페이지를 다시 열어 주세요.', { chargeUnknown: true }), true);
        endSessionIfRefused(error);
      }
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

  // Keep the captured selection above. Remove only recognized public choices
  // before the optional recorder starts; auth/billing keys and fragments stay
  // untouched and keep the analytics gate closed.
  const publicSelection = [...query.entries()];
  if (!location.hash && publicSelection.length && publicSelection.every(([name, value]) =>
    name === 'plan' ? Object.prototype.hasOwnProperty.call(PLANS, value)
      : name === 'funding' ? ['included', 'connected'].includes(value)
      : name === 'from' && value === 'app')) {
    history.replaceState(history.state, '', location.pathname);
  }

  render();
  // The Supabase redirect has to be adopted before anything asks the backend who
  // this is, or the first call goes out unauthenticated and the page renders the
  // signed-out state over a session that already exists.
  auth.init({ onSignedIn: afterSignIn, onSignedOut: afterSignOut })
    .then(() => {
      state.token = auth.token();
      state.user = auth.user();
      render();
      return loadBillingConfig();
    })
    .then(loadSubscription)
    .then(completePendingAuthorization);
})();
