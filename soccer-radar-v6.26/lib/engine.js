// SOCCER RADAR v6.26 · Selector engine.
// Orchestrates FixtureProfile -> Goal Model -> all 49 market candidates ->
// de-vig -> calibration -> MarketScore -> own-candidate gate -> best-market
// selection, for exactly one fixture. Every candidate gets a terminal state.

if (typeof require !== 'undefined' && typeof buildFixtureProfile === 'undefined') {
  var { buildFixtureProfile } = require('./fixtureProfile');
  var { buildScoreMatrix, outcomeProbabilities, pushNormalizedProbability, moneylineProbabilities, bttsProbabilities, doubleChanceProbabilities, expectedTotalGoals } = require('./math');
  var { devigTwoWay, devigThreeWay, impliedProbability } = require('./devig');
  var { computeConfidence, shrinkProbability } = require('./calibration');
  var { computeMarketScore } = require('./scoring');
  var { evaluateCandidateGate } = require('./gate');
  var { selectBestMarketPerFixture } = require('./selection');
  var { buildMarketUniverse } = require('./marketUniverse');
  var { lookupPrice } = require('./priceLookup');
}

const ZERO_COMPONENTS = {
  scoreProbabilityComponent: 0, scoreHistoryComponent: 0, scoreDataQualityComponent: 0,
  scoreMarketComponent: 0, scoreHomeAwayComponent: 0, scorePriceComponent: 0, scoreLeagueComponent: 0
};
const ZERO_PENALTIES = {
  disagreementPenalty: 0, lowSamplePenalty: 0, unstablePricePenalty: 0,
  poorHomeAwayPenalty: 0, weakLeaguePenalty: 0, poorDataQualityPenalty: 0, overconfidencePenalty: 0
};

function buildCandidate(market, ctx, config) {
  const { bet365, snapshotAt, snapshotAgeMinutes, fixtureProfile, grid, moneyline, btts, doubleChance, leagueReliabilityScore } = ctx;
  const price = lookupPrice(bet365, market);
  const publicEligible = config.markets.publicEnabledFamilies.includes(market.marketFamily);

  const common = {
    marketFamily: market.marketFamily,
    marketKey: market.marketKey,
    side: market.side,
    line: market.line,
    marketSnapshotAt: snapshotAt,
    snapshotAgeMinutes,
    hasExactMarket: price.hasExactMarket,
    hasExactLine: price.hasExactLine,
    publicEligible,
    dataQualityScore: fixtureProfile.dataQualityScore,
    historyScore: fixtureProfile.historyScore,
    homeSampleN: fixtureProfile.home.sampleN,
    awaySampleN: fixtureProfile.away.sampleN,
    insufficientHistory: fixtureProfile.insufficientHistory,
    leagueReliabilityScore: leagueReliabilityScore ?? 50
  };

  if (!price.hasExactLine) {
    return {
      ...common,
      bet365Odd: null, oppositeOdd: null, odd: null,
      rawImpliedProbability: null, devigMarketProbability: null,
      modelProbabilityRaw: null, modelProbabilityCalibrated: null,
      rawEv: null, calibratedEv: null, rawEdgePp: null, calibratedEdgePp: null,
      marketScore: 0, ...ZERO_COMPONENTS, penalties: ZERO_PENALTIES, overconfidencePenaltyApplied: false,
      modelProbabilityValid: false, marketProbabilityValid: false
    };
  }

  const odd = price.odd;
  const rawImplied = impliedProbability(odd);
  let devigProb = null;
  if (market.marketFamily === 'MONEYLINE' && price.otherOdds && price.otherOdds.length === 2) {
    const dv = devigThreeWay(odd, price.otherOdds[0], price.otherOdds[1]);
    devigProb = dv.devig;
  } else if (price.oppositeOdd && price.oppositeOdd > 1) {
    const dv = devigTwoWay(odd, price.oppositeOdd);
    devigProb = dv.devig;
  }
  const marketProbability = devigProb !== null ? devigProb : rawImplied;
  const marketProbabilityValid = marketProbability !== null && marketProbability >= 0 && marketProbability <= 1;

  let modelProbabilityRaw = null;
  if (grid) {
    if (market.marketFamily === 'GOALS') {
      modelProbabilityRaw = pushNormalizedProbability(outcomeProbabilities(grid, 'TOTAL', market.side, market.line));
    } else if (market.marketFamily === 'ASIAN_HANDICAP') {
      modelProbabilityRaw = pushNormalizedProbability(outcomeProbabilities(grid, 'HANDICAP', market.side, market.line));
    } else if (market.marketFamily === 'BTTS') {
      modelProbabilityRaw = market.side === 'YES' ? btts.BTTS_YES : btts.BTTS_NO;
    } else if (market.marketFamily === 'MONEYLINE') {
      modelProbabilityRaw = moneyline[market.side];
    } else if (market.marketFamily === 'DOUBLE_CHANCE') {
      modelProbabilityRaw = doubleChance[market.side];
    }
  }
  const modelProbabilityValid = !fixtureProfile.insufficientHistory &&
    modelProbabilityRaw !== null && modelProbabilityRaw !== undefined &&
    modelProbabilityRaw >= 0 && modelProbabilityRaw <= 1;

  let modelProbabilityCalibrated = null, calibratedEv = null, calibratedEdgePp = null, rawEv = null, rawEdgePp = null;
  let confidence = 0;
  if (modelProbabilityValid && marketProbabilityValid) {
    const targetSampleN = config.quality.targetSampleN;
    confidence = computeConfidence({
      sampleScore: Math.min(1, Math.min(fixtureProfile.home.sampleN, fixtureProfile.away.sampleN) / targetSampleN),
      historyScore: fixtureProfile.historyScore / 100,
      dataQualityScore: fixtureProfile.dataQualityScore / 100,
      leagueReliability: (leagueReliabilityScore ?? 50) / 100,
      marketQualityScore: devigProb !== null ? 1 : 0.6
    });
    const shrink = shrinkProbability(modelProbabilityRaw, marketProbability, confidence, config);
    modelProbabilityCalibrated = shrink.pFinal;
    rawEv = modelProbabilityRaw * odd - 1;
    rawEdgePp = modelProbabilityRaw - marketProbability;
    if (modelProbabilityCalibrated !== null) {
      calibratedEv = modelProbabilityCalibrated * odd - 1;
      calibratedEdgePp = modelProbabilityCalibrated - marketProbability;
    }
  }

  let scoreResult;
  if (modelProbabilityCalibrated !== null) {
    scoreResult = computeMarketScore({
      confidence,
      historyScore: fixtureProfile.historyScore,
      dataQualityScore: fixtureProfile.dataQualityScore,
      edgePp: calibratedEdgePp,
      homeSampleN: fixtureProfile.home.sampleN,
      awaySampleN: fixtureProfile.away.sampleN,
      targetSampleN: config.quality.targetSampleN,
      calibratedEv,
      leagueReliabilityScore: leagueReliabilityScore ?? 50,
      priceMovePct: 0
    }, config);
  } else {
    scoreResult = { marketScore: 0, components: ZERO_COMPONENTS, penalties: ZERO_PENALTIES, overconfidencePenaltyApplied: false };
  }

  return {
    ...common,
    bet365Odd: odd, odd, oppositeOdd: price.oppositeOdd ?? null,
    rawImpliedProbability: rawImplied, devigMarketProbability: devigProb,
    modelProbabilityRaw, modelProbabilityCalibrated,
    rawEv, calibratedEv, rawEdgePp, calibratedEdgePp,
    marketScore: scoreResult.marketScore,
    ...scoreResult.components,
    penalties: scoreResult.penalties,
    overconfidencePenaltyApplied: scoreResult.overconfidencePenaltyApplied,
    modelProbabilityValid, marketProbabilityValid
  };
}

