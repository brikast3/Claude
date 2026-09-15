'use strict';
const fs = require('fs');
const path = require('path');
const {
  node, stickyNote, codeNode, scheduleTrigger, ifNode, splitInBatches, waitNode,
  telegramNode, withLib, supabaseHeaders, providerHeaders, uid
} = require('./build-workflow');

const SB = supabaseHeaders();
const PROV = providerHeaders();

// ===========================================================================
// MODULE A · MARKET SCOUT (07:00 / 14:00 / 21:00)
// ===========================================================================
const triggerMarketScout = scheduleTrigger(
  'Schedule Trigger: Market Scout 07:00/14:00/21:00',
  '0 7,14,21 * * *',
  'Fires once per window (A/B/C). Fetches the fixture+odds universe for that window only -- no overlap with the other two windows (see lib/schedule.js getActiveWindow).'
);

const codeMarketScout = codeNode('Code: Market Scout v6.26', withLib(`
${SB}
${PROV}

const diag = { providerRequests: 0, providerRetries: 0, providerErrors: 0, dbWrites: 0, dbWriteFailures: 0, fixturesFetched: 0, fixturesStored: 0, parseErrors: 0 };
const nowMs = Date.now();
const window = getActiveWindow(nowMs, CONFIG);

// ---- 1. Fetch the fixture list for this window (paginated, fail-soft) --------
async function fetchFixtureWindow() {
  const out = [];
  const startSec = Math.floor(window.rangeStartMs / 1000);
  const endSec = Math.floor(window.rangeEndMs / 1000);
  let page = 1, more = true;
  while (more && page <= 15) {
    const r = await callProvider(\`/fixtures?status=scheduled&start_time=\${startSec}&end_time=\${endSec}&include=odds&per_page=50&page=\${page}\`, diag);
    if (!r.ok) break;
    const rows = Array.isArray(r.response && r.response.data) ? r.response.data : [];
    out.push(...rows);
    more = Boolean(r.response && r.response.pagination && r.response.pagination.has_more);
    page++;
  }
  return out;
}

// ---- 2. Parse Bet365 odds into the canonical payload -------------------------
// parseBet365Payload / EXCLUDED_COMPETITION_RE come from the bundled
// lib/bet365Parser.js above -- the SAME function the Execution Recheck node
// uses, so the two stages can never disagree on what a field means.

async function run() {
  const fixtures = await fetchFixtureWindow();
  diag.fixturesFetched = fixtures.length;
  const rows = [];
  for (const fx of fixtures) {
    try {
      const league = fx.league || {};
      if (EXCLUDED_COMPETITION_RE.test(String(league.name || '') + ' ' + String(fx.round || ''))) continue;
      const bet365 = parseBet365Payload(fx);
      rows.push({
        fixture_id: fx.id, kickoff: fx.starting_at || fx.start_time || fx.date,
        league_id: league.id ?? null, league_name: league.name ?? null, country: (league.country && league.country.name) ?? null,
        home_team: fx.home_team && fx.home_team.name, away_team: fx.away_team && fx.away_team.name,
        home_team_id: fx.home_team && fx.home_team.id, away_team_id: fx.away_team && fx.away_team.id,
        bookmaker_id: 8, bookmaker_name: 'Bet365', snapshot_at: bet365.snapshotAt,
        home_odd: bet365.moneyline && bet365.moneyline.home, draw_odd: bet365.moneyline && bet365.moneyline.draw, away_odd: bet365.moneyline && bet365.moneyline.away,
        btts_yes: bet365.btts && bet365.btts.yes, btts_no: bet365.btts && bet365.btts.no,
        totals: bet365.totals || null, asian_totals: bet365.asianTotals || null, asian_handicap: bet365.asianHandicap || null, double_chance: bet365.doubleChance || null,
        raw_market_payload: fx, payload_hash: null, window_id: window.windowId
      });
    } catch (e) { diag.parseErrors++; }
  }
  if (rows.length > 0) {
    const w = await sbWrite('/rest/v1/sr_v626_market_snapshots', 'POST', rows, diag);
    if (w.ok) diag.fixturesStored = rows.length;
  }
  return [{ json: { windowId: window.windowId, ...diag, storedAt: new Date().toISOString() } }];
}

return run();
`), { notes: 'Fetches fixtures + real Bet365 prices for this window only, parses into the canonical payload, and stores one snapshot row per fixture. Never fetches Asian markets beyond what Bet365 actually quotes -- no synthetic lines.' });

