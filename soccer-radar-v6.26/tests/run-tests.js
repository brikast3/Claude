// SOCCER RADAR v6.26 · Deterministic test suite (spec §36, 100+ cases).
// Pure unit tests against the same lib/ modules bundled into the n8n workflow.
'use strict';
const assert = require('assert');
const { CONFIG } = require('../lib/config');
const math = require('../lib/math');
const fixtureProfileLib = require('../lib/fixtureProfile');
const devig = require('../lib/devig');
const calibration = require('../lib/calibration');
const scoring = require('../lib/scoring');
const gate = require('../lib/gate');
const selection = require('../lib/selection');
const settlement = require('../lib/settlement');
const rateLimiter = require('../lib/rateLimiter');
const telegram = require('../lib/telegram');
const diagnostics = require('../lib/diagnostics');
const marketUniverse = require('../lib/marketUniverse');
const priceLookup = require('../lib/priceLookup');
const engine = require('../lib/engine');
const schedule = require('../lib/schedule');
const bet365Parser = require('../lib/bet365Parser');
const executionRecheck = require('../lib/executionRecheck');

let passCount = 0, failCount = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passCount++;
  } catch (e) {
    failCount++;
    failures.push({ name, error: e && e.stack ? e.stack : String(e) });
  }
}
async function atest(name, fn) {
  try {
    await fn();
    passCount++;
  } catch (e) {
    failCount++;
    failures.push({ name, error: e && e.stack ? e.stack : String(e) });
  }
}

const R = CONFIG.rejectionReasons;

// ---------------------------------------------------------------------------
// SECTION 1 · GOALS TOTAL SETTLEMENT (all 8 lines, OVER + UNDER)
// ---------------------------------------------------------------------------
const ODD = 1.90;
function settleGoals(side, line, total) {
  const h = Math.ceil(total / 2), a = total - h; // any home/away split with this total works
  return settlement.settleCandidate({ marketFamily: 'GOALS', side, line, odd: ODD }, { ftHome: h, ftAway: a, isVoid: false }, CONFIG);
}

