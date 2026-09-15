// SOCCER RADAR v6.26 · Exact Bet365 price lookup. No fallback, ever:
// no nearest line, no nearest market, no other bookmaker, no stale/assumed price.
// Missing data always resolves to hasExactMarket/hasExactLine = false.

function lookupPrice(bet365, market) {
  const { marketFamily, side, line, bookLine } = market;

  if (marketFamily === 'BTTS') {
    if (!bet365.btts) return { hasExactMarket: false, hasExactLine: false };
    const odd = side === 'YES' ? bet365.btts.yes : bet365.btts.no;
    const opposite = side === 'YES' ? bet365.btts.no : bet365.btts.yes;
    if (!(odd > 1)) return { hasExactMarket: true, hasExactLine: false };
    return { hasExactMarket: true, hasExactLine: true, odd, oppositeOdd: opposite };
  }

  if (marketFamily === 'MONEYLINE') {
    if (!bet365.moneyline) return { hasExactMarket: false, hasExactLine: false };
    const map = { HOME_WIN: 'home', DRAW: 'draw', AWAY_WIN: 'away' };
    const odd = bet365.moneyline[map[side]];
    if (!(odd > 1)) return { hasExactMarket: true, hasExactLine: false };
    const others = Object.keys(map).filter(k => k !== side).map(k => bet365.moneyline[map[k]]);
    return { hasExactMarket: true, hasExactLine: true, odd, otherOdds: others };
  }

  if (marketFamily === 'DOUBLE_CHANCE') {
    if (!bet365.doubleChance) return { hasExactMarket: false, hasExactLine: false };
    const odd = side === 'ONE_X' ? bet365.doubleChance.oneX : bet365.doubleChance.xTwo;
    if (!(odd > 1)) return { hasExactMarket: true, hasExactLine: false };
    return { hasExactMarket: true, hasExactLine: true, odd, oppositeOdd: null };
  }

  if (marketFamily === 'GOALS') {
    const isStandard = line === 1.5 || line === 2.5 || line === 3.5;
    const table = isStandard ? bet365.totals : bet365.asianTotals;
    if (!table) return { hasExactMarket: false, hasExactLine: false };
    const entry = table[String(line)];
    if (!entry) return { hasExactMarket: true, hasExactLine: false };
    const odd = side === 'OVER' ? entry.over : entry.under;
    const opposite = side === 'OVER' ? entry.under : entry.over;
    if (!(odd > 1)) return { hasExactMarket: true, hasExactLine: false };
    return { hasExactMarket: true, hasExactLine: true, odd, oppositeOdd: opposite };
  }

  if (marketFamily === 'ASIAN_HANDICAP') {
    if (!bet365.asianHandicap) return { hasExactMarket: false, hasExactLine: false };
    const entry = bet365.asianHandicap[String(bookLine)];
    if (!entry) return { hasExactMarket: true, hasExactLine: false };
    const odd = side === 'HOME' ? entry.home : entry.away;
    const opposite = side === 'HOME' ? entry.away : entry.home;
    if (!(odd > 1)) return { hasExactMarket: true, hasExactLine: false };
    return { hasExactMarket: true, hasExactLine: true, odd, oppositeOdd: opposite };
  }

  throw new Error('UNEXPECTED_ERROR');
}

if (typeof module !== 'undefined') {
  module.exports = { lookupPrice };
}
