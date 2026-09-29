// End-to-end simulation: runs the Code nodes that are actually inside the generated workflow JSON
// against a mock 5dollar API, with in-memory static data standing in for n8n.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

execFileSync('node', [path.join(__dirname, '..', 'build_workflow.js')], { stdio: 'ignore' });
const wf = require('../OVER25_CHECKLIST_AUTOMATION_v1.0.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const codeOf = name => wf.nodes.find(n => n.name === name).parameters.jsCode;

const MIN = 60000;
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const hist = (teamId, venue, goals) => ({ data: goals.map(([h, a], i) => ({
  id: 9000 + teamId * 100 + i, status: 'finished', kickoff_ts: 1700000000 - i * 1000,
  teams: venue === 'home' ? { home: { id: teamId }, away: { id: 999 } } : { home: { id: 999 }, away: { id: teamId } },
  goals: { home: h, away: a } })) });
const HI = Array.from({ length: 10 }, (_, i) => [[2, 1], [3, 1], [2, 2], [1, 2], [3, 0]][i % 5]); // ~3.4 goals, over 5/5
const LO = Array.from({ length: 10 }, (_, i) => [[1, 0], [0, 0], [1, 1], [0, 1], [2, 0]][i % 5]);
const odds = (line, over, under) => ({ data: { bookmakers: [{ slug: 'bet365', odds: { goal_line: { closing: { line, over, under } } } }] } });

function makeApi() {
  const calls = [];
  const fixtures = [
    { id: 1, kickoff_utc: iso(now + 30 * MIN), status: 'scheduled', home: { id: 101, name: 'Alpha' }, away: { id: 102, name: 'Beta' }, league: { name: 'Liga', country: 'X' } },
    { id: 2, kickoff_utc: iso(now + 31 * MIN), status: 'scheduled', home: { id: 201, name: 'Gamma' }, away: { id: 202, name: 'Delta' }, league: { name: 'Liga', country: 'X' } },
    { id: 3, kickoff_utc: iso(now + 32 * MIN), status: 'scheduled', home: { id: 301, name: 'Eps' }, away: { id: 302, name: 'Zeta' }, league: { name: 'Liga', country: 'X' } },
    { id: 4, kickoff_utc: iso(now + 33 * MIN), status: 'scheduled', home: { id: 401, name: 'Eta' }, away: { id: 402, name: 'Theta' }, league: { name: 'Liga', country: 'X' } },
  ];
  const oddsBy = { 1: odds(2.5, 1.78, 2.05), 2: odds(2.75, 1.9, 1.95), 3: odds(2.5, 1.85, 2.0), 4: odds(2.5, 1.8, 2.0) };
  const histBy = { 101: hist(101, 'home', HI), 102: hist(102, 'away', HI), 301: hist(301, 'home', LO), 302: hist(302, 'away', LO), 401: hist(401, 'home', HI.slice(0, 3)), 402: hist(402, 'away', HI.slice(0, 3)) };
  let fixtureDetail = { data: { id: 1, status: 'finished', goals: { home: 2, away: 1 } } };
  const httpRequest = async o => {
    calls.push(o.url);
    const u = new URL(o.url), p = u.pathname.replace('/v1', '');
    const ok = body => ({ statusCode: 200, body });
    if (o.headers['x-api-key'] !== 'TEST_KEY') return { statusCode: 401, body: null };
    if (p === '/fixtures') return ok({ data: fixtures, pagination: { has_more: false } });
    let m;
    if ((m = p.match(/^\/fixtures\/(\d+)\/odds$/))) return ok(oddsBy[m[1]]);
    if ((m = p.match(/^\/teams\/(\d+)\/fixtures$/))) return ok(histBy[m[1]]);
    if ((m = p.match(/^\/fixtures\/(\d+)$/))) return ok(fixtureDetail);
    return { statusCode: 404, body: null };
  };
  return { httpRequest, calls, setDetail: d => { fixtureDetail = d; } };
}

async function run(name, { env = {}, sd, input = [], api, prior = {} }) {
  const fn = new AsyncFunction('$env', '$getWorkflowStaticData', '$input', '$', codeOf(name));
  const $ = nodeName => ({ all: () => prior[nodeName] || [], first: () => (prior[nodeName] || [])[0] });
  return fn.call({ helpers: { httpRequest: api.httpRequest } }, { SR626_PROVIDER_API_KEY: 'TEST_KEY', SR_CL_PACE_MS: '0', ...env },
    () => sd, { all: () => input }, $);
}

test('discovery -> checklist -> message -> save -> settle -> daily report', async () => {
  const api = makeApi(), sd = {};

  // 1) analyse: fixture 1 passes, 2 has a 2.75 main line, 3 is low-scoring, 4 has too little history
  const r1 = await run('01 · Discover + Checklist', { env: { SR_CL_PUBLISH: 'true' }, sd, api });
  const summary = r1[0].json, picks = r1.slice(1);
  assert.equal(summary.analyzed, 4);
  const by = Object.fromEntries(summary.results.map(x => [x.fixture_id, x.reason]));
  assert.deepEqual(by, { 1: 'PASSED', 2: 'MAIN_LINE_NOT_2_5', 3: 'CHECKLIST_SCORE_TOO_LOW', 4: 'INSUFFICIENT_HISTORY' });
  assert.equal(picks.length, 1); assert.equal(picks[0].json.publish, true); assert.equal(picks[0].json.pick.fixture_id, 1);
  assert.equal(picks[0].json.pick.score, 7);
  assert.equal(summary.publish, false, 'summary item must never reach Telegram');
  // odds-first: fixture 2 (line 2.75) cost exactly one call, no history requests
  assert.ok(!api.calls.some(u => /teams\/201|teams\/202/.test(u)));

  // 2) second run: only the retryable fixture (2) is re-checked; nothing re-published
  const before = api.calls.length;
  const r2 = await run('01 · Discover + Checklist', { env: { SR_CL_PUBLISH: 'true' }, sd, api });
  assert.equal(r2.length, 1); assert.equal(r2[0].json.analyzed, 1);
  assert.equal(api.calls.length - before, 1 + 1, 'one discovery + one odds call');
  const r4 = await run('01 · Discover + Checklist', { env: { SR_CL_PUBLISH: 'true' }, sd, api });
  const r5 = await run('01 · Discover + Checklist', { env: { SR_CL_PUBLISH: 'true' }, sd, api });
  assert.equal(r5[0].json.analyzed, 0, 'attempts exhausted -> fixture 2 no longer polled');

  // 3) message + save
  const msg = await run('03 · Build Telegram Message', { env: { SR_CL_PUBLISH: 'true' }, sd, api, input: picks });
  assert.ok(msg[0].json.text.includes('Alpha — Beta') && msg[0].json.text.includes('1.78'));
  const saved = await run('05 · Save Open Pick', { sd, api, input: [{ json: { message_id: 777 } }], prior: { '03 · Build Telegram Message': msg } });
  assert.equal(saved[0].json.telegram_message_id, 777);
  assert.equal(sd.cl.open[1].telegram_message_id, 777);

  // 4) settlement: not before kickoff + 115 min, then WON 2:1 replies to message 777
  const notYet = await run('31 · Settle Open Picks', { sd, api });
  assert.equal(notYet.length, 1); assert.equal(notYet[0].json.open_picks, 1);
  sd.cl.open[1].kickoff = iso(now - 24 * 3600000 + 30 * MIN); // yesterday
  const settled = await run('31 · Settle Open Picks', { sd, api });
  const reply = settled[1].json;
  assert.equal(reply.reply, true); assert.equal(reply.telegram_message_id, 777);
  assert.match(reply.reply_text, /WON · 2:1 · \+0\.78u/);
  assert.equal(Object.keys(sd.cl.open).length, 0); assert.equal(sd.cl.history.length, 1);

  // 5) daily report for the previous local day
  const rep = await run('41 · Build Daily Report', { sd, api });
  assert.ok(rep[0].json.report_text.includes('Alpha — Beta') && rep[0].json.report_text.includes('+0.78u'));
});

test('dry-run default: qualified picks are analysed but flagged publish=false', async () => {
  const api = makeApi(), sd = {};
  const r = await run('01 · Discover + Checklist', { sd, api });
  assert.equal(r[0].json.picks, 1); assert.equal(r[1].json.publish, false);
});

test('missing API key fails loudly instead of silently doing nothing', async () => {
  const api = makeApi();
  await assert.rejects(run('01 · Discover + Checklist', { env: { SR626_PROVIDER_API_KEY: '' }, sd: {}, api }), /SR626_PROVIDER_API_KEY/);
});

test('void and unfinished fixtures are handled at settlement', async () => {
  const api = makeApi(), sd = { cl: { seen: {}, history: [], open: {
    7: { fixture_id: 7, home_team: 'A', away_team: 'B', kickoff: iso(now - 5 * 3600000), line: 2.5, odd: 1.8, telegram_message_id: 5, chat_id: '1' } } } };
  api.setDetail({ data: { id: 7, status: 'live', goals: { home: 1, away: 0 } } });
  const live = await run('31 · Settle Open Picks', { sd, api });
  assert.equal(live[0].json.notes[0].note, 'NOT_FINAL'); assert.equal(Object.keys(sd.cl.open).length, 1);
  api.setDetail({ data: { id: 7, status: 'postponed' } });
  const v = await run('31 · Settle Open Picks', { sd, api });
  assert.match(v[1].json.reply_text, /VOID/); assert.equal(sd.cl.history[0].pnl, 0);
});

test('generated workflow: every connection points at an existing node; telegram nodes use the shared credential', () => {
  const names = new Set(wf.nodes.map(n => n.name));
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from);
    for (const branch of c.main) for (const t of branch) assert.ok(names.has(t.node), t.node);
  }
  const tg = wf.nodes.filter(n => n.type.endsWith('telegram'));
  assert.equal(tg.length, 3);
  for (const n of tg) assert.equal(n.credentials.telegramApi.id, 'HRAZxfaNbMK1280u');
  assert.equal(new Set(wf.nodes.map(n => n.id)).size, wf.nodes.length);
});

test('generated workflow contains no secrets', () => {
  const s = JSON.stringify(wf);
  assert.ok(!/fb_live_|sb_secret_|7994b4c0/.test(s));
});
