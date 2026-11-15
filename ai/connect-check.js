// The account login's poll answers, turned into what the connect panel shows next (#4357). No DOM and no network:
// ai.js sends the poll and draws the step this returns. While the provider has not authorized, the page asks again on the
// provider's interval. Once it has, the real-answer check is sent at once, and a failed check waits for the person's retry
// instead of running the paid check again by itself.
(() => {
  'use strict';
  const LABELS = Object.freeze({
    waiting: '로그인을 기다리고 있어요.',
    checking: '연결 확인 중… 실제 테스트 답변을 기다리고 있어요.',
    verifying: '로그인을 확인했어요. 연결 확인 중… 실제 테스트 답변을 기다리고 있어요.',
    retry: '다시 시도'
  });
  const SLOW_DOWN_MS = 5000;
  // A server 500 without CORS headers also reads as a network failure, so the wait stops after this many in a row (#4423).
  const QUIET_FAILURE_LIMIT = 3;
  const TOKEN_WINDOW_SECONDS = 1800;

  const expired = (failure) => failure.status === 410 || failure.code === 'AI_ENGINE_ACCOUNT_CONNECTION_EXPIRED';
  // Only while the provider is still asked: a dropped answer or a provider briefly away is asked again on the next turn.
  const temporary = (failure) => (failure.network && !failure.aborted)
    || (failure.status === 503 && failure.code === 'AI_ENGINE_ACCOUNT_CONNECTION_UNAVAILABLE');

  function next({ phase, result, failure, interval, expiresAt, now, failures = 0 }) {
    const resumePhase = phase === 'verifying' ? 'verifying' : 'waiting';
    const step = (to, extra) => ({ phase: to, busy: false, label: '', error: null, retry: false, delayMs: null, expiresAt, interval,
      failures: 0, resumePhase, ...extra });
    if (result && result.status === 'complete') return step('connected');
    if (failure && expired(failure)) return step('expired', { error: failure });
    if (failure && (phase === 'verifying' || !temporary(failure))) return step('failed', { error: failure, retry: phase === 'verifying' });
    if (failure && failures + 1 >= QUIET_FAILURE_LIMIT) return step('failed', { error: failure, retry: true });
    if (result && result.phase === 'authorized') {
      const seconds = Number(result.expires_in_seconds);
      return step('verifying', { busy: true, label: LABELS.verifying, delayMs: 0, resumePhase: 'verifying',
        expiresAt: now + (seconds > 0 ? seconds : TOKEN_WINDOW_SECONDS) * 1000 });
    }
    let wait = interval + (result && result.slow_down ? SLOW_DOWN_MS : 0);
    const requested = Number(result && result.poll_interval_seconds);
    if (Number.isFinite(requested) && requested >= 2) wait = Math.max(wait, requested * 1000);
    return step('waiting', { label: LABELS.waiting, interval: wait, delayMs: Math.min(wait, Math.max(1, expiresAt - now + 1)),
      failures: failure ? failures + 1 : 0 });
  }

  Object.defineProperty(window, 'SidekickConnectCheck', { value: Object.freeze({ LABELS, next }), writable: false, configurable: false });
})();
