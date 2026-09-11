# football-quant

A backtestable football (soccer) value-betting research system: a time-weighted
Dixon-Coles model, tested walk-forward against **real historical closing odds**
(Bet365, via football-data.co.uk), with a bootstrap confidence interval on ROI
so a lucky run doesn't get mistaken for a real edge.

## Why this exists, and what it is not

You asked for a system built on "profitable" football-prediction projects found
on GitHub. Here's the honest research finding first, because it shapes
everything below:

**No public GitHub repository has an independently audited, long-run, live
track record proving profitability against a major bookmaker.** The space is
full of backtests, and backtests are trivially easy to overfit — repeatedly
tweak thresholds until historical ROI looks good, and you've fit noise, not an
edge (this is a well-documented failure mode, not a hypothetical one). Claimed
"proven profitable" systems you'll find on GitHub or in prediction blogs are
almost always unverified marketing, survivorship bias (losing systems get
deleted/rebranded, winning streaks get advertised), or both.

What *does* have real, peer-reviewed and decades-of-practitioner credibility is
the **methodology**: the Dixon & Coles (1997, *Applied Statistics* 46(2))
time-weighted Poisson model, market-implied (de-vigged) fair odds as a
calibration anchor, expected-value filtering, and fractional Kelly staking.
That's exactly what your existing n8n production engine (`Module A · Asian
Lines`) already implements. This project is the validation layer that engine
doesn't have: a way to actually find out, on real historical Bet365 closing
lines, whether a given league/market/threshold combination shows a persistent
edge — instead of trusting a README.

**Bottom line to set expectations correctly:** closing lines from a sharp book
are close to market-efficient. If a genuine edge exists here, published
research and practitioner consensus put it in the low single-digit percent ROI
range at best, it decays as you scale stake size (limits/restrictions), and it
requires real statistical validation (see "Reading the report" below) before
you risk money on it. Anyone selling a subscription that a promises a
much bigger edge with certainty is selling the same story that failed on
GitHub a thousand times before.

## Result (closed out, 2026-09-11)

Ran the walk-forward backtest against real Bet365 closing odds for the
English Premier League, 2020/21 through 2024/25 (5 seasons, 1900 matches),
default thresholds, no tuning per-market:

| Market | Bets | ROI | 95% CI (bootstrap) | Verdict |
|---|---|---|---|---|
| 1X2 | 779 | -7.14% | [-14.78%, +11.82%] | No edge |
| Over/Under 2.5 | 685 | -7.83% | [-14.49%, +1.06%] | No edge |
| Asian Handicap | 936 | -3.11% | [-8.70%, +2.88%] | No edge (closest to zero, consistent with AH's thinner margin) |

**Conclusion: no market/threshold combination tested on EPL shows a
statistically demonstrated edge against Bet365 closing lines.** This is the
answer, not a failed attempt at one — it's exactly what efficient-market
theory and the "no audited profitable GitHub repo exists" research (see
above) predicted going in. AH being the least negative and having the
tightest CI is the one data point that lines up with theory (tighter
bookmaker margin → closer to breakeven), which is some evidence the
methodology itself isn't broken, just that EPL specifically is too
efficiently priced for a plain Dixon-Coles model to beat.

Broader research across other sports and general quantitative/algorithmic
trading (statistical arbitrage, crypto arbitrage, horse racing pari-mutuel
syndicates) turned up the same structural pattern: real, durable, publicly
documented edges are rare, and the ones that are real either decay once
known (stat-arb went from ~0.67%/month in the 1960s-80s to unprofitable
after costs by the 2000s as capital crowded in) or depend on a market
structure fundamentally different from a fixed-odds bookmaker (pari-mutuel
pools, cross-exchange price gaps). Nothing about switching sport, league, or
domain changes that; only switching to a genuinely different market
mechanism (e.g. arbitrage) or genuinely new information (e.g. proprietary
data a bookmaker hasn't priced) would.

Left as future work, not pursued further here: testing the same AH
methodology on lower/thinner-liquidity leagues, and wiring in a
non-predictive arbitrage scanner (mathematically distinct problem, not a
statistical model at all).

## What it does

1. **Data** (`src/data.py`): downloads and parses free historical
   results + closing odds CSVs from
   [football-data.co.uk](https://www.football-data.co.uk/) — 25+ leagues,
   seasons back to 2000/01, closing odds from Bet365, Pinnacle, Betfair and
   others baked right into the CSV columns (`B365H`/`B365D`/`B365A` for 1X2,
   `B365>2.5`/`B365<2.5` for Over/Under 2.5 goals, `AHh`/`B365AHH`/`B365AHA`
   for Asian handicap in recent seasons of major leagues).

2. **Model** (`src/dixon_coles.py`): fits team attack/defense strength +
   home advantage + the Dixon-Coles low-score correlation parameter (rho) by
   maximum likelihood, with exponential time-decay so recent form matters more
   than matches from years ago. Same settlement math (quarter-line splitting,
   Asian handicap win/push/loss) as the production n8n engine, ported so the
   two are directly comparable.

3. **Backtest** (`src/backtest.py`): walk-forward, not a single train/test
   split — the model is refit on a rolling cadence (default weekly) using
   *only* matches strictly before the bet date, exactly like a live system
   would see the world. For each fixture it blends the model's probability
   with the market's de-vigged probability (weighted by a reliability score
   from how much history each team has), computes EV against the actual
   closing odds in the data, stakes fractional Kelly, and resolves the bet
   against the real result.

4. **Report**: ROI, hit rate, and — critically — a **bootstrap 95% confidence
   interval on ROI**. If that interval straddles zero, the backtest has not
   shown a real edge, regardless of what the point-estimate ROI says.

## Setup

```bash
cd football-quant
pip install -r requirements.txt
```

## Usage

```bash
python run_backtest.py --league E0 --seasons 2021 2122 2223 2324 2425 --market 1x2
python run_backtest.py --league SP1 --seasons 2223 2324 2425 --market ou25 --ev-min 0.03
python run_backtest.py --league E0 --seasons 2021 2122 2223 2324 2425 --market ah
```

League codes are football-data.co.uk's own: `E0` EPL, `E1` Championship,
`SP1` La Liga, `D1` Bundesliga, `I1` Serie A, `F1` Ligue 1, etc. — full list at
football-data.co.uk/data.php. Season codes are 4 digits, e.g. `2425` = 2024/25.

Key flags (see `--help` for all of them): `--market {1x2,ou25,ah}`,
`--ev-min`/`--ev-max` (EV band for a bet to qualify), `--refit-every-days`,
`--xi` (time-decay rate), `--kelly-fraction`.

`ah` (Asian handicap) is worth trying first if you only try one: bookmaker
margins there run roughly ~2% vs 1X2's ~5-6%, which is exactly why the
production n8n engine this project validates targets Asian lines rather than
match-odds markets. football-data.co.uk gives exactly one AH line per match
(AHh/B365AHH/B365AHA) — there's no line-shopping across multiple lines the
way the live engine's multi-line scout does.

## Reading the report

- **ROI 95% CI straddles zero** → this configuration has not demonstrated a
  real edge on this data. Don't bet it. This is the normal, expected outcome
  for most league/market/threshold combinations you'll try — closing markets
  are efficient more often than not.
- **Entire CI is positive** → promising, but still not proof: check it holds
  (a) out-of-sample on a league/season you didn't use while tuning thresholds,
  (b) across multiple leagues with the same fixed config (not re-tuned per
  league), and (c) that bet count is large enough (dozens, ideally 100+) that
  the CI itself is trustworthy. A positive CI from 25 bets is not a strategy.
- **Never** iterate on `--ev-min`/`--ev-max`/`--xi` against the same
  league/season until the number looks good and call that "validated" — that
  is exactly the overfitting failure mode described above. Pick thresholds
  once, on a training league/season, then confirm on a different one you
  haven't touched.

## Running the test suite

```bash
python tests/test_pipeline.py
```

These are synthetic-data sanity checks (probabilities sum to 1, staking
behaves, the walk-forward loop runs end to end) — they cannot and do not prove
anything about real-market profitability. That question only `run_backtest.py`
against real football-data.co.uk history can answer, and even then, see the
caveats above.

## Extending

- **CLV tracking**: this backtest bets at the closing line, so there's no
  opening-vs-closing comparison. football-data.co.uk does carry both an
  opening-ish price and closing price from some bookmakers (e.g. Pinnacle
  `PSH`/`PSCH`) — computing true CLV would mean betting at the earlier price
  and comparing to `PSCH`/`B365` at closing.
- **Ensembling**: an ELO or pi-ratings signal alongside Dixon-Coles, blended
  the same way the model and market probabilities already are, is a common
  next step in the literature if you want a second opinion instead of one
  model's calibration.