// fixtureInput: { homeMatches, awayMatches, leagueContext, leagueReliabilityScore,
//                 bet365, snapshotAt, nowMs }
function evaluateFixture(fixtureInput, config) {
  const fixtureProfile = buildFixtureProfile(
    { homeMatches: fixtureInput.homeMatches, awayMatches: fixtureInput.awayMatches, leagueContext: fixtureInput.leagueContext },
    config
  );

  let grid = null, moneyline = null, btts = null, doubleChance = null;
  if (!fixtureProfile.insufficientHistory) {
    grid = buildScoreMatrix(fixtureProfile.lambdaHome, fixtureProfile.lambdaAway, config.model.dixonColesRho, config.model.maxGoals);
    moneyline = moneylineProbabilities(grid);
    btts = bttsProbabilities(grid);
    doubleChance = doubleChanceProbabilities(moneyline);
  }

  const snapshotAgeMinutes = (fixtureInput.nowMs - Date.parse(fixtureInput.snapshotAt)) / 60000;
  const ctx = {
    bet365: fixtureInput.bet365,
    snapshotAt: fixtureInput.snapshotAt,
    snapshotAgeMinutes,
    fixtureProfile, grid, moneyline, btts, doubleChance,
    leagueReliabilityScore: fixtureInput.leagueReliabilityScore
  };

  const universe = buildMarketUniverse(config, fixtureInput.bet365);
  let candidates = universe.map(market => buildCandidate(market, ctx, config));

  // Own-candidate gate: applied to every public-enabled-family candidate (AH is
  // excluded -- it is never a public gate candidate while disabled).
  for (const c of candidates) {
    if (!c.publicEligible) { c.rejectionReason = config.rejectionReasons.MARKET_FAMILY_RESEARCH_ONLY; continue; }
    const verdict = evaluateCandidateGate(c, config);
    c.rejectionReason = verdict.passed ? null : verdict.reasonCode;
  }

  const selection = selectBestMarketPerFixture(candidates, config);

  return {
    fixtureProfile,
    lambdaHome: fixtureProfile.lambdaHome,
    lambdaAway: fixtureProfile.lambdaAway,
    expectedTotalGoals: fixtureProfile.lambdaHome !== null ? expectedTotalGoals(fixtureProfile.lambdaHome, fixtureProfile.lambdaAway) : null,
    scoreMatrix: grid,
    candidates: selection.candidates,
    bestCandidate: selection.candidates.find(c => c.selectedAsBestMarket === true) || null
  };
}

if (typeof module !== 'undefined') {
  module.exports = { evaluateFixture, buildCandidate };
}
