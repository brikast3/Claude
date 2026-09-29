const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib.js');

const cfg = L.getCfg({});
const row = (id, hid, aid, gh, ga, ts) => ({ id, status: 'finished', kickoff_ts: ts, teams: { home: { id: hid }, away: { id: aid } }, goals: { home: gh, away: ga } });

test('getCfg: defaults are the checklist thresholds and publishing is OFF', () => {
  assert.equal(cfg.publish, false);
  assert.equal(cfg.overRate, 0.55); assert.equal(cfg.totalGoals, 2.7);
  assert.equal(cfg.homeGF, 1.5); assert.equal(cfg.awayGF, 1.2); assert.equal(cfg.minGA, 1);
  assert.equal(cfg.line, 2.5);
});

test('getCfg: env overrides, junk falls back to default', () => {
  const c = L.getCfg({ SR_CL_PUBLISH: 'TRUE', SR_CL_TOTAL: '2.9', SR_CL_HOME_GF: 'abc', SR626_PROVIDER_API_BASE: 'https://x/v1/' });
  assert.equal(c.publish, true); assert.equal(c.totalGoals, 2.9); assert.equal(c.homeGF, 1.5); assert.equal(c.apiBase, 'https://x/v1');
});

test('venueRows: only finished, right venue, newest first, excludes current fixture', () => {
  const body = { data: [
    row(1, 10, 20, 2, 1, 100), row(2, 10, 30, 3, 0, 300), row(3, 40, 10, 1, 1, 200), // 3 = team 10 away
    { ...row(4, 10, 20, 0, 0, 400), status: 'scheduled' }, row(5, 10, 20, 1, 2, 500),
  ] };
  const r = L.venueRows(body, 10, 'home', 5, 10);
  assert.deepEqual(r.map(x => x.id), [2, 1]);
});

test('computeStats: hand-checked numbers', () => {
  const home = [row(1, 1, 9, 3, 1), row(2, 1, 9, 2, 0), row(3, 1, 9, 1, 1), row(4, 1, 9, 0, 0)]; // totals 4,2,2,0
  const away = [row(5, 9, 2, 1, 2), row(6, 9, 2, 0, 3), row(7, 9, 2, 2, 2), row(8, 9, 2, 0, 0)]; // totals 3,3,4,0
  const s = L.computeStats(home, away);
  assert.equal(s.over_rate_home, 0.25); assert.equal(s.over_rate_away, 0.75);
  assert.equal(s.avg_total, (2 + 2.5) / 2);
  assert.equal(s.home_gf, 1.5); assert.equal(s.home_ga, 0.5);
  assert.equal(s.away_gf, 1.75); assert.equal(s.away_ga, 0.75);
  assert.equal(s.btts_rate_home, 0.5); assert.equal(s.btts_rate_away, 0.5);
});

test('poissonGrid sums to 1; P(over 2.5) close to plain Poisson for total lambda 3', () => {
  const g = L.poissonGrid(1.5, 1.5);
  assert.ok(Math.abs(g.reduce((s, x) => s + x.p, 0) - 1) < 1e-9);
  const p = g.filter(x => x.h + x.a > 2.5).reduce((s, x) => s + x.p, 0);
  assert.ok(Math.abs(p - (1 - Math.exp(-3) * (1 + 3 + 4.5))) < 0.02, String(p));
});

test('modelOver: attacking teams -> higher P(over) than defensive teams', () => {
  const mk = (gh, ga) => Array.from({ length: 10 }, (_, i) => row(i, 1, 2, gh, ga, i));
  const hi = L.modelOver(mk(2, 2), mk(2, 2)), lo = L.modelOver(mk(1, 0), mk(0, 1));
  assert.ok(hi.p_over > 0.65 && lo.p_over < 0.3, `${hi.p_over} ${lo.p_over}`);
  assert.ok(Math.abs(hi.fair_odd - 1 / hi.p_over) < 1e-12);
});

// The example from the checklist screenshot (Eintracht Frankfurt v Hoffenheim).
const exampleStats = { over_rate_home: .62, over_rate_away: .69, avg_total: 3.10, home_gf: 1.82, away_gf: 1.45,
  home_ga: 1.15, away_ga: 1.70, btts_rate_home: .60, btts_rate_away: .65 };
const exampleModel = { p_over: .64, fair_odd: 1 / .64 };

test('evaluateChecklist: screenshot example passes all 7 automatic points', () => {
  const ev = L.evaluateChecklist(exampleStats, { over: 1.78 }, exampleModel, cfg);
  assert.equal(ev.score, 7); assert.equal(ev.evaluated, 7); assert.equal(ev.required, 6);
  assert.equal(ev.pass, true);
  assert.deepEqual(ev.criteria.filter(c => c.status === 'NA').map(c => c.id), [3, 8, 9]);
});

test('evaluateChecklist: one miss still passes (6/7), two misses do not', () => {
  const one = L.evaluateChecklist({ ...exampleStats, home_gf: 1.2 }, { over: 1.78 }, exampleModel, cfg);
  assert.equal(one.score, 6); assert.equal(one.pass, true);
  const two = L.evaluateChecklist({ ...exampleStats, home_gf: 1.2, away_gf: 1.0 }, { over: 1.78 }, exampleModel, cfg);
  assert.equal(two.score, 5); assert.equal(two.pass, false);
});

