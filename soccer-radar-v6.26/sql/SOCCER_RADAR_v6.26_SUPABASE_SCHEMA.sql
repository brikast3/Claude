-- ============================================================================
-- SOCCER RADAR v6.26 · QUALITY-FIRST MULTI-MARKET SELECTOR
-- Supabase / PostgreSQL schema.
--
-- All production tables are prefixed sr_v626_ and are entirely separate from
-- the old empirical_* tables used by v6.25.4. This schema NEVER references,
-- alters, or drops anything outside the sr_v626_ prefix.
--
-- Run with: psql "$SUPABASE_DB_URL" -f SOCCER_RADAR_v6.26_SUPABASE_SCHEMA.sql
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A) sr_v626_runs -- one row per Selector run
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_runs (
  run_id                         text primary key,
  started_at                     timestamptz not null default now(),
  finished_at                    timestamptz,
  "window"                       text,
  fixtures_fetched               integer not null default 0,
  fixtures_analyzed              integer not null default 0,
  fixture_profiles_built         integer not null default 0,
  markets_evaluated              integer not null default 0,
  candidates_passing_model       integer not null default 0,
  candidates_passing_price       integer not null default 0,
  candidates_passing_calibration integer not null default 0,
  candidates_passing_market_score integer not null default 0,
  public_candidates              integer not null default 0,
  published_count                integer not null default 0,
  execution_rejected             integer not null default 0,
  provider_requests              integer not null default 0,
  provider_retries               integer not null default 0,
  provider_errors                integer not null default 0,
  status                         text not null default 'RUNNING'
                                    check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  diagnostics                    jsonb not null default '{}'::jsonb,
  created_at                     timestamptz not null default now()
);

create index if not exists idx_sr_v626_runs_started_at on sr_v626_runs (started_at desc);

-- ----------------------------------------------------------------------------
-- B) sr_v626_fixture_analysis -- one row per fixture per run
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_fixture_analysis (
  id                     bigint generated always as identity primary key,
  run_id                 text not null references sr_v626_runs (run_id) on delete cascade,
  fixture_id             bigint not null,
  kickoff                timestamptz not null,
  league_id              bigint,
  league_name            text,
  country                text,
  home_team              text not null,
  away_team              text not null,

  lambda_home            numeric(6,3),
  lambda_away            numeric(6,3),
  expected_total_goals   numeric(6,3),

  home_attack_score      numeric(6,3),
  home_defence_score     numeric(6,3),
  away_attack_score      numeric(6,3),
  away_defence_score     numeric(6,3),

  home_sample_n          integer not null default 0,
  away_sample_n          integer not null default 0,

  history_score          numeric(5,2) check (history_score is null or history_score between 0 and 100),
  data_quality_score     numeric(5,2) check (data_quality_score is null or data_quality_score between 0 and 100),
  league_reliability     numeric(5,2) check (league_reliability is null or league_reliability between 0 and 100),

  goal_profile           jsonb,
  score_matrix           jsonb,

  engine_version         text not null default 'V6.26',
  model_version          text not null default 'MULTI_MARKET_SELECTOR_V1',

  created_at             timestamptz not null default now(),

  unique (run_id, fixture_id)
);

create index if not exists idx_sr_v626_fa_fixture on sr_v626_fixture_analysis (fixture_id);
create index if not exists idx_sr_v626_fa_kickoff on sr_v626_fixture_analysis (kickoff);
create index if not exists idx_sr_v626_fa_league on sr_v626_fixture_analysis (league_id);