test('Over 1.5, total=2 -> WIN', () => assert.strictEqual(settleGoals('OVER', 1.5, 2).status, 'WIN'));
test('Over 1.5, total=1 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 1.5, 1).status, 'LOSS'));
test('Under 1.5, total=1 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 1.5, 1).status, 'WIN'));
test('Under 1.5, total=2 -> LOSS', () => assert.strictEqual(settleGoals('UNDER', 1.5, 2).status, 'LOSS'));

test('Over 2.0 Asian, total=3 -> WIN', () => assert.strictEqual(settleGoals('OVER', 2.0, 3).status, 'WIN'));
test('Over 2.0 Asian, total=2 -> PUSH', () => assert.strictEqual(settleGoals('OVER', 2.0, 2).status, 'PUSH'));
test('Over 2.0 Asian, total=1 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 2.0, 1).status, 'LOSS'));
test('Under 2.0 Asian, total=2 -> PUSH', () => assert.strictEqual(settleGoals('UNDER', 2.0, 2).status, 'PUSH'));
test('Under 2.0 Asian, total=1 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 2.0, 1).status, 'WIN'));
test('Under 2.0 Asian, total=3 -> LOSS', () => assert.strictEqual(settleGoals('UNDER', 2.0, 3).status, 'LOSS'));

test('Over 2.25 Asian, total=3 -> WIN (both legs win)', () => assert.strictEqual(settleGoals('OVER', 2.25, 3).status, 'WIN'));
test('Over 2.25 Asian, total=2 -> HALF_LOSS (push+loss)', () => assert.strictEqual(settleGoals('OVER', 2.25, 2).status, 'HALF_LOSS'));
test('Over 2.25 Asian, total=1 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 2.25, 1).status, 'LOSS'));
test('Under 2.25 Asian, total=2 -> HALF_WIN (push+win)', () => assert.strictEqual(settleGoals('UNDER', 2.25, 2).status, 'HALF_WIN'));
test('Under 2.25 Asian, total=1 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 2.25, 1).status, 'WIN'));
test('Under 2.25 Asian, total=3 -> LOSS', () => assert.strictEqual(settleGoals('UNDER', 2.25, 3).status, 'LOSS'));

test('Over 2.5, total=3 -> WIN', () => assert.strictEqual(settleGoals('OVER', 2.5, 3).status, 'WIN'));
test('Over 2.5, total=2 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 2.5, 2).status, 'LOSS'));
test('Under 2.5, total=2 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 2.5, 2).status, 'WIN'));
test('Under 2.5, total=3 -> LOSS', () => assert.strictEqual(settleGoals('UNDER', 2.5, 3).status, 'LOSS'));

test('Over 2.75 Asian, total=4 -> WIN', () => assert.strictEqual(settleGoals('OVER', 2.75, 4).status, 'WIN'));
test('Over 2.75 Asian, total=3 -> HALF_WIN (win+push), example from spec', () => assert.strictEqual(settleGoals('OVER', 2.75, 3).status, 'HALF_WIN'));
test('Over 2.75 Asian, total=2 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 2.75, 2).status, 'LOSS'));
test('Under 2.75 Asian, total=3 -> HALF_LOSS (loss+push)', () => assert.strictEqual(settleGoals('UNDER', 2.75, 3).status, 'HALF_LOSS'));
test('Under 2.75 Asian, total=2 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 2.75, 2).status, 'WIN'));
test('Over 2.75 Asian is NOT treated as plain Over 2.5 (differs at total=3)', () => {
  assert.notStrictEqual(settleGoals('OVER', 2.75, 3).status, settleGoals('OVER', 2.5, 3).status);
});

test('Over 3.0 Asian, total=4 -> WIN', () => assert.strictEqual(settleGoals('OVER', 3.0, 4).status, 'WIN'));
test('Over 3.0 Asian, total=3 -> PUSH', () => assert.strictEqual(settleGoals('OVER', 3.0, 3).status, 'PUSH'));
test('Over 3.0 Asian, total=2 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 3.0, 2).status, 'LOSS'));
test('Under 3.0 Asian, total=3 -> PUSH', () => assert.strictEqual(settleGoals('UNDER', 3.0, 3).status, 'PUSH'));

test('Over 3.25 Asian, total=5 -> WIN', () => assert.strictEqual(settleGoals('OVER', 3.25, 5).status, 'WIN'));
test('Over 3.25 Asian, total=3 -> HALF_LOSS', () => assert.strictEqual(settleGoals('OVER', 3.25, 3).status, 'HALF_LOSS'));
test('Under 3.25 Asian, total=3 -> HALF_WIN', () => assert.strictEqual(settleGoals('UNDER', 3.25, 3).status, 'HALF_WIN'));
test('Under 3.25 Asian, total=2 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 3.25, 2).status, 'WIN'));

test('Over 3.5, total=4 -> WIN', () => assert.strictEqual(settleGoals('OVER', 3.5, 4).status, 'WIN'));
test('Over 3.5, total=3 -> LOSS', () => assert.strictEqual(settleGoals('OVER', 3.5, 3).status, 'LOSS'));
test('Under 3.5, total=3 -> WIN', () => assert.strictEqual(settleGoals('UNDER', 3.5, 3).status, 'WIN'));
test('Under 3.5, total=4 -> LOSS', () => assert.strictEqual(settleGoals('UNDER', 3.5, 4).status, 'LOSS'));

// ---------------------------------------------------------------------------
// SECTION 2 · BTTS / MONEYLINE / DOUBLE CHANCE SETTLEMENT
// ---------------------------------------------------------------------------
function settleOther(marketFamily, side, ftHome, ftAway) {
  return settlement.settleCandidate({ marketFamily, side, line: null, odd: ODD }, { ftHome, ftAway, isVoid: false }, CONFIG);
}
test('BTTS Yes, 2:1 -> WIN', () => assert.strictEqual(settleOther('BTTS', 'YES', 2, 1).status, 'WIN'));
test('BTTS Yes, 2:0 -> LOSS', () => assert.strictEqual(settleOther('BTTS', 'YES', 2, 0).status, 'LOSS'));
test('BTTS No, 2:0 -> WIN', () => assert.strictEqual(settleOther('BTTS', 'NO', 2, 0).status, 'WIN'));
test('BTTS No, 1:1 -> LOSS', () => assert.strictEqual(settleOther('BTTS', 'NO', 1, 1).status, 'LOSS'));
test('BTTS Yes, 0:0 -> LOSS', () => assert.strictEqual(settleOther('BTTS', 'YES', 0, 0).status, 'LOSS'));
test('BTTS No, 0:0 -> WIN', () => assert.strictEqual(settleOther('BTTS', 'NO', 0, 0).status, 'WIN'));

test('Home Win, 2:1 -> WIN', () => assert.strictEqual(settleOther('MONEYLINE', 'HOME_WIN', 2, 1).status, 'WIN'));
test('Home Win, 1:1 -> LOSS', () => assert.strictEqual(settleOther('MONEYLINE', 'HOME_WIN', 1, 1).status, 'LOSS'));
test('Draw, 1:1 -> WIN', () => assert.strictEqual(settleOther('MONEYLINE', 'DRAW', 1, 1).status, 'WIN'));
test('Draw, 2:1 -> LOSS', () => assert.strictEqual(settleOther('MONEYLINE', 'DRAW', 2, 1).status, 'LOSS'));
test('Away Win, 0:1 -> WIN', () => assert.strictEqual(settleOther('MONEYLINE', 'AWAY_WIN', 0, 1).status, 'WIN'));
test('Away Win, 1:1 -> LOSS', () => assert.strictEqual(settleOther('MONEYLINE', 'AWAY_WIN', 1, 1).status, 'LOSS'));

test('1X, home win 2:1 -> WIN', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'ONE_X', 2, 1).status, 'WIN'));
test('1X, draw 1:1 -> WIN', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'ONE_X', 1, 1).status, 'WIN'));
test('1X, away win 0:1 -> LOSS', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'ONE_X', 0, 1).status, 'LOSS'));
test('X2, draw 1:1 -> WIN', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'X_TWO', 1, 1).status, 'WIN'));
test('X2, away win 0:1 -> WIN', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'X_TWO', 0, 1).status, 'WIN'));
test('X2, home win 2:0 -> LOSS', () => assert.strictEqual(settleOther('DOUBLE_CHANCE', 'X_TWO', 2, 0).status, 'LOSS'));

// ---------------------------------------------------------------------------
// SECTION 3 · ASIAN HANDICAP SETTLEMENT
// ---------------------------------------------------------------------------
function settleAh(side, line, ftHome, ftAway) {
  return settlement.settleCandidate({ marketFamily: 'ASIAN_HANDICAP', side, line, odd: ODD }, { ftHome, ftAway, isVoid: false }, CONFIG);
}
test('AH Home 0, home wins 2:1 -> WIN', () => assert.strictEqual(settleAh('HOME', 0, 2, 1).status, 'WIN'));
test('AH Home 0, draw 1:1 -> PUSH', () => assert.strictEqual(settleAh('HOME', 0, 1, 1).status, 'PUSH'));
test('AH Home 0, away wins 1:2 -> LOSS', () => assert.strictEqual(settleAh('HOME', 0, 1, 2).status, 'LOSS'));

test('AH Home -0.5, home wins by 1 -> WIN', () => assert.strictEqual(settleAh('HOME', -0.5, 2, 1).status, 'WIN'));
test('AH Home -0.5, draw -> LOSS', () => assert.strictEqual(settleAh('HOME', -0.5, 1, 1).status, 'LOSS'));

test('AH Home -0.25, draw -> HALF_LOSS', () => assert.strictEqual(settleAh('HOME', -0.25, 1, 1).status, 'HALF_LOSS'));
test('AH Home -0.25, home wins by 1 -> WIN', () => assert.strictEqual(settleAh('HOME', -0.25, 2, 1).status, 'WIN'));
test('AH Home -0.25, away wins -> LOSS', () => assert.strictEqual(settleAh('HOME', -0.25, 1, 2).status, 'LOSS'));

test('AH Home -0.75, home wins by 1 -> HALF_WIN', () => assert.strictEqual(settleAh('HOME', -0.75, 2, 1).status, 'HALF_WIN'));
test('AH Home -0.75, home wins by 2 -> WIN', () => assert.strictEqual(settleAh('HOME', -0.75, 3, 1).status, 'WIN'));
test('AH Home -0.75, draw -> LOSS', () => assert.strictEqual(settleAh('HOME', -0.75, 1, 1).status, 'LOSS'));

test('AH Home -1.0, home wins by 1 -> PUSH', () => assert.strictEqual(settleAh('HOME', -1.0, 2, 1).status, 'PUSH'));
test('AH Home -1.0, home wins by 2 -> WIN', () => assert.strictEqual(settleAh('HOME', -1.0, 3, 1).status, 'WIN'));
test('AH Home -1.0, draw -> LOSS', () => assert.strictEqual(settleAh('HOME', -1.0, 1, 1).status, 'LOSS'));

test('AH Home -1.25, home wins by 1 -> HALF_LOSS', () => assert.strictEqual(settleAh('HOME', -1.25, 2, 1).status, 'HALF_LOSS'));
test('AH Home -1.25, home wins by 2 -> WIN', () => assert.strictEqual(settleAh('HOME', -1.25, 3, 1).status, 'WIN'));

test('AH Home -1.5, home wins by 2 -> WIN', () => assert.strictEqual(settleAh('HOME', -1.5, 3, 1).status, 'WIN'));
test('AH Home -1.5, home wins by 1 -> LOSS', () => assert.strictEqual(settleAh('HOME', -1.5, 2, 1).status, 'LOSS'));

test('AH Away mirrors Home: Away +0.75 half-loses when Home -0.75 half-wins', () => {
  assert.strictEqual(settleAh('AWAY', 0.75, 2, 1).status, 'HALF_LOSS');
});
test('AH Away +1.5, home wins by 1 -> WIN (away covers)', () => assert.strictEqual(settleAh('AWAY', 1.5, 2, 1).status, 'WIN'));
test('AH Away -0.5, away wins outright -> WIN', () => assert.strictEqual(settleAh('AWAY', -0.5, 0, 1).status, 'WIN'));

// ---------------------------------------------------------------------------
// SECTION 4 · VOID
// ---------------------------------------------------------------------------
test('VOID fixture -> GOALS market VOID, factor 1', () => {
  const r = settlement.settleCandidate({ marketFamily: 'GOALS', side: 'OVER', line: 2.5, odd: ODD }, { isVoid: true }, CONFIG);
  assert.strictEqual(r.status, 'VOID');
  assert.strictEqual(r.factor, 1);
});
test('VOID fixture -> Asian Handicap VOID', () => {
  const r = settlement.settleCandidate({ marketFamily: 'ASIAN_HANDICAP', side: 'HOME', line: -0.5, odd: ODD }, { isVoid: true }, CONFIG);
  assert.strictEqual(r.status, 'VOID');
});
test('Missing FT score with no void flag -> treated as VOID (fail-closed, never fabricated)', () => {
  const r = settlement.settleCandidate({ marketFamily: 'GOALS', side: 'OVER', line: 2.5, odd: ODD }, { ftHome: null, ftAway: null, isVoid: false }, CONFIG);
  assert.strictEqual(r.status, 'VOID');
});

// ---------------------------------------------------------------------------
// SECTION 5 · PROFIT CALCULATION
// ---------------------------------------------------------------------------
test('Profit for WIN at odd 1.95 on 100 EUR stake', () => {
  assert.strictEqual(settlement.computeProfitEur(100, 1.95), 95);
});
test('Profit for LOSS', () => assert.strictEqual(settlement.computeProfitEur(100, 0), -100));
test('Profit for PUSH is zero', () => assert.strictEqual(settlement.computeProfitEur(100, 1), 0));
test('Profit for HALF_WIN at odd 1.90 is half of full win', () => {
  const factor = (1.90 + 1) / 2;
  assert.strictEqual(settlement.computeProfitEur(100, factor), 45);
});
test('Profit for HALF_LOSS is -50', () => assert.strictEqual(settlement.computeProfitEur(100, 0.5), -50));

// ---------------------------------------------------------------------------
// SECTION 6 · GOAL MODEL / DIXON-COLES MATH
// ---------------------------------------------------------------------------
test('Score matrix sums to 1', () => {
  const grid = math.buildScoreMatrix(1.4, 1.1, CONFIG.model.dixonColesRho, CONFIG.model.maxGoals);
  let sum = 0;
  for (const row of grid) for (const p of row) sum += p;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
test('Score matrix is 8x8 for maxGoals=7 (0..7)', () => {
  const grid = math.buildScoreMatrix(1.4, 1.1, CONFIG.model.dixonColesRho, 7);
  assert.strictEqual(grid.length, 8);
  assert.strictEqual(grid[0].length, 8);
});
test('Moneyline probabilities sum to 1', () => {
  const grid = math.buildScoreMatrix(1.6, 1.2, CONFIG.model.dixonColesRho, 7);
  const ml = math.moneylineProbabilities(grid);
  assert.ok(Math.abs(ml.HOME_WIN + ml.DRAW + ml.AWAY_WIN - 1) < 1e-9);
});
test('BTTS yes + no = 1', () => {
  const grid = math.buildScoreMatrix(1.6, 1.2, CONFIG.model.dixonColesRho, 7);
  const b = math.bttsProbabilities(grid);
  assert.ok(Math.abs(b.BTTS_YES + b.BTTS_NO - 1) < 1e-9);
});
test('Double chance ONE_X = home+draw', () => {
  const grid = math.buildScoreMatrix(1.6, 1.2, CONFIG.model.dixonColesRho, 7);
  const ml = math.moneylineProbabilities(grid);
  const dc = math.doubleChanceProbabilities(ml);
  assert.ok(Math.abs(dc.ONE_X - (ml.HOME_WIN + ml.DRAW)) < 1e-9);
});
test('Stronger home lambda increases HOME_WIN probability', () => {
  const gridStrong = math.buildScoreMatrix(2.2, 0.9, CONFIG.model.dixonColesRho, 7);
  const gridWeak = math.buildScoreMatrix(1.0, 1.0, CONFIG.model.dixonColesRho, 7);
  const mlStrong = math.moneylineProbabilities(gridStrong);
  const mlWeak = math.moneylineProbabilities(gridWeak);
  assert.ok(mlStrong.HOME_WIN > mlWeak.HOME_WIN);
});
test('expectedTotalGoals = lambdaHome + lambdaAway', () => {
  assert.strictEqual(math.expectedTotalGoals(1.4, 1.1), 2.5);
});
test('Dixon-Coles tau(0,0) boosts the 0-0 probability for the configured negative rho', () => {
  assert.ok(math.dcTau(0, 0, 1.2, 1.0, -0.08) > 1);
});
test('Dixon-Coles tau(1,0)/tau(0,1) suppress the single-goal split for the configured negative rho', () => {
  assert.ok(math.dcTau(1, 0, 1.2, 1.0, -0.08) < 1);
  assert.ok(math.dcTau(0, 1, 1.2, 1.0, -0.08) < 1);
});
test('Dixon-Coles tau is 1 outside the 2x2 low-score correction zone', () => {
  assert.strictEqual(math.dcTau(2, 2, 1.2, 1.0, -0.08), 1);
});
test('buildScoreMatrix throws MODEL_PROBABILITY_INVALID on non-positive lambda', () => {
  assert.throws(() => math.buildScoreMatrix(0, 1.0, -0.08, 7), /MODEL_PROBABILITY_INVALID/);
});
test('splitLine on whole number returns single line', () => assert.deepStrictEqual(math.splitLine(2.0), [2.0]));
test('splitLine on half line returns single line', () => assert.deepStrictEqual(math.splitLine(2.5), [2.5]));
test('splitLine on .25 line splits correctly', () => assert.deepStrictEqual(math.splitLine(2.25), [2.0, 2.5]));
test('splitLine on .75 line splits correctly', () => assert.deepStrictEqual(math.splitLine(2.75), [2.5, 3.0]));
test('splitLine on negative .25 handicap splits correctly', () => assert.deepStrictEqual(math.splitLine(-0.25), [-0.5, 0]));
test('splitLine on negative .75 handicap splits correctly', () => assert.deepStrictEqual(math.splitLine(-1.25), [-1.5, -1.0]));

// ---------------------------------------------------------------------------
// SECTION 7 · FIXTURE PROFILE / RECENCY WEIGHTING
// ---------------------------------------------------------------------------
function matchesOf(goalsForList) {
  return goalsForList.map(gf => ({ goalsFor: gf, goalsAgainst: 1 }));
}
test('Recency weighting: last 5 matches dominate at 50%', () => {
  // last 5 all score 3, older 10 all score 0 -> weighted avg should be close to 3*0.5 alone dominating vs a flat average of ~1.0
  const recent = matchesOf([3, 3, 3, 3, 3]);
  const older = matchesOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const avg = fixtureProfileLib.weightedBucketAverage([...recent, ...older].map(m => m.goalsFor), 5, CONFIG.recency.weights);
  const flatAverage = 15 / 15; // = 1.0
  assert.ok(avg > flatAverage, `weighted avg ${avg} should exceed the flat average ${flatAverage}`);
});
test('A single very recent match cannot dominate the profile (min sample floor)', () => {
  const profile = fixtureProfileLib.buildSideProfile(matchesOf([5]), CONFIG);
  assert.strictEqual(profile.hasUsableHistory, false);
});
test('Sample below hard floor is flagged insufficient', () => {
  const profile = fixtureProfileLib.buildSideProfile(matchesOf([1, 2, 1]), CONFIG);
  assert.strictEqual(profile.hasUsableHistory, false);
});
test('Sample at/above hard floor is usable', () => {
  const profile = fixtureProfileLib.buildSideProfile(matchesOf([1, 2, 1, 0, 2]), CONFIG);
  assert.strictEqual(profile.hasUsableHistory, true);
});
test('dataQualityScore approaches 100 with a full target sample', () => {
  const profile = fixtureProfileLib.buildSideProfile(matchesOf(new Array(CONFIG.quality.targetSampleN).fill(1)), CONFIG);
  assert.strictEqual(profile.dataQualityScore, 100);
});
test('buildFixtureProfile flags insufficientHistory when either side lacks history', () => {
  const fp = fixtureProfileLib.buildFixtureProfile({
    homeMatches: matchesOf([1, 2, 1, 0, 2, 1, 1]),
    awayMatches: matchesOf([1, 1]),
    leagueContext: null
  }, CONFIG);
  assert.strictEqual(fp.insufficientHistory, true);
});
test('buildFixtureProfile computes distinct home/away lambdas, never blended', () => {
  const fp = fixtureProfileLib.buildFixtureProfile({
    homeMatches: matchesOf([2, 2, 2, 2, 2, 2, 2]),
    awayMatches: matchesOf([0, 0, 0, 0, 0, 0, 0]),
    leagueContext: null
  }, CONFIG);
  assert.ok(fp.lambdaHome > fp.lambdaAway);
});
test('League factor is neutral (1) without enough in-run league coverage', () => {
  const fp = fixtureProfileLib.buildFixtureProfile({
    homeMatches: matchesOf([1, 1, 1, 1, 1, 1, 1]),
    awayMatches: matchesOf([1, 1, 1, 1, 1, 1, 1]),
    leagueContext: { avgGoalsPerMatch: 4.0, fixturesObservedThisRun: 1 }
  }, CONFIG);
  assert.strictEqual(fp.leagueFactor, 1);
});

// ---------------------------------------------------------------------------
// SECTION 8 · DE-VIG
// ---------------------------------------------------------------------------
test('Two-way de-vig removes overround proportionally', () => {
  const d = devig.devigTwoWay(1.85, 2.00);
  assert.ok(d.margin > 0);
  assert.ok(d.devig < d.raw);
});
test('Two-way de-vig on a zero-margin (fair) market returns raw == devig', () => {
  const d = devig.devigTwoWay(2.0, 2.0);
  assert.ok(Math.abs(d.devig - 0.5) < 1e-9);
});
test('Three-way de-vig sums the three de-vigged probabilities to 1', () => {
  const h = devig.devigThreeWay(2.5, 3.3, 3.0);
  const d = devig.devigThreeWay(3.3, 2.5, 3.0);
  const a = devig.devigThreeWay(3.0, 2.5, 3.3);
  assert.ok(Math.abs(h.devig + d.devig + a.devig - 1) < 1e-6);
});
test('impliedProbability rejects odd <= 1', () => assert.strictEqual(devig.impliedProbability(1.0), null));

// ---------------------------------------------------------------------------
// SECTION 9 · CALIBRATION SHRINKAGE
// ---------------------------------------------------------------------------
test('Low confidence shrinks close to market probability', () => {
  const r = calibration.shrinkProbability(0.80, 0.50, 0.0, CONFIG);
  assert.ok(Math.abs(r.pFinal - 0.50) < Math.abs(r.pFinal - 0.80));
  assert.strictEqual(r.wModel, CONFIG.calibration.minModelWeight);
});
test('High confidence leans more (but never fully) toward model probability', () => {
  const r = calibration.shrinkProbability(0.80, 0.50, 1.0, CONFIG);
  assert.strictEqual(r.wModel, CONFIG.calibration.maxModelWeight);
  assert.ok(r.wModel < 1);
});
test('shrinkProbability never exceeds configured weight bounds', () => {
  const r = calibration.shrinkProbability(0.9, 0.1, 0.5, CONFIG);
  assert.ok(r.wModel >= CONFIG.calibration.minModelWeight && r.wModel <= CONFIG.calibration.maxModelWeight);
});
test('shrinkProbability fails closed on invalid model probability', () => {
  const r = calibration.shrinkProbability(null, 0.5, 0.5, CONFIG);
  assert.strictEqual(r.error, R.MODEL_PROBABILITY_INVALID);
});
test('shrinkProbability fails closed on invalid market probability', () => {
  const r = calibration.shrinkProbability(0.5, null, 0.5, CONFIG);
  assert.strictEqual(r.error, R.MARKET_PROBABILITY_INVALID);
});
test('computeConfidence averages all five components', () => {
  const c = calibration.computeConfidence({ sampleScore: 1, historyScore: 1, dataQualityScore: 1, leagueReliability: 1, marketQualityScore: 1 });
  assert.strictEqual(c, 1);
});
test('computeConfidence with all-zero components is zero', () => {
  const c = calibration.computeConfidence({ sampleScore: 0, historyScore: 0, dataQualityScore: 0, leagueReliability: 0, marketQualityScore: 0 });
  assert.strictEqual(c, 0);
});

// ---------------------------------------------------------------------------
// SECTION 10 · MARKET SCORE
// ---------------------------------------------------------------------------
function baseScoreInput(overrides) {
  return Object.assign({
    confidence: 0.8, historyScore: 85, dataQualityScore: 90, edgePp: 0.03,
    homeSampleN: 15, awaySampleN: 15, targetSampleN: 15, calibratedEv: 0.05,
    leagueReliabilityScore: 80, priceMovePct: 0
  }, overrides || {});
}
test('MarketScore is bounded 0..100', () => {
  const r = scoring.computeMarketScore(baseScoreInput(), CONFIG);
  assert.ok(r.marketScore >= 0 && r.marketScore <= 100);
});
test('High-quality inputs produce a MarketScore comfortably above the public gate', () => {
  const r = scoring.computeMarketScore(baseScoreInput(), CONFIG);
  assert.ok(r.marketScore >= CONFIG.gate.minMarketScore);
});
test('Low sample size drags MarketScore down via lowSamplePenalty', () => {
  const good = scoring.computeMarketScore(baseScoreInput(), CONFIG);
  const bad = scoring.computeMarketScore(baseScoreInput({ homeSampleN: 2, awaySampleN: 2 }), CONFIG);
  assert.ok(bad.marketScore < good.marketScore);
  assert.ok(bad.penalties.lowSamplePenalty > 0);
});
test('Weak league reliability is penalized', () => {
  const r = scoring.computeMarketScore(baseScoreInput({ leagueReliabilityScore: 10 }), CONFIG);
  assert.ok(r.penalties.weakLeaguePenalty > 0);
});
test('Extreme model/market disagreement is penalized', () => {
  const r = scoring.computeMarketScore(baseScoreInput({ edgePp: 0.30 }), CONFIG);
  assert.ok(r.penalties.disagreementPenalty > 0);
});
test('EV above the overconfidence threshold applies a flat penalty', () => {
  const r = scoring.computeMarketScore(baseScoreInput({ calibratedEv: 0.14 }), CONFIG);
  assert.strictEqual(r.overconfidencePenaltyApplied, true);
  assert.strictEqual(r.penalties.overconfidencePenalty, CONFIG.ev.overconfidencePenaltyPoints);
});
test('EV at exactly 3% does not trigger the overconfidence penalty', () => {
  const r = scoring.computeMarketScore(baseScoreInput({ calibratedEv: 0.03 }), CONFIG);
  assert.strictEqual(r.overconfidencePenaltyApplied, false);
});
test('All seven score components are returned for DB persistence', () => {
  const r = scoring.computeMarketScore(baseScoreInput(), CONFIG);
  const keys = ['scoreProbabilityComponent', 'scoreHistoryComponent', 'scoreDataQualityComponent', 'scoreMarketComponent', 'scoreHomeAwayComponent', 'scorePriceComponent', 'scoreLeagueComponent'];
  for (const k of keys) assert.ok(typeof r.components[k] === 'number', `missing component ${k}`);
});

// ---------------------------------------------------------------------------
// SECTION 11 · PUBLIC QUALITY GATE (odds boundaries, thresholds, fail-closed)
// ---------------------------------------------------------------------------
function baseGateCandidate(overrides) {
  return Object.assign({
    modelProbabilityValid: true, marketProbabilityValid: true, insufficientHistory: false,
    hasExactMarket: true, hasExactLine: true, snapshotAgeMinutes: 10,
    calibratedEv: 0.05, marketScore: 75, odd: 1.90, dataQualityScore: 90, historyScore: 85,
    calibratedEdgePp: 0.03
  }, overrides || {});
}
test('Gate passes a fully qualifying candidate', () => {
  assert.strictEqual(gate.evaluateCandidateGate(baseGateCandidate(), CONFIG).passed, true);
});
test('Odd 1.69 fails (below public range)', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ odd: 1.69 }), CONFIG);
  assert.strictEqual(v.passed, false);
  assert.strictEqual(v.reasonCode, R.ODD_BELOW_PUBLIC_RANGE);
});
test('Odd 1.70 passes (inclusive lower bound)', () => {
  assert.strictEqual(gate.evaluateCandidateGate(baseGateCandidate({ odd: 1.70 }), CONFIG).passed, true);
});
test('Odd 2.05 passes (inclusive upper bound)', () => {
  assert.strictEqual(gate.evaluateCandidateGate(baseGateCandidate({ odd: 2.05 }), CONFIG).passed, true);
});
test('Odd 2.06 fails (above public range)', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ odd: 2.06 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.ODD_ABOVE_PUBLIC_RANGE);
});
test('EV below 3% fails CALIBRATED_EV_TOO_LOW', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ calibratedEv: 0.02 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.CALIBRATED_EV_TOO_LOW);
});
test('EV above 12% still passes the gate (only scoring is penalized, not a hard reject)', () => {
  assert.strictEqual(gate.evaluateCandidateGate(baseGateCandidate({ calibratedEv: 0.13 }), CONFIG).passed, true);
});
test('EV above 18% hard-rejects as EXTREME_EV_REJECT', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ calibratedEv: 0.19 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.EXTREME_EV_REJECT);
});
test('Edge below 2pp fails CALIBRATED_EDGE_TOO_LOW', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ calibratedEdgePp: 0.01 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.CALIBRATED_EDGE_TOO_LOW);
});
test('Low data quality fails DATA_QUALITY_LOW', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ dataQualityScore: 70 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.DATA_QUALITY_LOW);
});
test('Low history score fails HISTORY_SCORE_LOW', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ historyScore: 50 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.HISTORY_SCORE_LOW);
});
test('MarketScore below 65 fails MARKET_SCORE_TOO_LOW', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ marketScore: 64 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.MARKET_SCORE_TOO_LOW);
});
test('Missing market fails EXACT_MARKET_NOT_FOUND, no fallback', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ hasExactMarket: false, hasExactLine: false }), CONFIG);
  assert.strictEqual(v.reasonCode, R.EXACT_MARKET_NOT_FOUND);
});
test('Missing exact line (market exists) fails EXACT_LINE_NOT_FOUND', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ hasExactLine: false }), CONFIG);
  assert.strictEqual(v.reasonCode, R.EXACT_LINE_NOT_FOUND);
});
test('Stale snapshot fails closed with SNAPSHOT_STALE', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ snapshotAgeMinutes: 56 }), CONFIG);
  assert.strictEqual(v.reasonCode, R.SNAPSHOT_STALE);
});
test('Snapshot at exactly the max age still passes', () => {
  assert.strictEqual(gate.evaluateCandidateGate(baseGateCandidate({ snapshotAgeMinutes: 55 }), CONFIG).passed, true);
});
test('Insufficient history fails closed regardless of score', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ insufficientHistory: true }), CONFIG);
  assert.strictEqual(v.reasonCode, R.INSUFFICIENT_HISTORY);
});
test('Invalid model probability fails closed first (highest priority)', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ modelProbabilityValid: false, marketProbabilityValid: false }), CONFIG);
  assert.strictEqual(v.reasonCode, R.MODEL_PROBABILITY_INVALID);
});
test('Invalid market probability fails closed', () => {
  const v = gate.evaluateCandidateGate(baseGateCandidate({ marketProbabilityValid: false }), CONFIG);
  assert.strictEqual(v.reasonCode, R.MARKET_PROBABILITY_INVALID);
});

