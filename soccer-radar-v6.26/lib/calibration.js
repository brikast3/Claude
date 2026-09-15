// SOCCER RADAR v6.26 · Calibration shrinkage.
// P_final = w_model * P_model + w_market * P_market
// The model weight grows only when we actually have reason to trust it: enough
// sample, consistent history, a reliable league, good data quality and a
// market we could de-vig cleanly. At low confidence P_final collapses toward
// the market price, never the other way around.

// components: each 0..1
//   sampleScore, historyScore, dataQualityScore, leagueReliability, marketQualityScore
function computeConfidence(components) {
  const {
    sampleScore = 0,
    historyScore = 0,
    dataQualityScore = 0,
    leagueReliability = 0,
    marketQualityScore = 0
  } = components;
  const values = [sampleScore, historyScore, dataQualityScore, leagueReliability, marketQualityScore]
    .map(v => Math.max(0, Math.min(1, v)));
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function shrinkProbability(modelProbability, marketProbability, confidence, config) {
  if (modelProbability === null || modelProbability === undefined || !(modelProbability >= 0) || !(modelProbability <= 1)) {
    return { pFinal: null, wModel: null, wMarket: null, error: 'MODEL_PROBABILITY_INVALID' };
  }
  if (marketProbability === null || marketProbability === undefined || !(marketProbability >= 0) || !(marketProbability <= 1)) {
    return { pFinal: null, wModel: null, wMarket: null, error: 'MARKET_PROBABILITY_INVALID' };
  }
  const { minModelWeight, maxModelWeight } = config.calibration;
  const clampedConfidence = Math.max(0, Math.min(1, confidence));
  const wModel = minModelWeight + (maxModelWeight - minModelWeight) * clampedConfidence;
  const wMarket = 1 - wModel;
  const pFinal = wModel * modelProbability + wMarket * marketProbability;
  return { pFinal, wModel, wMarket, error: null };
}

if (typeof module !== 'undefined') {
  module.exports = { computeConfidence, shrinkProbability };
}
