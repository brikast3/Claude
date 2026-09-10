"""
Smoke + sanity tests using synthetic data (no network needed - football-data.co.uk
is not reachable from every environment, so this suite never depends on it).

These tests check internal consistency (probabilities sum to 1, staking behaves,
the walk-forward loop runs end to end) - they do NOT and cannot prove the model is
profitable on real markets. That question can only be answered by running
run_backtest.py against real football-data.co.uk history.
"""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.backtest import BacktestConfig, run_backtest
from src.dixon_coles import DixonColesModel, fair_odd_from_outcome, outcome_probabilities, settle_return, split_line
from src.market import kelly_stake, no_vig_fair_odds_2way, no_vig_fair_probs_3way


def make_synthetic_league(n_teams=10, n_rounds=3, seed=42, true_overround=1.06):
    """Round-robin synthetic league where the bookmaker prices close to the TRUE
    generating probabilities (plus a realistic overround). Under an efficient
    synthetic market like this, a correctly-implemented backtest should show no
    exploitable long-run edge - useful as a bug-catcher, not a profitability claim.
    """
    rng = np.random.default_rng(seed)
    teams = [f"Team{i}" for i in range(n_teams)]
    true_attack = {t: rng.normal(0, 0.3) for t in teams}
    true_defense = {t: rng.normal(0, 0.3) for t in teams}
    home_adv = 0.25

    rows = []
    date = pd.Timestamp("2022-08-01")
    for rnd in range(n_rounds):
        for i, home in enumerate(teams):
            for away in teams:
                if home == away:
                    continue
                lam = np.exp(true_attack[home] + true_defense[away] + home_adv)
                mu = np.exp(true_attack[away] + true_defense[home])
                hg = rng.poisson(lam)
                ag = rng.poisson(mu)
                ftr = "H" if hg > ag else ("A" if ag > hg else "D")

                # Price close to the true model with a flat overround, matching what
                # an efficient closing line looks like.
                max_g = 10
                hp = np.array([np.exp(-lam) * lam**k / math.factorial(k) for k in range(max_g + 1)])
                ap = np.array([np.exp(-mu) * mu**k / math.factorial(k) for k in range(max_g + 1)])
                grid = np.outer(hp, ap)
                grid /= grid.sum()
                true_probs = {
                    "H": float(np.tril(grid, -1).sum()),
                    "D": float(np.trace(grid)),
                    "A": float(np.triu(grid, 1).sum()),
                }
                # Fair odds from the true probabilities, then shrunk by the overround
                # so implied probabilities sum to `true_overround` (a realistic vig).
                odds = {k: (1 / v) / true_overround for k, v in true_probs.items()}

                total = hg + ag
                over_true_p = float(sum(p for (h, a), p in np.ndenumerate(grid) if h + a > 2))
                under_true_p = 1 - over_true_p
                over_odd = true_overround / over_true_p if over_true_p > 0 else 100.0
                under_odd = true_overround / under_true_p if under_true_p > 0 else 100.0

                rows.append(
                    {
                        "Date": date,
                        "HomeTeam": home,
                        "AwayTeam": away,
                        "FTHG": int(hg),
                        "FTAG": int(ag),
                        "FTR": ftr,
                        "B365H": odds["H"],
                        "B365D": odds["D"],
                        "B365A": odds["A"],
                        "B365>2.5": over_odd,
                        "B365<2.5": under_odd,
                    }
                )
                date += pd.Timedelta(days=1)
    return pd.DataFrame(rows)


def test_split_line():
    assert split_line(2.5) == [2.5]
    assert split_line(2.25) == [2.0, 2.5]
    assert split_line(-1.75) == [-2.0, -1.5]


def test_no_vig_helpers():
    fair_a, fair_b = no_vig_fair_odds_2way(1.90, 1.90)
    assert abs(fair_a - 2.0) < 1e-9 and abs(fair_b - 2.0) < 1e-9

    probs = no_vig_fair_probs_3way(2.0, 3.5, 4.0)
    assert abs(sum(probs.values()) - 1.0) < 1e-9


