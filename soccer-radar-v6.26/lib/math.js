// SOCCER RADAR v6.26 · Goal model mathematics.
// Poisson / Dixon-Coles score matrix + settlement-aware market probabilities.
// Ported (same tau correction, same quarter-line split-and-average technique)
// from the project's own backtested football-quant/src/dixon_coles.py so the
// live engine and the offline research code agree bit-for-bit on methodology.

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonPmf(k, lambda) {
  if (!(lambda > 0) || k < 0) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

// Dixon-Coles low-score correlation correction.
function dcTau(h, a, lam, mu, rho) {
  if (h === 0 && a === 0) return 1 - lam * mu * rho;
  if (h === 0 && a === 1) return 1 + lam * rho;
  if (h === 1 && a === 0) return 1 + mu * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// Builds a normalized (maxGoals+1) x (maxGoals+1) score-probability matrix.
function buildScoreMatrix(lambdaHome, lambdaAway, rho, maxGoals) {
  if (!(lambdaHome > 0) || !(lambdaAway > 0)) {
    throw new Error('MODEL_PROBABILITY_INVALID');
  }
  const n = maxGoals + 1;
  const grid = [];
  for (let h = 0; h < n; h++) {
    const row = [];
    for (let a = 0; a < n; a++) {
      let p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      if (h <= 1 && a <= 1) p *= dcTau(h, a, lambdaHome, lambdaAway, rho);
      row.push(Math.max(0, p));
    }
    grid.push(row);
  }
  let sum = 0;
  for (let h = 0; h < n; h++) for (let a = 0; a < n; a++) sum += grid[h][a];
  if (!(sum > 0)) throw new Error('MODEL_PROBABILITY_INVALID');
  for (let h = 0; h < n; h++) for (let a = 0; a < n; a++) grid[h][a] /= sum;
  return grid;
}

// Quarter lines (x.25 / x.75) settle as two half-stake legs on the adjacent
// half/whole lines. Whole and half lines settle as a single leg. Mirrors
// split_line() in football-quant/src/dixon_coles.py (Math.trunc, not floor,
// so negative handicap lines split the same way Python's int() truncation does).
function splitLine(line) {
  const q = Math.round(line * 4) / 4;
  const frac = Math.abs(q - Math.trunc(q));
  if (Math.abs(frac - 0.25) < 1e-7 || Math.abs(frac - 0.75) < 1e-7) {
    return [round4(q - 0.25), round4(q + 0.25)];
  }
  return [q];
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

// Unified settlement-outcome classifier for one resolved leg.
// family: 'TOTAL' (goals over/under, any line shape) | 'HANDICAP' (Asian handicap)
// side:   TOTAL -> 'OVER' | 'UNDER'      HANDICAP -> 'HOME' | 'AWAY'
function settleBaseOutcome(family, side, line, h, a) {
  if (family === 'TOTAL') {
    const total = h + a;
    if (side === 'OVER') return total > line ? 'W' : total === line ? 'P' : 'L';
    return total < line ? 'W' : total === line ? 'P' : 'L';
  }
  if (family === 'HANDICAP') {
    const diff = side === 'HOME' ? h - a : a - h;
    const z = diff + line;
    return z > 0 ? 'W' : z === 0 ? 'P' : 'L';
  }
  throw new Error('UNEXPECTED_ERROR');
}

// P(win)/P(push)/P(loss) for a total-goals or handicap market, averaging the
// two half-stake legs of a quarter line.
function outcomeProbabilities(grid, family, side, line) {
  const parts = splitLine(line);
  const probs = { W: 0, P: 0, L: 0 };
  const maxGoals = grid.length - 1;
  for (const part of parts) {
    const sub = { W: 0, P: 0, L: 0 };
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = grid[h][a];
        if (p <= 0) continue;
        sub[settleBaseOutcome(family, side, part, h, a)] += p;
      }
    }
    probs.W += sub.W / parts.length;
    probs.P += sub.P / parts.length;
    probs.L += sub.L / parts.length;
  }
  return probs;
}

// Push-normalized "fair" probability of the bet winning, used everywhere the
// spec calls for a single model_probability value (EV = P*odd - 1 style math).
function pushNormalizedProbability(outcome) {
  const denom = 1 - outcome.P;
  if (!(denom > 1e-9)) return null; // certain push -> no meaningful probability
  return outcome.W / denom;
}

function moneylineProbabilities(grid) {
  let home = 0, draw = 0, away = 0;
  const n = grid.length;
  for (let h = 0; h < n; h++) {
    for (let a = 0; a < n; a++) {
      const p = grid[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  return { HOME_WIN: home, DRAW: draw, AWAY_WIN: away };
}

function bttsProbabilities(grid) {
  let yes = 0;
  const n = grid.length;
  for (let h = 0; h < n; h++) {
    for (let a = 0; a < n; a++) {
      if (h >= 1 && a >= 1) yes += grid[h][a];
    }
  }
  return { BTTS_YES: yes, BTTS_NO: 1 - yes };
}

function doubleChanceProbabilities(moneyline) {
  return {
    ONE_X: moneyline.HOME_WIN + moneyline.DRAW,
    X_TWO: moneyline.DRAW + moneyline.AWAY_WIN
  };
}

function expectedTotalGoals(lambdaHome, lambdaAway) {
  return lambdaHome + lambdaAway;
}

if (typeof module !== 'undefined') {
  module.exports = {
    poissonPmf,
    dcTau,
    buildScoreMatrix,
    splitLine,
    settleBaseOutcome,
    outcomeProbabilities,
    pushNormalizedProbability,
    moneylineProbabilities,
    bttsProbabilities,
    doubleChanceProbabilities,
    expectedTotalGoals
  };
}