// ===========================================================================
// MODULE B · SELECTOR (07:30 / 14:30 / 21:30)
// ===========================================================================
const triggerSelector = scheduleTrigger(
  'Schedule Trigger: Selector 07:30/14:30/21:30',
  '30 7,14,21 * * *',
  'Runs 30 minutes after its paired Market Scout window so every snapshot used here is fresh (well under the 55-minute staleness gate).'
);

const codeLoadFixtures = codeNode('Code: Load Fixtures From Snapshots', withLib(`
${SB}
${PROV}
const staticData = $getWorkflowStaticData('global');
staticData.runId = staticData.runId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
staticData.diagnostics = createRunDiagnostics();
staticData.stagedCandidates = [];
staticData.runStartedAt = new Date().toISOString();

const nowMs = Date.now();
const window = getActiveWindow(nowMs, CONFIG);
const diag = staticData.diagnostics;

async function loadLatestSnapshots() {
  const startIso = new Date(window.rangeStartMs).toISOString();
  const endIso = new Date(window.rangeEndMs).toISOString();
  const q = \`/rest/v1/sr_v626_market_snapshots?kickoff=gte.\${startIso}&kickoff=lt.\${endIso}&order=fixture_id.asc,snapshot_at.desc\`;
  const r = await sbFetch(q, { method: 'GET' });
  return Array.isArray(r) ? r : [];
}

function toBet365Payload(row) {
  return {
    snapshotAt: row.snapshot_at,
    moneyline: (row.home_odd || row.draw_odd || row.away_odd) ? { home: row.home_odd, draw: row.draw_odd, away: row.away_odd } : undefined,
    btts: (row.btts_yes || row.btts_no) ? { yes: row.btts_yes, no: row.btts_no } : undefined,
    totals: row.totals || undefined,
    asianTotals: row.asian_totals || undefined,
    asianHandicap: row.asian_handicap || undefined,
    doubleChance: row.double_chance || undefined
  };
}

async function fetchTeamHistory(teamId) {
  const r = await callProvider(\`/teams/\${teamId}/results?per_page=20&order=desc\`, diag);
  if (!r.ok) return [];
  const rows = Array.isArray(r.response && r.response.data) ? r.response.data : [];
  return rows.map(m => {
    const isHome = String(m.home_team_id) === String(teamId);
    const gf = isHome ? m.home_score : m.away_score;
    const ga = isHome ? m.away_score : m.home_score;
    return { goalsFor: Number(gf) || 0, goalsAgainst: Number(ga) || 0, isHome };
  });
}

async function run() {
  const snapshotRows = await loadLatestSnapshots();
  const byFixture = new Map();
  for (const row of snapshotRows) if (!byFixture.has(row.fixture_id)) byFixture.set(row.fixture_id, row);
  diag.fixturesFetched = byFixture.size;

  const leagueGoals = new Map();
  const items = [];
  for (const row of byFixture.values()) {
    const kickoffMs = Date.parse(row.kickoff);
    if (!isExecutable(kickoffMs, nowMs, CONFIG)) continue;
    diag.fixturesExecutable = (diag.fixturesExecutable || 0) + 1;

    const homeAll = await fetchTeamHistory(row.home_team_id);
    const awayAll = await fetchTeamHistory(row.away_team_id);
    const homeMatches = homeAll.filter(m => m.isHome);
    const awayMatches = awayAll.filter(m => !m.isHome);

    if (row.league_id) {
      const stat = leagueGoals.get(row.league_id) || { total: 0, n: 0 };
      const sample = homeMatches.slice(0, 5);
      for (const m of sample) { stat.total += m.goalsFor + m.goalsAgainst; stat.n++; }
      leagueGoals.set(row.league_id, stat);
    }

    items.push({
      fixtureId: row.fixture_id, kickoff: row.kickoff, leagueId: row.league_id, leagueName: row.league_name,
      country: row.country, homeTeam: row.home_team, awayTeam: row.away_team,
      homeMatches, awayMatches, bet365: toBet365Payload(row), snapshotAt: row.snapshot_at, nowMs
    });
  }

  diag.fixtureProfilesBuilt = items.length;
  return items.map(it => {
    const stat = it.leagueId ? leagueGoals.get(it.leagueId) : null;
    const leagueContext = stat && stat.n >= 4 ? { avgGoalsPerMatch: stat.total / stat.n, fixturesObservedThisRun: stat.n } : null;
    const leagueReliabilityScore = stat ? Math.min(100, Math.round(100 * Math.min(1, stat.n / 8))) : 50;
    return { json: { ...it, leagueContext, leagueReliabilityScore, runId: staticData.runId, windowId: window.windowId } };
  });
}
return run();
`), { notes: 'Reads back the latest snapshot per fixture (never re-fetches odds), pulls team history from the provider (rate-limited), and emits one item per executable fixture (kickoff >= 45min away).' });

