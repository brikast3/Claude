// SOCCER RADAR v6.26 · Provider rate limiting + fail-soft retry.
// Never bursts the shared 10 req/min provider limit (paced to 9/min), retries
// only transient statuses with controlled backoff, and always resolves (never
// throws) so one bad HTTP call can never abort an entire run.

function providerSpacingMs(config) {
  return Math.ceil(60000 / config.provider.maxRequestsPerMinute);
}

function retryDelayMs(attemptIndex, status, retryAfterSeconds) {
  if (status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(1000, retryAfterSeconds * 1000);
  }
  return attemptIndex === 0 ? 2000 : 4000;
}

// requestFn(attemptIndex) -> Promise<response>, rejecting with
// { statusCode, message, retryAfterSeconds } on failure.
// deps.sleep is injectable so tests never actually wait.
async function httpWithRetry(requestFn, config, deps) {
  const sleep = (deps && deps.sleep) || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const retryable = new Set(config.provider.retryableStatuses);
  const attempts = { made: 0, retries: 0 };
  let lastStatus = 0;
  let lastMessage = 'UNKNOWN_ERROR';

  for (let attempt = 0; attempt <= config.provider.maxRetries; attempt++) {
    attempts.made++;
    try {
      const response = await requestFn(attempt);
      return { ok: true, response, attempts };
    } catch (e) {
      lastStatus = Number(e && e.statusCode) || 0;
      lastMessage = e && e.message ? String(e.message).slice(0, 240) : 'UNKNOWN_ERROR';
      const isRetryable = retryable.has(lastStatus);
      const isLastAttempt = attempt === config.provider.maxRetries;
      if (!isRetryable || isLastAttempt) {
        return { ok: false, status: lastStatus, message: lastMessage, attempts };
      }
      attempts.retries++;
      await sleep(retryDelayMs(attempt, lastStatus, e && e.retryAfterSeconds));
    }
  }
  return { ok: false, status: lastStatus, message: lastMessage, attempts };
}

// Simple token-pacer: given the timestamp of the last provider call, how long
// (ms) must the caller wait before the next one to respect maxRequestsPerMinute.
function waitBeforeNextCall(lastCallAtMs, nowMs, config) {
  const spacing = providerSpacingMs(config);
  const elapsed = nowMs - lastCallAtMs;
  return Math.max(0, spacing - elapsed);
}

if (typeof module !== 'undefined') {
  module.exports = { providerSpacingMs, retryDelayMs, httpWithRetry, waitBeforeNextCall };
}
