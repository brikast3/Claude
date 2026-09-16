# SOCCER RADAR v6.26 · QUALITY-FIRST MULTI-MARKET SELECTOR — AUDIT REPORT

## 1. What this is

A from-scratch n8n production workflow replacing v6.25.4 (`UNIFIED_HISTORY_FIRST`) as the
only active pipeline for new public Singles. It is built around one pure, unit-tested JS
library (`lib/*.js`, bundled verbatim into every Code node) implementing:

`FIXTURE → ALL MARKETS → GOAL MODEL → BET365 PRICES → DE-VIG → CALIBRATION → MARKET SCORE →
BEST-MARKET SELECTION → PUBLIC GATE → EXECUTION RECHECK → PUBLICATION → SETTLEMENT`

v6.25.4's proven, working *techniques* were reused (Dixon-Coles low-score correction,
settlement-aware quarter-line splitting, fail-soft `httpWithRetry` with Retry-After
handling, PostgREST-via-`httpRequest` persistence, `$getWorkflowStaticData` loop
accumulation) — but every strategy-specific mechanism (RECIPROCAL_OVER, shadow betting,
SAFE DOUBLE, per-market pipelines, hard-coded Supabase/API keys) was deliberately **not**
carried forward.

## 2. Node / connection counts

| Type | Count |
|---|---|
| Schedule Trigger | 4 (Market Scout, Selector, Settlement, Daily Report) |
| Code | 14 |
| IF | 3 |
| SplitInBatches | 3 |
| Telegram | 3 |
| Wait | 1 |
| Sticky Note | 5 |
| **Total nodes** | **33** |
| **Total connections** | **30** |

Structural self-check (`build/main.js`, run on every build): **0 dangling connections**,
**0 unreachable executable nodes** (28/28 reachable by BFS from the 4 triggers), **0
isolated nodes**. Every non-trigger, non-sticky node has an incoming connection; the 3
legitimate pipeline end-points (`Code: Market Scout v6.26`, `Code: Save Run Diagnostics`,
`Telegram: Daily Report`) are the only nodes with no outgoing connection, matching where
each module naturally ends.

All 14 Code nodes pass **both**:
- `build/validate-syntax.js` — parses with `AsyncFunction` (n8n Code nodes support
  top-level `await`), 14/14 OK.
- `build/smoke-test.js` — actually **executes** every Code node with mocked
  `this.helpers.httpRequest`, `$env`, `$getWorkflowStaticData`, sharing one static store
  across the sequence to simulate a real single execution. 14/14 run without a runtime
  error.

## 3. Architecture (changed vs. reused)

**New for v6.26:**
- One unified Selector evaluates **all 49 markets per fixture** (16 Goals lines × sides,
  2 BTTS, 3 Moneyline, 2 Double Chance, 26 Asian Handicap line × side combinations) instead
  of four separate strategy-specific pipelines.
- Best-market-per-fixture ranking + `MIN_SCORE_SEPARATION` gate (`lib/selection.js`) —
  did not exist in v6.25.4 at all.
- Shrinkage calibration (`lib/calibration.js`) blending model and de-vigged market
  probability by a confidence score derived from sample size, history, league
  reliability, data quality and market quality.
- Extreme-EV overconfidence penalty (12%) and hard reject (18%) (`lib/scoring.js`,
  `lib/gate.js`).
- 7 new `sr_v626_*` tables, entirely separate from `empirical_*`; verified against a real
  local PostgreSQL 16 instance (see §6).
- All secrets moved to n8n environment variables / a named Telegram credential — the
  reference file had a live Supabase service key and a live provider API key hard-coded
  in plaintext inside several Code nodes. **Neither key was carried into this delivery
  or into any file in this repository.**