const loopFixtures = splitInBatches('Loop Over Fixtures');

const codeEvaluateFixture = codeNode('Code: Evaluate + Persist Fixture', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const fx = $input.first().json;

let result;
try {
  result = evaluateFixture(fx, CONFIG);
} catch (e) {
  diag.dbWriteFailures++;
  return [{ json: { fixtureId: fx.fixtureId, evaluationError: e.message } }];
}

diag.fixturesAnalyzed++;
for (const c of result.candidates) recordMarketEvaluated(diag, c.marketFamily);
for (const c of result.candidates) {
  if (c.modelProbabilityValid) diag.candidatesPassingModel++;
  if (c.hasExactLine) diag.candidatesPassingPrice++;
  if (c.modelProbabilityCalibrated !== null) diag.candidatesPassingCalibration++;
  if (c.marketScore >= CONFIG.gate.minMarketScore) diag.candidatesPassingMarketScore++;
  recordRejection(diag, c.rejectionReason);
}

const analysisRow = {
  run_id: staticData.runId, fixture_id: fx.fixtureId, kickoff: fx.kickoff, league_id: fx.leagueId, league_name: fx.leagueName,
  country: fx.country, home_team: fx.homeTeam, away_team: fx.awayTeam,
  lambda_home: result.lambdaHome, lambda_away: result.lambdaAway, expected_total_goals: result.expectedTotalGoals,
  home_attack_score: fx.homeMatches.length ? result.fixtureProfile.home.scoringRate : null,
  home_defence_score: fx.homeMatches.length ? result.fixtureProfile.home.concedingRate : null,
  away_attack_score: fx.awayMatches.length ? result.fixtureProfile.away.scoringRate : null,
  away_defence_score: fx.awayMatches.length ? result.fixtureProfile.away.concedingRate : null,
  home_sample_n: result.fixtureProfile.home.sampleN, away_sample_n: result.fixtureProfile.away.sampleN,
  history_score: result.fixtureProfile.historyScore, data_quality_score: result.fixtureProfile.dataQualityScore,
  league_reliability: fx.leagueReliabilityScore, goal_profile: result.fixtureProfile, score_matrix: result.scoreMatrix,
  engine_version: CONFIG.engineVersion, model_version: CONFIG.modelVersion
};
await sbWrite('/rest/v1/sr_v626_fixture_analysis', 'POST', [analysisRow], diag);

const candidateRows = result.candidates.map(c => ({
  run_id: staticData.runId, fixture_id: fx.fixtureId,
  market_family: c.marketFamily, market_key: c.marketKey, side: c.side, line: c.line,
  bet365_odd: c.bet365Odd, opposite_odd: c.oppositeOdd,
  raw_implied_probability: c.rawImpliedProbability, devig_market_probability: c.devigMarketProbability,
  model_probability_raw: c.modelProbabilityRaw, model_probability_calibrated: c.modelProbabilityCalibrated,
  raw_ev: c.rawEv, calibrated_ev: c.calibratedEv, raw_edge_pp: c.rawEdgePp, calibrated_edge_pp: c.calibratedEdgePp,
  market_score: c.marketScore,
  score_probability_component: c.scoreProbabilityComponent, score_history_component: c.scoreHistoryComponent,
  score_data_quality_component: c.scoreDataQualityComponent, score_market_component: c.scoreMarketComponent,
  score_home_away_component: c.scoreHomeAwayComponent, score_price_component: c.scorePriceComponent,
  score_league_component: c.scoreLeagueComponent, overconfidence_penalty: c.penalties ? c.penalties.overconfidencePenalty : 0,
  rank_in_fixture: c.rankInFixture, score_separation: c.scoreSeparation,
  public_eligible: c.publicEligible, selected_as_best_market: c.selectedAsBestMarket === true,
  rejection_reason: c.rejectionReason, market_snapshot_at: c.marketSnapshotAt,
  engine_version: CONFIG.engineVersion, model_version: CONFIG.modelVersion,
  calibration_version: CONFIG.calibrationVersion, score_version: CONFIG.scoreVersion
}));
if (candidateRows.length > 0) await sbWrite('/rest/v1/sr_v626_market_candidates', 'POST', candidateRows, diag);

if (result.bestCandidate) {
  diag.bestMarketsSelected++;
  staticData.stagedCandidates.push({
    fixtureId: fx.fixtureId, kickoff: fx.kickoff, leagueId: fx.leagueId, leagueName: fx.leagueName, country: fx.country,
    homeTeam: fx.homeTeam, awayTeam: fx.awayTeam, ...result.bestCandidate
  });
}
return [{ json: { fixtureId: fx.fixtureId, staged: Boolean(result.bestCandidate) } }];
`), { notes: 'Runs the full engine for ONE fixture, persists every candidate (approved or rejected) for the research dataset, and stages the fixture\'s best market (if any) for the publication queue. A failure here never stops the loop.' });

const codeFinalizeQueue = codeNode('Code: Finalize Candidate Queue', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.timezone }).format(new Date());

async function publishedToday() {
  const r = await sbFetch(\`/rest/v1/sr_v626_publication_registry?publication_date=eq.\${todayStr}&select=fixture_id\`, { method: 'GET' });
  return Array.isArray(r) ? r : [];
}

async function run() {
  const already = await publishedToday();
  const alreadyFixtureIds = new Set(already.map(r => r.fixture_id));
  const publishedTodayCount = already.length;

  const sorted = [...staticData.stagedCandidates].sort((a, b) => b.marketScore - a.marketScore);
  const approved = [];
  let publishedThisRun = 0;
  for (const c of sorted) {
    const caps = evaluatePublicationCaps({
      fixtureAlreadyPublished: alreadyFixtureIds.has(c.fixtureId),
      publishedThisRun, publishedToday: publishedTodayCount + publishedThisRun
    }, CONFIG);
    if (!caps.passed) { recordRejection(diag, caps.reasonCode); continue; }
    approved.push(c);
    publishedThisRun++;
    if (publishedThisRun >= CONFIG.volume.maxPublicPerRun) break;
  }
  diag.publicApproved = approved.length;
  return approved.map(c => ({ json: c }));
}
return run();
`), { notes: 'Sorts all of this run\'s best-market candidates by score, then enforces the run cap, the daily cap, and fixture dedup against sr_v626_publication_registry. 0 approved candidates is a perfectly valid outcome.' });

