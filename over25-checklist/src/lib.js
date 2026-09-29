// OVER 2.5 · 10-POINT CHECKLIST — shared pure logic.
// This file is inlined into every n8n Code node by build_workflow.js and is
// also unit-tested directly (tests/lib.test.js). No require(), no n8n globals.

const CL_VERSION = 'OVER25_CHECKLIST_V1_0';

// Env vars the workflow reads. `$env` is a proxy in n8n, so keys are read one by one.
const CL_ENV_KEYS = [
  'SR626_PROVIDER_API_BASE', 'SR626_PROVIDER_API_KEY',
  'SR_CL_PUBLISH', 'SR_CL_TELEGRAM_CHAT_ID',
  'SR_CL_MIN_MINUTES', 'SR_CL_MAX_MINUTES', 'SR_CL_SAMPLE', 'SR_CL_MIN_SAMPLE',
  'SR_CL_OVER_RATE', 'SR_CL_TOTAL', 'SR_CL_HOME_GF', 'SR_CL_AWAY_GF', 'SR_CL_MIN_GA', 'SR_CL_BTTS_RATE',
  'SR_CL_VALUE_MARGIN', 'SR_CL_MIN_SCORE', 'SR_CL_REQUIRE_VALUE', 'SR_CL_MIN_ODDS', 'SR_CL_MAX_ODDS',
  'SR_CL_PACE_MS', 'SR_CL_TIME_BUDGET_MS', 'SR_CL_MAX_ATTEMPTS', 'SR_CL_SETTLE_AFTER_MIN', 'SR_CL_TZ',
];

function getCfg(env) {
  const e = env || {};
  const raw = k => (e[k] === undefined || e[k] === null || String(e[k]).trim() === '' ? undefined : String(e[k]).trim());
  const n = (k, d) => { const v = raw(k); if (v === undefined) return d; const x = Number(v); return Number.isFinite(x) ? x : d; };
  const b = (k, d) => { const v = raw(k); return v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()); };
  const s = (k, d) => { const v = raw(k); return v === undefined ? d : v; };
  return {
    apiBase: s('SR626_PROVIDER_API_BASE', 'https://api.5dollarfootballapi.com/v1').replace(/\/$/, ''),
    apiKey: s('SR626_PROVIDER_API_KEY', ''),
    // Safe default: analyse and log only. Nothing is sent to Telegram until SR_CL_PUBLISH=true.
    publish: b('SR_CL_PUBLISH', false),
    chatId: s('SR_CL_TELEGRAM_CHAT_ID', '-1003038027412'),
    minMinutes: n('SR_CL_MIN_MINUTES', 20),
    maxMinutes: n('SR_CL_MAX_MINUTES', 50),
    sample: n('SR_CL_SAMPLE', 10),
    minSample: n('SR_CL_MIN_SAMPLE', 6),
    // Thresholds straight from the 10-point checklist.
    overRate: n('SR_CL_OVER_RATE', 0.55),
    totalGoals: n('SR_CL_TOTAL', 2.70),
    homeGF: n('SR_CL_HOME_GF', 1.50),
    awayGF: n('SR_CL_AWAY_GF', 1.20),
    minGA: n('SR_CL_MIN_GA', 1.00),
    bttsRate: n('SR_CL_BTTS_RATE', 0.55),
    // Criterion 10: book odds must beat the model's fair odds by at least this margin
    // (checklist example: fair 1.67 -> book must give 1.75+, i.e. ~+5%).
    valueMargin: n('SR_CL_VALUE_MARGIN', 0.05),
    minScore: s('SR_CL_MIN_SCORE', 'auto'),
    requireValue: b('SR_CL_REQUIRE_VALUE', true),
    minOdds: n('SR_CL_MIN_ODDS', 1.40),
    maxOdds: n('SR_CL_MAX_ODDS', 3.00),
    paceMs: n('SR_CL_PACE_MS', 7500),
    retryDelaysMs: [8000, 12000],
    timeBudgetMs: n('SR_CL_TIME_BUDGET_MS', 200000),
    maxAttempts: n('SR_CL_MAX_ATTEMPTS', 3),
    settleAfterMin: n('SR_CL_SETTLE_AFTER_MIN', 115),
    tz: s('SR_CL_TZ', 'Europe/Sofia'),
    line: 2.5,
  };
}