// ---------------------------------------------------------------------------
// SECTION 12 · PUBLICATION CAPS / DEDUP
// ---------------------------------------------------------------------------
test('Fixture already published blocks re-publication', () => {
  const v = gate.evaluatePublicationCaps({ fixtureAlreadyPublished: true, publishedThisRun: 0, publishedToday: 0 }, CONFIG);
  assert.strictEqual(v.reasonCode, R.FIXTURE_ALREADY_PUBLISHED);
});
test('Run cap (2 per run) is enforced', () => {
  const v = gate.evaluatePublicationCaps({ fixtureAlreadyPublished: false, publishedThisRun: 2, publishedToday: 0 }, CONFIG);
  assert.strictEqual(v.reasonCode, R.RUN_CAP_REACHED);
});
test('Run cap allows the 2nd publication of a run', () => {
  const v = gate.evaluatePublicationCaps({ fixtureAlreadyPublished: false, publishedThisRun: 1, publishedToday: 1 }, CONFIG);
  assert.strictEqual(v.passed, true);
});
test('Daily cap (4 per day) is enforced', () => {
  const v = gate.evaluatePublicationCaps({ fixtureAlreadyPublished: false, publishedThisRun: 0, publishedToday: 4 }, CONFIG);
  assert.strictEqual(v.reasonCode, R.DAILY_CAP_REACHED);
});
test('Zero published today is a perfectly valid state (0 signals allowed)', () => {
  const v = gate.evaluatePublicationCaps({ fixtureAlreadyPublished: false, publishedThisRun: 0, publishedToday: 0 }, CONFIG);
  assert.strictEqual(v.passed, true);
});