const loopApproved = splitInBatches('Loop Over Approved Picks');

const codeExecutionRecheck = codeNode('Code: Execution Recheck', withLib(`
${SB}
${PROV}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const c = $input.first().json;

async function fetchLatestPrice() {
  const r = await callProvider(\`/fixtures/\${c.fixtureId}?include=odds\`, diag);
  if (!r.ok) return null;
  return r.response;
}

async function run() {
  const fresh = await fetchLatestPrice();
  if (!fresh) {
    return [{ json: { ...c, executionApproved: false, executionReason: CONFIG.rejectionReasons.EXACT_MARKET_NOT_FOUND } }];
  }
  // Re-derive the exact same market/line from a FRESH parse (same
  // parseBet365Payload used by Market Scout) via the same priceLookup used at
  // selection time -- never a nearest-line, nearest-market, or stale fallback.
  const freshBet365 = parseBet365Payload(fresh.data || fresh);
  const market = { marketFamily: c.marketFamily, side: c.side, line: c.line, bookLine: c.bookLine };
  const price = lookupPrice(freshBet365, market);
  const currentOdd = price.hasExactLine ? price.odd : c.bet365Odd;
  const priceDeteriorationPct = c.bet365Odd > 0 ? Math.max(0, (c.bet365Odd - currentOdd) / c.bet365Odd) : 1;
  const snapshotAgeMinutes = (Date.now() - Date.parse(c.marketSnapshotAt)) / 60000;

  const verdict = evaluateExecutionRecheck({
    ...c, odd: currentOdd, entryOdd: c.bet365Odd, hasExactMarket: price.hasExactMarket === true,
    hasExactLine: price.hasExactLine === true, snapshotAgeMinutes
  }, priceDeteriorationPct, CONFIG);

  if (!verdict.passed) {
    diag.executionRejected++;
    recordRejection(diag, verdict.reasonCode);
    await sbWrite(\`/rest/v1/sr_v626_market_candidates?fixture_id=eq.\${c.fixtureId}&market_key=eq.\${c.marketKey}&run_id=eq.\${staticData.runId}\`, 'PATCH', { rejection_reason: verdict.reasonCode, selected_as_best_market: false }, diag);
    return [{ json: { ...c, executionApproved: false, executionReason: verdict.reasonCode } }];
  }
  return [{ json: { ...c, executionApproved: true, currentOdd } }];
}
return run();
`), { notes: 'Reloads the live price for the EXACT fixture/market/line right before publishing and re-runs the full gate. Fails closed on any mismatch, staleness, or price deterioration > 2%. Never falls back to a nearby line, another market, or a stale price.' });

const ifExecutionApproved = ifNode('IF: Execution Approved?', '={{ $json.executionApproved }}');

