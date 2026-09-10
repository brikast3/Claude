"""Market-side helpers: de-vigging bookmaker odds and staking."""
from __future__ import annotations


def no_vig_fair_odds_2way(odd_a: float, odd_b: float) -> tuple[float, float]:
    """Proportional (equal-margin) de-vig for a two-way market, e.g. Over/Under
    or a single Asian handicap side vs its pair. Same method as noVigFair() in
    the production engine.
    """
    pa, pb = 1 / odd_a, 1 / odd_b
    overround = pa + pb
    return overround / pa, overround / pb


def no_vig_fair_probs_3way(odd_h: float, odd_d: float, odd_a: float) -> dict[str, float]:
    """Proportional de-vig for a three-way 1X2 market."""
    ph, pd, pa = 1 / odd_h, 1 / odd_d, 1 / odd_a
    overround = ph + pd + pa
    return {"H": ph / overround, "D": pd / overround, "A": pa / overround}


def kelly_stake(prob: float, odd: float, bankroll: float, fraction: float = 0.3, cap: float = 0.03) -> float:
    """Fractional Kelly stake, capped as a fraction of bankroll. Mirrors
    kellyStake() in the production engine.
    """
    if not (odd > 1) or not (0 < prob < 1):
        return 0.0
    b = odd - 1
    f = ((prob * odd) - 1) / b
    return max(0.0, min(bankroll * f * fraction, bankroll * cap))
