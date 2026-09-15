// SOCCER RADAR v6.26 · Bet365 payload parser.
// Single source of truth for turning one provider fixture record into the
// canonical bet365 payload lib/priceLookup.js consumes. Used identically by
// Market Scout (initial snapshot) and the pre-publish Execution Recheck, so
// the two stages can never silently disagree on what a field means.
//
// NOTE: field name aliases below mirror the 5DollarFootballAPI PRO shapes
// this project has integrated with previously (1x2/match_winner/moneyline,
// btts/both_teams_to_score, goal_line/total_goals, asian_handicap). If the
// live schema differs, this is the ONLY function that needs adapting --
// everything downstream (devig/model/gate/scoring) already consumes the
// canonical shape produced here.

function pickStage(stageObj) {
  return stageObj ? (stageObj.closing || stageObj.opening || stageObj.latest || null) : null;
}
function firstOf(...xs) {
  return xs.find(x => x && typeof x === 'object') || null;
}
function n1(v) {
  return Number(v) > 1 ? Number(v) : null;
}
function isHalfLine(v) {
  const x = Number(v);
  return Number.isFinite(x) && Math.abs((x - Math.floor(x)) - 0.5) < 1e-9;
}

function findBet365Book(fixture) {
  const books = Array.isArray(fixture && fixture.bookmakers) ? fixture.bookmakers : [];
  const b = books.find(x => String((x && x.slug) || '').toLowerCase() === 'bet365' || /bet\s*365/i.test(String((x && x.name) || '')));
  return (b && b.odds) || (fixture && fixture.odds) || {};
}

function parseBet365Payload(fixture) {
  const o = findBet365Book(fixture);
  const q1 = pickStage(firstOf(o['1x2'], o.match_winner, o.matchWinner, o.moneyline));
  const qb = pickStage(firstOf(o.btts, o.both_teams_to_score, o.bothTeamsToScore));
  const qg = pickStage(firstOf(o.goal_line, o.goalline, o.goals_over_under, o.total_goals));
  const qah = pickStage(firstOf(o.asian_handicap, o.asianHandicap, o.handicap));
  const qdc = pickStage(firstOf(o.double_chance, o.doubleChance, o.dc));

  const payload = { snapshotAt: new Date().toISOString() };

  if (q1) {
    const home = n1(q1.home ?? q1['1']), draw = n1(q1.draw ?? q1.x), away = n1(q1.away ?? q1['2']);
    if (home || draw || away) payload.moneyline = { home, draw, away };
  }
  if (qb) {
    const yes = n1(qb.yes ?? qb.YES), no = n1(qb.no ?? qb.NO);
    if (yes || no) payload.btts = { yes, no };
  }
  if (qdc) {
    const oneX = n1(qdc.oneX ?? qdc['1x'] ?? qdc.home_draw), xTwo = n1(qdc.xTwo ?? qdc['x2'] ?? qdc.draw_away);
    if (oneX || xTwo) payload.doubleChance = { oneX, xTwo };
  }
  if (qg) {
    const line = Number.isFinite(Number(qg.line ?? qg.total)) ? Number(qg.line ?? qg.total) : null;
    const over = n1(qg.over), under = n1(qg.under);
    if (line !== null && (over || under)) {
      const bucket = isHalfLine(line) ? 'totals' : 'asianTotals';
      payload[bucket] = payload[bucket] || {};
      payload[bucket][String(line)] = { over, under };
    }
  }
  if (qah) {
    const line = Number.isFinite(Number(qah.line)) ? Number(qah.line) : null;
    const home = n1(qah.home), away = n1(qah.away);
    if (line !== null && (home || away)) {
      payload.asianHandicap = { [String(line)]: { home, away } };
    }
  }
  return payload;
}

const EXCLUDED_COMPETITION_RE = /friendly|friendlies|\bu1[789]\b|\bu2[0123]\b|reserve|reserves|women/i;

if (typeof module !== 'undefined') {
  module.exports = { parseBet365Payload, findBet365Book, isHalfLine, EXCLUDED_COMPETITION_RE };
}
