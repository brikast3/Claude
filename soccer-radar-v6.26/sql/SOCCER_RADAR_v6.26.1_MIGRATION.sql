-- ============================================================================
-- SOCCER RADAR v6.26.1 · MIGRATION
--
-- Adds MARKET_FAMILY_RESEARCH_ONLY to the allowed rejection_reason values on
-- an EXISTING sr_v626_market_candidates table. Additive only -- does not
-- touch any existing rows, any other table, or empirical_*.
--
-- Run with: psql "$SUPABASE_DB_URL" -f SOCCER_RADAR_v6.26.1_MIGRATION.sql
-- ============================================================================

begin;

alter table sr_v626_market_candidates
  drop constraint if exists sr_v626_market_candidates_rejection_reason_check;

alter table sr_v626_market_candidates
  add constraint sr_v626_market_candidates_rejection_reason_check
  check (rejection_reason is null or rejection_reason in (
    'MARKET_SCORE_TOO_LOW','ODD_BELOW_PUBLIC_RANGE','ODD_ABOVE_PUBLIC_RANGE',
    'CALIBRATED_EV_TOO_LOW','CALIBRATED_EDGE_TOO_LOW','DATA_QUALITY_LOW',
    'HISTORY_SCORE_LOW','EXTREME_EV_REJECT','SECOND_MARKET_TOO_CLOSE',
    'BETTER_MARKET_ON_SAME_FIXTURE','EXACT_MARKET_NOT_FOUND','EXACT_LINE_NOT_FOUND',
    'BET365_PRICE_MOVED','PRICE_DETERIORATION_TOO_HIGH','SNAPSHOT_STALE',
    'FIXTURE_ALREADY_PUBLISHED','DAILY_CAP_REACHED','RUN_CAP_REACHED',
    'INSUFFICIENT_HISTORY','MODEL_PROBABILITY_INVALID','MARKET_PROBABILITY_INVALID',
    'EXECUTION_REJECTED','MARKET_FAMILY_RESEARCH_ONLY','UNEXPECTED_ERROR'
  ));

commit;
