// SOCCER RADAR v6.26 · De-vig market probability.
// Bookmaker odds are never accepted directly as fair probability. When both
// sides of a market are available, the overround is removed proportionally.

function impliedProbability(odd) {
  if (!(odd > 1)) return null;
  return 1 / odd;
}

function devigTwoWay(oddSide, oddOpposite) {
  const pSide = impliedProbability(oddSide);
  const pOpp = impliedProbability(oddOpposite);
  if (pSide === null || pOpp === null) return { raw: pSide, devig: null, margin: null };
  const overround = pSide + pOpp;
  if (!(overround > 0)) return { raw: pSide, devig: null, margin: null };
  return { raw: pSide, devig: pSide / overround, margin: overround - 1 };
}

function devigThreeWay(oddSide, oddOther1, oddOther2) {
  const pSide = impliedProbability(oddSide);
  const p1 = impliedProbability(oddOther1);
  const p2 = impliedProbability(oddOther2);
  if (pSide === null || p1 === null || p2 === null) return { raw: pSide, devig: null, margin: null };
  const overround = pSide + p1 + p2;
  if (!(overround > 0)) return { raw: pSide, devig: null, margin: null };
  return { raw: pSide, devig: pSide / overround, margin: overround - 1 };
}

if (typeof module !== 'undefined') {
  module.exports = { impliedProbability, devigTwoWay, devigThreeWay };
}
