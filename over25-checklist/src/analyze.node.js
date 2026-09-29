// 01 · Discover + Checklist — finds fixtures at T-20..T-50, scores the 10-point checklist, emits qualified picks.
const ENV = {};
for (const k of CL_ENV_KEYS) { try { ENV[k] = $env[k]; } catch (e) { /* env access blocked */ } }
const cfg = getCfg(ENV);
if (!cfg.apiKey) throw new Error('OVER25_CHECKLIST: задай SR626_PROVIDER_API_KEY като environment variable в n8n (същият като в Fusion Engine).');

const sd = $getWorkflowStaticData('global');
const st = initState(sd);
const t0 = Date.now();
pruneState(st, t0);

const client = createProvider({
  httpRequest: o => this.helpers.httpRequest(o),
  base: cfg.apiBase, key: cfg.apiKey, paceMs: cfg.paceMs, retryDelaysMs: cfg.retryDelaysMs,
});

const disc = await discoverFixtures(client, cfg, t0);
const results = [];
const picks = [];
let deferred = 0;

for (const fx of disc.fixtures) {
  const prev = st.seen[fx.fixture_id];
  if (!needsAnalysis(prev, cfg)) continue;
  if (Date.now() - t0 > cfg.timeBudgetMs) { deferred++; continue; }
  const r = await analyzeFixture(client, cfg, fx, new Date().toISOString());
  st.seen[fx.fixture_id] = {
    ts: Date.now(), attempts: ((prev && prev.attempts) || 0) + 1,
    retryable: r.retryable, decision: r.decision, reason: r.reason, score: r.score == null ? null : r.score,
  };
  results.push({
    fixture_id: fx.fixture_id, match: `${fx.home_team} — ${fx.away_team}`, league: fx.league,
    minutes_to_kickoff: fx.minutes_to_kickoff, decision: r.decision, reason: r.reason,
    score: r.score == null ? null : `${r.score}/${r.evaluated} (нужни ${r.required})`, odd: r.odd == null ? null : r.odd,
  });
  if (r.decision === 'PICK') picks.push(r.pick);
}

return [
  { json: {
    diagnostic: true, publish: false, engine: CL_VERSION, live: cfg.publish,
    window_min: [cfg.minMinutes, cfg.maxMinutes], fixtures_in_window: disc.fixtures.length, fixtures_fetched: disc.fetched,
    discovery_error: disc.error, analyzed: results.length, deferred_by_time_budget: deferred,
    provider_calls: client.stats.calls, provider_failures: client.stats.failures, picks: picks.length, results,
  } },
  ...picks.map(p => ({ json: { publish: cfg.publish, chat_id: cfg.chatId, pick: p } })),
];
