'use strict';
// Executes the heaviest Code nodes with mocked n8n globals + a fake Supabase/
// provider HTTP layer, to catch runtime (not just syntax) mistakes in the glue
// code before this ever touches a real n8n instance.
const fs = require('fs');
const path = require('path');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'out', 'SOCCER_RADAR_v6.26_QUALITY_FIRST_MULTI_MARKET_SELECTOR_FINAL.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function codeOf(name) {
  return wf.nodes.find(n => n.name === name).parameters.jsCode;
}

const ENV = {
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'fake-key',
  SR626_PROVIDER_API_BASE: 'https://fake.provider', SR626_PROVIDER_API_KEY: 'fake-provider-key',
  SR626_TELEGRAM_CHAT_ID: '-100123456'
};

function fakeHttpRequest(log) {
  return async (opts) => {
    log.push({ method: opts.method || 'GET', url: opts.url });
    if (opts.url.includes('/rest/v1/')) {
      if (opts.method === 'GET' || !opts.method) return [];
      return Array.isArray(opts.body) ? opts.body : [opts.body];
    }
    if (opts.url.includes('/fixtures')) {
      if (opts.returnFullResponse) {
        return { statusCode: 200, headers: {}, body: { data: [], pagination: { has_more: false } } };
      }
      return { data: [] };
    }
    if (opts.url.includes('/teams/')) {
      return { statusCode: 200, headers: {}, body: { data: [] } };
    }
    return { statusCode: 200, headers: {}, body: {} };
  };
}

// One shared static store simulates a single real workflow execution flowing
// through several nodes in sequence (matches how $getWorkflowStaticData works
// in n8n: shared across all nodes within one execution).
const staticStore = {};
const $getWorkflowStaticData = (scope) => { staticStore[scope] = staticStore[scope] || {}; return staticStore[scope]; };

async function run(name, extraJson) {
  const log = [];
  const thisCtx = { helpers: { httpRequest: fakeHttpRequest(log) } };
  const $input = { first: () => ({ json: extraJson || {} }), all: () => [{ json: extraJson || {} }] };
  const fn = new AsyncFunction('$input', '$env', '$getWorkflowStaticData', '$node', '$json', codeOf(name));
  const result = await fn.call(thisCtx, $input, ENV, $getWorkflowStaticData, {}, extraJson || {});
  console.log(`OK  ${name}  -> ${Array.isArray(result) ? result.length + ' item(s)' : typeof result}, ${log.length} http call(s)`);
  return result;
}

(async () => {
  try {
    await run('Code: Market Scout v6.26');
    await run('Code: Load Fixtures From Snapshots');
    await run('Code: Evaluate + Persist Fixture', {
      fixtureId: 1, kickoff: new Date(Date.now() + 3600000).toISOString(), leagueId: 1, leagueName: 'Test League', country: 'X',
      homeTeam: 'A', awayTeam: 'B',
      homeMatches: new Array(15).fill({ goalsFor: 1.8, goalsAgainst: 0.9 }),
      awayMatches: new Array(15).fill({ goalsFor: 1.3, goalsAgainst: 1.1 }),
      leagueContext: null, leagueReliabilityScore: 70,
      bet365: { btts: { yes: 1.9, no: 1.9 }, moneyline: { home: 1.9, draw: 3.5, away: 4.0 } },
      snapshotAt: new Date().toISOString(), nowMs: Date.now(), runId: 'test-run'
    });
    await run('Code: Finalize Candidate Queue');
    await run('Code: Execution Recheck', {
      fixtureId: 1, marketFamily: 'BTTS', side: 'YES', line: null, bet365Odd: 1.9, marketSnapshotAt: new Date().toISOString(),
      marketScore: 75, dataQualityScore: 90, historyScore: 85, calibratedEv: 0.05, calibratedEdgePp: 0.03,
      modelProbabilityValid: true, marketProbabilityValid: true, insufficientHistory: false, marketKey: 'BTTS_YES', runId: 'test-run'
    });
    await run('Code: Build Pick + Insert', {
      fixtureId: 1, kickoff: new Date().toISOString(), leagueId: 1, leagueName: 'L', country: 'X', homeTeam: 'A', awayTeam: 'B',
      marketFamily: 'BTTS', side: 'YES', line: null, currentOdd: 1.9, marketScore: 75, modelProbabilityCalibrated: 0.55,
      devigMarketProbability: 0.52, calibratedEv: 0.05, calibratedEdgePp: 0.03, historyScore: 85, dataQualityScore: 90, marketKey: 'BTTS_YES'
    });
    await run('Code: Register Publication', { pickId: 'p1', fixtureId: 1, marketKey: 'BTTS_YES', text: 'x', message_id: 555 });
    await run('Code: Record Telegram Failure', { pickId: 'p1' });
    await run('Code: Record Execution Rejected', { executionReason: 'MARKET_SCORE_TOO_LOW' });
    await run('Code: Save Run Diagnostics');
    await run('Code: Load Open Picks');
    await run('Code: Fetch Result + Settle', {
      fixture_id: 1, pick_id: 'p1', market_family: 'BTTS', side: 'YES', line: null, entry_odd: 1.9, stake_eur: 100,
      model_probability_calibrated: 0.55, market_probability: 0.52, market_score: 75, closing_odd: null
    });
    await run('Code: Build Result Reply', {
      home_team: 'A', away_team: 'B', market_family: 'BTTS', side: 'YES', line: null, entry_odd: 1.9,
      settlementStatus: 'WIN', profitEur: 95, ftHome: 2, ftAway: 1, telegram_message_id: 555
    });
    await run('Code: Build Daily Report');
    console.log('\nAll smoke tests completed without runtime errors.');
  } catch (e) {
    console.error('SMOKE TEST FAILURE:', e.stack);
    process.exit(1);
  }
})();
