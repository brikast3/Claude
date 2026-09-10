"""
Time-weighted Dixon-Coles Poisson model (Dixon & Coles, 1997, Applied Statistics 46(2)).

Same core mathematics as the production n8n Asian Lines engine this project is
adapted from (geometric-mean lambdas replaced here by a proper maximum-likelihood
fit; the low-score tau correction and Asian-line settlement logic are ported
verbatim so results are directly comparable). This module is deliberately
dependency-light (numpy + scipy only) and side-effect-free so it can be unit
tested and walk-forward-backtested without touching any network or database.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson as _poisson

MAX_GOALS = 10


def dc_tau(h: int, a: int, lam: float, mu: float, rho: float) -> float:
    """Dixon-Coles low-score correlation correction."""
    if h == 0 and a == 0:
        return 1 - lam * mu * rho
    if h == 0 and a == 1:
        return 1 + lam * rho
    if h == 1 and a == 0:
        return 1 + mu * rho
    if h == 1 and a == 1:
        return 1 - rho
    return 1.0


@dataclass
class DixonColesModel:
    teams: list[str] = field(default_factory=list)
    attack: dict[str, float] = field(default_factory=dict)
    defense: dict[str, float] = field(default_factory=dict)
    home_adv: float = 0.0
    rho: float = 0.0
    games_played: dict[str, int] = field(default_factory=dict)

    def fit(self, matches, xi: float = 0.0018, as_of=None) -> "DixonColesModel":
        """Fit on a dataframe with Date/HomeTeam/AwayTeam/FTHG/FTAG columns.

        xi: exponential time-decay rate (days). Dixon & Coles found ~0.0018 to be
        roughly optimal on weekly English league data - treat it as a tunable
        hyperparameter, not a universal constant.
        as_of: reference date for the exponential weights; defaults to the last
        match date in `matches` (used to give a walk-forward backtest a
        "current moment" independent of the training slice's own last row).
        """
        if len(matches) == 0:
            raise ValueError("cannot fit Dixon-Coles model on zero matches")
        teams = sorted(set(matches["HomeTeam"]) | set(matches["AwayTeam"]))
        n = len(teams)
        idx = {t: i for i, t in enumerate(teams)}

        ref_date = as_of if as_of is not None else matches["Date"].max()
        days_ago = (ref_date - matches["Date"]).dt.days.clip(lower=0).to_numpy()
        weights = np.exp(-xi * days_ago)

        home_idx = matches["HomeTeam"].map(idx).to_numpy()
        away_idx = matches["AwayTeam"].map(idx).to_numpy()
        hg = matches["FTHG"].to_numpy()
        ag = matches["FTAG"].to_numpy()

        # Parameter vector: [alpha_1..alpha_{n-1}, beta_1..beta_n, gamma, rho]
        # alpha_n is fixed to -sum(other alphas) for identifiability.
        def unpack(x):
            alpha = np.empty(n)
            alpha[: n - 1] = x[: n - 1]
            alpha[n - 1] = -alpha[: n - 1].sum()
            beta = x[n - 1 : 2 * n - 1]
            gamma = x[2 * n - 1]
            rho = x[2 * n]
            return alpha, beta, gamma, rho

        def neg_log_lik(x):
            alpha, beta, gamma, rho = unpack(x)
            lam = np.exp(alpha[home_idx] + beta[away_idx] + gamma)
            mu = np.exp(alpha[away_idx] + beta[home_idx])
            ll = (
                _poisson.logpmf(hg, lam)
                + _poisson.logpmf(ag, mu)
            )
            tau = np.array(
                [dc_tau(int(h), int(a), lm, mm, rho) for h, a, lm, mm in zip(hg, ag, lam, mu)]
            )
            tau = np.clip(tau, 1e-10, None)
            ll = ll + np.log(tau)
            return -np.sum(weights * ll)

        x0 = np.zeros(2 * n + 1)
        bounds = [(-3, 3)] * (2 * n - 1) + [(-3, 3)] + [(-0.5, 0.5)]
        res = minimize(neg_log_lik, x0, method="L-BFGS-B", bounds=bounds)
        alpha, beta, gamma, rho = unpack(res.x)

        self.teams = teams
        self.attack = {t: float(alpha[idx[t]]) for t in teams}
        self.defense = {t: float(beta[idx[t]]) for t in teams}
        self.home_adv = float(gamma)
        self.rho = float(rho)
        self.games_played = {
            t: int(((matches["HomeTeam"] == t) | (matches["AwayTeam"] == t)).sum())
            for t in teams
        }
        return self

    def lambdas(self, home: str, away: str) -> tuple[float, float]:
        if home not in self.attack or away not in self.attack:
            raise KeyError(f"unknown team(s): {home!r}, {away!r}")
        lam = np.exp(self.attack[home] + self.defense[away] + self.home_adv)
        mu = np.exp(self.attack[away] + self.defense[home])
        return float(lam), float(mu)

    def score_matrix(self, home: str, away: str, max_goals: int = MAX_GOALS) -> np.ndarray:
        lam, mu = self.lambdas(home, away)
        hp = _poisson.pmf(np.arange(max_goals + 1), lam)
        ap = _poisson.pmf(np.arange(max_goals + 1), mu)
        grid = np.outer(hp, ap)
        for h in (0, 1):
            for a in (0, 1):
                grid[h, a] *= dc_tau(h, a, lam, mu, self.rho)
        grid = np.clip(grid, 0, None)
        grid /= grid.sum()
        return grid

    def reliability(self, home: str, away: str, min_games: int = 6, saturate_games: int = 30) -> float:
        """0..1 confidence proxy from how much history each team has in the fitted
        window. Not a statistical guarantee - just a sample-size sanity gate, same
        role as `reliabilityScore` in the production engine but derived from actual
        games-in-fit rather than a goals-variance heuristic.
        """
        gh = self.games_played.get(home, 0)
        ga = self.games_played.get(away, 0)
        if min(gh, ga) < min_games:
            return 0.0
        return float(np.clip(min(gh, ga) / saturate_games, 0.0, 1.0))


def match_odds_probs(grid: np.ndarray) -> dict[str, float]:
    home_win = float(np.tril(grid, -1).sum())
    draw = float(np.trace(grid))
    away_win = float(np.triu(grid, 1).sum())
    return {"H": home_win, "D": draw, "A": away_win}


def split_line(line: float) -> list[float]:
    """Quarter lines (X.25/X.75) settle as two half-stake bets on the adjacent
    half/whole lines, exactly like Asian handicap/goal-line settlement.
    """
    q = round(line * 4) / 4
    frac = abs(q - int(q))
    if abs(frac - 0.25) < 1e-7 or abs(frac - 0.75) < 1e-7:
        return [q - 0.25, q + 0.25]
    return [q]


def _settle_base(family: str, side: str, line: float, h: int, a: int) -> str:
    if family == "TOTAL":
        total = h + a
        if side == "OVER":
            return "W" if total > line else ("P" if total == line else "L")
        return "W" if total < line else ("P" if total == line else "L")
    diff = (h - a) if side == "HOME" else (a - h)
    z = diff + line
    return "W" if z > 0 else ("P" if z == 0 else "L")


def outcome_probabilities(grid: np.ndarray, family: str, side: str, line: float) -> dict[str, float]:
    """P(win)/P(push)/P(loss) for a total-goals or handicap bet, splitting quarter
    lines into two half-stake legs the same way the production engine settles them.
    """
    parts = split_line(line)
    probs = {"W": 0.0, "P": 0.0, "L": 0.0}
    max_goals = grid.shape[0] - 1
    for part in parts:
        sub = {"W": 0.0, "P": 0.0, "L": 0.0}
        for h in range(max_goals + 1):
            for a in range(max_goals + 1):
                p = grid[h, a]
                if p <= 0:
                    continue
                sub[_settle_base(family, side, part, h, a)] += p
        for k in probs:
            probs[k] += sub[k] / len(parts)
    return probs


def fair_odd_from_outcome(probs: dict[str, float]) -> float | None:
    """Fair decimal odd implied by W/P/L probabilities (pushes refund stake)."""
    coeff = probs["W"]
    if coeff <= 0:
        return None
    return (1 - probs["P"]) / coeff


def settle_return(family: str, side: str, line: float, h: int, a: int, odd: float) -> float:
    """Actual payout multiplier for a 1-unit stake on ONE resolved match, splitting
    a quarter line into two half-stake legs. 0 = full loss, 0.5 = half loss,
    1.0 = push (stake refunded), (1+odd)/2 = half win, odd = full win. Mirrors
    settleAsian() in the production engine bit for bit.
    """
    parts = split_line(line)
    ret = 0.0
    for part in parts:
        outcome = _settle_base(family, side, part, h, a)
        leg_return = odd if outcome == "W" else (1.0 if outcome == "P" else 0.0)
        ret += leg_return / len(parts)
    return ret
