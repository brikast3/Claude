// SOCCER RADAR v6.26 · Best-market-per-fixture selection.
// Ranking and the score-separation check only ever compete among PUBLIC-ENABLED
// market families. Asian Handicap candidates are still fully scored and stored
// (research dataset) but never enter this competition while AH is not public.

function selectBestMarketPerFixture(candidates, config) {
  const R = config.rejectionReasons;
  const publicFamilies = new Set(config.markets.publicEnabledFamilies);

  const enriched = candidates.map(c => ({ ...c }));
  const eligible = enriched.filter(c => publicFamilies.has(c.marketFamily));

  if (eligible.length === 0) {
    for (const c of enriched) {
      c.rankInFixture = null;
      c.scoreSeparation = null;
      c.selectedAsBestMarket = false;
      // AH-only fixture: nothing was ever in competition for the public slot.
    }
    return { candidates: enriched, bestCandidate: null, separation: null };
  }

  const sorted = [...eligible].sort((a, b) => b.marketScore - a.marketScore);
  sorted.forEach((c, i) => { c.rankInFixture = i + 1; });

  const best = sorted[0];
  const second = sorted[1] || null;
  const separation = second ? round2(best.marketScore - second.marketScore) : null;

  for (const c of sorted) {
    if (c === best) {
      c.scoreSeparation = separation;
      if (c.rejectionReason) {
        // The top-ranked-by-score candidate already failed its own gate (e.g.
        // odd out of range). We never cascade down to the second-best market
        // just to force a signal -- the fixture simply produces no pick.
        c.selectedAsBestMarket = false;
      } else if (second !== null && separation < config.selection.minScoreSeparation) {
        c.selectedAsBestMarket = false;
        c.rejectionReason = R.SECOND_MARKET_TOO_CLOSE;
      } else {
        c.selectedAsBestMarket = true;
      }
    } else {
      c.scoreSeparation = round2(c.marketScore - best.marketScore);
      c.selectedAsBestMarket = false;
      // Only overwrite a still-empty reason -- a candidate that already failed
      // its own gate (e.g. DATA_QUALITY_LOW) keeps that more specific reason.
      if (!c.rejectionReason) c.rejectionReason = R.BETTER_MARKET_ON_SAME_FIXTURE;
    }
  }

  // Candidates outside the public-enabled families (Asian Handicap) never competed.
  for (const c of enriched) {
    if (!publicFamilies.has(c.marketFamily)) {
      c.rankInFixture = null;
      c.scoreSeparation = null;
      c.selectedAsBestMarket = false;
    }
  }

  const selected = enriched.find(c => c.selectedAsBestMarket === true) || null;
  return { candidates: enriched, bestCandidate: selected, separation };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

if (typeof module !== 'undefined') {
  module.exports = { selectBestMarketPerFixture };
}
