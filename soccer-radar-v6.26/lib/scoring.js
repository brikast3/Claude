// SOCCER RADAR v6.26 · MarketScore (0-100).
// Weighted components (spec §13) plus explicit, separately recorded penalties.
// Every component and penalty is returned so it can be persisted verbatim into
// sr_v626_market_candidates -- nothing is folded away before it hits the DB.

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// input:
//   confidence            0..1   (from calibration.computeConfidence)
//   historyScore          0..100
//   dataQualityScore      0..100
//   edgePp                fraction, pFinal - marketProbability (signed)
//   homeSampleN, awaySampleN, targetSampleN
//   calibratedEv          fraction
//   leagueReliabilityScore 0..100
//   priceMovePct          fraction, |odd move| since first seen this run (0 = stable)
function computeMarketScore(input, config) {
  const w = config.score.weights;
  const {
    confidence,
    historyScore,
    dataQualityScore,
    edgePp,
    homeSampleN,
    awaySampleN,
    targetSampleN,
    calibratedEv,
    leagueReliabilityScore,
    priceMovePct = 0
  } = input;

  const probabilityConfidenceComponent = clamp(confidence * 100, 0, 100);
  const historyConsistencyComponent = clamp(historyScore, 0, 100);
  const dataQualityComponent = clamp(dataQualityScore, 0, 100);
  const marketAgreementComponent = clamp(100 * (1 - Math.min(1, Math.abs(edgePp) / 0.10)), 0, 100);
  const relevantSample = Math.min(homeSampleN, awaySampleN);
  const homeAwayRelevanceComponent = clamp(100 * Math.min(1, relevantSample / targetSampleN), 0, 100);
  const idealEv = 0.06;
  const priceValueQualityComponent = clamp(100 * (1 - Math.abs(calibratedEv - idealEv) / 0.15), 0, 100);
  const leagueReliabilityComponent = clamp(leagueReliabilityScore, 0, 100);

  const weightedSum =
    w.probabilityConfidence * probabilityConfidenceComponent +
    w.historyConsistency * historyConsistencyComponent +
    w.dataQuality * dataQualityComponent +
    w.marketAgreement * marketAgreementComponent +
    w.homeAwayRelevance * homeAwayRelevanceComponent +
    w.priceValueQuality * priceValueQualityComponent +
    w.leagueReliability * leagueReliabilityComponent;

  // ---- penalties ----------------------------------------------------------
  const sc = config.score;
  let disagreementPenalty = 0;
  if (Math.abs(edgePp) > sc.disagreementPenaltyThresholdPp) {
    const over = (Math.abs(edgePp) - sc.disagreementPenaltyThresholdPp) / sc.disagreementPenaltyThresholdPp;
    disagreementPenalty = clamp(over * sc.disagreementPenaltyMax, 0, sc.disagreementPenaltyMax);
  }

  let lowSamplePenalty = 0;
  const avgSample = (homeSampleN + awaySampleN) / 2;
  if (avgSample < targetSampleN * 0.5) {
    const deficit = 1 - avgSample / (targetSampleN * 0.5);
    lowSamplePenalty = clamp(deficit * sc.lowSamplePenaltyMax, 0, sc.lowSamplePenaltyMax);
  }

  let unstablePricePenalty = 0;
  if (priceMovePct > config.gate.maxPriceDeteriorationPct) {
    const over = (priceMovePct - config.gate.maxPriceDeteriorationPct) / config.gate.maxPriceDeteriorationPct;
    unstablePricePenalty = clamp(over * sc.unstablePricePenaltyMax, 0, sc.unstablePricePenaltyMax);
  }

  let poorHomeAwayPenalty = 0;
  if (homeAwayRelevanceComponent < 50) {
    poorHomeAwayPenalty = clamp((1 - homeAwayRelevanceComponent / 50) * sc.poorHomeAwayPenaltyMax, 0, sc.poorHomeAwayPenaltyMax);
  }

  let weakLeaguePenalty = 0;
  if (leagueReliabilityComponent < 50) {
    weakLeaguePenalty = clamp((1 - leagueReliabilityComponent / 50) * sc.weakLeaguePenaltyMax, 0, sc.weakLeaguePenaltyMax);
  }

  let poorDataQualityPenalty = 0;
  if (dataQualityComponent < config.gate.minDataQuality) {
    poorDataQualityPenalty = clamp((1 - dataQualityComponent / config.gate.minDataQuality) * sc.poorDataQualityPenaltyMax, 0, sc.poorDataQualityPenaltyMax);
  }

  let overconfidencePenalty = 0;
  if (calibratedEv > config.ev.overconfidencePenaltyThreshold) {
    overconfidencePenalty = config.ev.overconfidencePenaltyPoints;
  }

  const totalPenalty = disagreementPenalty + lowSamplePenalty + unstablePricePenalty +
    poorHomeAwayPenalty + weakLeaguePenalty + poorDataQualityPenalty + overconfidencePenalty;

  const marketScore = clamp(Math.round((weightedSum - totalPenalty) * 100) / 100, 0, 100);

  return {
    marketScore,
    components: {
      scoreProbabilityComponent: round2(probabilityConfidenceComponent),
      scoreHistoryComponent: round2(historyConsistencyComponent),
      scoreDataQualityComponent: round2(dataQualityComponent),
      scoreMarketComponent: round2(marketAgreementComponent),
      scoreHomeAwayComponent: round2(homeAwayRelevanceComponent),
      scorePriceComponent: round2(priceValueQualityComponent),
      scoreLeagueComponent: round2(leagueReliabilityComponent)
    },
    penalties: {
      disagreementPenalty: round2(disagreementPenalty),
      lowSamplePenalty: round2(lowSamplePenalty),
      unstablePricePenalty: round2(unstablePricePenalty),
      poorHomeAwayPenalty: round2(poorHomeAwayPenalty),
      weakLeaguePenalty: round2(weakLeaguePenalty),
      poorDataQualityPenalty: round2(poorDataQualityPenalty),
      overconfidencePenalty: round2(overconfidencePenalty)
    },
    overconfidencePenaltyApplied: overconfidencePenalty > 0
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

if (typeof module !== 'undefined') {
  module.exports = { computeMarketScore };
}
