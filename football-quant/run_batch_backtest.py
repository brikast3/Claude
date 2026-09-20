#!/usr/bin/env python3
"""
Batch extension of run_backtest.py: screen the SAME walk-forward Dixon-Coles
methodology, with FIXED default thresholds, across several thinner-liquidity
leagues and all three markets, instead of just EPL.

Why this exists
----------------
The README's own "Result" section found no demonstrated edge for EPL 1X2,
O/U 2.5, or Asian Handicap (95% CIs straddling or below zero), and listed as
future work: "testing the same AH methodology on lower/thinner-liquidity
leagues" -- the theory being that a top-flight league like the EPL is priced
by heavy sharp-money action and is close to fully efficient, while a lower
division or a less internationally-bet league gets much less of that
correcting action, so a statistical model has a better (still not good, just
better) chance of finding real mispricing. This script runs exactly that
screen. It does NOT change the model, the settlement math, or the staking --
only which league/season data it's pointed at.

No per-league tuning, on purpose
---------------------------------
Every league/market combination below uses the *same* BacktestConfig
defaults (the same ones the EPL run used). There is deliberately no
per-league --ev-min/--ev-max/--xi flag here, unlike run_backtest.py. Letting
each league pick its own "best" threshold after seeing results is exactly
the overfitting failure mode the README warns about (tune until the number
looks good, call it validated). If a league/market shows a positive CI here,
the very next step is to re-test it with these exact same fixed thresholds
on fresh out-of-sample seasons -- never to go back and retune this run until
more cells turn green.

Multiple comparisons, read this before trusting any single green cell
-----------------------------------------------------------------------
This script tests up to 9 leagues x 3 markets = 27 independent cells at a
95% confidence level. Even if there were truly zero edge anywhere, you'd
expect roughly 1-2 cells to show a spuriously positive CI by chance alone
(27 x 5% ~= 1.35). A single positive cell out of dozens is exactly what
random noise looks like -- it is a candidate for follow-up, not a result.
Treat this script as a screen, not a verdict: promising cells need
confirmation on data this screen never touched (see README "Reading the
report", point b) before anyone considers staking real money on them.

Network requirement
--------------------
Needs outbound HTTPS to https://www.football-data.co.uk. That host was
blocked by organization egress policy in the sandboxed environment this
script was written in, so it has NOT been run against real data -- only
exercised against synthetic data via tests/test_pipeline.py's helpers,
which checks the plumbing (argument handling, per-cell error handling,
table formatting) but proves nothing about real-market results. Run this
yourself somewhere with internet access; see README "Setup".

Usage
-----
    python run_batch_backtest.py
    python run_batch_backtest.py --markets ah
    python run_batch_backtest.py --leagues E1 E2 B1 G1 --markets ah 1x2
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.backtest import BacktestConfig, run_backtest
from src.data import available_markets, download_season, load_seasons

# football-data.co.uk league codes. Each one here is a lower-division or a
# less internationally-bet top flight than the EPL -- less sharp money,
# thinner AH coverage in older seasons (expected; handled per-cell below).
LEAGUES = [
    ("E1", "England Championship (tier 2)"),
    ("E2", "England League One (tier 3)"),
    ("E3", "England League Two (tier 4)"),
    ("SC1", "Scotland Championship"),
    ("SC2", "Scotland League One"),
    ("B1", "Belgium First Division A"),
    ("G1", "Greece Super League"),
    ("P1", "Portugal Primeira Liga"),
    ("T1", "Turkey Super Lig"),
]

# Same 5 seasons the EPL run used, for a like-for-like comparison.
SEASONS = ["2021", "2122", "2223", "2324", "2425"]

MARKETS = ["ah", "1x2", "ou25"]


def run_one_cell(league: str, seasons: list[str], market: str, cache_dir: str) -> dict:
    """Download+load one league's seasons and run the fixed-threshold backtest
    for one market. Returns a result dict; never raises for expected data
    issues (missing seasons, missing market columns) -- those are reported
    as a 'skipped' row instead of aborting the whole batch.
    """
    try:
        paths = []
        for s in seasons:
            try:
                paths.append(download_season(league, s, cache_dir))
            except Exception as e:  # noqa: BLE001 - report and skip this season, not the whole league
                print(f"  [{league}/{s}] download failed, skipping this season: {e}")
        if not paths:
            return {"league": league, "market": market, "status": "NO_DATA", "detail": "no seasons downloaded"}

        matches = load_seasons(paths)
    except Exception as e:  # noqa: BLE001
        return {"league": league, "market": market, "status": "LOAD_ERROR", "detail": str(e)}

    coverage = available_markets(matches)[market]
    if coverage["usable_rows"] == 0:
        return {
            "league": league,
            "market": market,
            "status": "NO_MARKET_COVERAGE",
            "detail": f"columns present={coverage['columns_present']}, 0 usable rows",
        }

    cfg = BacktestConfig(market=market)  # fixed defaults, no per-league tuning
    result = run_backtest(matches, cfg)

    if result.n_bets < 20:
        return {
            "league": league,
            "market": market,
            "status": "TOO_FEW_BETS",
            "n_bets": result.n_bets,
            "detail": "need >= 20 for a meaningful CI",
        }

    lo, hi = result.roi_ci95
    if lo < 0 < hi:
        verdict = "CI straddles zero: no demonstrated edge"
    elif lo > 0:
        verdict = "Entire CI positive: candidate for out-of-sample follow-up"
    else:
        verdict = "Entire CI negative: no edge"

    return {
        "league": league,
        "market": market,
        "status": "OK",
        "n_bets": result.n_bets,
        "roi": result.roi,
        "hit_rate": result.hit_rate,
        "ci_lo": lo,
        "ci_hi": hi,
        "verdict": verdict,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--leagues",
        nargs="+",
        default=[code for code, _ in LEAGUES],
        help="football-data.co.uk league codes to screen (default: the thinner-liquidity list above)",
    )
    ap.add_argument("--seasons", nargs="+", default=SEASONS, help="season codes (default: same 5 the EPL run used)")
    ap.add_argument("--markets", nargs="+", default=MARKETS, choices=MARKETS, help="markets to screen (default: all three)")
    ap.add_argument("--cache-dir", default="data_cache")
    args = ap.parse_args()

    league_names = dict(LEAGUES)
    n_cells = len(args.leagues) * len(args.markets)
    expected_false_positives = n_cells * 0.05

    print("=== Batch screen: fixed-threshold walk-forward backtest ===")
    print(f"Leagues: {', '.join(args.leagues)}")
    print(f"Seasons: {', '.join(args.seasons)}")
    print(f"Markets: {', '.join(args.markets)}")
    print(f"Total cells: {n_cells} (at 95% CI, expect ~{expected_false_positives:.1f} spurious positives by chance alone)")
    print()

    rows = []
    for league in args.leagues:
        name = league_names.get(league, league)
        for market in args.markets:
            print(f"--- {league} ({name}) / {market} ---")
            row = run_one_cell(league, args.seasons, market, args.cache_dir)
            rows.append(row)
            if row["status"] == "OK":
                print(
                    f"  bets={row['n_bets']} roi={row['roi']:.2%} hit_rate={row['hit_rate']:.2%} "
                    f"CI=[{row['ci_lo']:.2%}, {row['ci_hi']:.2%}] -> {row['verdict']}"
                )
            else:
                print(f"  {row['status']}: {row.get('detail', '')}")
            print()

    print("=== Summary ===")
    header = f"{'League':<6}{'Market':<8}{'Bets':>6}{'ROI':>9}{'CI low':>9}{'CI high':>9}  Verdict"
    print(header)
    print("-" * len(header))
    positive_ci_rows = []
    for row in rows:
        if row["status"] != "OK":
            print(f"{row['league']:<6}{row['market']:<8}{'--':>6}{'--':>9}{'--':>9}{'--':>9}  {row['status']}")
            continue
        print(
            f"{row['league']:<6}{row['market']:<8}{row['n_bets']:>6}{row['roi']:>9.2%}"
            f"{row['ci_lo']:>9.2%}{row['ci_hi']:>9.2%}  {row['verdict']}"
        )
        if row["ci_lo"] > 0:
            positive_ci_rows.append(row)

    print()
    ok_rows = [row for row in rows if row["status"] == "OK"]
    if not ok_rows:
        print(
            "No cell actually completed a backtest (see statuses above, e.g. NO_DATA / "
            "NO_MARKET_COVERAGE / TOO_FEW_BETS) -- there is nothing to conclude from this run. "
            "This is not the same as 'tested and found no edge'; fix the data access and re-run."
        )
    elif not positive_ci_rows:
        print(
            f"{len(ok_rows)} cell(s) completed. None showed an entire-positive 95% CI. Consistent "
            "with the EPL result and with market-efficiency theory: this screen did not find a "
            "demonstrated edge either."
        )
    else:
        print(
            f"{len(positive_ci_rows)} cell(s) showed an entire-positive CI: "
            + ", ".join(f"{r['league']}/{r['market']}" for r in positive_ci_rows)
        )
        print(
            f"Before trusting any of these: remember {n_cells} cells were screened, so ~{expected_false_positives:.1f} "
            "false positives were expected by chance alone. Re-run the SAME fixed thresholds against fresh seasons "
            "these cells have not seen (out-of-sample confirmation) before treating this as a real edge -- see "
            "README 'Reading the report', point (b)."
        )


if __name__ == "__main__":
    main()
