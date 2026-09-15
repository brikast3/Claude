// SOCCER RADAR v6.26 · QUALITY-FIRST MULTI-MARKET SELECTOR
// Central configuration. Every threshold used anywhere in Scanner / Gate / Build
// MUST be read from this object -- no duplicated hard-coded numbers elsewhere.
// This file is the single source of truth: it is bundled verbatim into every
// n8n Code node that needs it, and imported directly by the test suite, so the
// logic under test is byte-for-byte the logic that runs in production.

const ENGINE_VERSION = 'V6.26';
const MODEL_VERSION = 'MULTI_MARKET_SELECTOR_V1';
const CALIBRATION_VERSION = 'V626_CALIBRATION_V1';
const SCORE_VERSION = 'MARKET_SCORE_V1';

const REJECTION_REASONS = Object.freeze({
  MARKET_SCORE_TOO_LOW: 'MARKET_SCORE_TOO_LOW',
  ODD_BELOW_PUBLIC_RANGE: 'ODD_BELOW_PUBLIC_RANGE',
  ODD_ABOVE_PUBLIC_RANGE: 'ODD_ABOVE_PUBLIC_RANGE',
  CALIBRATED_EV_TOO_LOW: 'CALIBRATED_EV_TOO_LOW',
  CALIBRATED_EDGE_TOO_LOW: 'CALIBRATED_EDGE_TOO_LOW',
  DATA_QUALITY_LOW: 'DATA_QUALITY_LOW',
  HISTORY_SCORE_LOW: 'HISTORY_SCORE_LOW',
  EXTREME_EV_REJECT: 'EXTREME_EV_REJECT',
  SECOND_MARKET_TOO_CLOSE: 'SECOND_MARKET_TOO_CLOSE',
  BETTER_MARKET_ON_SAME_FIXTURE: 'BETTER_MARKET_ON_SAME_FIXTURE',
  EXACT_MARKET_NOT_FOUND: 'EXACT_MARKET_NOT_FOUND',
  EXACT_LINE_NOT_FOUND: 'EXACT_LINE_NOT_FOUND',
  BET365_PRICE_MOVED: 'BET365_PRICE_MOVED',
  PRICE_DETERIORATION_TOO_HIGH: 'PRICE_DETERIORATION_TOO_HIGH',
  SNAPSHOT_STALE: 'SNAPSHOT_STALE',
  FIXTURE_ALREADY_PUBLISHED: 'FIXTURE_ALREADY_PUBLISHED',
  DAILY_CAP_REACHED: 'DAILY_CAP_REACHED',
  RUN_CAP_REACHED: 'RUN_CAP_REACHED',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  MODEL_PROBABILITY_INVALID: 'MODEL_PROBABILITY_INVALID',
  MARKET_PROBABILITY_INVALID: 'MARKET_PROBABILITY_INVALID',
  EXECUTION_REJECTED: 'EXECUTION_REJECTED',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR' // only for genuinely unforeseen exceptions
});

