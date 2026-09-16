// SOCCER RADAR v6.26 · Execution-time recompute (spec S19).
// Re-derives EVERYTHING from the fresh Bet365 price at publish time --
// de-vig, calibration, EV, Edge, MarketScore -- rather than re-checking price
// deterioration alone while still gating on the stale selection-time numbers.
// A market whose price moved enough to change the calibrated verdict must be
// judged on the NEW verdict, not the old one.

if (typeof require !== 'undefined' && typeof lookupPrice === 'undefined') {
  var { lookupPrice } = require('./priceLookup');
  var { impliedProbability, devigTwoWay, devigThreeWay } = require('./devig');
  var { computeConfidence, shrinkProbability } = require('./calibration');
  var { computeMarketScore } = require('./scoring');
  var { evaluateExecutionRecheck } = require('./gate');
}

// c: a staged candidate (the object persisted by lib/engine.js's buildCandidate,
//    carried through selection + the publication queue) -- must include
//    bet365Odd (the entry/selection-time odd), modelProbabilityRaw,
//    homeSampleN/awaySampleN/historyScore/dataQualityScore/leagueReliabilityScore.
// freshBet365: a canonical bet365 payload parsed from a JUST-fetched provider response.
function recomputeExecutionCandidate(c, freshBet365, config) {
  const market = { marketFamily: c.marketFamily, side: c.side, line: c.line, bookLine: c.bookLine };
  const price = lookupPrice(freshBet365, market);
  const executionSnapshotAt = freshBet365.snapshotAt || new Date().toISOString();

  if (!price.hasExactMarket || !price.hasExactLine || !(price.odd > 1)) {
    const reasonCode = price.hasExactMarket ? config.rejectionReasons.EXACT_LINE_NOT_FOUND : config.rejectionReasons.EXACT_MARKET_NOT_FOUND;
    return { approved: false, reasonCode, refreshed: null, currentOdd: null, priceDeteriorationPct: null };
  }

  const currentOdd = Number(price.odd);
  const priceDeteriorationPct = c.bet365Odd > 0 ? Math.max(0, (c.bet365Odd - currentOdd) / c.bet365Odd) : 1;
  const snapshotAgeMinutes = Math.max(0, (Date.now() - Date.parse(executionSnapshotAt)) / 60000);

  const rawImpliedProbability = impliedProbability(currentOdd);
  let devigMarketProbability = null;
  if (c.marketFamily === 'MONEYLINE' && Array.isArray(price.otherOdds) && price.otherOdds.length === 2 && price.otherOdds.every(x => Number(x) > 1)) {
    devigMarketProbability = devigThreeWay(currentOdd, Number(price.otherOdds[0]), Number(price.otherOdds[1])).devig;
  } else if (Number(price.oppositeOdd) > 1) {
    devigMarketProbability = devigTwoWay(currentOdd, Number(price.oppositeOdd)).devig;
  }
  const marketProbability = devigMarketProbability !== null ? devigMarketProbability : rawImpliedProbability;
  const marketProbabilityValid = marketProbability !== null && marketProbability >= 0 && marketProbability <= 1;
  const modelProbabilityRaw = Number(c.modelProbabilityRaw);
  const modelProbabilityValid = Number.isFinite(modelProbabilityRaw) && modelProbabilityRaw >= 0 && modelProbabilityRaw <= 1;

  let modelProbabilityCalibrated = null, calibratedEv = null, calibratedEdgePp = null, marketScore = 0, scoreResult = null;

  if (modelProbabilityValid && marketProbabilityValid) {
    const confidence = computeConfidence({
      sampleScore: Math.min(1, Math.min(Number(c.homeSampleN || 0), Number(c.awaySampleN || 0)) / config.quality.targetSampleN),
      historyScore: Number(c.historyScore || 0) / 100,
      dataQualityScore: Number(c.dataQualityScore || 0) / 100,
      leagueReliability: Number(c.leagueReliabilityScore ?? 50) / 100,
      marketQualityScore: devigMarketProbability !== null ? 1 : 0.6
    });
    modelProbabilityCalibrated = shrinkProbability(modelProbabilityRaw, marketProbability, confidence, config).pFinal;
    if (modelProbabilityCalibrated !== null) {
      calibratedEv = modelProbabilityCalibrated * currentOdd - 1;
      calibratedEdgePp = modelProbabilityCalibrated - marketProbability;
      scoreResult = computeMarketScore({
        confidence, historyScore: Number(c.historyScore || 0), dataQualityScore: Number(c.dataQualityScore || 0),
        edgePp: calibratedEdgePp, homeSampleN: Number(c.homeSampleN || 0), awaySampleN: Number(c.awaySampleN || 0),
        targetSampleN: config.quality.targetSampleN, calibratedEv, leagueReliabilityScore: Number(c.leagueReliabilityScore ?? 50),
        priceMovePct: priceDeteriorationPct
      }, config);
      marketScore = scoreResult.marketScore;
    }
  }

  const refreshed = {
    ...c,
    odd: currentOdd, bet365Odd: currentOdd, entryOdd: c.bet365Odd, oppositeOdd: price.oppositeOdd ?? null,
    hasExactMarket: true, hasExactLine: true, snapshotAgeMinutes, marketSnapshotAt: executionSnapshotAt,
    rawImpliedProbability, devigMarketProbability, modelProbabilityRaw, modelProbabilityValid, marketProbabilityValid,
    modelProbabilityCalibrated, calibratedEv, calibratedEdgePp, marketScore,
    overconfidencePenaltyApplied: Boolean(scoreResult && scoreResult.overconfidencePenaltyApplied)
  };

  const verdict = evaluateExecutionRecheck(refreshed, priceDeteriorationPct, config);
  return {
    approved: verdict.passed,
    reasonCode: verdict.passed ? null : verdict.reasonCode,
    refreshed, currentOdd, priceDeteriorationPct
  };
}

if (typeof module !== 'undefined') {
  module.exports = { recomputeExecutionCandidate };
}
