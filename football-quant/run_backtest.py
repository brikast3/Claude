#!/usr/bin/env python3
"""
CLI entry point: download football-data.co.uk seasons, run the walk-forward
Dixon-Coles value-betting backtest, print an honest report.

Example:
    python run_backtest.py --league E0 --seasons 2122 2223 2324 2425 --market 1x2
    python run_backtest.py --league SP1 --seasons 2223 2324 2425 --market ou25 --ev-min 0.03

League codes / season codes are football-data.co.uk's own (E0=EPL, E1=Championship,
SP1=La Liga, D1=Bundesliga, I1=Serie A, F1=Ligue 1, ... see football-data.co.uk/data.php).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.backtest import BacktestConfig, run_backtest
from src.data import available_markets, download_season, load_seasons


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", required=True, help="football-data.co.uk league code, e.g. E0")
    ap.add_argument("--seasons", required=True, nargs="+", help="season codes, e.g. 2223 2324 2425")
    ap.add_argument("--market", default="1x2", choices=["1x2", "ou25"])
    ap.add_argument("--cache-dir", default="data_cache")
    ap.add_argument("--xi", type=float, default=0.0018)
    ap.add_argument("--refit-every-days", type=int, default=7)
    ap.add_argument("--ev-min", type=float, default=0.02)
    ap.add_argument("--ev-max", type=float, default=0.15)
    ap.add_argument("--reference-bankroll", type=float, default=1000.0)
    ap.add_argument("--kelly-fraction", type=float, default=0.30)
    args = ap.parse_args()

    paths = [download_season(args.league, s, args.cache_dir) for s in args.seasons]
    matches = load_seasons(paths)
    print(f"Loaded {len(matches)} matches from {len(paths)} season file(s).")
    markets = available_markets(matches)
    print(f"Market coverage: {markets[args.market]}")
    if markets[args.market]["usable_rows"] == 0:
        print(f"No usable odds for market '{args.market}' in this data - aborting.")
        return

    cfg = BacktestConfig(
        market=args.market,
        xi=args.xi,
        refit_every_days=args.refit_every_days,
        ev_min=args.ev_min,
        ev_max=args.ev_max,
        reference_bankroll=args.reference_bankroll,
        kelly_fraction=args.kelly_fraction,
    )
    result = run_backtest(matches, cfg)

    print()
    print("=== Backtest report (walk-forward, no lookahead) ===")
    print(f"Bets placed:     {result.n_bets}")
    print(f"Total staked:    {result.total_staked:.2f}")
    print(f"Total profit:    {result.total_profit:.2f}")
    print(f"ROI:             {result.roi:.2%}" if result.n_bets else "ROI:             n/a")
    print(f"Hit rate:        {result.hit_rate:.2%}" if result.n_bets else "Hit rate:        n/a")
    lo, hi = result.roi_ci95
    if result.n_bets >= 20:
        print(f"ROI 95% CI (bootstrap, {result.n_bets} bets): [{lo:.2%}, {hi:.2%}]")
        if lo < 0 < hi:
            print("  -> CI straddles zero: this run does NOT demonstrate a real edge yet.")
        elif lo > 0:
            print("  -> Entire CI is positive, but see README for what this still doesn't prove.")
    else:
        print("Too few bets for a meaningful confidence interval (need >= 20).")


if __name__ == "__main__":
    main()
