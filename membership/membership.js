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
  // The plans this page sells through Toss, identity only. What each one costs
  // is Korean won held in the backend's catalog (GET /membership/catalog?schema=v3,
  // D79), so this page has no price table to drift from — it renders what the
  // server said or it renders nothing. `sold` is here because the page must know
  // before the backend answers whether a plan may open a card window at all.
  //
  // D79 brought back a permanent Free plan. It is drawn on the page as its own
  // card, but it is not in this table: nothing about it is bought here.
  const PLANS = {
    birdie: { label: 'Birdie', storage: '5GB', sold: true },
    eagle: { label: 'Eagle', storage: '25GB', sold: true },
    albatross: { label: 'Albatross', storage: '100GB', sold: true }
  };
  // The first paid plan, and the landing place for any plan value this page does
  // not sell — including `free`, which the landing's Free row links with.
  const DEFAULT_PLAN = 'birdie';
  // The landing's Free row links here as ?plan=free: a public choice to clean
  // from the address, with nothing to preselect.
  const FREE_PLAN_LINK = 'free';
  // One-time purchases (D79 6·7): the item ids are fixed by the API contract.
  // A group closes as a whole when its catalog entry or its purchase route is
  // missing, so one unready product never opens a payment window for another.
  // Owner 2026-10-27: four packs, named by size. The page never prints a credit
  // amount: a pack is a share of one Birdie month, derived from the catalog.
  const ITEMS = {
    credits_500: { group: 'credits', action: '충전하기', size: 'S' },
    credits_1500: { group: 'credits', action: '충전하기', size: 'M' },
    credits_5000: { group: 'credits', action: '충전하기', size: 'L' },
    credits_15000: { group: 'credits', action: '충전하기', size: 'XL' },
    reset_full: { group: 'tickets', action: '구매하기' },
    reset_half: { group: 'tickets', action: '구매하기' }
  };
  const TICKET_NAMES = { full: '전체', half: '절반' };
  // The plan every usage multiple and pack share is measured against.
  const BASE_PLAN = 'birdie';
  // The one thing that has to survive Toss's redirect. It is the same public
  // choice the person already made on this page — never an amount, an account,
  // an order or an entitlement, because none of those would be believed by the
  // backend anyway.
  const SELECTION_KEY = 'sidekick_toss_selection';
  // The order this tab opened a one-time payment window for; cleared once the
  // window fails or the server has answered the way back.
  const PURCHASE_KEY = 'sidekick_toss_purchase';

  const state = {
    plan: DEFAULT_PLAN,
    // The plan a link arrived with (?plan=eagle), marked on its card until a card is pressed.
    requestedPlan: '',
    // A copy of the shared sign-in's bearer, refreshed whenever it changes, so
    // every "is this person signed in" below reads one field.
    token: auth.token(),
    user: null,
    billing: { sales_enabled: false, mode: 'unavailable', client_key: '', plans: {}, review_checkout_allowed: false },
    // GET /membership/catalog?schema=v3, read once. null until it answered or
    // when it could not be read; `catalogChecked` tells those two apart.
    catalog: null,
    catalogChecked: false,
    // Item groups the server refused to sell (404 or not configured). Closed for this visit.
    closedGroups: {},
    // The item whose payment window is being opened.
    item: null,
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
  // The Free card carries no data-plan: it has no price node and no button.
  const planCards = [...document.querySelectorAll('.plan-card[data-plan]')];
  const itemCards = [...document.querySelectorAll('.extra-card[data-item]')];
  // 로그인 화면은 구매를 누른 순간에만 열린다. 그때 무엇을 사려던
  // 중이었는지 기억해 두었다가, 로그인이 끝나면 사람이 다시 누르지
  // 않아도 그 구매를 이어서 시작한다.
  let pendingPurchase = null;
  let pendingItem = null;
  // A return from a one-time payment is confirmed once per page load, however
  // many sign-in hooks run after it.
  let purchaseConfirmSent = false;

  function won(value) { return `${Number(value).toLocaleString('ko-KR')}원`; }
  function positiveWon(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
  }
  // The catalog's web price first; a plain plan key in the Toss config second.
  // Never a price keyed by the removed AI-account choice.
  function priceOf(plan) {
    const fromCatalog = state.catalog && state.catalog.plans[plan] ? state.catalog.plans[plan].price : null;
    return fromCatalog || positiveWon(state.billing.plans[plan]);
  }
  function itemPrice(id) {
    return state.catalog && state.catalog.items[id] ? state.catalog.items[id] : null;
  }

  // Only the fields this page prints, each checked. Anything else in the answer is ignored.
  function readCatalog(value) {
    if (!value || typeof value !== 'object' || value.schema_version !== 'membership_catalog.v3') return null;
    const plans = {};
    (Array.isArray(value.plans) ? value.plans : []).forEach((row) => {
      if (!row || !Object.prototype.hasOwnProperty.call(PLANS, row.id)) return;
      const price = positiveWon(row.price && row.price.web_krw);
      const credits = row.credits && Number.isInteger(row.credits.amount) && row.credits.amount > 0 ? row.credits.amount : null;
      if (price) plans[row.id] = { price, credits };
    });
    const items = {};
    const packCredits = {};
    (Array.isArray(value.credit_packs) ? value.credit_packs : []).forEach((row) => {
      if (!row || !Object.prototype.hasOwnProperty.call(ITEMS, row.id) || ITEMS[row.id].group !== 'credits') return;
      const price = positiveWon(row.price && row.price.web_krw);
      if (price) items[row.id] = price;
      if (Number.isInteger(row.credits) && row.credits > 0) packCredits[row.id] = row.credits;
    });
    (Array.isArray(value.reset_tickets) ? value.reset_tickets : []).forEach((row) => {
      const id = row && (row.kind === 'full' || row.kind === 'half') ? `reset_${row.kind}` : '';
      const price = id ? positiveWon(row.price && row.price.web_krw) : null;
      if (price) items[id] = price;
    });
    return { plans, items, packCredits };
  }

  // Usage is shown relative to Birdie, never as a credit number: a plan is
  // "N배" of Birdie's month and a pack is "N%" of it. Both come from the
  // catalog's amounts, so they cannot drift from the contract.
  function baseCredits() {
    const base = state.catalog && state.catalog.plans[BASE_PLAN];
    return base && base.credits ? base.credits : null;
  }
  function roundedRatio(value) { return Math.round(value * 10) / 10; }
  function renderUsageRatios() {
    const base = baseCredits();
    if (!base) return;
    document.querySelectorAll('[data-usage-multiple]').forEach((node) => {
      const plan = state.catalog.plans[node.dataset.usageMultiple];
      if (plan && plan.credits) node.textContent = String(roundedRatio(plan.credits / base));
    });
    document.querySelectorAll('[data-usage-share]').forEach((node) => {
      const credits = state.catalog.packCredits[node.dataset.usageShare];
      if (credits) node.textContent = String(roundedRatio((credits * 100) / base));
    });
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
  // 추가 충전과 티켓은 구독이 아니어서 이 규칙과 무관하다: 어디서 구독 중이든 Free든 살 수 있다.
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
      return '이미 구독 중이에요. 추가로 청구되지 않았어요.';
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
    if (code === 'sales_disabled' || code === 'selection_not_saleable' || code === 'schema_not_ready') return '지금은 구독할 수 없어요. 청구되지 않았어요.';
    if (code === 'plan_unchanged') return '이미 이 플랜을 쓰고 있어요. 바뀐 것은 없어요.';
    if (code === 'subscription_inactive') return '이용 중인 구독이 없어요.';
    if (error.network && !chargeUnknown) return '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    return fallback;
  }

  // 쓰기 요청에서 로그인이 끝난 것을 알았으면 이 브라우저의 로그인도 정리한다.
  // 그대로 두면 다음 버튼도 같은 이유로 실패한다.
  function endSessionIfRefused(error) {
    if (error && (error.status === 401 || error.status === 423)) auth.signOut({ server: false, silent: true });
  }

  // 이 구독의 결제 기간이 끝나는 날. 서버가 날짜를 주지 않았으면 빈 문자열이다.
  function periodEndLabel(subscription) {
    const end = subscription && Number(subscription.current_period_end);
    return end > 0 ? new Date(end * 1000).toLocaleDateString('ko-KR') : '';
  }

  function renderSubscription() {
    const panel = $('subscription-panel');
    const subscription = state.subscription;
    // 해지한 구독도 결제 기간이 남았으면 보여 준다 — 다시 시작하기가 여기 있다.
    const visible = Boolean(state.token && subscription && (subscription.active || subscription.resumable));
    panel.hidden = !visible;
    if (!visible) return;
    const plan = PLANS[subscription.plan_id];
    $('subscription-line').textContent = plan ? plan.label : String(subscription.plan_id || '');
    const until = periodEndLabel(subscription);
    // 다른 곳(App Store)의 구독이 살아 있거나 서버가 웹 결제를 허락하지 않으면 다시 시작하기를
    // 내놓지 않는다. 해지는 언제나 할 수 있어야 하므로 해지 버튼은 이 조건과 무관하다.
    const resumeBlocked = Boolean(webPurchaseBlock());
    // 해지한 구독도 이미 결제한 기간이 끝날 때까지는 지금 플랜 그대로다(2026-10-12 결정).
    $('subscription-renewal').textContent = subscription.cancel_at_period_end
      ? (resumeBlocked
        ? `해지했어요. 다음 결제는 없고, ${until}까지 지금 플랜을 그대로 쓸 수 있어요. 지금은 웹에서 다시 시작할 수 없어요.`
        : `해지했어요. 다음 결제는 없고, ${until}까지 지금 플랜을 그대로 쓸 수 있어요. 그 전에 다시 시작하면 추가 결제 없이 이어져요.`)
      : `${until}에 다음 달 금액이 결제돼요.`;
    $('cancel-button').hidden = Boolean(subscription.cancel_at_period_end);
    $('resume-button').hidden = !subscription.resumable || resumeBlocked;
  }

  function itemReady(id) {
    const item = ITEMS[id];
    return Boolean(item) && !state.closedGroups[item.group] && itemPrice(id) !== null && publicCheckoutReady();
  }

  function renderItems() {
    itemCards.forEach((card) => {
      const id = card.dataset.item;
      const item = ITEMS[id];
      if (!item) return;
      const price = itemPrice(id);
      const closed = Boolean(state.closedGroups[item.group]) || (state.catalogChecked && price === null);
      card.querySelector(`[data-item-price="${id}"]`).textContent = price === null || closed ? '—' : won(price);
      const button = card.querySelector('[data-buy-item]');
      const ready = itemReady(id);
      button.disabled = !ready || state.busy;
      // 판매가 닫힌 묶음은 결제 창을 열지 않고 "준비 중"으로 남는다.
      button.textContent = state.busy && state.item === id ? '연결 중…'
        : closed ? '준비 중이에요'
        : !state.catalogChecked ? '금액을 불러오는 중이에요'
        : testModeHere() ? '테스트 모드예요'
        : !publicCheckoutReady() ? '준비 중이에요'
        : item.action;
      card.classList.toggle('is-closed', closed);
    });
  }

  function render() {
    if (!PLANS[state.plan]) state.plan = DEFAULT_PLAN;
    const authenticated = Boolean(state.token);
    const subscribed = Boolean(state.subscription && state.subscription.active);
    const purchaseBlock = webPurchaseBlock();

    planCards.forEach((card) => {
      const id = card.dataset.plan;
      const plan = PLANS[id];
      const amount = plan && plan.sold ? priceOf(id) : null;
      const priceNode = card.querySelector(`[data-price="${id}"]`);
      const next = amount === null ? '—' : won(amount);
      if (priceNode.textContent !== next) {
        priceNode.textContent = next;
        // 금액이 바뀐 카드만 짧게 짚어 준다.
        priceNode.classList.remove('just-changed');
        void priceNode.offsetWidth;
        priceNode.classList.add('just-changed');
      }
      card.querySelector(`[data-sub="${id}"]`).textContent = !plan.sold
        ? '지금은 웹에서 구매할 수 없어요.'
        : amount === null ? '금액을 불러오고 있어요.'
        : '매월 자동 갱신';

      const button = card.querySelector('[data-buy]');
      const ready = publicCheckoutReady() && plan.sold && amount !== null && !subscribed && !state.busy;
      const current = subscribed && state.subscription.plan_id === id;
      // 구독 중이면 다른 플랜 카드의 버튼은 "바꾸기" 다. 견적을 받은 카드만
      // 결제 문구가 되고, 해지를 예약한 구독은 바꿀 수 없다 — 다음 달에 끝나는
      // 구독 위에 새 금액을 올리는 것은 사람이 원한 적 없는 일이다.
      const changeable = subscribed && !current && publicCheckoutReady() && plan.sold && amount !== null
        && !state.busy && !state.subscription.cancel_at_period_end;
      const quoted = state.quote && state.quote.to_plan_id === id ? state.quote : null;
      // 로그인은 여기서 요구하지 않는다. 누르면 로그인 화면이 열리고,
      // 끝나면 이 구매가 이어진다.
      // 서버가 웹 결제를 허락하지 않은 계정에는 결제·바꾸기 버튼을 모두 닫는다.
      button.disabled = Boolean(purchaseBlock) || !(ready || (changeable && (!quoted || quoted.applies_now)));
      button.hidden = current;
      button.textContent = state.busy && state.plan === id && !state.item ? '연결 중…'
        : !plan.sold ? '지금은 구매할 수 없어요'
        : purchaseBlock === 'pending' && (ready || changeable) ? '구독 상태를 확인하는 중이에요'
        : purchaseBlock && (ready || changeable) ? '웹에서는 결제할 수 없어요'
        : ready ? `${plan.label} 구독하기`
        : changeable && quoted && quoted.applies_now ? (quoted.charge_krw > 0 ? `오늘 ${won(quoted.charge_krw)} 결제하고 바꾸기` : '추가 결제 없이 바꾸기')
        : changeable && quoted ? '지금은 바꿀 수 없어요'
        : changeable ? `${plan.label}로 바꾸기`
        : subscribed ? '지금은 바꿀 수 없어요'
        : testModeHere() ? '테스트 모드예요'
        : '금액을 불러오는 중이에요';
      card.classList.toggle('is-current', current);
      card.classList.toggle('is-selected', !current && state.requestedPlan === id);
    });
    renderItems();
    renderUsageRatios();

    // The header's account slot is /auth.js's: it reads the same bearer.
    $('account-line').hidden = authenticated;
    $('open-signin').hidden = authenticated;
    if (authenticated) $('auth-status').textContent = '';
    renderSubscription();
    $('page-title').textContent = subscribed ? '구독 관리' : '요금제';
    document.querySelector('.promo-line').hidden = subscribed;

    if (!$('checkout-status').dataset.pinned) {
      const status = testModeHere()
        ? '지금은 테스트 모드라 이 주소에서는 결제할 수 없어요. 준비가 끝나면 바로 열려요.'
        : !publicCheckoutReady()
        ? '지금은 구독을 시작할 수 없어요.'
        : purchaseBlock ? WEB_PURCHASE_BLOCK_COPY[purchaseBlock]
        : '';
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

  // 추가 충전·티켓 카드 아래의 한 줄. 누른 곳 가까이에 답한다.
  function sayPurchase(message, isError) {
    const node = $('purchase-status');
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
    pendingItem = null;
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
        // Korean won, server-owned. Only a plain plan key is read (priceOf).
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

  // The v3 catalog is public product data. An old backend answers 404 here: then
  // no catalog price is shown and both purchase groups stay 준비 중.
  async function loadCatalog() {
    try {
      state.catalog = readCatalog(await api('/membership/catalog?schema=v3', { method: 'GET' }));
    } catch (_) {
      state.catalog = null;
    }
    state.catalogChecked = true;
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

  // 로그인 화면은 /auth.js 가 연다. 여기서는 무엇을 사려던 중이었는지만 기억한다.
  function openSignin(plan) {
    pendingPurchase = plan || null;
    pendingItem = null;
    auth.open();
  }

  function openSigninForItem(itemId) {
    pendingPurchase = null;
    pendingItem = itemId;
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
      state.requestedPlan = '';
      if (state.plan !== (state.quote && state.quote.to_plan_id)) state.quote = null;
      render();
      if (!state.token) { openSignin(card.dataset.plan); return; }
      if (state.subscription && state.subscription.active) { changePlan(card.dataset.plan); return; }
      startCheckout();
    });
  });

  itemCards.forEach((card) => {
    const button = card.querySelector('[data-buy-item]');
    if (!button) return;
    button.addEventListener('click', () => {
      const id = card.dataset.item;
      if (!itemReady(id) || state.busy) return;
      if (!state.token) { openSigninForItem(id); return; }
      startItemPurchase(id);
    });
  });

  $('open-signin').addEventListener('click', () => openSignin(null));

  // 로그인 직후 확인 화면을 한 장 더 끼우지 않는다: 고른 플랜 그대로
  // 토스 결제창이 바로 열린다. 다른 탭에서 로그인한 것이면 이 탭은 화면만
  // 따라가고, 여기서 누르다 만 구매를 대신 시작하지 않는다.
  async function afterSignIn(user, context) {
    if (context && context.otherTab) pendingPurchase = null;
    if (context && context.otherTab) pendingItem = null;
    state.token = auth.token();
    state.user = auth.user();
    closeSignin();
    render();
    await loadBillingConfig();
    await loadSubscription();
    await completePendingAuthorization();
    await completePendingPurchase();
    const subscribed = Boolean(state.subscription && state.subscription.active);
    if (pendingPurchase && !subscribed) {
      state.plan = pendingPurchase;
      pendingPurchase = null;
      render();
      await startCheckout();
    }
    if (pendingItem) {
      const id = pendingItem;
      pendingItem = null;
      await startItemPurchase(id);
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
      // D79: the plan is the whole choice. AI connection has nothing to do with it.
      const intent = await api('/membership/toss/authorization', {
        method: 'POST',
        body: JSON.stringify({ plan_id: state.plan })
      });
      sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ plan_id: state.plan }));
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

  // What POST /purchases/toss/order answered, checked field by field; null if any is off.
  function readOrder(value) {
    if (!value || typeof value !== 'object') return null;
    const orderId = typeof value.order_id === 'string' && /^[A-Za-z0-9_=-]{6,64}$/.test(value.order_id) ? value.order_id : '';
    const name = typeof value.order_name === 'string' ? value.order_name.trim() : '';
    const customerKey = typeof value.customer_key === 'string' ? value.customer_key : '';
    const amount = positiveWon(value.amount_krw);
    if (!orderId || !name || name.length > 100 || !customerKey || amount === null) return null;
    return { orderId, name, customerKey, amount };
  }

  // The purchase routes are missing (an older backend) or switched off: the
  // whole group closes for this visit and shows 준비 중, never a second try.
  function purchaseClosed(error) {
    if (!error) return false;
    if (error.status === 404 || error.status === 501 || error.status === 503) return true;
    const code = String(error.code || error.detail || '');
    return ['purchases_disabled', 'purchases_unavailable', 'sales_disabled', 'schema_not_ready',
      'not_configured', 'item_not_saleable'].includes(code);
  }

  // One-time payment (D79 6·7): the server writes the order and its amount, Toss
  // takes the card, and only POST /purchases/toss/confirm on the way back grants.
  async function startItemPurchase(itemId) {
    const item = ITEMS[itemId];
    const shown = itemPrice(itemId);
    if (!item || !state.token || state.busy || !itemReady(itemId)) return;
    state.busy = true;
    state.item = itemId;
    sayPurchase('', false);
    render();
    try {
      const order = readOrder(await api('/purchases/toss/order', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId })
      }));
      if (!order) throw new Error('order_invalid');
      // The number on the card is the number charged, or no window opens.
      if (order.amount !== shown) {
        state.busy = false;
        state.item = null;
        sayPurchase('금액이 바뀌었어요. 청구되지 않았어요. 새 금액을 확인한 뒤 다시 눌러 주세요.', true);
        await loadCatalog();
        return;
      }
      sessionStorage.setItem(PURCHASE_KEY, JSON.stringify({ order_id: order.orderId, item_id: itemId }));
      const TossPayments = await loadTossSdk();
      const payment = TossPayments(state.billing.client_key).payment({ customerKey: order.customerKey });
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: order.amount },
        orderId: order.orderId,
        orderName: order.name,
        successUrl: `${location.origin}/membership/?purchase=paid`,
        failUrl: `${location.origin}/membership/?purchase=failed`
      });
    } catch (error) {
      state.busy = false;
      state.item = null;
      sessionStorage.removeItem(PURCHASE_KEY);
      if (purchaseClosed(error)) {
        state.closedGroups[item.group] = true;
        sayPurchase('아직 준비 중이에요. 청구되지 않았어요.', true);
      } else if (error && error.code === 'USER_CANCEL') {
        sayPurchase('결제를 취소했어요. 청구되지 않았어요.', false);
      } else {
        sayPurchase(failureCopy(error, '결제 창을 열지 못했어요. 청구되지 않았어요. 잠시 뒤 다시 시도해 주세요.'), true);
        endSessionIfRefused(error);
      }
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
    const body = JSON.stringify({ plan_id: planId });
    const quoted = state.quote && state.quote.to_plan_id === planId ? state.quote : null;
    state.busy = true;
    render();
    try {
      if (!quoted) {
        const quote = await api('/membership/toss/plan/quote', { method: 'POST', body });
        state.quote = quote;
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
    // 해지는 다음 결제를 멈추고, 이미 결제한 기간은 끝날 때까지 그대로 쓰게 둔다(2026-10-12 결정).
    // 실수로 누르지 않게 한 번 더 묻고, 지금 플랜을 언제까지 쓰는지 날짜로 보여 준다.
    const until = periodEndLabel(state.subscription);
    const keeps = until ? `${until}까지` : '이미 결제한 기간이 끝날 때까지';
    if (!window.confirm(`해지하면 다음 결제부터 청구되지 않아요. 지금 플랜은 ${keeps} 그대로 쓸 수 있어요. 해지할까요?`)) return;
    state.busy = true;
    render();
    try {
      state.subscription = await api('/membership/toss/cancel', { method: 'POST' });
      const ends = periodEndLabel(state.subscription);
      say(`해지했어요. 다음 결제는 청구되지 않고, ${ends ? `${ends}까지` : '이미 결제한 기간이 끝날 때까지'} 지금 플랜을 그대로 쓸 수 있어요. 추가 사용량과 다시 채우기는 그대로 남아요.`, false);
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
          plan_id: selection.plan_id
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

  // What the server granted, in words. A replay granted nothing new.
  function grantCopy(grant) {
    if (!grant || typeof grant !== 'object') return '결제를 반영했어요.';
    if (grant.replayed === true) return '이미 반영된 결제예요. 추가로 청구되지 않았어요.';
    const granted = grant.granted && typeof grant.granted === 'object' ? grant.granted : {};
    if (Number.isInteger(granted.credits) && granted.credits > 0) {
      const item = ITEMS[grant.item_id];
      return item && item.size ? `추가 사용량 ${item.size} 충전이 끝났어요.` : '추가 사용량 충전이 끝났어요.';
    }
    const tickets = granted.tickets && typeof granted.tickets === 'object' ? granted.tickets : null;
    if (tickets && TICKET_NAMES[tickets.kind] && Number.isInteger(tickets.count) && tickets.count > 0) {
      return `사용량 다시 채우기(${TICKET_NAMES[tickets.kind]}) ${tickets.count}장을 받았어요.`;
    }
    return '결제를 반영했어요.';
  }

  // Coming back from a one-time payment window. Toss adds paymentKey, orderId
  // and amount; only the server's confirm grants anything, and it is idempotent,
  // so a reload asks again and is answered "already done".
  async function completePendingPurchase() {
    if (query.get('purchase') !== 'paid') return;
    const paymentKey = query.get('paymentKey');
    const orderId = query.get('orderId');
    const amount = Number(query.get('amount'));
    if (!paymentKey || !orderId || !Number.isInteger(amount) || amount <= 0) return;
    if (!state.token) return say('결제를 마치려면 같은 계정으로 다시 로그인해 주세요.', true);
    if (state.busy || purchaseConfirmSent) return;
    purchaseConfirmSent = true;
    state.busy = true;
    say('결제를 확인하고 있어요.', false);
    render();
    try {
      const grant = await api('/purchases/toss/confirm', {
        method: 'POST',
        body: JSON.stringify({ payment_key: paymentKey, order_id: orderId, amount })
      });
      sessionStorage.removeItem(PURCHASE_KEY);
      say(grantCopy(grant), false);
      // The one-time key leaves the address bar once the server has answered.
      history.replaceState(history.state, '', location.pathname);
    } catch (error) {
      say(failureCopy(error, '결제를 확인하지 못했어요. 중복 청구되지 않으니 잠시 뒤 이 페이지를 다시 열어 주세요.', { chargeUnknown: true }), true);
      endSessionIfRefused(error);
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
  if (query.get('purchase') === 'failed') {
    sessionStorage.removeItem(PURCHASE_KEY);
    say(query.get('code') === 'PAY_PROCESS_CANCELED' ? '결제를 취소했어요. 청구되지 않았어요.' : '결제를 마치지 못했어요. 청구되지 않았어요.', true);
  }
  // The landing page's plan rows link here with the plan already chosen
  // (/membership/?plan=eagle). Older links still carry the removed AI-account
  // choice (&funding=…): the plan is preselected and that choice is ignored. A
  // value this page does not sell falls back to the default — which is what
  // ?plan=free does — and no authorisation starts without the person clicking.
  const requestedPlan = query.get('plan');
  if (requestedPlan && Object.prototype.hasOwnProperty.call(PLANS, requestedPlan)) {
    state.plan = requestedPlan;
    state.requestedPlan = requestedPlan;
  }

  // Keep the captured selection above. Remove only recognized public choices
  // before the optional recorder starts; auth/billing keys and fragments stay
  // untouched and keep the analytics gate closed.
  const publicSelection = [...query.entries()];
  if (!location.hash && publicSelection.length && publicSelection.every(([name, value]) =>
    name === 'plan' ? Object.prototype.hasOwnProperty.call(PLANS, value) || value === FREE_PLAN_LINK
      : name === 'funding' ? true
      : name === 'from' && value === 'app')) {
    history.replaceState(history.state, '', location.pathname);
  }

  render();
  // The stored session has to be settled (auth.init) before anything asks the
  // backend who this is, or the first call goes out unauthenticated and the page
  // renders the signed-out state over a session that already exists.
  auth.init({ onSignedIn: afterSignIn, onSignedOut: afterSignOut })
    .then(() => {
      state.token = auth.token();
      state.user = auth.user();
      render();
      loadCatalog();
      return loadBillingConfig();
    })
    .then(loadSubscription)
    .then(completePendingAuthorization)
    .then(completePendingPurchase);
})();
