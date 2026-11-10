(() => {
  'use strict';

  // The home page's "첫 업무부터, Free로." rows show each paid plan's web price
  // (owner 2026-11-10). The figure is never written in the page: it is the same
  // public answer /membership/ shows a signed-out visitor (GET
  // /membership/toss/config → plans, monthly won incl. VAT), so the two pages
  // cannot disagree. Without an answer a row keeps its "멤버십에서 확인" slot.
  // A row's plan is the one its link hands /membership/ (?plan=…).
  const CONFIG_URL = 'https://api.sidekickagent.app/membership/toss/config';
  const PRICE_NOTE = '월 · 부가세 포함';

  function positiveWon(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
  }

  function planOf(row) {
    try { return new URL(row.getAttribute('href'), 'https://sidekickagent.app').searchParams.get('plan') || ''; } catch (_) { return ''; }
  }

  function fill(plans) {
    document.querySelectorAll('a.plan-row').forEach((row) => {
      const slot = row.querySelector('.plan-row-price');
      const figure = slot && slot.querySelector('b');
      // Only an empty slot is a price slot: Free's "무료" stays as written.
      if (!figure || figure.textContent.trim()) return;
      const price = positiveWon(plans[planOf(row)]);
      if (price === null) return;
      figure.textContent = `${price.toLocaleString('ko-KR')}원`;
      const note = document.createElement('small');
      note.textContent = PRICE_NOTE;
      slot.append(note);
    });
  }

  fetch(CONFIG_URL, { method: 'GET', credentials: 'omit' })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      const plans = config && config.plans && typeof config.plans === 'object' ? config.plans : null;
      if (plans) fill(plans);
    })
    .catch(() => { /* the rows keep "멤버십에서 확인" */ });
})();