const codeInsertPick = codeNode('Code: Build Pick + Insert', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const c = $input.first().json;
const pickId = staticData.runId + '-' + c.fixtureId + '-' + c.marketKey;

const row = {
  pick_id: pickId, candidate_id: null, run_id: staticData.runId, fixture_id: c.fixtureId, kickoff: c.kickoff,
  league_id: c.leagueId, league_name: c.leagueName, country: c.country, home_team: c.homeTeam, away_team: c.awayTeam,
  market_family: c.marketFamily, market_key: c.marketKey, selection: c.side, side: c.side, line: c.line,
  entry_odd: c.currentOdd, market_score: c.marketScore, model_probability_calibrated: c.modelProbabilityCalibrated,
  market_probability: c.devigMarketProbability ?? c.rawImpliedProbability, calibrated_ev: c.calibratedEv, calibrated_edge_pp: c.calibratedEdgePp,
  history_score: c.historyScore, data_quality_score: c.dataQualityScore, stake_eur: CONFIG.stake.fixedStakeEur,
  published: false, status: 'OPEN',
  engine_version: CONFIG.engineVersion, model_version: CONFIG.modelVersion,
  calibration_version: CONFIG.calibrationVersion, score_version: CONFIG.scoreVersion
};
await sbWrite('/rest/v1/sr_v626_picks', 'POST', [row], diag);

const text = formatPickPost({
  homeTeam: c.homeTeam, awayTeam: c.awayTeam, country: c.country, leagueName: c.leagueName, kickoff: c.kickoff,
  marketFamily: c.marketFamily, side: c.side, line: c.line, entryOdd: c.currentOdd, marketScore: c.marketScore, stakeEur: CONFIG.stake.fixedStakeEur
});
return [{ json: { ...c, pickId, text } }];
`), { notes: 'Only reaches sr_v626_picks after both the own-candidate gate AND the execution recheck passed.' });

const telegramPublishPick = telegramNode('Telegram: Publish Pick', '={{ $json.text }}');

const ifTelegramSuccessPublish = ifNode('IF: Telegram Publish Success?', '={{ $json.message_id ? true : false }}');

const codeRegisterPublication = codeNode('Code: Register Publication', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const c = $input.first().json;
const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.timezone }).format(new Date());
const messageId = c.message_id;

await sbWrite(\`/rest/v1/sr_v626_picks?pick_id=eq.\${c.pickId}\`, 'PATCH', {
  published: true, published_at: new Date().toISOString(), telegram_chat_id: $env.SR626_TELEGRAM_CHAT_ID,
  telegram_message_id: messageId, telegram_text: c.text
}, diag);
await sbWrite('/rest/v1/sr_v626_publication_registry', 'POST', [{
  fixture_id: c.fixtureId, pick_id: c.pickId, publication_date: todayStr, market_key: c.marketKey, telegram_message_id: messageId
}], diag);
diag.publicPublished++;
return [{ json: { ok: true } }];
`));

const codeRegisterTelegramFailure = codeNode('Code: Record Telegram Failure', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const c = $input.first().json;
diag.dbWriteFailures++;
await sbWrite(\`/rest/v1/sr_v626_picks?pick_id=eq.\${c.pickId}\`, 'PATCH', { published: false, status: 'TELEGRAM_FAILED' }, diag);
return [{ json: { ok: false } }];
`), { notes: 'Telegram publish failed. The pick row is marked TELEGRAM_FAILED (never silently lost, never double-published on retry).' });

const waitBetweenPicks = waitNode('Wait 6s Between Picks', 6);

const codeRecordExecutionRejected = codeNode('Code: Record Execution Rejected', withLib(`
const staticData = $getWorkflowStaticData('global');
return [{ json: { ok: true, reason: $input.first().json.executionReason } }];
`));

const codeFinalizeRun = codeNode('Code: Save Run Diagnostics', withLib(`
${SB}
const staticData = $getWorkflowStaticData('global');
const diag = staticData.diagnostics;
const row = {
  run_id: staticData.runId, started_at: staticData.runStartedAt, finished_at: new Date().toISOString(), window: null,
  fixtures_fetched: diag.fixturesFetched, fixtures_analyzed: diag.fixturesAnalyzed, fixture_profiles_built: diag.fixtureProfilesBuilt,
  markets_evaluated: diag.marketsEvaluated, candidates_passing_model: diag.candidatesPassingModel,
  candidates_passing_price: diag.candidatesPassingPrice, candidates_passing_calibration: diag.candidatesPassingCalibration,
  candidates_passing_market_score: diag.candidatesPassingMarketScore, public_candidates: diag.publicApproved,
  published_count: diag.publicPublished, execution_rejected: diag.executionRejected,
  provider_requests: diag.providerRequests, provider_retries: diag.providerRetries, provider_errors: diag.providerErrors,
  status: 'COMPLETED', diagnostics: diag
};
await sbWrite('/rest/v1/sr_v626_runs', 'POST', [row], diag);
return [{ json: { runId: staticData.runId, summary: diag } }];
`), { notes: 'Every Selector run ends here, published or not. This is the single row an operator reads to see exactly what happened this run.' });

