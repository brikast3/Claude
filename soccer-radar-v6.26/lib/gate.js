// SOCCER RADAR v6.26 · Public quality gate.
// Two independent checks, run in this priority order so the recorded reason is
// always the most specific one, never a generic catch-all:
//   1) evaluateCandidateGate    -- everything intrinsic to the candidate itself
//   2) evaluatePublicationCaps  -- everything about run/day state (caps, dedup)
// Both fail closed: missing/invalid data is always a rejection, never a fallback.

function fail(code) {
  return { passed: false, reasonCode: code };
}

function evaluateCandidateGate(candidate, config) {
  const R = config.rejectionReasons;

  if (candidate.insufficientHistory === true) return fail(R.INSUFFICIENT_HISTORY);
  if (candidate.modelProbabilityValid === false) return fail(R.MODEL_PROBABILITY_INVALID);
  if (candidate.marketProbabilityValid === false) return fail(R.MARKET_PROBABILITY_INVALID);
  if (candidate.hasExactMarket === false) return fail(R.EXACT_MARKET_NOT_FOUND);
  if (candidate.hasExactLine === false) return fail(R.EXACT_LINE_NOT_FOUND);
  if (candidate.snapshotAgeMinutes > config.gate.maxSnapshotAgeMinutes) return fail(R.SNAPSHOT_STALE);
  if (candidate.calibratedEv > config.ev.hardRejectThreshold) return fail(R.EXTREME_EV_REJECT);
  if (candidate.marketScore < config.gate.minMarketScore) return fail(R.MARKET_SCORE_TOO_LOW);
  if (candidate.odd < config.odds.minPublicOdd) return fail(R.ODD_BELOW_PUBLIC_RANGE);
  if (candidate.odd > config.odds.maxPublicOdd) return fail(R.ODD_ABOVE_PUBLIC_RANGE);
  if (candidate.dataQualityScore < config.gate.minDataQuality) return fail(R.DATA_QUALITY_LOW);
  if (candidate.historyScore < config.gate.minHistoryScore) return fail(R.HISTORY_SCORE_LOW);
  if (candidate.calibratedEv < config.ev.minCalibratedEv) return fail(R.CALIBRATED_EV_TOO_LOW);
  if (candidate.calibratedEdgePp < config.ev.minCalibratedEdgePp) return fail(R.CALIBRATED_EDGE_TOO_LOW);

  return { passed: true, reasonCode: null };
}

// context: { fixtureAlreadyPublished, publishedThisRun, publishedToday }
function evaluatePublicationCaps(context, config) {
  const R = config.rejectionReasons;
  if (context.fixtureAlreadyPublished) return fail(R.FIXTURE_ALREADY_PUBLISHED);
  if (context.publishedThisRun >= config.volume.maxPublicPerRun) return fail(R.RUN_CAP_REACHED);
  if (context.publishedToday >= config.volume.maxPublicPerDay) return fail(R.DAILY_CAP_REACHED);
  return { passed: true, reasonCode: null };
}

// Recompute-on-recheck version used just before Telegram publication (spec §19).
// priceDeteriorationPct: fraction the current odd has dropped vs the odd used at selection time.
function evaluateExecutionRecheck(candidate, priceDeteriorationPct, config) {
  const R = config.rejectionReasons;
  if (candidate.hasExactMarket === false) return fail(R.EXACT_MARKET_NOT_FOUND);
  if (candidate.hasExactLine === false) return fail(R.EXACT_LINE_NOT_FOUND);
  if (candidate.snapshotAgeMinutes > config.gate.maxSnapshotAgeMinutes) return fail(R.SNAPSHOT_STALE);
  if (priceDeteriorationPct > config.gate.maxPriceDeteriorationPct) return fail(R.PRICE_DETERIORATION_TOO_HIGH);
  if (Math.abs(candidate.odd - candidate.entryOdd) / candidate.entryOdd > 0.15) return fail(R.BET365_PRICE_MOVED);
  // Recompute against the full gate with the refreshed price/probabilities.
  // sr_v626_runs.execution_rejected is the counter that records "this failed at
  // the execution-recheck stage"; the specific reasonCode returned here (one of
  // the standard codes, e.g. MARKET_SCORE_TOO_LOW) is what gets persisted on
  // the candidate row -- never a separate ad-hoc "EXECUTION_REJECTED:<x>" string.
  const base = evaluateCandidateGate(candidate, config);
  if (!base.passed) return fail(base.reasonCode);
  return { passed: true, reasonCode: null };
}

if (typeof module !== 'undefined') {
  module.exports = { evaluateCandidateGate, evaluatePublicationCaps, evaluateExecutionRecheck };
}