test('evaluateChecklist: thresholds are inclusive (55% / 2.70 / 1.50 / 1.20 / 1.00)', () => {
  const edge = { over_rate_home: .55, over_rate_away: .55, avg_total: 2.7, home_gf: 1.5, away_gf: 1.2, home_ga: 1, away_ga: 1, btts_rate_home: .55, btts_rate_away: .55 };
  const ev = L.evaluateChecklist(edge, { over: 1.78 }, exampleModel, cfg);
  assert.equal(ev.criteria.filter(c => c.status === 'FAIL').length, 0);
});

test('evaluateChecklist: no value blocks the pick even with a perfect score; can be switched off', () => {
  const noValue = L.evaluateChecklist(exampleStats, { over: 1.50 }, exampleModel, cfg); // needs >= 1.64
  assert.equal(noValue.score, 6); assert.equal(noValue.valueOk, false); assert.equal(noValue.pass, false);
  const perfectNoValue = L.evaluateChecklist(exampleStats, { over: 1.50 }, exampleModel, { ...cfg, requireValue: false });
  assert.equal(perfectNoValue.pass, true);
});

test('evaluateChecklist: value margin boundary (fair 1.5625 * 1.05 = 1.6406)', () => {
  assert.equal(L.evaluateChecklist(exampleStats, { over: 1.64 }, exampleModel, cfg).valueOk, false);
  assert.equal(L.evaluateChecklist(exampleStats, { over: 1.65 }, exampleModel, cfg).valueOk, true);
});

test('evaluateChecklist: explicit SR_CL_MIN_SCORE overrides the 80% rule', () => {
  const c = { ...cfg, minScore: '7' };
  assert.equal(L.evaluateChecklist({ ...exampleStats, home_gf: 1.2 }, { over: 1.78 }, exampleModel, c).pass, false);
});

test('extractGoalLine: prefers bet365, closing over current, null when missing', () => {
  const body = { data: { bookmakers: [{ slug: 'other', odds: { goal_line: { current: { line: 3, over: 2 } } } },
    { slug: 'bet365', odds: { goal_line: { closing: { line: 2.5, over: 1.8, under: 2.0 }, current: { line: 2.75, over: 1.9 }, opening: { over: 1.7 } } } }] } };
  const g = L.extractGoalLine(body);
  assert.deepEqual([g.line, g.over, g.under, g.opening_over], [2.5, 1.8, 2, 1.7]);
  assert.equal(L.extractGoalLine({ data: { bookmakers: [{ slug: 'bet365', odds: {} }] } }), null);
  assert.equal(L.extractGoalLine(null), null);
});

test('needsAnalysis: retries only retryable reasons and only up to maxAttempts', () => {
  assert.equal(L.needsAnalysis(undefined, cfg), true);
  assert.equal(L.needsAnalysis({ retryable: true, attempts: 2 }, cfg), true);
  assert.equal(L.needsAnalysis({ retryable: true, attempts: 3 }, cfg), false);
  assert.equal(L.needsAnalysis({ retryable: false, attempts: 1 }, cfg), false);
});

test('settleOver: 3+ goals wins at odds-1, 2 goals loses 1u', () => {
  assert.deepEqual(L.settleOver(2.5, 2, 1, 1.8), { status: 'WON', pnl: 0.8 });
  assert.deepEqual(L.settleOver(2.5, 1, 1, 1.8), { status: 'LOSS', pnl: -1 });
  assert.deepEqual(L.settleOver(2.5, 0, 0, 1.8), { status: 'LOSS', pnl: -1 });
});

test('buildMessage: escapes HTML in names, shows manual-check markers and the odds', () => {
  const ev = L.evaluateChecklist(exampleStats, { over: 1.78 }, exampleModel, cfg);
  const pick = { home_team: 'A<b>&Co', away_team: 'B', league: 'Bundesliga', country: 'Germany', kickoff: '2026-09-30T15:30:00Z',
    odd: 1.78, bookmaker: 'bet365', model_prob: .64, fair_odd: 1.5625, edge_pct: 13.92, score: 7, evaluated: 7, required: 6, criteria: ev.criteria };
  const m = L.buildMessage(pick, cfg, Date.parse('2026-09-30T15:00:00Z'));
  assert.ok(m.includes('A&lt;b&gt;&amp;Co')); assert.ok(!m.includes('<b>&Co'));
  assert.ok(m.includes('1.78') && m.includes('7/7') && m.includes('🔎 3.') && m.includes('след ~30 мин'));
});

test('buildDailyReport: previous local day only, null when nothing to report', () => {
  const now = Date.parse('2026-09-30T05:00:00Z');
  const h = [{ kickoff: '2026-09-29T15:00:00Z', home_team: 'A', away_team: 'B', odd: 1.8, status: 'WON', pnl: 0.8, score_text: '2:1' },
    { kickoff: '2026-09-29T17:00:00Z', home_team: 'C', away_team: 'D', odd: 1.9, status: 'LOSS', pnl: -1, score_text: '0:0' },
    { kickoff: '2026-09-20T17:00:00Z', home_team: 'E', away_team: 'F', odd: 1.9, status: 'WON', pnl: 0.9, score_text: '3:1' }];
  const t = L.buildDailyReport(h, now, 'Europe/Sofia');
  assert.ok(t.includes('2026-09-29') && t.includes('✅ 1 · ❌ 1') && t.includes('3 затворени') && !t.includes('E — F'));
  assert.equal(L.buildDailyReport([], now, 'Europe/Sofia'), null);
});