// ===========================================================================
// MODULE C · SETTLEMENT (:15 / :45 past every hour)
// ===========================================================================
const triggerSettlement = scheduleTrigger('Schedule Trigger: Settlement :15/:45', '15,45 * * * *', 'Settles finished fixtures and opportunistically captures the closing line for picks whose kickoff has just passed.');

const codeLoadOpenPicks = codeNode('Code: Load Open Picks', withLib(`
${SB}
async function run() {
  const r = await sbFetch("/rest/v1/sr_v626_picks?status=eq.OPEN&published=eq.true&order=kickoff.asc", { method: 'GET' });
  const rows = Array.isArray(r) ? r : [];
  return rows.map(p => ({ json: p }));
}
return run();
`));

const loopOpenPicks = splitInBatches('Loop Over Open Picks');

const codeSettlePick = codeNode('Code: Fetch Result + Settle', withLib(`
${SB}
${PROV}
const diag = { providerRequests: 0, providerRetries: 0, providerErrors: 0, dbWrites: 0, dbWriteFailures: 0 };
const p = $input.first().json;

async function fetchResult() {
  const r = await callProvider(\`/fixtures/\${p.fixture_id}\`, diag);
  if (!r.ok) return null;
  return r.response && r.response.data;
}
// Closing-line capture (for CLV) reuses the identical parseBet365Payload +
// lookupPrice pair used everywhere else. Left unpriced (fail-closed, clv_pp
// stays null) rather than guessed if the fixture has already kicked off and
// the provider no longer exposes a pre-match Bet365 price for this market.
async function captureClosingOddIfMissing() {
  if (p.closing_odd) return p.closing_odd;
  const r = await callProvider(\`/fixtures/\${p.fixture_id}?include=odds\`, diag);
  if (!r.ok || !r.response) return null;
  const freshBet365 = parseBet365Payload(r.response.data || r.response);
  const price = lookupPrice(freshBet365, { marketFamily: p.market_family, side: p.side, line: p.line, bookLine: p.line });
  return price.hasExactLine ? price.odd : null;
}

async function run() {
  const closingOdd = await captureClosingOddIfMissing();
  if (closingOdd !== null) {
    await sbWrite(\`/rest/v1/sr_v626_picks?pick_id=eq.\${p.pick_id}\`, 'PATCH', { closing_odd: closingOdd }, diag);
  }
  const fx = await fetchResult();
  if (!fx) return [{ json: { ...p, newlySettled: false } }];
  const status = String(fx.status || '');
  const isFinished = status === 'finished' || status === 'FT';
  const isVoidStatus = ['postponed', 'cancelled', 'abandoned', 'PST', 'CANC', 'ABD'].includes(status);
  if (!isFinished && !isVoidStatus) return [{ json: { ...p, newlySettled: false } }];

  const ftHome = fx.goals ? Number(fx.goals.home) : null;
  const ftAway = fx.goals ? Number(fx.goals.away) : null;

  let settlement;
  try {
    settlement = settleCandidate(
      { marketFamily: p.market_family, side: p.side, line: p.line, odd: p.entry_odd },
      { ftHome, ftAway, isVoid: isVoidStatus },
      CONFIG
    );
  } catch (e) {
    return [{ json: { ...p, newlySettled: false, settleError: e.message } }];
  }
  const profitEur = computeProfitEur(p.stake_eur, settlement.factor);
  const effectiveClosingOdd = closingOdd !== null ? closingOdd : p.closing_odd;
  const clvPp = effectiveClosingOdd ? impliedProbability(p.entry_odd) - impliedProbability(effectiveClosingOdd) : null;

  await sbWrite(\`/rest/v1/sr_v626_picks?pick_id=eq.\${p.pick_id}\`, 'PATCH', {
    status: settlement.status, result_score: \`\${ftHome}:\${ftAway}\`, profit_eur: profitEur, settled_at: new Date().toISOString(),
    closing_odd: effectiveClosingOdd ?? null, clv_pp: clvPp
  }, diag);

  const outcomeProb = settlement.status === 'VOID' ? null : (settlement.status === 'WIN' || settlement.status === 'HALF_WIN' ? 1 : (settlement.status === 'PUSH' ? null : 0));
  if (outcomeProb !== null && p.model_probability_calibrated !== null) {
    const brier = Math.pow(p.model_probability_calibrated - outcomeProb, 2);
    const clippedP = Math.min(0.999, Math.max(0.001, p.model_probability_calibrated));
    const logLoss = -(outcomeProb * Math.log(clippedP) + (1 - outcomeProb) * Math.log(1 - clippedP));
    await sbWrite('/rest/v1/sr_v626_calibration', 'POST', [{
      candidate_id: null, fixture_id: p.fixture_id, market_family: p.market_family, market_key: p.market_key,
      side: p.side, line: p.line, odd: p.entry_odd, predicted_probability: p.model_probability_calibrated,
      market_probability: p.market_probability, market_score: p.market_score, result: settlement.status,
      profit_eur: profitEur, brier_component: brier, log_loss_component: logLoss, clv_pp: clvPp, settled_at: new Date().toISOString()
    }], diag);
  }

  return [{ json: { ...p, newlySettled: true, settlementStatus: settlement.status, ftHome, ftAway, profitEur } }];
}
return run();
`), { notes: 'Fail-soft: a provider error or an unfinished fixture defers this pick to the next run without throwing. Asian quarter-line settlement (WIN/HALF_WIN/PUSH/HALF_LOSS/LOSS/VOID) is mathematically exact.' });