// ---------- small helpers ----------
const clNum = x => (x === null || x === undefined || x === '' ? null : Number(x));
const clFin = x => Number.isFinite(clNum(x));
const clClamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clMean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const clSleep = ms => new Promise(r => setTimeout(r, ms));
const clData = x => (x && x.data !== undefined ? x.data : x);
const clEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clPct = (v, d = 0) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');
const clDec = (v, d = 2) => (Number.isFinite(v) ? Number(v).toFixed(d) : '—');

// ---------- provider client (retries + pacing, mirrors the existing engine) ----------
function createProvider({ httpRequest, base, key, paceMs = 7500, retryDelaysMs = [8000, 12000], sleep = clSleep }) {
  const stats = { calls: 0, failures: 0 };
  async function get(path) {
    for (let a = 0; a <= retryDelaysMs.length; a++) {
      let sc = 0, body = null;
      try {
        const r = await httpRequest({
          method: 'GET', url: base.replace(/\/$/, '') + path,
          headers: { 'x-api-key': key, accept: 'application/json' },
          json: true, timeout: 20000, returnFullResponse: true, ignoreHttpStatusErrors: true,
        });
        stats.calls++;
        sc = Number((r && r.statusCode) || 0);
        body = r ? r.body : null;
      } catch (err) { sc = 0; }
      if (paceMs > 0) await sleep(paceMs);
      if (sc >= 200 && sc < 300) return body;
      if (![0, 408, 429, 500, 502, 503, 504].includes(sc)) break;
      if (a < retryDelaysMs.length && retryDelaysMs[a] > 0) await sleep(retryDelaysMs[a]);
    }
    stats.failures++;
    return null;
  }
  return { get, stats };
}

// ---------- fixture discovery ----------
const CL_SCHEDULED = ['NS', 'SCHEDULED', 'NOT_STARTED', 'NOT STARTED', 'TIMED', 'UPCOMING', ''];

function normalizeFixture(f, now) {
  const id = Number(f && (f.id ?? f.fixture_id ?? (f.fixture && f.fixture.id)));
  const ko = (f && f.kickoff_utc) || (f && f.kickoff_ts != null && Number.isFinite(Number(f.kickoff_ts)) ? new Date(Number(f.kickoff_ts) * 1000).toISOString() : null);
  const ms = Date.parse(ko || '');
  const st = String((typeof (f && f.status) === 'string' ? f.status : (f && f.status && (f.status.short || f.status.name))) || '').toUpperCase();
  const tid = side => Number((f && f[side] && f[side].id) ?? (f && f.teams && f.teams[side] && f.teams[side].id) ?? 0) || null;
  const tname = side => (f && f[side] && f[side].name) ?? (f && f.teams && f.teams[side] && f.teams[side].name) ?? (f && f[side + '_team']) ?? null;
  return {
    fixture_id: Number.isFinite(id) && id > 0 ? id : null,
    kickoff: ko, kickoff_ms: Number.isFinite(ms) ? ms : null,
    minutes_to_kickoff: Number.isFinite(ms) ? +((ms - now) / 60000).toFixed(2) : null,
    home_team_id: tid('home'), away_team_id: tid('away'),
    home_team: tname('home'), away_team: tname('away'),
    league: (f && f.league && f.league.name) ?? (f && f.competition && f.competition.name) ?? (f && f.league_name) ?? null,
    country: (f && f.league && f.league.country) ?? (f && f.country && f.country.name) ?? (typeof (f && f.country) === 'string' ? f.country : null),
    provider_status: st || null,
  };
}

async function discoverFixtures(client, cfg, now) {
  const start = Math.floor((now + cfg.minMinutes * 60000) / 1000);
  const end = Math.floor((now + cfg.maxMinutes * 60000) / 1000);
  const all = [], seen = new Set();
  let page = 1, hasMore = true, error = null, pages = 0;
  while (hasMore && page <= 10) {
    const body = await client.get(`/fixtures?status=scheduled&start_time=${start}&end_time=${end}&page=${page}&per_page=100`);
    if (body == null) { error = 'DISCOVERY_REQUEST_FAILED'; break; }
    pages++;
    const rows = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : Array.isArray(body.response) ? body.response : Array.isArray(body.fixtures) ? body.fixtures : [];
    for (const f of rows) {
      const nf = normalizeFixture(f, now);
      if (!nf.fixture_id || seen.has(nf.fixture_id)) continue;
      seen.add(nf.fixture_id);
      all.push(nf);
    }
    hasMore = Boolean(body && body.pagination && body.pagination.has_more);
    page++;
  }
  const fixtures = all
    .filter(f => f.kickoff_ms != null && CL_SCHEDULED.includes(f.provider_status || '')
      && f.minutes_to_kickoff >= cfg.minMinutes - 0.5 && f.minutes_to_kickoff <= cfg.maxMinutes)
    .sort((a, b) => a.kickoff_ms - b.kickoff_ms);
  return { fixtures, fetched: all.length, pages, error };
}

