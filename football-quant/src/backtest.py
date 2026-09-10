"""
Walk-forward value-betting backtest against real historical closing odds.

This is the validation layer the live n8n engine does not have: it never trains
on data from after the bet it is evaluating, refits on a rolling cadence exactly
like a live system would, and reports a bootstrap confidence interval on ROI so
a lucky run on one league/season doesn't get mistaken for a real edge.

Supported markets: '1x2' (B365H/B365D/B365A) and 'ou25' (B365>2.5/B365<2.5).
Both are almost always present in football-data.co.uk files; Asian handicap
columns (AHh/B365AHH/B365AHA) exist only for recent seasons of major leagues -
the settlement math for it already lives in dixon_coles.outcome_probabilities,
wiring it into this loop is a small, mechanical extension once you have enough
AH-column coverage to bother.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np
import pandas as pd

from .dixon_coles import DixonColesModel, match_odds_probs, outcome_probabilities
from .market import kelly_stake, no_vig_fair_odds_2way, no_vig_fair_probs_3way


@dataclass
class BacktestConfig:
    market: str = "1x2"  # '1x2' or 'ou25'
    xi: float = 0.0018
    refit_every_days: int = 7
    min_train_matches: int = 150
    min_reliability: float = 0.35
    ev_min: float = 0.02
    ev_max: float = 0.15
    model_weight_min: float = 0.35
    model_weight_max: float = 0.60
    reference_bankroll: float = 1000.0
    kelly_fraction: float = 0.30
    stake_cap: float = 0.03


@dataclass
class BacktestResult:
    bets: pd.DataFrame
    n_bets: int
    total_staked: float
    total_profit: float
    roi: float
    hit_rate: float
    roi_ci95: tuple[float, float] = field(default=(float("nan"), float("nan")))


def _model_weight(reliability: float, cfg: BacktestConfig) -> float:
    span = cfg.model_weight_max - cfg.model_weight_min
    return cfg.model_weight_min + reliability * span


def _bootstrap_roi_ci(returns: np.ndarray, n_resamples: int = 2000, seed: int = 7) -> tuple[float, float]:
    """returns: per-bet profit/stake ratios. Resamples bets with replacement to
    get a 95% CI on mean ROI - the standard guard against reporting noise as edge.
    """
    if len(returns) < 20:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    means = np.empty(n_resamples)
    n = len(returns)
    for i in range(n_resamples):
        sample = rng.choice(returns, size=n, replace=True)
        means[i] = sample.mean()
    return (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))


def _evaluate_1x2(grid, row, cfg: BacktestConfig, reliability: float):
    model_probs = match_odds_probs(grid)
    odds = {"H": row["B365H"], "D": row["B365D"], "A": row["B365A"]}
    if any(pd.isna(v) for v in odds.values()):
        return None
    market_probs = no_vig_fair_probs_3way(odds["H"], odds["D"], odds["A"])
    w = _model_weight(reliability, cfg)
    best = None
    for side in ("H", "D", "A"):
        calibrated = w * model_probs[side] + (1 - w) * market_probs[side]
        ev = calibrated * odds[side] - 1
        if cfg.ev_min <= ev <= cfg.ev_max:
            if best is None or ev > best["ev"]:
                won = row["FTR"] == side
                best = {"side": side, "odd": odds[side], "calibrated_prob": calibrated, "ev": ev, "won": won}
    return best


def _evaluate_ou25(grid, row, cfg: BacktestConfig, reliability: float):
    over_odd, under_odd = row.get("B365>2.5"), row.get("B365<2.5")
    if pd.isna(over_odd) or pd.isna(under_odd):
        return None
    over_probs = outcome_probabilities(grid, "TOTAL", "OVER", 2.5)
    under_probs = outcome_probabilities(grid, "TOTAL", "UNDER", 2.5)
    model_probs = {"OVER": over_probs["W"], "UNDER": under_probs["W"]}
    market_fair_over, market_fair_under = no_vig_fair_odds_2way(over_odd, under_odd)
    market_probs = {"OVER": 1 / market_fair_over, "UNDER": 1 / market_fair_under}
    w = _model_weight(reliability, cfg)
    total_goals = row["FTHG"] + row["FTAG"]
    best = None
    for side, odd in (("OVER", over_odd), ("UNDER", under_odd)):
        calibrated = w * model_probs[side] + (1 - w) * market_probs[side]
        ev = calibrated * odd - 1
        if cfg.ev_min <= ev <= cfg.ev_max:
            if best is None or ev > best["ev"]:
                won = (total_goals > 2.5) if side == "OVER" else (total_goals < 2.5)
                best = {"side": side, "odd": odd, "calibrated_prob": calibrated, "ev": ev, "won": won}
    return best


def run_backtest(matches: pd.DataFrame, cfg: BacktestConfig | None = None) -> BacktestResult:
    cfg = cfg or BacktestConfig()
    matches = matches.sort_values("Date").reset_index(drop=True)
    dates = matches["Date"]
    start = dates.min() + timedelta(days=1)
    end = dates.max()

    evaluator = _evaluate_1x2 if cfg.market == "1x2" else _evaluate_ou25
    rows = []
    cursor = start
    while cursor <= end:
        window_end = cursor + timedelta(days=cfg.refit_every_days)
        train = matches[matches["Date"] < cursor]
        test = matches[(matches["Date"] >= cursor) & (matches["Date"] < window_end)]
        cursor = window_end
        if len(test) == 0:
            continue
        if len(train) < cfg.min_train_matches:
            continue
        model = DixonColesModel().fit(train, xi=cfg.xi)
        for _, row in test.iterrows():
            home, away = row["HomeTeam"], row["AwayTeam"]
            if home not in model.attack or away not in model.attack:
                continue  # promoted/relegated team with no history in the training window
            reliability = model.reliability(home, away)
            if reliability < cfg.min_reliability:
                continue
            grid = model.score_matrix(home, away)
            pick = evaluator(grid, row, cfg, reliability)
            if pick is None:
                continue
            stake = kelly_stake(
                pick["calibrated_prob"], pick["odd"], cfg.reference_bankroll, cfg.kelly_fraction, cfg.stake_cap
            )
            if stake <= 0:
                continue
            profit = stake * (pick["odd"] - 1) if pick["won"] else -stake
            rows.append(
                {
                    "Date": row["Date"],
                    "HomeTeam": home,
                    "AwayTeam": away,
                    "market": cfg.market,
                    "side": pick["side"],
                    "odd": pick["odd"],
                    "calibrated_prob": pick["calibrated_prob"],
                    "ev": pick["ev"],
                    "reliability": reliability,
                    "stake": stake,
                    "won": pick["won"],
                    "profit": profit,
                }
            )

    bets = pd.DataFrame(rows)
    if bets.empty:
        return BacktestResult(bets, 0, 0.0, 0.0, float("nan"), float("nan"))

    total_staked = float(bets["stake"].sum())
    total_profit = float(bets["profit"].sum())
    roi = total_profit / total_staked if total_staked > 0 else float("nan")
    hit_rate = float(bets["won"].mean())
    per_bet_roi = (bets["profit"] / bets["stake"]).to_numpy()
    ci = _bootstrap_roi_ci(per_bet_roi)
    return BacktestResult(bets, len(bets), total_staked, total_profit, roi, hit_rate, ci)