def test_kelly_stake_bounds():
    assert kelly_stake(0.5, 1.5, 1000) == 0.0  # negative-EV bet -> no stake
    stake = kelly_stake(0.6, 2.0, 1000, fraction=0.3, cap=0.03)
    assert 0 < stake <= 30.0  # capped at 3% of bankroll


def test_settle_return_asian_handicap():
    # Home -0.25 (quarter line splits into -0.5 and 0), draw actual result -> half loss.
    assert abs(settle_return("AH", "HOME", -0.25, 1, 1, 2.0) - 0.5) < 1e-9
    # Home -0.25, home wins by 1 -> covers both split lines -> full win.
    assert abs(settle_return("AH", "HOME", -0.25, 2, 1, 2.0) - 2.0) < 1e-9
    # Home 0 (pick'em), draw -> clean push, stake back.
    assert abs(settle_return("AH", "HOME", 0.0, 1, 1, 2.0) - 1.0) < 1e-9
    # Away +0.25 (mirror of home -0.25), draw actual result -> half win.
    assert abs(settle_return("AH", "AWAY", 0.25, 1, 1, 2.0) - 1.5) < 1e-9
    # Away +0.25, home wins by 1 -> away side loses outright on both split lines.
    assert abs(settle_return("AH", "AWAY", 0.25, 2, 1, 2.0) - 0.0) < 1e-9


def test_walk_forward_backtest_ah_market_runs():
    df = make_synthetic_league(n_teams=10, n_rounds=4, seed=4)
    rng = np.random.default_rng(5)
    # Bolt on a plausible pick'em-ish AH line with a small overround, just to exercise
    # the 'ah' code path end to end - not a claim about realistic AH line selection.
    df["AHh"] = rng.choice([-0.25, 0.0, 0.25], size=len(df))
    df["B365AHH"] = rng.uniform(1.85, 2.05, size=len(df))
    df["B365AHA"] = rng.uniform(1.85, 2.05, size=len(df))
    cfg = BacktestConfig(market="ah", refit_every_days=14, min_train_matches=60, ev_min=0.0, ev_max=1.0)
    result = run_backtest(df, cfg)
    assert result.n_bets >= 0
    if result.n_bets:
        assert (result.bets["stake"] > 0).all()
        assert result.bets["return_multiplier"].between(0, result.bets["odd"]).all()


def test_dixon_coles_fit_and_probabilities():
    df = make_synthetic_league(n_teams=8, n_rounds=2, seed=1)
    model = DixonColesModel().fit(df, xi=0.0018)
    grid = model.score_matrix("Team0", "Team1")
    assert abs(grid.sum() - 1.0) < 1e-6
    assert grid.shape == (11, 11)

    probs = outcome_probabilities(grid, "TOTAL", "OVER", 2.5)
    assert abs(sum(probs.values()) - 1.0) < 1e-6
    fair = fair_odd_from_outcome(probs)
    assert fair is None or fair > 1.0

    rel = model.reliability("Team0", "Team1")
    assert 0.0 <= rel <= 1.0


def test_walk_forward_backtest_runs_end_to_end():
    df = make_synthetic_league(n_teams=10, n_rounds=4, seed=2)
    cfg = BacktestConfig(market="1x2", refit_every_days=14, min_train_matches=60, ev_min=0.0, ev_max=1.0)
    result = run_backtest(df, cfg)
    assert result.n_bets >= 0
    if result.n_bets:
        assert 0.0 <= result.hit_rate <= 1.0
        assert not result.bets["stake"].isna().any()
        assert (result.bets["stake"] > 0).all()


if __name__ == "__main__":
    test_split_line()
    test_no_vig_helpers()
    test_kelly_stake_bounds()
    test_settle_return_asian_handicap()
    test_walk_forward_backtest_ah_market_runs()
    test_dixon_coles_fit_and_probabilities()
    test_walk_forward_backtest_runs_end_to_end()
    print("All tests passed.")