// ---------- odds ----------
function extractGoalLine(oddsBody) {
  const bms = (clData(oddsBody) && clData(oddsBody).bookmakers) || [];
  const bm = bms.find(x => String(x.slug || '').toLowerCase() === 'bet365') || bms[0];
  const gl = bm && bm.odds && bm.odds.goal_line;
  if (!gl) return null;
  const cur = gl.closing || gl.current || {};
  const open = gl.opening || {};
  if (!clFin(cur.line) || !clFin(cur.over)) return null;
  return {
    bookmaker: bm.slug || bm.name || null,
    line: Number(cur.line), over: Number(cur.over),
    under: clFin(cur.under) ? Number(cur.under) : null,
    opening_over: clFin(open.over) ? Number(open.over) : null,
  };
}

// ---------- history ----------
function finishedRows(body, currentId) {
  const arr = clData(body);
  return (Array.isArray(arr) ? arr : []).filter(x => Number(x && x.id) !== Number(currentId)
    && String((x && x.status) || '').toLowerCase() === 'finished'
    && clFin(x && x.goals && x.goals.home) && clFin(x && x.goals && x.goals.away));
}

function venueRows(body, teamId, venue, currentId, limit) {
  return finishedRows(body, currentId)
    .filter(x => Number(x.teams && x.teams[venue] && x.teams[venue].id) === Number(teamId))
    .sort((a, b) => Number(b.kickoff_ts || 0) - Number(a.kickoff_ts || 0))
    .slice(0, limit);
}

// Home rows: goals.home = scored, goals.away = conceded. Away rows: the reverse.
function computeStats(homeRows, awayRows) {
  const gh = r => Number(r.goals.home), ga = r => Number(r.goals.away);
  const rate = (rows, fn) => (rows.length ? rows.filter(fn).length / rows.length : null);
  const total = r => gh(r) + ga(r);
  const btts = r => gh(r) > 0 && ga(r) > 0;
  const over = r => total(r) >= 3;
  return {
    n_home: homeRows.length, n_away: awayRows.length,
    over_rate_home: rate(homeRows, over), over_rate_away: rate(awayRows, over),
    avg_total_home: clMean(homeRows.map(total)), avg_total_away: clMean(awayRows.map(total)),
    avg_total: (homeRows.length && awayRows.length) ? (clMean(homeRows.map(total)) + clMean(awayRows.map(total))) / 2 : null,
    home_gf: clMean(homeRows.map(gh)), home_ga: clMean(homeRows.map(ga)),
    away_gf: clMean(awayRows.map(ga)), away_ga: clMean(awayRows.map(gh)),
    btts_rate_home: rate(homeRows, btts), btts_rate_away: rate(awayRows, btts),
  };
}

// ---------- model: time-weighted Poisson + Dixon-Coles low-score correction ----------
const CL_W = [1, .92, .84, .76, .68, .60, .54, .48, .43, .38, .34, .30, .27, .24, .21];
function weightedAvg(rows, fn) {
  let s = 0, z = 0;
  rows.slice(0, 15).forEach((r, i) => { const v = fn(r); if (Number.isFinite(v)) { s += v * (CL_W[i] || .2); z += (CL_W[i] || .2); } });
  return z ? s / z : null;
}
const clPois = (l, k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * Math.pow(l, k) / f; };

function poissonGrid(lh, la) {
  const g = []; let z = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    let p = clPois(lh, h) * clPois(la, a);
    if (h === 0 && a === 0) p *= 1 - .08 * lh * la;
    else if (h === 0 && a === 1) p *= 1 + .08 * lh;
    else if (h === 1 && a === 0) p *= 1 + .08 * la;
    else if (h === 1 && a === 1) p *= 1 - .08;
    p = Math.max(0, p); g.push({ h, a, p }); z += p;
  }
  return g.map(x => ({ ...x, p: x.p / z }));
}