-- ----------------------------------------------------------------------------
-- C) sr_v626_market_candidates -- EVERY evaluated market, approved or rejected
--    (the research/calibration dataset -- never a shadow-bet ledger)
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_market_candidates (
  candidate_id                    bigint generated always as identity primary key,
  run_id                          text not null references sr_v626_runs (run_id) on delete cascade,
  fixture_id                      bigint not null,

  market_family                   text not null
                                     check (market_family in ('GOALS', 'BTTS', 'MONEYLINE', 'DOUBLE_CHANCE', 'ASIAN_HANDICAP')),
  market_key                      text not null,
  side                            text not null,
  line                            numeric(5,2),

  bet365_odd                      numeric(6,3),
  opposite_odd                    numeric(6,3),

  raw_implied_probability         numeric(6,5) check (raw_implied_probability is null or raw_implied_probability between 0 and 1),
  devig_market_probability        numeric(6,5) check (devig_market_probability is null or devig_market_probability between 0 and 1),

  model_probability_raw           numeric(6,5) check (model_probability_raw is null or model_probability_raw between 0 and 1),
  model_probability_calibrated    numeric(6,5) check (model_probability_calibrated is null or model_probability_calibrated between 0 and 1),

  raw_ev                          numeric(6,4),
  calibrated_ev                   numeric(6,4),
  raw_edge_pp                     numeric(6,4),
  calibrated_edge_pp              numeric(6,4),

  market_score                    numeric(5,2) not null default 0 check (market_score between 0 and 100),

  score_probability_component     numeric(5,2) default 0,
  score_history_component         numeric(5,2) default 0,
  score_data_quality_component    numeric(5,2) default 0,
  score_market_component          numeric(5,2) default 0,
  score_home_away_component       numeric(5,2) default 0,
  score_price_component           numeric(5,2) default 0,
  score_league_component          numeric(5,2) default 0,

  overconfidence_penalty          numeric(5,2) not null default 0,

  rank_in_fixture                 integer,
  score_separation                numeric(5,2),

  public_eligible                 boolean not null default false,
  selected_as_best_market         boolean not null default false,

  rejection_reason                text
                                     check (rejection_reason is null or rejection_reason in (
                                       'MARKET_SCORE_TOO_LOW','ODD_BELOW_PUBLIC_RANGE','ODD_ABOVE_PUBLIC_RANGE',
                                       'CALIBRATED_EV_TOO_LOW','CALIBRATED_EDGE_TOO_LOW','DATA_QUALITY_LOW',
                                       'HISTORY_SCORE_LOW','EXTREME_EV_REJECT','SECOND_MARKET_TOO_CLOSE',
                                       'BETTER_MARKET_ON_SAME_FIXTURE','EXACT_MARKET_NOT_FOUND','EXACT_LINE_NOT_FOUND',
                                       'BET365_PRICE_MOVED','PRICE_DETERIORATION_TOO_HIGH','SNAPSHOT_STALE',
                                       'FIXTURE_ALREADY_PUBLISHED','DAILY_CAP_REACHED','RUN_CAP_REACHED',
                                       'INSUFFICIENT_HISTORY','MODEL_PROBABILITY_INVALID','MARKET_PROBABILITY_INVALID',
                                       'EXECUTION_REJECTED','MARKET_FAMILY_RESEARCH_ONLY','UNEXPECTED_ERROR'
                                     )),

  market_snapshot_at               timestamptz,

  engine_version                   text not null default 'V6.26',
  model_version                    text not null default 'MULTI_MARKET_SELECTOR_V1',
  calibration_version              text not null default 'V626_CALIBRATION_V1',
  score_version                    text not null default 'MARKET_SCORE_V1',

  created_at                       timestamptz not null default now(),

  unique (run_id, fixture_id, market_key)
);

create index if not exists idx_sr_v626_mc_fixture on sr_v626_market_candidates (fixture_id);
create index if not exists idx_sr_v626_mc_run on sr_v626_market_candidates (run_id);
create index if not exists idx_sr_v626_mc_family on sr_v626_market_candidates (market_family);
create index if not exists idx_sr_v626_mc_selected on sr_v626_market_candidates (selected_as_best_market) where selected_as_best_market;
create index if not exists idx_sr_v626_mc_rejection on sr_v626_market_candidates (rejection_reason);
create index if not exists idx_sr_v626_mc_score on sr_v626_market_candidates (market_score desc);

-- ----------------------------------------------------------------------------
-- D) sr_v626_picks -- only the officially approved, published public Singles
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_picks (
  pick_id                       text primary key,
  candidate_id                  bigint references sr_v626_market_candidates (candidate_id),
  run_id                        text references sr_v626_runs (run_id),

  fixture_id                    bigint not null,
  kickoff                       timestamptz not null,

  league_id                     bigint,
  league_name                   text,
  country                       text,
  home_team                     text not null,
  away_team                     text not null,

  market_family                 text not null,
  market_key                    text not null,
  selection                     text not null,
  side                          text not null,
  line                          numeric(5,2),

  entry_odd                     numeric(6,3) not null check (entry_odd > 1),

  market_score                  numeric(5,2) not null check (market_score between 0 and 100),

  model_probability_calibrated  numeric(6,5),
  market_probability            numeric(6,5),

  calibrated_ev                 numeric(6,4),
  calibrated_edge_pp            numeric(6,4),

  history_score                 numeric(5,2),
  data_quality_score            numeric(5,2),

  stake_eur                     numeric(8,2) not null default 100,

  published                     boolean not null default false,
  published_at                  timestamptz,

  telegram_chat_id              text,
  telegram_message_id           bigint,
  telegram_text                 text,

  status                        text not null default 'OPEN'
                                   check (status in ('OPEN', 'WIN', 'HALF_WIN', 'PUSH', 'HALF_LOSS', 'LOSS', 'VOID', 'TELEGRAM_FAILED')),
  result_score                  text,
  profit_eur                    numeric(8,2),

  closing_odd                   numeric(6,3),
  clv_pp                        numeric(6,4),

  settled_at                    timestamptz,

  engine_version                text not null default 'V6.26',
  model_version                 text not null default 'MULTI_MARKET_SELECTOR_V1',
  calibration_version           text not null default 'V626_CALIBRATION_V1',
  score_version                 text not null default 'MARKET_SCORE_V1',

  created_at                    timestamptz not null default now()
);

