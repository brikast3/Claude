// SOCCER RADAR v6.26 · Settlement engine.
// WIN / HALF_WIN / PUSH / HALF_LOSS / LOSS / VOID, with mathematically correct
// Asian quarter-line splitting (x.25 / x.75) for both goal totals and Asian
// Handicap, sharing the exact same return-factor math via lib/math.js.

// splitLine/settleBaseOutcome come from lib/math.js. When bundled into a single
// n8n Code node, math.js is concatenated in ahead of this file so these names
// are already in scope; under Node (tests, build script) we require them.
/* eslint-disable no-var */
var __math = typeof require !== 'undefined' ? require('./math') : null;
var splitLine = typeof splitLine !== 'undefined' ? splitLine : __math.splitLine;
var settleBaseOutcome = typeof settleBaseOutcome !== 'undefined' ? settleBaseOutcome : __math.settleBaseOutcome;

const EPS = 1e-6;

function classifyReturnFactor(factor, odd) {
  if (Math.abs(factor - odd) < EPS) return 'WIN';
  if (Math.abs(factor - (odd + 1) / 2) < EPS) return 'HALF_WIN';
  if (Math.abs(factor - 1) < EPS) return 'PUSH';
  if (Math.abs(factor - 0.5) < EPS) return 'HALF_LOSS';
  return 'LOSS';
}

// Return factor (multiplier on stake) for one resolved fixture on a total or
// handicap market, splitting quarter lines into two equally-weighted legs.
function asianReturnFactor(family, side, line, odd, ftHome, ftAway) {
  const parts = splitLine(line);
  let ret = 0;
  for (const part of parts) {
    const outcome = settleBaseOutcome(family, side, part, ftHome, ftAway);
    const legReturn = outcome === 'W' ? odd : outcome === 'P' ? 1 : 0;
    ret += legReturn / parts.length;
  }
  return ret;
}

// candidate: { marketFamily, side, line, odd }
// result:    { ftHome, ftAway, isVoid }
function settleCandidate(candidate, result, config) {
  const { marketFamily, side, line, odd } = candidate;
  const { ftHome, ftAway, isVoid } = result;

  if (isVoid) return { status: 'VOID', factor: 1 };
  if (!(odd > 1)) throw new Error('MARKET_PROBABILITY_INVALID');
  if (!Number.isFinite(ftHome) || !Number.isFinite(ftAway)) return { status: 'VOID', factor: 1 };

  if (marketFamily === 'GOALS') {
    const factor = asianReturnFactor('TOTAL', side, line, odd, ftHome, ftAway);
    return { status: classifyReturnFactor(factor, odd), factor };
  }
  if (marketFamily === 'ASIAN_HANDICAP') {
    const factor = asianReturnFactor('HANDICAP', side, line, odd, ftHome, ftAway);
    return { status: classifyReturnFactor(factor, odd), factor };
  }
  if (marketFamily === 'BTTS') {
    const bttsYes = ftHome >= 1 && ftAway >= 1;
    const won = side === 'YES' ? bttsYes : !bttsYes;
    return { status: won ? 'WIN' : 'LOSS', factor: won ? odd : 0 };
  }
  if (marketFamily === 'MONEYLINE') {
    const actual = ftHome > ftAway ? 'HOME_WIN' : ftHome < ftAway ? 'AWAY_WIN' : 'DRAW';
    const won = side === actual;
    return { status: won ? 'WIN' : 'LOSS', factor: won ? odd : 0 };
  }
  if (marketFamily === 'DOUBLE_CHANCE') {
    const homeWinsOutright = ftHome > ftAway;
    const awayWinsOutright = ftAway > ftHome;
    const won = side === 'ONE_X' ? !awayWinsOutright : !homeWinsOutright;
    return { status: won ? 'WIN' : 'LOSS', factor: won ? odd : 0 };
  }
  throw new Error('UNEXPECTED_ERROR');
}

function computeProfitEur(stakeEur, factor) {
  return Math.round(stakeEur * (factor - 1) * 100) / 100;
}

if (typeof module !== 'undefined') {
  module.exports = { classifyReturnFactor, asianReturnFactor, settleCandidate, computeProfitEur };
}