// ---------------------------------------------------------------------------
// SECTION 13 · EXECUTION RECHECK
// ---------------------------------------------------------------------------
function baseExecCandidate(overrides) {
  return Object.assign(baseGateCandidate(), { entryOdd: 1.90, odd: 1.90 }, overrides || {});
}
test('Execution recheck passes when nothing has changed', () => {
  assert.strictEqual(gate.evaluateExecutionRecheck(baseExecCandidate(), 0, CONFIG).passed, true);
});
test('Execution recheck rejects on price deterioration above 2%', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ odd: 1.83 }), 0.037, CONFIG);
  assert.strictEqual(v.reasonCode, R.PRICE_DETERIORATION_TOO_HIGH);
});
test('Execution recheck allows deterioration at exactly the 2% boundary', () => {
  assert.strictEqual(gate.evaluateExecutionRecheck(baseExecCandidate(), 0.02, CONFIG).passed, true);
});
test('Execution recheck rejects a market that disappeared before publish', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ hasExactMarket: false, hasExactLine: false }), 0, CONFIG);
  assert.strictEqual(v.reasonCode, R.EXACT_MARKET_NOT_FOUND);
});
test('Execution recheck rejects a line that disappeared before publish', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ hasExactLine: false }), 0, CONFIG);
  assert.strictEqual(v.reasonCode, R.EXACT_LINE_NOT_FOUND);
});
test('Execution recheck rejects a stale snapshot at publish time', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ snapshotAgeMinutes: 90 }), 0, CONFIG);
  assert.strictEqual(v.reasonCode, R.SNAPSHOT_STALE);
});
test('Execution recheck flags a wildly moved price as BET365_PRICE_MOVED', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ odd: 2.5 }), 0, CONFIG);
  assert.strictEqual(v.reasonCode, R.BET365_PRICE_MOVED);
});
test('Execution recheck re-applies the full gate (e.g. re-derived low score)', () => {
  const v = gate.evaluateExecutionRecheck(baseExecCandidate({ marketScore: 40 }), 0, CONFIG);
  assert.strictEqual(v.reasonCode, R.MARKET_SCORE_TOO_LOW);
});