const CONFIG = Object.freeze({
  engineVersion: ENGINE_VERSION,
  modelVersion: MODEL_VERSION,
  calibrationVersion: CALIBRATION_VERSION,
  scoreVersion: SCORE_VERSION,

  timezone: 'Europe/Sofia',

  // ---- 2. PUBLIC MARKETS -------------------------------------------------
  markets: {
    goalsLines: [1.5, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5],
    asianHandicapLines: [-1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5],
    publicEnabledFamilies: ['GOALS', 'BTTS', 'MONEYLINE', 'DOUBLE_CHANCE'],
    // Asian Handicap is analyzed and stored for research, but never public.
    // Reason: poor forward result of the previous (v6.25.4) model on this family.
    asianHandicapPublicEnabled: false
  },

  // ---- 6. GOAL MODEL ------------------------------------------------------
  model: {
    maxGoals: 7, // score probability matrix 0:0..7:7 (spec minimum)
    dixonColesRho: -0.08 // fixed structural low-score correlation term, not a league constant
  },

  // ---- 5. FIXTURE PROFILE / RECENCY WEIGHTING ------------------------------
  recency: {
    bucketSize: 5,
    weights: [0.5, 0.3, 0.2] // last 5 / previous 5 / older usable history
  },

  quality: {
    targetSampleN: 15, // matches needed per side for a "full" data-quality score
    minSampleNHard: 4  // below this -> INSUFFICIENT_HISTORY, hard fail-closed
  },

  // ---- 9. CALIBRATION SHRINKAGE -------------------------------------------
  calibration: {
    minModelWeight: 0.20,
    maxModelWeight: 0.65
  },

  // ---- 10. ODDS POLICY ------------------------------------------------------
  odds: {
    minPublicOdd: 1.70,
    maxPublicOdd: 2.05
  },

  // ---- 12. EXTREME EV PROTECTION -------------------------------------------
  ev: {
    overconfidencePenaltyThreshold: 0.12,
    hardRejectThreshold: 0.18,
    overconfidencePenaltyPoints: 15, // MarketScore points deducted 0..100 scale
    minCalibratedEv: 0.03,
    minCalibratedEdgePp: 0.02 // 2 percentage points, expressed as a fraction
  },

  // ---- 13. MARKET SCORE WEIGHTS --------------------------------------------
  score: {
    weights: {
      probabilityConfidence: 0.25,
      historyConsistency: 0.20,
      dataQuality: 0.15,
      marketAgreement: 0.15,
      homeAwayRelevance: 0.10,
      priceValueQuality: 0.10,
      leagueReliability: 0.05
    },
    disagreementPenaltyThresholdPp: 0.15, // |edge| beyond this starts penalizing
    disagreementPenaltyMax: 20,
    lowSamplePenaltyMax: 15,
    unstablePricePenaltyMax: 10,
    poorHomeAwayPenaltyMax: 10,
    weakLeaguePenaltyMax: 10,
    poorDataQualityPenaltyMax: 10
  },

  // ---- 15. MARKET SEPARATION -----------------------------------------------
  selection: {
    minScoreSeparation: 3
  },

  // ---- 16. PUBLIC QUALITY GATE ----------------------------------------------
  gate: {
    minMarketScore: 65,
    minDataQuality: 82,
    minHistoryScore: 68,
    maxSnapshotAgeMinutes: 55,
    maxPriceDeteriorationPct: 0.02
  },

  // ---- 17. VOLUME CAPS -------------------------------------------------------
  volume: {
    minPublicPerDay: 0,
    maxPublicPerRun: 2,
    maxPublicPerDay: 4
  },

  // ---- 22. STAKE ---------------------------------------------------------
  stake: {
    fixedStakeEur: 100,
    useKelly: false
  },

  // ---- 28. SAFE DOUBLE ------------------------------------------------------
  safeDouble: {
    publicEnabled: false
  },

  // ---- 29. SCHEDULE (Europe/Sofia) -------------------------------------------
  schedule: {
    minMinutesToKickoff: 45,
    windows: [
      { id: 'A', scoutTime: '07:00', selectorTime: '07:30' },
      { id: 'B', scoutTime: '14:00', selectorTime: '14:30' },
      { id: 'C', scoutTime: '21:00', selectorTime: '21:30' }
    ]
  },

  // ---- 30. API RATE LIMIT ---------------------------------------------------
  provider: {
    name: '5DollarFootballAPI PRO',
    sharedLimitPerMinute: 10,
    maxRequestsPerMinute: 9,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
    maxRetries: 2
  },

  rejectionReasons: REJECTION_REASONS
});

if (typeof module !== 'undefined') {
  module.exports = { CONFIG, REJECTION_REASONS, ENGINE_VERSION, MODEL_VERSION, CALIBRATION_VERSION, SCORE_VERSION };
}