function modelOver(homeRows, awayRows, line = 2.5) {
  const hGF = weightedAvg(homeRows, r => Number(r.goals.home)), hGA = weightedAvg(homeRows, r => Number(r.goals.away));
  const aGF = weightedAvg(awayRows, r => Number(r.goals.away)), aGA = weightedAvg(awayRows, r => Number(r.goals.home));
  const lh = clClamp((hGF + aGA) / 2, .15, 4.5), la = clClamp((aGF + hGA) / 2, .15, 4.5);
  const g = poissonGrid(lh, la);
  const p = g.filter(x => x.h + x.a > line).reduce((s, x) => s + x.p, 0);
  return { lambda_home: lh, lambda_away: la, p_over: p, fair_odd: p > 0 ? 1 / p : null };
}

function devigTwoWay(over, under) {
  if (!(over > 1) || !(under > 1)) return null;
  const a = 1 / over, b = 1 / under;
  return a / (a + b);
}

// ---------- the 10-point checklist ----------
const CL_LABELS = {
  1: 'Проходимост ТБ 2.5', 2: 'Среден тотал голове', 3: 'Очаквани голове (xG)', 4: 'Атака на домакина',
  5: 'Атака на госта', 6: 'Дупки в защитата', 7: 'Обе отбелязват (BTTS)', 8: 'Кадри / контузии',
  9: 'Мотивация', 10: 'Value (коеф. над справедливия)',
};
const CL_MANUAL = {
  3: 'не се изчислява автоматично (доставчикът няма xG) — мин. 2.70 xG общо',
  8: 'ръчна проверка: основните голмайстори в състава, контузен най-много ключов защитник на госта',
  9: 'ръчна проверка: победата е нужна и на двата отбора',
};

function evaluateChecklist(stats, gl, model, cfg) {
  const c = [];
  const push = (id, ok, text) => c.push({ id, label: CL_LABELS[id], status: ok === null ? 'NA' : ok ? 'PASS' : 'FAIL', text });
  const ge = (v, t) => Number.isFinite(v) && v >= t;
  push(1, ge(stats.over_rate_home, cfg.overRate) && ge(stats.over_rate_away, cfg.overRate),
    `${clPct(stats.over_rate_home)} / ${clPct(stats.over_rate_away)} (мин. ${clPct(cfg.overRate)} и за двата)`);
  push(2, ge(stats.avg_total, cfg.totalGoals), `${clDec(stats.avg_total)} гола на мач (мин. ${clDec(cfg.totalGoals)})`);
  push(3, null, CL_MANUAL[3]);
  push(4, ge(stats.home_gf, cfg.homeGF), `${clDec(stats.home_gf)} вкарани като домакин (мин. ${clDec(cfg.homeGF)})`);
  push(5, ge(stats.away_gf, cfg.awayGF), `${clDec(stats.away_gf)} вкарани като гост (мин. ${clDec(cfg.awayGF)})`);
  push(6, ge(stats.home_ga, cfg.minGA) && ge(stats.away_ga, cfg.minGA),
    `${clDec(stats.home_ga)} / ${clDec(stats.away_ga)} допуснати (мин. ${clDec(cfg.minGA)} и за двата)`);
  push(7, ge(stats.btts_rate_home, cfg.bttsRate) && ge(stats.btts_rate_away, cfg.bttsRate),
    `${clPct(stats.btts_rate_home)} / ${clPct(stats.btts_rate_away)} (мин. ${clPct(cfg.bttsRate)} и за двете)`);
  push(8, null, CL_MANUAL[8]);
  push(9, null, CL_MANUAL[9]);
  const needOdd = model.fair_odd * (1 + cfg.valueMargin);
  push(10, Number.isFinite(needOdd) && gl.over >= needOdd,
    `модел ${clPct(model.p_over, 1)} → справедлив ${clDec(model.fair_odd)}, нужен ≥ ${clDec(needOdd)}, БК дава ${clDec(gl.over)}`);
  const evaluated = c.filter(x => x.status !== 'NA').length;
  const score = c.filter(x => x.status === 'PASS').length;
  const auto = cfg.minScore === 'auto' || !Number.isFinite(Number(cfg.minScore));
  // 8/10 rule (80%), scaled to the criteria that can actually be evaluated.
  const required = auto ? Math.ceil(evaluated * 0.8 - 1e-9) : Number(cfg.minScore);
  const valueOk = c.find(x => x.id === 10).status === 'PASS';
  const pass = score >= required && (!cfg.requireValue || valueOk);
  return { criteria: c, score, evaluated, required, valueOk, pass };
}

