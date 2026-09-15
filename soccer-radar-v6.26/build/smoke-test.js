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

// PostgREST bulk-insert requires every row in a POSTed array to have the exact
// same key set (one INSERT, one column list). JSON.stringify silently drops
// any key whose value is `undefined`, so a field built with `a && a.b` (which
// evaluates to `undefined`, not `null`, when `a` is missing) can desync one
// row's keys from the rest and blow up in production with a cryptic "All
// object keys must match" -- exactly what happened with real provider data.
// Catch that class of bug here by checking every multi-row POST body.
function assertBulkInsertKeysMatch(url, body) {
  if (!Array.isArray(body) || body.length < 2) return;
  const first = Object.keys(body[0]).sort().join(',');
  for (let i = 1; i < body.length; i++) {
    const keys = Object.keys(body[i]).sort().join(',');
    if (keys !== first) {
      throw new Error(`Bulk insert key mismatch for ${url}: row 0 has [${first}] but row ${i} has [${keys}]`);
    }
  }
}

function fakeHttpRequest(log) {
  return async (opts) => {
    log.push({ method: opts.method || 'GET', url: opts.url });
    if (opts.url.includes('/rest/v1/')) {
      const isGet = opts.method === 'GET' || !opts.method;
      const body = isGet ? [] : (Array.isArray(opts.body) ? opts.body : [opts.body]);
      if (!isGet) assertBulkInsertKeysMatch(opts.url, JSON.parse(JSON.stringify(opts.body)));
      return { statusCode: 200, headers: {}, body };
    }
    if (opts.url.includes('/odds?bookmakers=bet365')) {
      // realistic shape: GET /fixtures/{id}/odds?bookmakers=bet365 -> { data: { bookmakers: [...] } }
      // Fixture 2 deliberately has an incomplete book (no btts, no moneyline) --
      // exactly the real-world case that broke the bulk insert.
      const isFixture2 = opts.url.includes('/fixtures/2/');
      const odds = isFixture2
        ? { goal_line: { closing: { line: 2.5, over: 1.9, under: 1.9 } } }
        : {
            '1x2': { closing: { home: 1.85, draw: 3.6, away: 4.2 } },
            btts: { closing: { yes: 1.9, no: 1.9 } },
            goal_line: { closing: { line: 2.5, over: 1.9, under: 1.9 } }
          };
      return { statusCode: 200, headers: {}, body: { data: { bookmakers: [{ slug: 'bet365', name: 'Bet365', odds }] } } };
    }
    if (opts.url.includes('/fixtures') && opts.url.includes('status=scheduled')) {
      return {
        statusCode: 200, headers: {}, body: {
          data: [
            {
              id: 1, kickoff_utc: new Date(Date.now() + 3 * 3600000).toISOString(),
              league: { id: 1, name: 'Test League', country: 'Testland' },
              teams: { home: { id: 10, name: 'Home FC' }, away: { id: 20, name: 'Away FC' } }
            },
            {
              id: 2, kickoff_utc: new Date(Date.now() + 4 * 3600000).toISOString(),
              league: { id: 1, name: 'Test League', country: 'Testland' },
              teams: { home: { id: 30, name: 'Home FC 2' }, away: { id: 40, name: 'Away FC 2' } }
            }
          ],
          pagination: { has_more: false }
        }
      };
    }
    if (opts.url.includes('/fixtures/')) {
      return { statusCode: 200, headers: {}, body: { data: { id: 1, status: 'finished', goals: { home: 2, away: 1 } } } };
    }
    if (opts.url.includes('/teams/')) {
      return {
        statusCode: 200, headers: {}, body: {
          data: [{ teams: { home: { id: 10 }, away: { id: 20 } }, goals: { home: 2, away: 1 } }]
        }
      };
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