const ifNewlySettled = ifNode('IF: Newly Settled?', '={{ $json.newlySettled }}');

const codeReplyResult = codeNode('Code: Build Result Reply', withLib(`
const p = $input.first().json;
const text = formatResultReply(
  { homeTeam: p.home_team, awayTeam: p.away_team, marketFamily: p.market_family, side: p.side, line: p.line, entryOdd: p.entry_odd },
  { status: p.settlementStatus, profitEur: p.profitEur, ftHome: p.ftHome, ftAway: p.ftAway }
);
return [{ json: { ...p, text } }];
`));

const telegramReplyResult = node({
  name: 'Telegram: Reply Result', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
  parameters: {
    chatId: '={{ $env.SR626_TELEGRAM_CHAT_ID }}', text: '={{ $json.text }}',
    replyTo: '={{ $json.telegram_message_id }}',
    additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML', reply_to_message_id: '={{ $json.telegram_message_id }}' }
  },
  credentials: { telegramApi: { id: 'SR626_TELEGRAM_CREDENTIAL', name: 'Telegram account' } }
});
telegramReplyResult.onError = 'continueRegularOutput'; // a reply failure must never crash the settlement loop

// ===========================================================================
// MODULE D · DAILY REPORT (08:00)
// ===========================================================================
const triggerDailyReport = scheduleTrigger('Schedule Trigger: Daily Report 08:00', '0 8 * * *', 'Reports only on sr_v626_picks (official public Singles) -- the research-only market_candidates table never feeds this report.');

const codeDailyReport = codeNode('Code: Build Daily Report', withLib(`
${SB}
async function run() {
  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.timezone }).format(new Date());
  const rows = await sbFetch(\`/rest/v1/sr_v626_picks?published=eq.true&kickoff=gte.\${todayStr}&kickoff=lt.\${todayStr}T23:59:59&order=kickoff.asc\`, { method: 'GET' });
  const picks = Array.isArray(rows) ? rows : [];
  const settled = picks.filter(p => p.status && p.status !== 'OPEN');

  const wins = settled.filter(p => p.status === 'WIN' || p.status === 'HALF_WIN').length;
  const losses = settled.filter(p => p.status === 'LOSS' || p.status === 'HALF_LOSS').length;
  const plEur = settled.reduce((s, p) => s + (Number(p.profit_eur) || 0), 0);
  const staked = settled.length * CONFIG.stake.fixedStakeEur;
  const roiPct = staked > 0 ? (plEur / staked) * 100 : 0;

  const byFamily = {};
  for (const p of settled) byFamily[p.market_family] = (byFamily[p.market_family] || 0) + (Number(p.profit_eur) || 0);

  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const roll7 = await sbFetch(\`/rest/v1/sr_v626_picks?published=eq.true&settled_at=gte.\${since7}&select=profit_eur\`, { method: 'GET' });
  const roll7Rows = Array.isArray(roll7) ? roll7 : [];
  const roll7Pl = roll7Rows.reduce((s, r) => s + (Number(r.profit_eur) || 0), 0);
  const roll7Staked = roll7Rows.length * CONFIG.stake.fixedStakeEur;

  const roll30 = await sbFetch('/rest/v1/sr_v626_picks?published=eq.true&status=neq.OPEN&order=settled_at.desc&limit=30&select=profit_eur', { method: 'GET' });
  const roll30Rows = Array.isArray(roll30) ? roll30 : [];
  const roll30Pl = roll30Rows.reduce((s, r) => s + (Number(r.profit_eur) || 0), 0);
  const roll30Staked = roll30Rows.length * CONFIG.stake.fixedStakeEur;

  const text = formatDailyReport({
    dateLabel: todayStr, totalPicks: picks.length, wins, losses, plEur, roiPct, byFamily,
    rolling7d: { sampleN: roll7Rows.length, plEur: roll7Pl, roiPct: roll7Staked > 0 ? (roll7Pl / roll7Staked) * 100 : 0 },
    rolling30Settled: { sampleN: roll30Rows.length, plEur: roll30Pl, roiPct: roll30Staked > 0 ? (roll30Pl / roll30Staked) * 100 : 0 }
  });
  return [{ json: { text } }];
}
return run();
`));