// ---------- per-fixture pipeline ----------
const CL_RETRYABLE = ['ODDS_UNAVAILABLE', 'NO_GOAL_LINE_ODDS', 'MAIN_LINE_NOT_2_5', 'HISTORY_UNAVAILABLE'];

async function analyzeFixture(client, cfg, fx, nowIso) {
  const rej = (reason, extra = {}) => ({ decision: 'REJECT', reason, retryable: CL_RETRYABLE.includes(reason), ...extra });
  if (!fx.home_team_id || !fx.away_team_id) return rej('TEAM_IDS_UNAVAILABLE');
  // Odds first: one call rules out every fixture whose main Bet365 line is not 2.5.
  const ob = await client.get(`/fixtures/${fx.fixture_id}/odds?bookmakers=bet365`);
  if (ob == null) return rej('ODDS_UNAVAILABLE');
  const gl = extractGoalLine(ob);
  if (!gl) return rej('NO_GOAL_LINE_ODDS');
  if (Math.abs(gl.line - cfg.line) > 1e-9) return rej('MAIN_LINE_NOT_2_5', { line: gl.line });
  if (gl.over < cfg.minOdds || gl.over > cfg.maxOdds) return rej('ODDS_OUT_OF_RANGE', { odd: gl.over });
  const hb = await client.get(`/teams/${fx.home_team_id}/fixtures`);
  const ab = await client.get(`/teams/${fx.away_team_id}/fixtures`);
  if (hb == null || ab == null) return rej('HISTORY_UNAVAILABLE');
  const homeRows = venueRows(hb, fx.home_team_id, 'home', fx.fixture_id, cfg.sample);
  const awayRows = venueRows(ab, fx.away_team_id, 'away', fx.fixture_id, cfg.sample);
  if (homeRows.length < cfg.minSample || awayRows.length < cfg.minSample) {
    return rej('INSUFFICIENT_HISTORY', { n_home: homeRows.length, n_away: awayRows.length });
  }
  const stats = computeStats(homeRows, awayRows);
  const model = modelOver(homeRows, awayRows, cfg.line);
  const ev = evaluateChecklist(stats, gl, model, cfg);
  const base = { score: ev.score, evaluated: ev.evaluated, required: ev.required, odd: gl.over };
  if (!ev.pass) return rej(ev.score < ev.required ? 'CHECKLIST_SCORE_TOO_LOW' : 'NO_VALUE', base);
  const marketP = devigTwoWay(gl.over, gl.under);
  return {
    decision: 'PICK', reason: 'PASSED', retryable: false, ...base,
    pick: {
      engine: CL_VERSION, fixture_id: fx.fixture_id,
      home_team: fx.home_team, away_team: fx.away_team, league: fx.league, country: fx.country,
      kickoff: fx.kickoff, market: 'OVER', line: cfg.line, odd: gl.over, under_odd: gl.under,
      opening_odd: gl.opening_over, bookmaker: gl.bookmaker,
      model_prob: model.p_over, fair_odd: model.fair_odd, market_prob_novig: marketP,
      edge_pct: (gl.over * model.p_over - 1) * 100,
      lambda_home: model.lambda_home, lambda_away: model.lambda_away,
      score: ev.score, evaluated: ev.evaluated, required: ev.required,
      criteria: ev.criteria, stats, created_at: nowIso,
    },
  };
}

// ---------- state kept in n8n workflow static data ----------
function initState(sd) {
  sd.cl = sd.cl || {};
  sd.cl.seen = sd.cl.seen || {};
  sd.cl.open = sd.cl.open || {};
  sd.cl.history = sd.cl.history || [];
  return sd.cl;
}
function pruneState(st, now) {
  for (const k of Object.keys(st.seen)) if (now - (st.seen[k].ts || 0) > 3 * 86400000) delete st.seen[k];
  if (st.history.length > 2000) st.history = st.history.slice(-2000);
}
// True when this fixture still needs analysis on this run.
function needsAnalysis(entry, cfg) {
  if (!entry) return true;
  return entry.retryable === true && (entry.attempts || 1) < cfg.maxAttempts;
}

