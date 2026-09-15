// SOCCER RADAR v6.26 · The fixed universe of markets evaluated for every fixture.
// GOALS(16) + BTTS(2) + MONEYLINE(3) + DOUBLE_CHANCE(2) + ASIAN_HANDICAP(26) = 49.

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

function buildMarketUniverse(config) {
  const markets = [];

  for (const line of config.markets.goalsLines) {
    for (const side of ['OVER', 'UNDER']) {
      const asian = !isStandardGoalsLine(line);
      const key = `${side}_${niceLineLabel(line).replace('.', '_')}${asian ? '_ASIAN' : ''}`;
      markets.push({ marketFamily: 'GOALS', marketKey: key, side, line });
    }
  }

  markets.push({ marketFamily: 'BTTS', marketKey: 'BTTS_YES', side: 'YES', line: null });
  markets.push({ marketFamily: 'BTTS', marketKey: 'BTTS_NO', side: 'NO', line: null });

  markets.push({ marketFamily: 'MONEYLINE', marketKey: 'HOME_WIN', side: 'HOME_WIN', line: null });
  markets.push({ marketFamily: 'MONEYLINE', marketKey: 'DRAW', side: 'DRAW', line: null });
  markets.push({ marketFamily: 'MONEYLINE', marketKey: 'AWAY_WIN', side: 'AWAY_WIN', line: null });

  markets.push({ marketFamily: 'DOUBLE_CHANCE', marketKey: 'ONE_X', side: 'ONE_X', line: null });
  markets.push({ marketFamily: 'DOUBLE_CHANCE', marketKey: 'X_TWO', side: 'X_TWO', line: null });

  for (const homeLine of config.markets.asianHandicapLines) {
    const homeKey = `AH_HOME_${niceLineLabel(homeLine).replace('.', '_').replace('-', 'M')}`;
    const awayKey = `AH_AWAY_${niceLineLabel(homeLine).replace('.', '_').replace('-', 'M')}`;
    markets.push({ marketFamily: 'ASIAN_HANDICAP', marketKey: homeKey, side: 'HOME', line: homeLine, bookLine: homeLine });
    markets.push({ marketFamily: 'ASIAN_HANDICAP', marketKey: awayKey, side: 'AWAY', line: -homeLine, bookLine: homeLine });
  }

  return markets;
}

if (typeof module !== 'undefined') {
  module.exports = { buildMarketUniverse, lineKey, niceLineLabel, isStandardGoalsLine };
}