// ---------------------------------------------------------------------------
// SECTION 14 · BEST-MARKET SELECTION / SEPARATION / DEDUP
// ---------------------------------------------------------------------------
function candidate(marketFamily, marketScore, overrides) {
  return Object.assign({ marketFamily, marketKey: marketFamily + '_' + marketScore, marketScore, rejectionReason: null }, overrides || {});
}
test('Selection: two good markets on the same fixture -> only the higher one is selected', () => {
  const cands = [candidate('BTTS', 74), candidate('GOALS', 71)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.bestCandidate.marketFamily, 'BTTS');
  const goals = res.candidates.find(c => c.marketFamily === 'GOALS');
  assert.strictEqual(goals.selectedAsBestMarket, false);
  assert.strictEqual(goals.rejectionReason, R.BETTER_MARKET_ON_SAME_FIXTURE);
});
test('Selection: second market too close (separation < 3) blocks publication entirely', () => {
  const cands = [candidate('BTTS', 70), candidate('GOALS', 69)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  const btts = res.candidates.find(c => c.marketFamily === 'BTTS');
  assert.strictEqual(btts.selectedAsBestMarket, false);
  assert.strictEqual(btts.rejectionReason, R.SECOND_MARKET_TOO_CLOSE);
});
test('Selection: separation of exactly 3 is sufficient', () => {
  const cands = [candidate('BTTS', 71), candidate('GOALS', 68)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.bestCandidate.marketFamily, 'BTTS');
  assert.strictEqual(res.candidates.find(c => c.marketFamily === 'BTTS').selectedAsBestMarket, true);
});
test('Selection: single public candidate with no runner-up is selected outright', () => {
  const cands = [candidate('BTTS', 74)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.bestCandidate.marketFamily, 'BTTS');
});
test('Selection: Asian Handicap candidates never compete for the public slot while disabled', () => {
  const cands = [candidate('ASIAN_HANDICAP', 95), candidate('BTTS', 60)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  const ah = res.candidates.find(c => c.marketFamily === 'ASIAN_HANDICAP');
  assert.strictEqual(ah.selectedAsBestMarket, false);
  assert.strictEqual(ah.rankInFixture, null);
  assert.strictEqual(res.bestCandidate.marketFamily, 'BTTS');
});
test('Selection: fixture with only Asian Handicap candidates produces no public best market', () => {
  const cands = [candidate('ASIAN_HANDICAP', 90)];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.bestCandidate, null);
});
test('Selection: top-ranked-by-score candidate that already failed its own gate is not selected (no cascade to 2nd best)', () => {
  const cands = [
    candidate('GOALS', 90, { rejectionReason: R.ODD_ABOVE_PUBLIC_RANGE }),
    candidate('BTTS', 70)
  ];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.bestCandidate, null);
  const goals = res.candidates.find(c => c.marketFamily === 'GOALS');
  assert.strictEqual(goals.selectedAsBestMarket, false);
  assert.strictEqual(goals.rejectionReason, R.ODD_ABOVE_PUBLIC_RANGE);
  const btts = res.candidates.find(c => c.marketFamily === 'BTTS');
  assert.strictEqual(btts.selectedAsBestMarket, false, 'never cascade down to the runner-up');
});
test('Selection: duplicate market keys on the same fixture still rank deterministically', () => {
  const cands = [candidate('GOALS', 70, { marketKey: 'OVER_2_5' }), candidate('GOALS', 70, { marketKey: 'OVER_2_5' })];
  const res = selection.selectBestMarketPerFixture(cands, CONFIG);
  assert.strictEqual(res.candidates.filter(c => c.selectedAsBestMarket).length <= 1, true);
});

// ---------------------------------------------------------------------------
// SECTION 15 · RATE LIMITER / RETRY (429, 5xx, fail-soft)
// ---------------------------------------------------------------------------
const noSleep = { sleep: () => Promise.resolve() };
async function testAsyncSuite() {
  await atest('providerSpacingMs paces to <= 9 requests/minute', () => {
    assert.strictEqual(rateLimiter.providerSpacingMs(CONFIG), Math.ceil(60000 / 9));
  });
  await atest('httpWithRetry succeeds immediately on first try', async () => {
    const r = await rateLimiter.httpWithRetry(async () => ({ ok: true }), CONFIG, noSleep);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.attempts.retries, 0);
  });
  await atest('httpWithRetry retries on 429 and eventually succeeds', async () => {
    let calls = 0;
    const r = await rateLimiter.httpWithRetry(async () => {
      calls++;
      if (calls < 2) { const e = new Error('rate limited'); e.statusCode = 429; e.retryAfterSeconds = 1; throw e; }
      return { body: 'ok' };
    }, CONFIG, noSleep);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.attempts.retries, 1);
  });
  await atest('httpWithRetry retries on 504 up to maxRetries then fails soft (never throws)', async () => {
    const r = await rateLimiter.httpWithRetry(async () => {
      const e = new Error('gateway timeout'); e.statusCode = 504; throw e;
    }, CONFIG, noSleep);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 504);
    assert.strictEqual(r.attempts.made, CONFIG.provider.maxRetries + 1);
  });
  await atest('httpWithRetry does NOT retry a non-transient 404', async () => {
    let calls = 0;
    const r = await rateLimiter.httpWithRetry(async () => { calls++; const e = new Error('not found'); e.statusCode = 404; throw e; }, CONFIG, noSleep);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls, 1);
  });
  await atest('httpWithRetry respects Retry-After for 429 (backoff >= header value)', async () => {
    const waits = [];
    const r = await rateLimiter.httpWithRetry(async (attempt) => {
      if (attempt === 0) { const e = new Error('rl'); e.statusCode = 429; e.retryAfterSeconds = 7; throw e; }
      return { ok: true };
    }, CONFIG, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    assert.strictEqual(r.ok, true);
    assert.ok(waits[0] >= 7000);
  });
  await atest('A DB write failure on one candidate does not stop the next candidate from being processed', async () => {
    const items = [{ id: 1, shouldFail: true }, { id: 2, shouldFail: false }];
    const results = [];
    for (const item of items) {
      const r = await rateLimiter.httpWithRetry(async () => {
        if (item.shouldFail) { const e = new Error('db down'); e.statusCode = 503; throw e; }
        return { savedId: item.id };
      }, CONFIG, noSleep);
      results.push(r);
    }
    assert.strictEqual(results[0].ok, false);
    assert.strictEqual(results[1].ok, true);
    assert.strictEqual(results[1].response.savedId, 2);
  });
  await atest('A Telegram publish failure is recorded and does not throw', async () => {
    const r = await rateLimiter.httpWithRetry(async () => { const e = new Error('telegram down'); e.statusCode = 502; throw e; }, CONFIG, noSleep);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(typeof r.message, 'string');
  });
  await atest('Settlement provider call retries transient errors before giving up', async () => {
    let calls = 0;
    const r = await rateLimiter.httpWithRetry(async () => { calls++; const e = new Error('timeout'); e.statusCode = 408; throw e; }, CONFIG, noSleep);
    assert.strictEqual(calls, CONFIG.provider.maxRetries + 1);
    assert.strictEqual(r.ok, false);
  });
}

