// SOCCER RADAR v6.26 · The universe of markets evaluated for a fixture.
// Built ONLY from selections that have a real Bet365 price in the canonical
// snapshot -- no theoretical full-grid expansion, no nearest-line fallback,
// no synthetic markets. A market Bet365 never quoted for this fixture was
// never truly "evaluated" in the fail-closed sense (spec SS20), so it never
// becomes a sr_v626_market_candidates row at all, rather than a permanent
// EXACT_MARKET_NOT_FOUND placeholder. The theoretical maximum, if every line
// in config were priced, is GOALS(16) + BTTS(2) + MONEYLINE(3) +
// DOUBLE_CHANCE(2) + ASIAN_HANDICAP(26) = 49.

function lineKey(line) {
  return String(line);
}

function niceLineLabel(line) {
  const s = (Math.round(Math.abs(line) * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  return line < 0 ? '-' + s : s;
}

function isStandardGoalsLine(line) {
  return line === 1.5 || line === 2.5 || line === 3.5;
}

function hasOdd(v) {
  return Number(v) > 1;
}

function goalsMarketKey(side, line) {
  const asian = !isStandardGoalsLine(line);
  return `${side}_${niceLineLabel(line).replace('.', '_')}${asian ? '_ASIAN' : ''}`;
}

function ahMarketKey(side, homeLine) {
  return `AH_${side}_${niceLineLabel(homeLine).replace('.', '_').replace('-', 'M')}`;
}

// bet365: the canonical payload from lib/priceLookup.js (moneyline, btts,
// totals, asianTotals, asianHandicap, doubleChance) -- whatever Bet365 has
// actually quoted for this fixture, nothing more.
function buildMarketUniverse(config, bet365) {
  const b = bet365 || {};
  const markets = [];

  const pushGoalsTable = (table) => {
    if (!table || typeof table !== 'object') return;
    for (const [rawLine, q] of Object.entries(table)) {
      const line = Number(rawLine);
      if (!Number.isFinite(line) || !q || typeof q !== 'object') continue;
      if (hasOdd(q.over)) markets.push({ marketFamily: 'GOALS', marketKey: goalsMarketKey('OVER', line), side: 'OVER', line });
      if (hasOdd(q.under)) markets.push({ marketFamily: 'GOALS', marketKey: goalsMarketKey('UNDER', line), side: 'UNDER', line });
    }
  };
  pushGoalsTable(b.totals);
  pushGoalsTable(b.asianTotals);

  if (b.btts) {
    if (hasOdd(b.btts.yes)) markets.push({ marketFamily: 'BTTS', marketKey: 'BTTS_YES', side: 'YES', line: null });
    if (hasOdd(b.btts.no)) markets.push({ marketFamily: 'BTTS', marketKey: 'BTTS_NO', side: 'NO', line: null });
  }

  if (b.moneyline) {
    if (hasOdd(b.moneyline.home)) markets.push({ marketFamily: 'MONEYLINE', marketKey: 'HOME_WIN', side: 'HOME_WIN', line: null });
    if (hasOdd(b.moneyline.draw)) markets.push({ marketFamily: 'MONEYLINE', marketKey: 'DRAW', side: 'DRAW', line: null });
    if (hasOdd(b.moneyline.away)) markets.push({ marketFamily: 'MONEYLINE', marketKey: 'AWAY_WIN', side: 'AWAY_WIN', line: null });
  }

  if (b.doubleChance) {
    if (hasOdd(b.doubleChance.oneX)) markets.push({ marketFamily: 'DOUBLE_CHANCE', marketKey: 'ONE_X', side: 'ONE_X', line: null });
    if (hasOdd(b.doubleChance.xTwo)) markets.push({ marketFamily: 'DOUBLE_CHANCE', marketKey: 'X_TWO', side: 'X_TWO', line: null });
  }

  if (b.asianHandicap && typeof b.asianHandicap === 'object') {
    for (const [rawLine, q] of Object.entries(b.asianHandicap)) {
      const homeLine = Number(rawLine);
      if (!Number.isFinite(homeLine) || !q || typeof q !== 'object') continue;
      if (hasOdd(q.home)) markets.push({ marketFamily: 'ASIAN_HANDICAP', marketKey: ahMarketKey('HOME', homeLine), side: 'HOME', line: homeLine, bookLine: homeLine });
      if (hasOdd(q.away)) markets.push({ marketFamily: 'ASIAN_HANDICAP', marketKey: ahMarketKey('AWAY', homeLine), side: 'AWAY', line: -homeLine, bookLine: homeLine });
    }
  }

  return markets;
}

if (typeof module !== 'undefined') {
  module.exports = { buildMarketUniverse, lineKey, niceLineLabel, isStandardGoalsLine };
}
