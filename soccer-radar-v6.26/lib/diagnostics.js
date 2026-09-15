// SOCCER RADAR v6.26 · Run diagnostics aggregator.
// Every Selector run returns one of these, fully populated -- every input
// fixture/candidate must reach a terminal state that is reflected here.

function createRunDiagnostics() {
  return {
    fixturesFetched: 0,
    fixturesExecutable: 0,
    fixturesAnalyzed: 0,
    fixtureProfilesBuilt: 0,

    marketsEvaluated: 0,
    goalsMarketsEvaluated: 0,
    bttsMarketsEvaluated: 0,
    moneylineMarketsEvaluated: 0,
    doubleChanceMarketsEvaluated: 0,
    asianTotalMarketsEvaluated: 0,
    asianHandicapMarketsEvaluated: 0,

    candidatesPassingModel: 0,
    candidatesPassingPrice: 0,
    candidatesPassingCalibration: 0,
    candidatesPassingMarketScore: 0,

    bestMarketsSelected: 0,

    executionRejected: 0,

    publicApproved: 0,
    publicPublished: 0,

    providerRequests: 0,
    providerRetries: 0,
    providerErrors: 0,

    dbWrites: 0,
    dbWriteFailures: 0,

    rejectionCounts: {}
  };
}

function recordMarketEvaluated(diag, marketFamily) {
  diag.marketsEvaluated++;
  if (marketFamily === 'GOALS') diag.goalsMarketsEvaluated++;
  else if (marketFamily === 'BTTS') diag.bttsMarketsEvaluated++;
  else if (marketFamily === 'MONEYLINE') diag.moneylineMarketsEvaluated++;
  else if (marketFamily === 'DOUBLE_CHANCE') diag.doubleChanceMarketsEvaluated++;
  else if (marketFamily === 'ASIAN_HANDICAP') diag.asianHandicapMarketsEvaluated++;
}

function recordRejection(diag, reasonCode) {
  if (!reasonCode) return;
  diag.rejectionCounts[reasonCode] = (diag.rejectionCounts[reasonCode] || 0) + 1;
}

// Fails the whole run object closed if a genuinely unknown reason code appears.
function validateReasonCode(reasonCode, config) {
  if (reasonCode === null || reasonCode === undefined) return true;
  return Object.values(config.rejectionReasons).includes(reasonCode);
}

if (typeof module !== 'undefined') {
  module.exports = { createRunDiagnostics, recordMarketEvaluated, recordRejection, validateReasonCode };
}