// ---------------------------------------------------------------------------
// SECTION 16 · TELEGRAM FORMATTING
// ---------------------------------------------------------------------------
const samplePick = {
  homeTeam: 'Alavés', awayTeam: 'Valencia', country: 'Spain', leagueName: 'LaLiga',
  kickoff: '2026-09-15T18:00:00.000Z', marketFamily: 'BTTS', side: 'YES', line: null,
  entryOdd: 1.95, marketScore: 72, stakeEur: 100
};
test('Pick post never leaks model %, EV, edge, DQ, lambda or Poisson detail', () => {
  const msg = telegram.formatPickPost(samplePick);
  for (const forbidden of ['EV', 'Edge', 'lambda', 'Poisson', 'DQ', 'Model']) {
    assert.ok(!msg.includes(forbidden), `pick post leaked "${forbidden}"`);
  }
});
test('Pick post includes team names, market, price, and rating', () => {
  const msg = telegram.formatPickPost(samplePick);
  assert.ok(msg.includes('Alavés'));
  assert.ok(msg.includes('Valencia'));
  assert.ok(msg.includes('Гол/Гол — Да'));
  assert.ok(msg.includes('1.95'));
  assert.ok(msg.includes('72/100'));
});
test('Result reply WIN header is distinct from LOSS', () => {
  const win = telegram.formatResultReply(samplePick, { status: 'WIN', profitEur: 95, ftHome: 2, ftAway: 1 });
  const loss = telegram.formatResultReply(samplePick, { status: 'LOSS', profitEur: -100 });
  assert.notStrictEqual(win.split('\n')[0], loss.split('\n')[0]);
});
test('Result reply distinguishes HALF_WIN, PUSH, HALF_LOSS, VOID with unique headers', () => {
  const statuses = ['WIN', 'HALF_WIN', 'PUSH', 'HALF_LOSS', 'LOSS', 'VOID'];
  const headers = new Set(statuses.map(s => telegram.formatResultReply(samplePick, { status: s, profitEur: 0, ftHome: 1, ftAway: 1 }).split('\n')[0]));
  assert.strictEqual(headers.size, statuses.length);
});
test('Result reply shows the profit with correct sign', () => {
  const win = telegram.formatResultReply(samplePick, { status: 'WIN', profitEur: 95, ftHome: 2, ftAway: 1 });
  assert.ok(win.includes('+95.00'));
  const loss = telegram.formatResultReply(samplePick, { status: 'LOSS', profitEur: -100 });
  assert.ok(loss.includes('-100.00'));
});
test('Daily report includes P/L, ROI and per-market breakdown', () => {
  const msg = telegram.formatDailyReport({
    dateLabel: '15.09.2026', totalPicks: 3, wins: 2, losses: 1, plEur: 84, roiPct: 28.0,
    byFamily: { GOALS: 90, BTTS: 94, MONEYLINE: -100 }
  });
  assert.ok(msg.includes('Официални прогнози: 3'));
  assert.ok(msg.includes('+84.00'));
  assert.ok(msg.includes('+28.0%'));
  assert.ok(msg.includes('GOALS: +90.00'));
});
test('Daily report suppresses rolling metrics below sample threshold', () => {
  const msg = telegram.formatDailyReport({ dateLabel: 'x', totalPicks: 1, wins: 1, losses: 0, plEur: 10, roiPct: 10, rolling7d: { sampleN: 2, plEur: 5, roiPct: 5 } });
  assert.ok(!msg.includes('Последни 7 дни'));
});
test('Daily report shows rolling metrics once sample is sufficient', () => {
  const msg = telegram.formatDailyReport({ dateLabel: 'x', totalPicks: 1, wins: 1, losses: 0, plEur: 10, roiPct: 10, rolling7d: { sampleN: 6, plEur: 50, roiPct: 12 } });
  assert.ok(msg.includes('Последни 7 дни'));
});
test('Asian Handicap display label shows the team and signed line', () => {
  const label = telegram.marketDisplayLabel({ marketFamily: 'ASIAN_HANDICAP', side: 'HOME', line: -0.75, homeTeam: 'Alavés', awayTeam: 'Valencia' });
  assert.ok(label.includes('Alavés'));
  assert.ok(label.includes('-0.75'));
});

// ---------------------------------------------------------------------------
// SECTION 17 · DIAGNOSTICS / REASON CODES
// ---------------------------------------------------------------------------
test('createRunDiagnostics initializes every required counter to zero', () => {
  const d = diagnostics.createRunDiagnostics();
  const required = ['fixturesFetched', 'marketsEvaluated', 'goalsMarketsEvaluated', 'bttsMarketsEvaluated', 'moneylineMarketsEvaluated', 'doubleChanceMarketsEvaluated', 'asianTotalMarketsEvaluated', 'asianHandicapMarketsEvaluated', 'candidatesPassingModel', 'candidatesPassingPrice', 'candidatesPassingCalibration', 'candidatesPassingMarketScore', 'bestMarketsSelected', 'executionRejected', 'publicApproved', 'publicPublished', 'providerRequests', 'providerRetries', 'providerErrors', 'dbWrites', 'dbWriteFailures'];
  for (const k of required) assert.strictEqual(d[k], 0, `counter ${k} not initialized to 0`);
});
test('recordMarketEvaluated increments the correct family counter', () => {
  const d = diagnostics.createRunDiagnostics();
  diagnostics.recordMarketEvaluated(d, 'GOALS');
  diagnostics.recordMarketEvaluated(d, 'ASIAN_HANDICAP');
  assert.strictEqual(d.marketsEvaluated, 2);
  assert.strictEqual(d.goalsMarketsEvaluated, 1);
  assert.strictEqual(d.asianHandicapMarketsEvaluated, 1);
});
test('validateReasonCode accepts every configured reason', () => {
  for (const code of Object.values(CONFIG.rejectionReasons)) {
    assert.strictEqual(diagnostics.validateReasonCode(code, CONFIG), true);
  }
});
test('validateReasonCode rejects an unknown ad-hoc string', () => {
  assert.strictEqual(diagnostics.validateReasonCode('SOMETHING_MADE_UP', CONFIG), false);
});
test('validateReasonCode accepts null (no rejection)', () => {
  assert.strictEqual(diagnostics.validateReasonCode(null, CONFIG), true);
});
test('recordRejection tallies counts per reason code', () => {
  const d = diagnostics.createRunDiagnostics();
  diagnostics.recordRejection(d, R.MARKET_SCORE_TOO_LOW);
  diagnostics.recordRejection(d, R.MARKET_SCORE_TOO_LOW);
  diagnostics.recordRejection(d, R.ODD_BELOW_PUBLIC_RANGE);
  assert.strictEqual(d.rejectionCounts[R.MARKET_SCORE_TOO_LOW], 2);
  assert.strictEqual(d.rejectionCounts[R.ODD_BELOW_PUBLIC_RANGE], 1);
});

// ---------------------------------------------------------------------------
// SECTION 18 · MARKET UNIVERSE / PRICE LOOKUP (fail-closed, no fallback)
// ---------------------------------------------------------------------------
function fullBet365Payload() {
  const totals = {}, asianTotals = {};
  for (const line of CONFIG.markets.goalsLines) {
    const table = marketUniverse.isStandardGoalsLine(line) ? totals : asianTotals;
    table[String(line)] = { over: 1.9, under: 1.9 };
  }
  const asianHandicap = {};
  for (const line of CONFIG.markets.asianHandicapLines) asianHandicap[String(line)] = { home: 1.9, away: 1.95 };
  return {
    moneyline: { home: 1.9, draw: 3.5, away: 4.0 },
    btts: { yes: 1.9, no: 1.9 },
    doubleChance: { oneX: 1.25, xTwo: 1.6 },
    totals, asianTotals, asianHandicap
  };
}
// Universe built from a fully-priced book proves the enumeration logic itself
// (every line, both sides, correct key naming) is complete and correct.
test('Market universe contains exactly 49 markets when every line is priced (16+2+3+2+26)', () => {
  assert.strictEqual(marketUniverse.buildMarketUniverse(CONFIG, fullBet365Payload()).length, 49);
});
test('Market universe covers all 8 goals lines x 2 sides when fully priced', () => {
  const goals = marketUniverse.buildMarketUniverse(CONFIG, fullBet365Payload()).filter(m => m.marketFamily === 'GOALS');
  assert.strictEqual(goals.length, 16);
});
test('Market universe covers all 13 Asian Handicap lines x 2 sides when fully priced', () => {
  const ah = marketUniverse.buildMarketUniverse(CONFIG, fullBet365Payload()).filter(m => m.marketFamily === 'ASIAN_HANDICAP');
  assert.strictEqual(ah.length, 26);
});
// Real Bet365 books are sparse (spec limitation #2) -- the universe must
// shrink to exactly what was quoted, never pad with synthetic/theoretical markets.
test('Market universe with no bet365 payload at all is empty (fail closed, never synthetic)', () => {
  assert.strictEqual(marketUniverse.buildMarketUniverse(CONFIG, undefined).length, 0);
  assert.strictEqual(marketUniverse.buildMarketUniverse(CONFIG, {}).length, 0);
});
test('Market universe with a sparse real-world book only includes quoted sides', () => {
  const sparse = { btts: { yes: 1.9, no: 1.9 }, totals: { '2.5': { over: 1.85, under: undefined } } };
  const universe = marketUniverse.buildMarketUniverse(CONFIG, sparse);
  assert.strictEqual(universe.length, 3); // BTTS_YES, BTTS_NO, OVER_2_5 (no UNDER_2_5: no price)
  assert.ok(!universe.some(m => m.marketKey === 'UNDER_2_5'));
  assert.ok(!universe.some(m => m.marketFamily === 'ASIAN_HANDICAP'));
});
test('Market universe never includes a side priced at exactly 1 (no edge, not a real bet)', () => {
  const universe = marketUniverse.buildMarketUniverse(CONFIG, { btts: { yes: 1, no: 1.9 } });
  assert.strictEqual(universe.length, 1);
  assert.strictEqual(universe[0].marketKey, 'BTTS_NO');
});
test('Asian Handicap is excluded from public-enabled families', () => {
  assert.ok(!CONFIG.markets.publicEnabledFamilies.includes('ASIAN_HANDICAP'));
  assert.strictEqual(CONFIG.markets.asianHandicapPublicEnabled, false);
});
test('priceLookup: missing market family returns hasExactMarket=false, no fallback', () => {
  const r = priceLookup.lookupPrice({}, { marketFamily: 'BTTS', side: 'YES' });
  assert.strictEqual(r.hasExactMarket, false);
});
test('priceLookup: market present but requested line absent -> EXACT_LINE_NOT_FOUND territory, never nearest-line', () => {
  const bet365 = { totals: { '2.5': { over: 1.9, under: 1.9 } } };
  const r = priceLookup.lookupPrice(bet365, { marketFamily: 'GOALS', side: 'OVER', line: 3.5 });
  assert.strictEqual(r.hasExactMarket, true);
  assert.strictEqual(r.hasExactLine, false);
});
test('priceLookup: exact line present resolves the exact price, not an adjacent one', () => {
  const bet365 = { totals: { '2.5': { over: 1.90, under: 1.95 }, '3.5': { over: 2.50, under: 1.50 } } };
  const r = priceLookup.lookupPrice(bet365, { marketFamily: 'GOALS', side: 'OVER', line: 2.5 });
  assert.strictEqual(r.odd, 1.90);
});
test('priceLookup: Asian Handicap reads home/away from the same nominal-line entry', () => {
  const bet365 = { asianHandicap: { '-0.5': { home: 1.90, away: 1.95 } } };
  const home = priceLookup.lookupPrice(bet365, { marketFamily: 'ASIAN_HANDICAP', side: 'HOME', line: -0.5, bookLine: -0.5 });
  const away = priceLookup.lookupPrice(bet365, { marketFamily: 'ASIAN_HANDICAP', side: 'AWAY', line: 0.5, bookLine: -0.5 });
  assert.strictEqual(home.odd, 1.90);
  assert.strictEqual(away.odd, 1.95);
});

