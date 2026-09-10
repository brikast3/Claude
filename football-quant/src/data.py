"""
Load and normalize historical football results + closing odds from football-data.co.uk.

football-data.co.uk publishes free CSV files per league/season at:
    https://www.football-data.co.uk/mmz4281/<season_code>/<league_code>.csv
e.g. season_code "2324" = 2023/24, league_code "E0" = English Premier League.

The CSVs carry closing (or near-closing) odds from several real bookmakers,
including Bet365 columns (B365H/B365D/B365A for 1X2, B365>2.5/B365<2.5 for
Over/Under 2.5 goals, B365AHH/B365AHA + AHh for Asian handicap in recent
seasons). Column availability varies by league/season - always check what's
actually present before assuming a market backtest is possible.
"""
from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://www.football-data.co.uk/mmz4281/{season}/{league}.csv"

REQUIRED_COLUMNS = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"]

# Bookmaker odds columns we know how to use, grouped by market.
ODDS_COLUMNS = {
    "1x2": ["B365H", "B365D", "B365A"],
    "ou25": ["B365>2.5", "B365<2.5"],
    "ah": ["AHh", "B365AHH", "B365AHA"],
}


def download_season(league: str, season: str, cache_dir: str | Path) -> Path:
    """Download one league/season CSV, caching it locally. Returns the local path.

    league: football-data.co.uk league code, e.g. 'E0' (EPL), 'E1' (Championship),
            'SP1' (La Liga), 'D1' (Bundesliga), 'I1' (Serie A), 'F1' (Ligue 1).
    season: 4-digit season code, e.g. '2324' for 2023/24.
    """
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{league}_{season}.csv"
    if dest.exists():
        return dest
    url = BASE_URL.format(season=season, league=league)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest


def load_csv(path_or_buffer) -> pd.DataFrame:
    """Parse one football-data.co.uk CSV into a tidy, chronologically-sorted frame.

    Keeps every original odds column that is present (so callers can pick whichever
    market/bookmaker they have coverage for) plus normalized Date/FTHG/FTAG/FTR.
    Rows missing a required column are dropped rather than silently coerced.
    """
    df = pd.read_csv(path_or_buffer, encoding="latin1")
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")
    df = df.dropna(subset=REQUIRED_COLUMNS).copy()
    df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
    df = df.dropna(subset=["Date"])
    df["FTHG"] = df["FTHG"].astype(int)
    df["FTAG"] = df["FTAG"].astype(int)
    df = df.sort_values("Date").reset_index(drop=True)
    return df


def load_seasons(paths: list[str | Path]) -> pd.DataFrame:
    """Load and concatenate multiple season CSVs into one chronological frame."""
    frames = [load_csv(p) for p in paths]
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values("Date").reset_index(drop=True)


def available_markets(df: pd.DataFrame) -> dict:
    """Report which of the known market column groups are usable in this frame,
    i.e. every column in the group is present and non-null on at least one row.
    """
    result = {}
    for market, cols in ODDS_COLUMNS.items():
        present = [c for c in cols if c in df.columns]
        usable_rows = int(df[present].notna().all(axis=1).sum()) if present else 0
        result[market] = {"columns_present": present, "usable_rows": usable_rows}
    return result
