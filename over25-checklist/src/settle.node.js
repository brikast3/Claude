// 31 · Settle Open Picks — flat 1u stake, Over 2.5 wins on 3+ goals.
const ENV = {};
for (const k of CL_ENV_KEYS) { try { ENV[k] = $env[k]; } catch (e) { /* env access blocked */ } }
const cfg = getCfg(ENV);
if (!cfg.apiKey) throw new Error('OVER25_CHECKLIST: задай SR626_PROVIDER_API_KEY като environment variable в n8n.');

const st = initState($getWorkflowStaticData('global'));
const t0 = Date.now();
const client = createProvider({
  httpRequest: o => this.helpers.httpRequest(o),
  base: cfg.apiBase, key: cfg.apiKey, paceMs: cfg.paceMs, retryDelaysMs: cfg.retryDelaysMs,
});
const FINAL = ['FINISHED', 'FT', 'AET', 'AFTER_EXTRA_TIME', 'FULL_TIME'];
const VOIDED = ['POSTPONED', 'CANCELLED', 'CANCELED', 'ABANDONED'];
const out = [];
const notes = [];

for (const [fid, p] of Object.entries(st.open)) {
  const ko = Date.parse(p.kickoff);
  if (!Number.isFinite(ko) || t0 < ko + cfg.settleAfterMin * 60000) continue;
  if (Date.now() - t0 > cfg.timeBudgetMs) { notes.push({ fixture_id: fid, note: 'DEFERRED_TIME_BUDGET' }); continue; }

  const body = await client.get(`/fixtures/${fid}`);
  if (body == null) { notes.push({ fixture_id: fid, note: 'PROVIDER_ERROR' }); continue; }
  const f = clData(body) || {};
  const status = String(typeof f.status === 'string' ? f.status : (f.status && (f.status.short || f.status.name)) || '').trim().toUpperCase();
  const base = { fixture_id: p.fixture_id, home_team: p.home_team, away_team: p.away_team, kickoff: p.kickoff, odd: p.odd,
    model_prob: p.model_prob, score: p.score, settled_at: new Date().toISOString() };
  let entry = null, reply = null;

  if (VOIDED.includes(status)) {
    entry = { ...base, status: 'VOID', pnl: 0, score_text: status };
    reply = buildReply({ status: 'VOID', pnl: 0 });
  } else if (FINAL.includes(status)) {
    const h = clNum(f.goals && f.goals.home), a = clNum(f.goals && f.goals.away);
    if (!clFin(h) || !clFin(a)) { notes.push({ fixture_id: fid, note: 'FINAL_WITHOUT_SCORE' }); continue; }
    const r = settleOver(p.line, h, a, p.odd);
    entry = { ...base, status: r.status, pnl: r.pnl, score_text: `${h}:${a}` };
    reply = buildReply(r, h, a);
  } else if (t0 > ko + 72 * 3600000) {
    entry = { ...base, status: 'UNSETTLED', pnl: 0, score_text: status || '—' };
  } else { notes.push({ fixture_id: fid, note: 'NOT_FINAL', provider_status: status || null }); continue; }

  st.history.push(entry);
  delete st.open[fid];
  if (reply) out.push({ json: { reply: true, chat_id: p.chat_id, telegram_message_id: p.telegram_message_id, reply_text: reply, fixture_id: p.fixture_id } });
  else notes.push({ fixture_id: fid, note: 'UNSETTLED_AFTER_72H' });
}

return [{ json: { diagnostic: true, reply: false, open_picks: Object.keys(st.open).length, settled_now: out.length, notes } }, ...out];