const telegramDailyReport = telegramNode('Telegram: Daily Report', '={{ $json.text }}');

// ===========================================================================
// STICKY NOTES
// ===========================================================================
const stickyHeader = stickyNote('CONTROL NOTE',
  '## SOCCER RADAR v6.26 · QUALITY-FIRST MULTI-MARKET SELECTOR\\n\\n' +
  'v6.25.4 (UNIFIED_HISTORY_FIRST) is retired as the production prediction engine. ' +
  'This is a from-scratch architecture: FIXTURE -> ALL MARKETS -> MODEL -> BET365 -> CALIBRATION -> QUALITY GATE -> ' +
  'MARKET RANKING -> BEST MARKET -> EXECUTION RECHECK -> PUBLICATION. Max 1 public Single per fixture. 0 signals is a valid result.\\n\\n' +
  'No reciprocal logic. No shadow bets (only a research dataset of every evaluated candidate). Asian Handicap is scored but never public (PUBLIC_ENABLED=false).\\n\\n' +
  '**Required n8n environment variables** (Settings -> Variables, never hard-coded):\\n' +
  '- SUPABASE_URL, SUPABASE_SERVICE_KEY\\n' +
  '- SR626_PROVIDER_API_BASE, SR626_PROVIDER_API_KEY (5DollarFootballAPI PRO)\\n' +
  '- SR626_TELEGRAM_CHAT_ID\\n\\n' +
  '**Required credential**: a Telegram API credential named "Telegram account" (n8n Credentials, not hard-coded).\\n\\n' +
  'All thresholds live in lib/config.js CONFIG (bundled into every Code node) -- Scanner, Gate and Build all read the same numbers.',
  [40, 40], [900, 480]
);

const stickyModuleA = stickyNote('MODULE A · MARKET SCOUT', 'Collects real Bet365 prices only. No approximate price, no nearest-line fallback, no cross-market substitution. Writes sr_v626_market_snapshots.', [40, 560], [520, 200]);
const stickyModuleB = stickyNote('MODULE B · SELECTOR', 'Per fixture: builds the FixtureProfile, runs the Dixon-Coles goal model, scores all 49 markets, selects the best PUBLIC-enabled market, and applies the full quality gate + execution recheck before ever calling Telegram.', [600, 560], [560, 200]);
const stickyModuleC = stickyNote('MODULE C · SETTLEMENT', 'WIN/HALF_WIN/PUSH/HALF_LOSS/LOSS/VOID with settlement-aware Asian quarter-line splitting. Replies to the original Telegram post via its stored message_id.', [1200, 560], [480, 200]);
const stickyModuleD = stickyNote('MODULE D · DAILY REPORT', 'Reads only sr_v626_picks (official public Singles). Rolling 7d/30-settled metrics only render once the sample is large enough.', [1720, 560], [420, 200]);

module.exports = {
  triggerMarketScout, codeMarketScout,
  triggerSelector, codeLoadFixtures, loopFixtures, codeEvaluateFixture, codeFinalizeQueue, loopApproved,
  codeExecutionRecheck, ifExecutionApproved, codeInsertPick, telegramPublishPick, ifTelegramSuccessPublish,
  codeRegisterPublication, codeRegisterTelegramFailure, waitBetweenPicks, codeRecordExecutionRejected, codeFinalizeRun,
  triggerSettlement, codeLoadOpenPicks, loopOpenPicks, codeSettlePick, ifNewlySettled, codeReplyResult, telegramReplyResult,
  triggerDailyReport, codeDailyReport, telegramDailyReport,
  stickyHeader, stickyModuleA, stickyModuleB, stickyModuleC, stickyModuleD
};