// ---------------------------------------------------------------------------
// SECTION 19 · CONFIG CENTRALIZATION SANITY (numbers must match the spec)
// ---------------------------------------------------------------------------
test('CONFIG is frozen (immutable) so it cannot silently drift at runtime', () => {
  assert.ok(Object.isFrozen(CONFIG));
});
test('Public odds range matches spec exactly', () => {
  assert.strictEqual(CONFIG.odds.minPublicOdd, 1.70);
  assert.strictEqual(CONFIG.odds.maxPublicOdd, 2.05);
});
test('Volume caps match spec exactly', () => {
  assert.strictEqual(CONFIG.volume.minPublicPerDay, 0);
  assert.strictEqual(CONFIG.volume.maxPublicPerRun, 2);
  assert.strictEqual(CONFIG.volume.maxPublicPerDay, 4);
});
test('Fixed stake is 100 EUR, Kelly disabled', () => {
  assert.strictEqual(CONFIG.stake.fixedStakeEur, 100);
  assert.strictEqual(CONFIG.stake.useKelly, false);
});
test('Safe Double is disabled for v6.26', () => {
  assert.strictEqual(CONFIG.safeDouble.publicEnabled, false);
});
test('Provider rate limit is paced to 9/min under the shared 10/min ceiling', () => {
  assert.strictEqual(CONFIG.provider.maxRequestsPerMinute, 9);
  assert.strictEqual(CONFIG.provider.sharedLimitPerMinute, 10);
});
test('MIN_TO_KO is 45 minutes', () => {
  assert.strictEqual(CONFIG.schedule.minMinutesToKickoff, 45);
});
test('Three non-overlapping schedule windows are configured', () => {
  assert.strictEqual(CONFIG.schedule.windows.length, 3);
  const ids = CONFIG.schedule.windows.map(w => w.id);
  assert.deepStrictEqual(ids, ['A', 'B', 'C']);
});
test('Version tags match spec exactly', () => {
  assert.strictEqual(CONFIG.engineVersion, 'V6.26.1');
  assert.strictEqual(CONFIG.modelVersion, 'MULTI_MARKET_SELECTOR_V1');
  assert.strictEqual(CONFIG.calibrationVersion, 'V626_CALIBRATION_V1');
  assert.strictEqual(CONFIG.scoreVersion, 'MARKET_SCORE_V1');
});

// ---------------------------------------------------------------------------
// SECTION 20 · END-TO-END ENGINE INTEGRATION
// ---------------------------------------------------------------------------
function goodMatches(gf, ga) { return new Array(15).fill(0).map(() => ({ goalsFor: gf, goalsAgainst: ga })); }

test('Engine end-to-end: a clean high-quality fixture can produce a public best market', () => {
  const result = engine.evaluateFixture({
    homeMatches: goodMatches(2, 0.7),
    awayMatches: goodMatches(1.6, 0.9),
    leagueContext: { avgGoalsPerMatch: 2.7, fixturesObservedThisRun: 10 },
    leagueReliabilityScore: 85,
    bet365: {
      moneyline: { home: 1.85, draw: 3.6, away: 4.2 },
      btts: { yes: 1.85, no: 1.95 },
      totals: { '2.5': { over: 1.85, under: 1.95 } },
      doubleChance: { oneX: 1.25, xTwo: 1.6 }
    },
    snapshotAt: new Date(Date.now() - 5 * 60000).toISOString(),
    nowMs: Date.now()
  }, CONFIG);
  // Real-world sparse book: moneyline(3) + btts(2) + totals 2.5(2) + doubleChance(2) = 9.
  // No theoretical 49-market padding for lines/markets Bet365 never quoted.
  assert.strictEqual(result.candidates.length, 9);
  assert.ok(result.lambdaHome > 0 && result.lambdaAway > 0);
});

test('Engine end-to-end: insufficient history yields INSUFFICIENT_HISTORY on every public candidate, no signal', () => {
  const result = engine.evaluateFixture({
    homeMatches: [{ goalsFor: 1, goalsAgainst: 1 }],
    awayMatches: [{ goalsFor: 1, goalsAgainst: 1 }],
    leagueContext: null,
    leagueReliabilityScore: 50,
    bet365: { btts: { yes: 1.9, no: 1.9 } },
    snapshotAt: new Date().toISOString(),
    nowMs: Date.now()
  }, CONFIG);
  assert.strictEqual(result.bestCandidate, null);
  const btts = result.candidates.find(c => c.marketKey === 'BTTS_YES');
  assert.strictEqual(btts.rejectionReason, R.INSUFFICIENT_HISTORY);
});

test('Engine end-to-end: a fixture with prices on no markets at all produces zero signal, never a fabricated one', () => {
  const result = engine.evaluateFixture({
    homeMatches: goodMatches(1.5, 1.2), awayMatches: goodMatches(1.3, 1.1),
    leagueContext: null, leagueReliabilityScore: 60,
    bet365: {}, snapshotAt: new Date().toISOString(), nowMs: Date.now()
  }, CONFIG);
  assert.strictEqual(result.bestCandidate, null);
  // An empty book means an empty universe -- no theoretical placeholders.
  assert.strictEqual(result.candidates.length, 0);
});

test('Engine end-to-end: Asian Handicap candidates are fully scored even though never public', () => {
  const result = engine.evaluateFixture({
    homeMatches: goodMatches(2, 0.7), awayMatches: goodMatches(1.6, 0.9),
    leagueContext: { avgGoalsPerMatch: 2.7, fixturesObservedThisRun: 10 }, leagueReliabilityScore: 85,
    bet365: { asianHandicap: { '-0.5': { home: 1.9, away: 1.95 } } },
    snapshotAt: new Date().toISOString(), nowMs: Date.now()
  }, CONFIG);
  const ah = result.candidates.find(c => c.marketKey.startsWith('AH_HOME'));
  assert.ok(ah.marketScore >= 0);
  assert.strictEqual(ah.publicEligible, false);
  assert.strictEqual(ah.rejectionReason, R.MARKET_FAMILY_RESEARCH_ONLY);
  assert.strictEqual(result.bestCandidate, null);
});
test('MARKET_FAMILY_RESEARCH_ONLY is a valid reason code (never a schema-rejected ad-hoc string)', () => {
  assert.strictEqual(diagnostics.validateReasonCode(R.MARKET_FAMILY_RESEARCH_ONLY, CONFIG), true);
});

// ---------------------------------------------------------------------------
// SECTION 21 · SCHEDULE WINDOWS (no overlapping executions)
// ---------------------------------------------------------------------------
test('isExecutable rejects a fixture inside the 45-minute MIN_TO_KO buffer', () => {
  const now = Date.now();
  assert.strictEqual(schedule.isExecutable(now + 30 * 60000, now, CONFIG), false);
});
test('isExecutable allows a fixture at exactly 45 minutes to kickoff', () => {
  const now = Date.now();
  assert.strictEqual(schedule.isExecutable(now + 45 * 60000, now, CONFIG), true);
});
test('getActiveWindow resolves to window A shortly after 07:00 Sofia time', () => {
  // 2026-09-15 07:05 Europe/Sofia (UTC+3 in September) = 04:05 UTC
  const nowMs = Date.parse('2026-09-15T04:05:00.000Z');
  const w = schedule.getActiveWindow(nowMs, CONFIG);
  assert.strictEqual(w.windowId, 'A');
});
test('getActiveWindow resolves to window B shortly after 14:00 Sofia time', () => {
  const nowMs = Date.parse('2026-09-15T11:05:00.000Z'); // 14:05 Sofia
  const w = schedule.getActiveWindow(nowMs, CONFIG);
  assert.strictEqual(w.windowId, 'B');
});
test('getActiveWindow resolves to window C shortly after 21:00 Sofia time', () => {
  const nowMs = Date.parse('2026-09-15T18:05:00.000Z'); // 21:05 Sofia
  const w = schedule.getActiveWindow(nowMs, CONFIG);
  assert.strictEqual(w.windowId, 'C');
});
test('getActiveWindow just before 07:00 Sofia still belongs to the overnight window C', () => {
  const nowMs = Date.parse('2026-09-15T03:30:00.000Z'); // 06:30 Sofia
  const w = schedule.getActiveWindow(nowMs, CONFIG);
  assert.strictEqual(w.windowId, 'C');
});
test('Adjacent windows never overlap: window A ends exactly when window B starts', () => {
  const nowMsA = Date.parse('2026-09-15T04:05:00.000Z');
  const wA = schedule.getActiveWindow(nowMsA, CONFIG);
  const nowMsB = Date.parse('2026-09-15T11:05:00.000Z');
  const wB = schedule.getActiveWindow(nowMsB, CONFIG);
  assert.strictEqual(wA.rangeEndMs, wB.rangeStartMs);
});