**Reused (technique, not code, re-verified against `football-quant/src/dixon_coles.py`,
this project's own backtested Python implementation of the same math):**
- Dixon-Coles `tau` low-score correction.
- Quarter-line (`x.25`/`x.75`) split-and-average settlement, generalized here to cover
  both goal totals **and** Asian Handicap with one function (`settleBaseOutcome`).
- `httpWithRetry` fail-soft pattern (never throws; retries only 408/429/500/502/503/504;
  respects `Retry-After`).

**Removed entirely (not "disabled", not present):**
- RECIPROCAL_OVER / RECIPROCAL_UNDER / automatic side-flipping — no such function exists
  anywhere in `lib/`.
- Shadow betting / shadow Telegram posts — `sr_v626_market_candidates` is a research
  dataset (every evaluated market, approved or rejected), never a virtual-stake ledger.
- SAFE DOUBLE — `CONFIG.safeDouble.publicEnabled = false` and no Safe Double node,
  Code path, or table exists in this workflow at all.

## 4. Test suite

**227 deterministic test cases, 227 passing** (`tests/run-tests.js`, plain `node:assert`,
no framework, run with `node tests/run-tests.js`). Required coverage from spec §36 is
present for every item: all 8 goals lines × both sides, BTTS Yes/No, Home/Draw/Away,
1X/X2, Asian Handicap (WIN/HALF_WIN/PUSH/HALF_LOSS/LOSS/VOID across whole, half and
quarter lines), duplicate fixture/candidate, two-good-markets-same-fixture, second-market-
too-close, MarketScore-below-threshold, odds boundaries (1.69/1.70/2.05/2.06), EV
boundaries (<3%, >12%, >18%), low DQ/HistoryScore, missing market/opposite-price/line,
stale snapshot, price deterioration, daily/run cap, first-candidate-rejected-second-
approved, first-candidate-DB-failure-second-still-processed, 429/504 retry, Telegram
failure, settlement retry.

Every hand-computed settlement expectation (e.g. Over 2.75 at 3 total goals → HALF_WIN,
Asian Handicap −0.75 at a 1-goal home win → HALF_WIN) was independently re-derived from
first principles before being asserted, then cross-checked against the equivalent case in
`football-quant/tests/test_pipeline.py`'s methodology.

## 5. Known limitations (read before wiring to the live provider)

1. **Bet365 field-name aliases are best-effort, isolated to one function.**
   `lib/bet365Parser.js`'s `parseBet365Payload` mirrors the 5DollarFootballAPI field
   aliases this project has integrated with before (`1x2`/`match_winner`/`moneyline`,
   `btts`/`both_teams_to_score`, `goal_line`/`total_goals`, `asian_handicap`,
   `double_chance`). I do not have live access to the current provider schema to verify
   these field names byte-for-byte. If the live payload differs, **this is the only
   function that needs adapting** — every downstream stage (de-vig, model, calibration,
   scoring, gate, settlement) already consumes the canonical shape it produces and needs
   no changes. This is precisely why `EXACT_MARKET_NOT_FOUND` / `EXACT_LINE_NOT_FOUND`
   fail closed rather than guessing: a schema mismatch degrades to "no signal for that
   market", never a wrong price.
2. **The provider appears to expose one *current* Goals line and one *current* Asian
   Handicap line per fixture per fetch** (per the `opening`/`closing` stage structure
   observed in the reference workflow), not a full ladder of all 8/13 lines at once.
   Market Scout stores whatever line Bet365 actually quotes, keyed by its real value —
   the engine correctly resolves every *other* line to `EXACT_LINE_NOT_FOUND` (fail
   closed, not fabricated). In practice this means most fixtures will have genuine
   pricing for only a handful of the 49 candidate markets, which is expected and
   compliant with "no approximate price, no nearest-line fallback."
3. **Cross-loop state uses `$getWorkflowStaticData('global')`**, not a database-backed
   staging table, to accumulate diagnostics and the best-candidate queue across a
   SplitInBatches loop within one execution. This is correct and safe as long as
   Selector runs never overlap (guaranteed here by the 3-times-daily schedule + the
   45-minute `MIN_TO_KO` floor), but is not safe for *concurrent* executions of the same
   trigger. If n8n's "Allow multiple executions" is ever enabled for this workflow, this
   must move to a DB-backed run-scoped table instead.
4. **Closing-line capture for CLV** is best-effort and fail-closed: if the provider no
   longer exposes a pre-match Bet365 price by the time settlement runs, `closing_odd`
   and `clv_pp` stay `null` for that pick rather than being estimated.
5. **League reliability and league goal-context are derived only from fixtures observed
   within the current run**, per spec §5's "no universal league constants" requirement.
   This means the very first runs against a new league will have a neutral (50/100,
   factor 1.0) prior until enough same-run coverage accumulates — intentional, not a bug.
6. The workflow JSON is **~1.0 MB** (vs. 417 KB for the 103-node v6.25.4 reference)
   because all 14 Code nodes embed the full ~62 KB tested library bundle rather than
   duplicating ad-hoc logic per node. This trades file size for a guaranteed single
   source of truth between what is tested and what runs in production.

## 6. Pre-production audit (spec §35, all 30 items)

| # | Item | Result |
|---|---|---|
| 1 | All nodes connected | ✅ 28/28 executable nodes reachable from a trigger (BFS) |
| 2 | No dangling connections | ✅ 0 found by `build/main.js` |
| 3 | No dead production branches | ✅ same BFS reachability check |
| 4 | Loop Over Items continuation correct | ✅ mirrors the proven `SplitInBatches` loop-back pattern (loop output → body → back to same node; done output → next stage) |
| 5 | Rejected candidate doesn't stop the loop | ✅ `evaluateFixture` wrapped in try/catch per fixture; execution-rejected picks route to a no-op node and loop back |
| 6 | Every candidate reaches a terminal state | ✅ every candidate gets `selectedAsBestMarket` or a `rejectionReason`; tested |
| 7 | Telegram receives only approved public picks | ✅ only reachable via Insert Pick → Publish, gated by own-candidate gate + execution recheck |
| 8 | Run cap works | ✅ `MAX_PUBLIC_PER_RUN=2` enforced in `Code: Finalize Candidate Queue`; unit-tested |
| 9 | Daily cap works | ✅ `MAX_PUBLIC_PER_DAY=4` checked against the publication registry; unit-tested |
| 10 | Fixture dedup works | ✅ enforced twice: app-level (`evaluatePublicationCaps`) and DB-level (`unique(fixture_id, publication_date)`, verified live in §7) |
| 11 | Max one public market per fixture | ✅ `selection.js` selects exactly one candidate; DB partial unique index `uq_sr_v626_picks_open_fixture` verified live |
| 12 | Market ranking works | ✅ sorted by `marketScore` desc; unit-tested |
| 13 | Score separation works | ✅ `MIN_SCORE_SEPARATION=3`; boundary-tested at exactly 3 |
| 14 | Exact-market execution validation | ✅ `evaluateExecutionRecheck` checks `hasExactMarket`; tested |
| 15 | Exact-line validation | ✅ same, `hasExactLine`; tested |
| 16 | Stale snapshot fail-closed | ✅ 55-minute boundary tested both at selection and execution recheck |
| 17 | Asian quarter settlement correct | ✅ 30+ hand-verified test cases across all 8 goals lines + 13 AH lines |
| 18 | Telegram message ID recorded | ✅ `Code: Register Publication` stores `message_id` into `sr_v626_picks` and the registry |
| 19 | Settlement reply uses the right message ID | ✅ `telegram_message_id` flows from `Load Open Picks` through settlement to the reply node's `replyTo` |
| 20 | Calibration record works | ✅ `sr_v626_calibration` row written with Brier/log-loss/CLV components on every settlement |
| 21 | Daily report uses only official public picks | ✅ queries `sr_v626_picks` only, never `market_candidates` |
| 22 | Old tables unaffected | ✅ grep-verified zero references to `empirical_*` in any executable code; schema/reset scripts scoped to `sr_v626_*` only, verified live |
| 23 | SAFE DOUBLE disabled | ✅ `CONFIG.safeDouble.publicEnabled=false`; no Safe Double node exists |
| 24 | Provider rate limit protected | ✅ **fixed during audit** — pacing now enforced via `$getWorkflowStaticData('global').lastProviderCallAtMs` inside `callProvider`, shared across all Code node invocations, capped to `Math.ceil(60000/9)` ms between calls |
| 25 | 429/5xx don't crash the workflow | ✅ `httpWithRetry` never throws; unit-tested for 429 (Retry-After) and 504 |
| 26 | DB failure on one candidate doesn't stop others | ✅ `sbWrite` is fail-soft (never throws); the per-fixture loop continues regardless of write outcome |
| 27 | Telegram failure recorded correctly | ✅ **fixed during audit** — both Telegram nodes now set `onError: 'continueRegularOutput'`; publish failures route to `Code: Record Telegram Failure` (`status='TELEGRAM_FAILED'`) instead of crashing |
| 28 | No duplicate Telegram publication | ✅ registry's `unique(fixture_id, publication_date)` + pre-publish cap check |
| 29 | No hard-coded secrets | ✅ grep-verified; all secrets via `$env.*` or the named Telegram credential |
| 30 | All Code nodes pass syntax validation | ✅ 14/14 via `AsyncFunction` parse **and** 14/14 via mocked execution (`build/smoke-test.js`) |

Two real issues (#24 pacing, #27 Telegram error handling) were **found and fixed** during
this audit pass, before this file was written — not merely checked off.

## 7. SQL schema — live-verified

Both SQL files were executed against a real, throwaway PostgreSQL 16 instance (not just
read for syntax):
- `SOCCER_RADAR_v6.26_SUPABASE_SCHEMA.sql` — all 7 tables + all indexes created without
  error.
- `SOCCER_RADAR_v6.26_RESET.sql` — truncates all 7 `sr_v626_*` tables and nothing else;
  the script's own trailing sanity `SELECT` (informational, no writes) confirms zero
  `empirical_*` tables were touched.
- Constraint tests performed live: a second `sr_v626_publication_registry` row for the
  same `(fixture_id, publication_date)` was correctly **rejected**; an invalid
  `rejection_reason` string was correctly **rejected**; a `market_score` of 150 was
  correctly **rejected**; a second `OPEN`+`published` pick on an already-open fixture was
  correctly **rejected** by the partial unique index.

## 8. API request budget

Provider: 5DollarFootballAPI PRO, shared limit 10 req/min. This workflow paces itself to
`MAX_PROVIDER_REQUESTS_PER_MINUTE = 9` (`Math.ceil(60000/9) ≈ 6667 ms` between calls,
enforced globally, retries included).

Rough per-run estimate (varies with the day's fixture count; illustrative for ~15
fixtures in a window):
- **Market Scout** (×3/day): 1–3 paginated fixture-list calls per window.
- **Selector** (×3/day): 2 team-history calls per executable fixture (~15 fixtures ≈ 30
  calls) + up to 2 execution-recheck calls (≤`MAX_PUBLIC_PER_RUN`).
- **Settlement** (every 30 min): 1 result-check call per still-open pick (bounded by
  `MAX_PUBLIC_PER_DAY=4`, so ≤4 open picks at any time) + at most 1 closing-line capture
  per pick, once.
- **Daily Report**: 0 provider calls (Supabase only).

At the configured pacing, even a worst-case burst of ~40 calls in one Selector run takes
≈4.5 minutes to drain — comfortably inside the shared limit and never bursting.

## 9. Production schedule (Europe/Sofia)

| Time | Job |
|---|---|
| 07:00 / 14:00 / 21:00 | Market Scout (windows A/B/C, non-overlapping per `lib/schedule.js`) |
| 07:30 / 14:30 / 21:30 | Selector (30 min after its paired Scout window; `MIN_TO_KO=45` min) |
| :15 and :45 past every hour | Settlement (finished-fixture check + closing-line capture) |
| 08:00 | Daily Report |

## 10. Deliverables

1. `out/SOCCER_RADAR_v6.26_QUALITY_FIRST_MULTI_MARKET_SELECTOR_FINAL.json`
2. `sql/SOCCER_RADAR_v6.26_SUPABASE_SCHEMA.sql`
3. `sql/SOCCER_RADAR_v6.26_RESET.sql` (scoped to `sr_v626_*` only — confirmed, §7)
4. This audit report
5. `lib/*.js` + `tests/run-tests.js` (227/227 passing) + `build/*.js` (the workflow is
   generated, not hand-typed, from the same tested library)

**Required n8n setup before activating:** environment variables `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `SR626_PROVIDER_API_BASE`, `SR626_PROVIDER_API_KEY`,
`SR626_TELEGRAM_CHAT_ID`, and a Telegram API credential named "Telegram account".

## 11. v6.26.1 addendum — fixes from real-provider testing

Found and fixed after the account owner ran this workflow against the real provider and a
real Supabase project (three real bugs the mocked smoke tests could not have caught, since
they don't enforce Postgres constraints or exercise real provider field shapes):

1. **`sr_v626_runs` parent created before children.** The original design inserted the run
   row only at the very end (`Save Run Diagnostics`), but `sr_v626_fixture_analysis` and
   `sr_v626_market_candidates` both have a foreign key to it — every child write during a
   run would have violated that FK. `Code: Load Fixtures From Snapshots` now creates the
   parent (`status: RUNNING`) first; `Save Run Diagnostics` `PATCH`es that same row instead
   of inserting a second one. `run_id` is now always freshly generated (removed a `||`
   that could otherwise reuse a stale id left in global static data from a prior
   execution — this closes Known Limitation #3 above).
2. **Real 5DollarFootballAPI field names.** Several guessed field names were wrong:
   kickoff is `fixture.kickoff_utc` / `kickoff_ts` (not `starting_at`), teams are
   `fixture.teams.home/away.{id,name}` (not `fixture.home_team`), `league.country` is a
   plain string. The batch fixture list's `include=odds` is discovery-only per the
   provider (may carry a line with no side price) — the authoritative price always
   requires a separate `GET /fixtures/{id}/odds?bookmakers=bet365` call, now used
   everywhere a price is read (Market Scout, Execution Recheck, closing-line capture).
3. **PostgREST bulk-insert key consistency.** A field built as `a && a.b` evaluates to
   `undefined` (not `null`) when `a` is missing, and `JSON.stringify` drops
   `undefined`-valued keys — so a fixture with an incomplete Bet365 book produced a
   snapshot row with a different key set than its neighbors, and PostgREST rejects a
   multi-row insert unless every row has the exact same columns ("All object keys must
   match"). Every field is now explicit `?? null`, and `build/smoke-test.js` permanently
   guards against this class of bug (`assertBulkInsertKeysMatch`, JSON round-trips every
   multi-row POST body exactly as production would).

Two further improvements, ported from a corrected copy of this workflow the account owner
produced independently and verified against here before merging:

4. **Real-market-only universe.** `buildMarketUniverse(config, bet365)` now builds
   candidates only from lines Bet365 actually quoted for the fixture, rather than the full
   theoretical 49-market grid filtered down after the fact. Confirmed via `AUDIT_REPORT.md`
   §5 limitation #2 (real books are sparse) — this avoids ~40 empty
   `EXACT_MARKET_NOT_FOUND` rows per fixture in the common case.
5. **Execution Recheck fully recomputes**, not just re-checks price deterioration:
   de-vig → calibration → EV → Edge → MarketScore are all re-derived from the live price
   (`lib/executionRecheck.js`, unit-tested), so a price move that would change the
   calibrated verdict is judged on the new verdict, not the stale selection-time one.
   Asian Handicap candidates are now labelled `MARKET_FAMILY_RESEARCH_ONLY` instead of a
   bare `null` (added to the SQL `rejection_reason` CHECK constraint — additive, verified
   against a live PostgreSQL instance).

**Rejected from that independently-produced copy:** its sticky-note documentation claimed
"no artificial per-run or per-day publication quantity cap" (relabeled
`v6.26.6 · 5-WINDOW QUALITY-UNLIMITED`), but the actual `Finalize Candidate Queue` code was
byte-for-byte unchanged and still enforces `CONFIG.volume.maxPublicPerRun=2` /
`maxPublicPerDay=4` — the documentation didn't match the code. This workflow keeps those
caps enforced and does not claim otherwise anywhere.

All 240 tests pass (up from 227), `build/validate-syntax.js` and `build/smoke-test.js` are
clean, and the SQL schema + reset scripts were re-verified against a live PostgreSQL 16
instance after the `MARKET_FAMILY_RESEARCH_ONLY` addition.
