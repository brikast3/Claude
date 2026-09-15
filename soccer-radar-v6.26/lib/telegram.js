// SOCCER RADAR v6.26 · Telegram message formatting.
// The public post is deliberately thin: no model %, fair odd, EV%, edge%,
// HistoryScore, DQ, lambdas or Poisson detail -- those stay in the DB only.

function formatLineNumber(line) {
  const s = (Math.round(line * 100) / 100).toFixed(2);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function formatSignedLine(line) {
  const abs = formatLineNumber(Math.abs(line));
  if (line > 0) return '+' + abs;
  if (line < 0) return '-' + abs;
  return '0';
}

function marketDisplayLabel(pick) {
  const { marketFamily, side, line, homeTeam, awayTeam } = pick;
  switch (marketFamily) {
    case 'BTTS':
      return side === 'YES' ? 'Гол/Гол — Да' : 'Гол/Гол — Не';
    case 'GOALS':
      return (side === 'OVER' ? 'Над ' : 'Под ') + formatLineNumber(line) + ' гола';
    case 'MONEYLINE':
      return side === 'HOME_WIN' ? '1 (Победа домакин)' : side === 'DRAW' ? 'Х (Равенство)' : '2 (Победа гост)';
    case 'DOUBLE_CHANCE':
      return side === 'ONE_X' ? '1X (Двоен шанс)' : 'X2 (Двоен шанс)';
    case 'ASIAN_HANDICAP':
      return 'Хандикап ' + (side === 'HOME' ? homeTeam : awayTeam) + ' (' + formatSignedLine(line) + ')';
    default:
      return pick.marketKey || marketFamily;
  }
}

function formatDateTimeSofia(isoKickoff) {
  const d = new Date(isoKickoff);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('day')}.${get('month')} · ${get('hour')}:${get('minute')}`;
}

function eur(x) {
  const sign = x >= 0 ? '+' : '-';
  return sign + Math.abs(x).toFixed(2) + ' €';
}

function formatPickPost(pick) {
  return [
    '🎯 SOCCER RADAR · PICK',
    '',
    `⚽ ${pick.homeTeam} — ${pick.awayTeam}`,
    `🏆 ${pick.country} · ${pick.leagueName}`,
    `🕒 ${formatDateTimeSofia(pick.kickoff)}`,
    '',
    `🔥 ${marketDisplayLabel(pick)}`,
    `💰 Bet365: ${pick.entryOdd.toFixed(2)}`,
    '',
    `📊 Рейтинг: ${Math.round(pick.marketScore)}/100`,
    `💶 Фиксиран залог: ${pick.stakeEur} €`
  ].join('\n');
}

const RESULT_HEADERS = {
  WIN: '✅ ПЕЧЕЛИВША',
  HALF_WIN: '🟡 ПОЛОВИН ПЕЧАЛБА',
  PUSH: '⚪ ВЪЗСТАНОВЕН ЗАЛОГ',
  HALF_LOSS: '🟠 ПОЛОВИН ЗАГУБА',
  LOSS: '❌ ЗАГУБА',
  VOID: '⚫ ОТМЕНЕН МАЧ'
};

function formatResultReply(pick, settlement) {
  const header = RESULT_HEADERS[settlement.status] || RESULT_HEADERS.LOSS;
  if (settlement.status === 'LOSS') {
    return [header, '', `💰 ${eur(settlement.profitEur)}`].join('\n');
  }
  const lines = [
    header,
    '',
    `⚽ ${pick.homeTeam} — ${pick.awayTeam}`,
    `🎯 ${marketDisplayLabel(pick)} @${pick.entryOdd.toFixed(2)}`,
    `🏁 ${settlement.ftHome}:${settlement.ftAway}`,
    '',
    `💰 ${eur(settlement.profitEur)}`
  ];
  return lines.join('\n');
}

function formatDailyReport(summary) {
  const lines = [
    '📊 SOCCER RADAR · ДНЕВЕН ОТЧЕТ',
    '',
    summary.dateLabel,
    '',
    `Официални прогнози: ${summary.totalPicks}`,
    `✅ ${summary.wins}`,
    `❌ ${summary.losses}`,
    '',
    `💰 P/L: ${eur(summary.plEur)}`,
    `📈 ROI: ${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(1)}%`
  ];
  if (summary.byFamily && Object.keys(summary.byFamily).length > 0) {
    lines.push('', 'ПО ПАЗАРИ:', '');
    for (const [family, pl] of Object.entries(summary.byFamily)) {
      lines.push(`${family}: ${eur(pl)}`);
    }
  }
  if (summary.rolling7d && summary.rolling7d.sampleN >= 5) {
    lines.push('', `📅 Последни 7 дни (N=${summary.rolling7d.sampleN}): ${eur(summary.rolling7d.plEur)} · ROI ${summary.rolling7d.roiPct.toFixed(1)}%`);
  }
  if (summary.rolling30Settled && summary.rolling30Settled.sampleN >= 10) {
    lines.push(`📈 Последни 30 сетълмента (N=${summary.rolling30Settled.sampleN}): ${eur(summary.rolling30Settled.plEur)} · ROI ${summary.rolling30Settled.roiPct.toFixed(1)}%`);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { formatLineNumber, formatSignedLine, marketDisplayLabel, formatDateTimeSofia, formatPickPost, formatResultReply, formatDailyReport };
}
