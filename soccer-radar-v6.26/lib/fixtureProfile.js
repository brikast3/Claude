// SOCCER RADAR v6.26 · FixtureProfile builder.
// Builds one recency-weighted team profile per side (home performance of the
// home team, away performance of the away team -- never blended, never a
// universal league constant) and combines both into lambdas for the goal model.

function weightedBucketAverage(valuesMostRecentFirst, bucketSize, weights) {
  const buckets = [];
  for (let i = 0; i < valuesMostRecentFirst.length; i += bucketSize) {
    buckets.push(valuesMostRecentFirst.slice(i, i + bucketSize));
  }
  let weightedSum = 0;
  let weightUsed = 0;
  for (let i = 0; i < weights.length; i++) {
    const bucket = buckets[i];
    if (!bucket || bucket.length === 0) continue;
    const mean = bucket.reduce((s, v) => s + v, 0) / bucket.length;
    weightedSum += mean * weights[i];
    weightUsed += weights[i];
  }
  // Any usable history beyond the configured buckets counts as "older" (last weight slot).
  if (buckets.length > weights.length) {
    const rest = buckets.slice(weights.length).flat();
    if (rest.length > 0) {
      const mean = rest.reduce((s, v) => s + v, 0) / rest.length;
      const w = weights[weights.length - 1] * 0.5; // diminishing extra tail weight
      weightedSum += mean * w;
      weightUsed += w;
    }
  }
  if (weightUsed <= 0) return null;
  return weightedSum / weightUsed;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

// matches: array ordered MOST RECENT FIRST, each { goalsFor, goalsAgainst }
// restricted to the venue relevant to the side being profiled (home matches
// for the home team's profile, away matches for the away team's profile).
function buildSideProfile(matches, config) {
  const n = matches.length;
  const goalsFor = matches.map(m => m.goalsFor);
  const goalsAgainst = matches.map(m => m.goalsAgainst);
  const weights = config.recency.weights;
  const bucketSize = config.recency.bucketSize;

  const scoringRate = weightedBucketAverage(goalsFor, bucketSize, weights);
  const concedingRate = weightedBucketAverage(goalsAgainst, bucketSize, weights);
  const cleanSheetRate = weightedBucketAverage(matches.map(m => (m.goalsAgainst === 0 ? 1 : 0)), bucketSize, weights);
  const failedToScoreRate = weightedBucketAverage(matches.map(m => (m.goalsFor === 0 ? 1 : 0)), bucketSize, weights);
  const bttsRate = weightedBucketAverage(matches.map(m => (m.goalsFor > 0 && m.goalsAgainst > 0 ? 1 : 0)), bucketSize, weights);
  const o15Rate = weightedBucketAverage(matches.map(m => (m.goalsFor + m.goalsAgainst > 1.5 ? 1 : 0)), bucketSize, weights);
  const o25Rate = weightedBucketAverage(matches.map(m => (m.goalsFor + m.goalsAgainst > 2.5 ? 1 : 0)), bucketSize, weights);
  const o35Rate = weightedBucketAverage(matches.map(m => (m.goalsFor + m.goalsAgainst > 3.5 ? 1 : 0)), bucketSize, weights);

  const sampleN = n;
  const dataQualityScore = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, sampleN / config.quality.targetSampleN))));

  // History consistency: penalize erratic scoring output relative to its own mean.
  const gfMean = n ? goalsFor.reduce((s, v) => s + v, 0) / n : 0;
  const consistency = n >= 2 ? Math.max(0, 1 - stdDev(goalsFor) / (gfMean + 1)) : 0;
  const sampleSufficiency = Math.min(1, sampleN / config.quality.targetSampleN);
  const historyScore = Math.max(0, Math.min(100, Math.round(100 * (0.5 * consistency + 0.5 * sampleSufficiency))));

  return {
    sampleN,
    scoringRate: scoringRate ?? 0,
    concedingRate: concedingRate ?? 0,
    cleanSheetRate: cleanSheetRate ?? 0,
    failedToScoreRate: failedToScoreRate ?? 0,
    bttsRate: bttsRate ?? 0,
    o15Rate: o15Rate ?? 0,
    o25Rate: o25Rate ?? 0,
    o35Rate: o35Rate ?? 0,
    dataQualityScore,
    historyScore,
    hasUsableHistory: sampleN >= config.quality.minSampleNHard
  };
}

// leagueContext: { avgGoalsPerMatch: number|null, fixturesObservedThisRun: number }
// Derived dynamically from fixtures seen in THIS run for THIS league -- never a
// hard-coded per-league constant. If insufficient in-run coverage, factor is 1
// (purely team-driven lambdas, no external adjustment).
function buildFixtureProfile(input, config) {
  const { homeMatches, awayMatches, leagueContext } = input;
  const home = buildSideProfile(homeMatches || [], config);
  const away = buildSideProfile(awayMatches || [], config);

  if (!home.hasUsableHistory || !away.hasUsableHistory) {
    return {
      home, away,
      insufficientHistory: true,
      lambdaHome: null,
      lambdaAway: null,
      dataQualityScore: Math.min(home.dataQualityScore, away.dataQualityScore),
      historyScore: Math.min(home.historyScore, away.historyScore)
    };
  }

  const leagueFactor = (leagueContext && leagueContext.avgGoalsPerMatch && leagueContext.fixturesObservedThisRun >= 4)
    ? clampFactor(leagueContext.avgGoalsPerMatch / 2.6, 0.75, 1.35)
    : 1;

  const lambdaHome = Math.max(0.05, ((home.scoringRate + away.concedingRate) / 2) * leagueFactor);
  const lambdaAway = Math.max(0.05, ((away.scoringRate + home.concedingRate) / 2) * leagueFactor);

  return {
    home,
    away,
    insufficientHistory: false,
    lambdaHome,
    lambdaAway,
    leagueFactor,
    dataQualityScore: Math.round((home.dataQualityScore + away.dataQualityScore) / 2),
    historyScore: Math.round((home.historyScore + away.historyScore) / 2)
  };
}

function clampFactor(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

if (typeof module !== 'undefined') {
  module.exports = { buildSideProfile, buildFixtureProfile, weightedBucketAverage, stdDev };
}
