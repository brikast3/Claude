-- ============================================================================
-- SOCCER RADAR v6.26 · RESET SCRIPT
--
-- Wipes ONLY the sr_v626_* production tables (for calibration-period resets /
-- clean test runs). Never touches empirical_* (v6.25.4) or any other table.
--
-- Run with: psql "$SUPABASE_DB_URL" -f SOCCER_RADAR_v6.26_RESET.sql
-- ============================================================================

begin;

truncate table
  sr_v626_publication_registry,
  sr_v626_calibration,
  sr_v626_picks,
  sr_v626_market_candidates,
  sr_v626_fixture_analysis,
  sr_v626_market_snapshots,
  sr_v626_runs
restart identity cascade;

commit;

-- Sanity check: confirm nothing outside sr_v626_* was touched by this script.
-- (This SELECT is informational only -- it performs no writes.)
select relname
from pg_class
where relkind = 'r'
  and relname like 'empirical\_%' escape '\'
order by relname;