create index if not exists idx_sr_v626_picks_fixture on sr_v626_picks (fixture_id);
create index if not exists idx_sr_v626_picks_status on sr_v626_picks (status);
create index if not exists idx_sr_v626_picks_kickoff on sr_v626_picks (kickoff);
create index if not exists idx_sr_v626_picks_settled_at on sr_v626_picks (settled_at desc);
create index if not exists idx_sr_v626_picks_market_family on sr_v626_picks (market_family);
create unique index if not exists uq_sr_v626_picks_open_fixture
  on sr_v626_picks (fixture_id) where status = 'OPEN' and published = true;

-- ----------------------------------------------------------------------------
-- E) sr_v626_calibration -- settled outcomes joined back to the prediction,
--    for Brier/log-loss/CLV analysis by market family and score bucket
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_calibration (
  id                     bigint generated always as identity primary key,
  candidate_id           bigint references sr_v626_market_candidates (candidate_id),
  fixture_id             bigint not null,

  market_family          text not null,
  market_key             text not null,
  side                   text not null,
  line                   numeric(5,2),
  odd                    numeric(6,3) not null,

  predicted_probability  numeric(6,5),
  market_probability     numeric(6,5),
  market_score           numeric(5,2),

  result                 text not null check (result in ('WIN', 'HALF_WIN', 'PUSH', 'HALF_LOSS', 'LOSS', 'VOID')),
  profit_eur             numeric(8,2),

  brier_component        numeric(8,6),
  log_loss_component     numeric(8,6),
  clv_pp                 numeric(6,4),

  settled_at             timestamptz not null default now()
);

create index if not exists idx_sr_v626_calib_fixture on sr_v626_calibration (fixture_id);
create index if not exists idx_sr_v626_calib_family on sr_v626_calibration (market_family);
create index if not exists idx_sr_v626_calib_settled_at on sr_v626_calibration (settled_at desc);

-- ----------------------------------------------------------------------------
-- F) sr_v626_publication_registry -- hard dedup: max ONE public Single per
--    fixture per calendar day
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_publication_registry (
  id                     bigint generated always as identity primary key,
  fixture_id             bigint not null,
  pick_id                text not null references sr_v626_picks (pick_id),
  publication_date       date not null,
  market_key             text not null,
  telegram_message_id    bigint,
  created_at             timestamptz not null default now(),

  unique (fixture_id, publication_date)
);

create index if not exists idx_sr_v626_pubreg_date on sr_v626_publication_registry (publication_date);

-- ----------------------------------------------------------------------------
-- G) sr_v626_market_snapshots -- raw Bet365 price snapshots collected by
--    Market Scout (fail-closed source of truth for the Selector + Execution
--    Recheck; never edited, only appended)
-- ----------------------------------------------------------------------------
create table if not exists sr_v626_market_snapshots (
  id                     bigint generated always as identity primary key,
  fixture_id             bigint not null,
  kickoff                timestamptz not null,

  bookmaker_id           integer not null default 8,
  bookmaker_name         text not null default 'Bet365',

  snapshot_at            timestamptz not null default now(),

  home_odd               numeric(6,3),
  draw_odd               numeric(6,3),
  away_odd               numeric(6,3),

  btts_yes               numeric(6,3),
  btts_no                numeric(6,3),

  totals                 jsonb,
  asian_totals           jsonb,
  asian_handicap         jsonb,
  double_chance          jsonb,

  league_id              bigint,
  league_name            text,
  country                text,
  home_team              text,
  away_team              text,
  home_team_id           bigint,
  away_team_id           bigint,
  window_id              text,

  raw_market_payload     jsonb,
  payload_hash           text,

  created_at             timestamptz not null default now()
);

create index if not exists idx_sr_v626_snap_fixture on sr_v626_market_snapshots (fixture_id);
create index if not exists idx_sr_v626_snap_kickoff on sr_v626_market_snapshots (kickoff);
create index if not exists idx_sr_v626_snap_snapshot_at on sr_v626_market_snapshots (fixture_id, snapshot_at desc);

commit;

-- ============================================================================
-- This script never touches empirical_* (v6.25.4) tables. Run
-- SOCCER_RADAR_v6.26_RESET.sql to wipe v6.26 state during calibration testing;
-- it is likewise scoped to sr_v626_* only.
-- ============================================================================