// ---------- Telegram messages ----------
function sofiaTime(iso, tz) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('bg-BG', { timeZone: tz || 'Europe/Sofia', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function buildMessage(pick, cfg, nowMs) {
  const icon = { PASS: '✅', FAIL: '❌', NA: '🔎' };
  const lines = pick.criteria.map(c => `${icon[c.status]} ${c.id}. <b>${clEsc(c.label)}:</b> ${clEsc(c.text)}`);
  const mins = Math.round((Date.parse(pick.kickoff) - (nowMs || Date.now())) / 60000);
  return [
    `🔥 <b>ТБ 2.5 · чек-лист ${pick.score}/${pick.evaluated}</b> (нужни ${pick.required})`,
    `🏆 ${clEsc(pick.league || '—')}${pick.country ? ' · ' + clEsc(pick.country) : ''}`,
    `⚽ <b>${clEsc(pick.home_team)} — ${clEsc(pick.away_team)}</b>`,
    `🕒 ${sofiaTime(pick.kickoff, cfg.tz)} (${cfg.tz.split('/').pop()})${Number.isFinite(mins) && mins > 0 ? ` · след ~${mins} мин` : ''}`,
    '',
    `📈 Над 2.5 гола @ <b>${clDec(pick.odd)}</b> (${clEsc(pick.bookmaker || 'Bet365')})`,
    `🧮 Модел ${clPct(pick.model_prob, 1)} · справедлив коеф. ${clDec(pick.fair_odd)} · EV ${pick.edge_pct >= 0 ? '+' : ''}${pick.edge_pct.toFixed(1)}%`,
    '',
    ...lines,
    '',
    '🔎 = не е проверено автоматично; провери го ръчно преди залог.',
  ].join('\n');
}

// ---------- settlement ----------
function settleOver(line, h, a, odd) {
  const total = h + a;
  if (total > line) return { status: 'WON', pnl: +(odd - 1).toFixed(4) };
  if (total < line) return { status: 'LOSS', pnl: -1 };
  return { status: 'PUSH', pnl: 0 };
}
function buildReply(res, h, a) {
  const u = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}u`;
  if (res.status === 'VOID') return '⚪ VOID · мачът не се е състоял';
  const mark = res.status === 'WON' ? '✅ WON' : res.status === 'LOSS' ? '❌ LOSS' : '⚪ PUSH';
  return `${mark} · ${h}:${a} · ${u(res.pnl)}`;
}

// ---------- daily report ----------
function localDate(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function summarize(rows) {
  const settled = rows.filter(r => ['WON', 'LOSS', 'PUSH'].includes(r.status));
  const won = settled.filter(r => r.status === 'WON').length;
  const loss = settled.filter(r => r.status === 'LOSS').length;
  const pnl = settled.reduce((s, r) => s + r.pnl, 0);
  return { picks: rows.length, settled: settled.length, won, loss, pnl, roi: settled.length ? pnl / settled.length : null,
    hit: won + loss ? won / (won + loss) : null };
}
function buildDailyReport(history, nowMs, tz) {
  const day = localDate(nowMs - 86400000, tz);
  const dayRows = history.filter(r => localDate(Date.parse(r.kickoff), tz) === day);
  if (!dayRows.length) return null;
  const d = summarize(dayRows), all = summarize(history);
  const u = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}u`;
  return [
    `📊 <b>ТБ 2.5 чек-лист · ${day}</b>`,
    `Залози: ${d.picks} · ✅ ${d.won} · ❌ ${d.loss} · P/L ${u(d.pnl)}`,
    ...dayRows.map(r => `${r.status === 'WON' ? '✅' : r.status === 'LOSS' ? '❌' : '⚪'} ${clEsc(r.home_team)} — ${clEsc(r.away_team)} @ ${clDec(r.odd)} (${r.score_text || ''})`),
    '',
    `<b>Общо:</b> ${all.settled} затворени · успеваемост ${clPct(all.hit)} · P/L ${u(all.pnl)}${all.roi != null ? ` · ROI ${(all.roi * 100).toFixed(1)}%` : ''}`,
  ].join('\n');
}

/* EXPORTS-START */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CL_VERSION, CL_ENV_KEYS, getCfg, createProvider, normalizeFixture, discoverFixtures, extractGoalLine,
    finishedRows, venueRows, computeStats, weightedAvg, poissonGrid, modelOver, devigTwoWay,
    evaluateChecklist, analyzeFixture, initState, pruneState, needsAnalysis, buildMessage,
    settleOver, buildReply, localDate, summarize, buildDailyReport, CL_RETRYABLE,
  };
}
/* EXPORTS-END */