// ---------------------------------------------------------------------------
// SECTION 22 · BET365 PAYLOAD PARSER (Market Scout / Execution Recheck share this)
// ---------------------------------------------------------------------------
test('parseBet365Payload extracts 1x2, BTTS and a standard total from a Bet365 book', () => {
  const fixture = {
    bookmakers: [{ slug: 'bet365', odds: {
      '1x2': { closing: { home: 1.85, draw: 3.6, away: 4.2 } },
      btts: { closing: { yes: 1.85, no: 1.95 } },
      goal_line: { closing: { line: 2.5, over: 1.9, under: 1.9 } }
    } }]
  };
  const payload = bet365Parser.parseBet365Payload(fixture);
  assert.strictEqual(payload.moneyline.home, 1.85);
  assert.strictEqual(payload.btts.yes, 1.85);
  assert.strictEqual(payload.totals['2.5'].over, 1.9);
});
test('parseBet365Payload routes a non-half goal line into asianTotals, not totals', () => {
  const fixture = { bookmakers: [{ slug: 'bet365', odds: { goal_line: { closing: { line: 2.25, over: 1.9, under: 1.9 } } } }] };
  const payload = bet365Parser.parseBet365Payload(fixture);
  assert.ok(payload.asianTotals['2.25']);
  assert.ok(!payload.totals);
});
test('parseBet365Payload extracts Asian Handicap at its nominal line', () => {
  const fixture = { bookmakers: [{ slug: 'bet365', odds: { asian_handicap: { closing: { line: -0.5, home: 1.9, away: 1.95 } } } }] };
  const payload = bet365Parser.parseBet365Payload(fixture);
  assert.strictEqual(payload.asianHandicap['-0.5'].home, 1.9);
});
test('parseBet365Payload never fabricates a market that is absent from the book', () => {
  const fixture = { bookmakers: [{ slug: 'bet365', odds: {} }] };
  const payload = bet365Parser.parseBet365Payload(fixture);
  assert.strictEqual(payload.moneyline, undefined);
  assert.strictEqual(payload.btts, undefined);
  assert.strictEqual(payload.asianHandicap, undefined);
});
test('parseBet365Payload falls back to opening price only when no closing price exists', () => {
  const fixture = { bookmakers: [{ slug: 'bet365', odds: { btts: { opening: { yes: 1.8, no: 2.0 } } } }] };
  const payload = bet365Parser.parseBet365Payload(fixture);
  assert.strictEqual(payload.btts.yes, 1.8);
});
test('EXCLUDED_COMPETITION_RE matches friendlies and youth competitions', () => {
  assert.ok(bet365Parser.EXCLUDED_COMPETITION_RE.test('International Friendly'));
  assert.ok(bet365Parser.EXCLUDED_COMPETITION_RE.test('U19 Championship'));
  assert.ok(!bet365Parser.EXCLUDED_COMPETITION_RE.test('LaLiga'));
});

// ---------------------------------------------------------------------------
// SECTION 23 · EXECUTION-TIME RECOMPUTE (spec S19 -- not just deterioration)
// ---------------------------------------------------------------------------
function stagedCandidate(overrides) {
  return Object.assign({
    fixtureId: 1, marketFamily: 'BTTS', marketKey: 'BTTS_YES', side: 'YES', line: null, bookLine: null,
    bet365Odd: 1.90, modelProbabilityRaw: 0.58,
    homeSampleN: 15, awaySampleN: 15, historyScore: 85, dataQualityScore: 90, leagueReliabilityScore: 85,
    marketScore: 75, calibratedEv: 0.05, calibratedEdgePp: 0.03
  }, overrides || {});
}
test('Execution recompute: unchanged price re-derives essentially the same verdict and approves', () => {
  const r = executionRecheck.recomputeExecutionCandidate(stagedCandidate(), { btts: { yes: 1.90, no: 1.90 } }, CONFIG);
  assert.strictEqual(r.approved, true);
  assert.strictEqual(r.currentOdd, 1.90);
  assert.ok(r.refreshed.modelProbabilityCalibrated > 0);
});
test('Execution recompute: price deteriorated beyond 2% is rejected on the RECOMPUTED numbers', () => {
  const r = executionRecheck.recomputeExecutionCandidate(stagedCandidate(), { btts: { yes: 1.83, no: 1.97 } }, CONFIG);
  assert.strictEqual(r.approved, false);
  assert.strictEqual(r.reasonCode, R.PRICE_DETERIORATION_TOO_HIGH);
});
test('Execution recompute: price improved is still approved (never auto-rejected for being better)', () => {
  const r = executionRecheck.recomputeExecutionCandidate(stagedCandidate(), { btts: { yes: 2.0, no: 1.8 } }, CONFIG);
  assert.strictEqual(r.approved, true);
  assert.strictEqual(r.currentOdd, 2.0);
});
test('Execution recompute: market vanished entirely -> EXACT_MARKET_NOT_FOUND, never a fallback', () => {
  const r = executionRecheck.recomputeExecutionCandidate(stagedCandidate(), {}, CONFIG);
  assert.strictEqual(r.approved, false);
  assert.strictEqual(r.reasonCode, R.EXACT_MARKET_NOT_FOUND);
});
test('Execution recompute: exact line vanished (family present) -> EXACT_LINE_NOT_FOUND', () => {
  const c = stagedCandidate({ marketFamily: 'GOALS', marketKey: 'OVER_2_5', side: 'OVER', line: 2.5 });
  const r = executionRecheck.recomputeExecutionCandidate(c, { totals: { '3.5': { over: 1.9, under: 1.9 } } }, CONFIG);
  assert.strictEqual(r.approved, false);
  assert.strictEqual(r.reasonCode, R.EXACT_LINE_NOT_FOUND);
});
test('Execution recompute judges the fresh price on its OWN merits, not the stale staged marketScore', () => {
  // Same staged candidate (marketScore=75 at selection time), but the fresh
  // price implies a market probability that wildly disagrees with the model --
  // the recompute must fail on that new disagreement, regardless of what the
  // candidate looked like when it was first selected.
  const c = stagedCandidate({ modelProbabilityRaw: 0.85 }); // model very confident of YES
  const agreeing = executionRecheck.recomputeExecutionCandidate(c, { btts: { yes: 1.30, no: 3.2 } }, CONFIG); // market agrees (low odd = high implied prob)
  const disagreeing = executionRecheck.recomputeExecutionCandidate(c, { btts: { yes: 1.90, no: 1.90 } }, CONFIG); // market thinks ~50/50
  assert.ok(agreeing.refreshed.marketScore > disagreeing.refreshed.marketScore,
    `agreeing score ${agreeing.refreshed.marketScore} should exceed disagreeing score ${disagreeing.refreshed.marketScore}`);
});
test('Execution recompute: MONEYLINE uses three-way de-vig for the market probability', () => {
  const c = stagedCandidate({ marketFamily: 'MONEYLINE', marketKey: 'HOME_WIN', side: 'HOME_WIN', modelProbabilityRaw: 0.5 });
  const r = executionRecheck.recomputeExecutionCandidate(c, { moneyline: { home: 1.90, draw: 3.6, away: 4.2 } }, CONFIG);
  assert.ok(r.refreshed.devigMarketProbability > 0 && r.refreshed.devigMarketProbability < 1);
});
test('Execution recompute: invalid staged model probability fails closed', () => {
  const c = stagedCandidate({ modelProbabilityRaw: NaN });
  const r = executionRecheck.recomputeExecutionCandidate(c, { btts: { yes: 1.9, no: 1.9 } }, CONFIG);
  assert.strictEqual(r.refreshed.modelProbabilityValid, false);
  assert.strictEqual(r.refreshed.modelProbabilityCalibrated, null);
});
test('Execution recompute snapshot age reflects the FRESH fetch, not the stale selection-time snapshot', () => {
  const oldSnapshot = new Date(Date.now() - 90 * 60000).toISOString();
  const c = stagedCandidate({ marketSnapshotAt: oldSnapshot });
  const r = executionRecheck.recomputeExecutionCandidate(c, { btts: { yes: 1.9, no: 1.9, }, snapshotAt: new Date().toISOString() }, CONFIG);
  assert.ok(r.approved, 'must not fail SNAPSHOT_STALE using the old selection-time timestamp');
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
testAsyncSuite().then(() => {
  console.log(`\n${passCount} passed, ${failCount} failed (total ${passCount + failCount})\n`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL: ${f.name}\n  ${f.error}\n`);
    process.exit(1);
  } else {
    process.exit(0);
  }
});
