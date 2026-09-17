# tennis-4040-strategy

Analysis of the uploaded tennis betting strategy ("Ще има в гейма счет 40:40 – Да")
and an assessment of whether/how it can be automated in n8n.

## The strategy, as written in the source document

Translated summary of the uploaded `.docx`:

> **System "There will be 40:40 in the game – Yes"**
>
> This type of bet often works for evenly matched opponents in a final or
> semifinal. Watch a few games first and draw conclusions about who is
> making errors on their own serve. Between two closely matched players,
> a 40:40 score can occur in almost every game. Odds are typically around
> 3.0 or higher.
>
> **Criteria before betting:**
> 1. Final or semifinal only
> 2. Watch/skip 5–6 games first
> 3. Work out on whose serve the score keeps reaching 40:40
>
> The document then walks through one worked example (Nadal vs. Fognini):
> after watching several games, it notes Fognini was struggling more on
> serve, bets "40:40 – Yes" on his next service game, and it wins. It
> mentions using **"Правильный Догон"** (a progressive "chase" staking
> system: increase the stake on the next similar bet to recover a
> previous loss plus profit) for anyone willing to use it, and notes only
> one such progression was needed in that example — a flat stake would
> also have shown a profit.

That's the entire strategy: a manual, in-play, pattern-watching heuristic,
illustrated with **one** match.

## Honest assessment (same standard we held `football-quant/` to)

- **Sample size is one match.** The whole case for the system is a single
  worked example. That's an anecdote, not a backtest. Before trusting this
  with money, the actual claim needs testing across many historical
  finals/semifinals: *"if a server has already hit 40:40 in most of their
  own service games so far in this match, how often do they hit 40:40 in
  their next service game?"* We have not measured that anywhere.
- **The underlying signal is plausible but narrow.** In-match serve form
  (a player having an off day on serve) is a real, well-known tennis
  phenomenon — this isn't nonsense the way a naive gambler's fallacy would
  be. But by "game 5–6" a player has typically served only 2–3 games
  themselves, which is a very small sample to judge "this player is
  struggling on serve today" from.
- **The staking method is the real danger, not the detection logic.**
  "Правильный Догон" is a Martingale-style loss-chasing system: raise the
  stake after a loss so the next win recovers everything plus profit. This
  class of system always shows a smooth-looking equity curve of small wins
  — right up until a losing streak the model didn't anticipate, at which
  point the required recovery stake grows exponentially and blows the
  bankroll (classic gambler's ruin). The document gives no stake cap, no
  bankroll size, no stopping rule. **Do not automate this part.**

## Can it be automated in n8n?

**Partially — the detection/alerting half, yes. The betting/staking half, no.**

### What's realistically automatable
- Detecting that a live match is a final/semifinal (round metadata from a
  fixtures API).
- Tracking, live, which player is serving each game and whether that game
  went to deuce (40:40) at any point.
- Computing "server X has hit deuce in K of their last N own service
  games" and firing an alert once a threshold is crossed, *before* the
  next relevant service game.
- Pushing that alert to Telegram/Slack so a human decides whether to place
  a bet manually.

### What we deliberately did not automate
- **Placing the bet.** Most bookmakers' terms of service prohibit
  automated/bot betting and can restrict or close accounts that do it —
  and more importantly, wiring real-money execution to an unvalidated,
  single-match heuristic is not a good idea regardless of ToS.
- **The progressive "Dogon" staking.** As above — that's how a plausible
  in-match pattern turns into ruin. Any automation should only ever
  suggest a flat, fixed stake.

### Data you'd need that we don't have yet
Live, in-play tennis data with:
- Round/stage per match (Final / Semifinal) from fixture metadata.
- Game-by-game score progression per set, including **which player served
  each game** and **whether that game reached 40:40**, at low latency
  (seconds, not minutes — the whole point is alerting before the next
  service game starts).

Point-by-point or game-level live feeds with this granularity are
typically paid products — e.g. Sportradar Tennis, Betradar, BetsAPI
(b365api) live scores, or a RapidAPI tennis-live-data plan. Confirm
whatever provider you pick actually allows this use in their terms
before wiring in real keys.

## Recommended path (same order we used for `football-quant/` and the
hockey draft)

1. **Collect data first.** Before building a live alerting system, pull
   historical game-by-game (or point-by-point) score sequences for
   ATP/WTA finals and semifinals.
2. **Backtest the actual hypothesis**, not the anecdote: across hundreds
   of matches, if a server has already hit deuce in ≥K of their own
   service games so far, what fraction of their *next* service game also
   reaches deuce? Get a real rate with a confidence interval (bootstrap,
   like the football backtest does), not a single "it worked once."
3. **Only if that shows a real, non-trivial edge**, move to the live
   monitor below — as a notification tool, with a flat stake, and treat
   every alert it produces as "worth watching," not "place this bet."

## What's in this folder

`TENNIS_4040_MONITOR_v1.0_DRAFT.json` — an n8n workflow skeleton, in the
same DRAFT style as the repo's `HOCKEY_HISTORY_FIRST_v1.0_DRAFT.json`:

- **Manual Trigger** + **Schedule Trigger** (poll live matches every
  minute) both feed into…
- **Code: Tennis 40:40 Detector v1.0 DRAFT** — filters to live
  final/semifinal matches, requires ≥5 completed games before acting
  (per the document's own criteria), computes the current server's deuce
  rate over their own service games so far in that match, and flags a
  candidate alert once it crosses `CFG.MIN_DEUCE_RATE` (currently an
  unvalidated guess — see step 2 above before trusting it).
- **IF: Alert Condition Met?** routes only real alerts onward.
- **Format: Telegram Message** — builds a Bulgarian-language alert with
  the match, server, deuce rate, a small-sample warning when applicable,
  a fixed stake suggestion, and an explicit "unvalidated heuristic"
  disclaimer. It does not place any bet or send anything itself — wire
  your own Telegram/Slack node onto its output.

`API`/`KEY` in the Code node are placeholders — no live provider is
connected. Treat this as an architecture draft to wire a real data source
into after step 1–2 of the recommended path above, not as something to
enable today.
