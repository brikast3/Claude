// SOCCER RADAR v6.26 · Window scheduling helpers (Europe/Sofia).
// Determines which of the three non-overlapping windows (A/B/C) "now" falls
// into, and the fixture-kickoff range that window covers, so Market Scout and
// the Selector never process overlapping slices of the day.

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutesInTz(nowMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(nowMs));
  const hh = Number(parts.find(p => p.type === 'hour').value);
  const mm = Number(parts.find(p => p.type === 'minute').value);
  return hh * 60 + mm;
}

function localDateStr(nowMs, timezone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Converts a local wall-clock time in `timezone` to a UTC epoch ms, correcting
// for the timezone offset actually in effect on that date (handles DST).
function localTimeToEpochMs(dateStr, hh, mm, timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date(guess));
    const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const observed = Date.UTC(y, m - 1, d, hh, mm, 0);
    const actual = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    guess += observed - actual;
  }
  return guess;
}

// Returns { windowId, rangeStartMs, rangeEndMs } for "now". The active window
// is the one whose scoutTime has most recently passed; it covers fixtures
// from its own scoutTime up to (but not including) the next window's scoutTime.
function getActiveWindow(nowMs, config) {
  const tz = config.timezone;
  const windows = config.schedule.windows;
  const nowMin = nowMinutesInTz(nowMs, tz);
  const todayStr = localDateStr(nowMs, tz);

  const sorted = [...windows].sort((a, b) => timeToMinutes(a.scoutTime) - timeToMinutes(b.scoutTime));
  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (nowMin >= timeToMinutes(sorted[i].scoutTime)) activeIdx = i;
  }
  if (activeIdx === -1) activeIdx = sorted.length - 1; // before the first window today -> still last night's window C

  const active = sorted[activeIdx];
  const next = sorted[(activeIdx + 1) % sorted.length];
  const usedYesterday = activeIdx === sorted.length - 1 && nowMin < timeToMinutes(sorted[0].scoutTime);
  const startDate = usedYesterday ? addDays(todayStr, -1) : todayStr;
  const endDate = activeIdx === sorted.length - 1 ? addDays(startDate, 1) : startDate;

  const [sh, sm] = active.scoutTime.split(':').map(Number);
  const [eh, em] = next.scoutTime.split(':').map(Number);

  return {
    windowId: active.id,
    rangeStartMs: localTimeToEpochMs(startDate, sh, sm, tz),
    rangeEndMs: localTimeToEpochMs(endDate, eh, em, tz)
  };
}

function isExecutable(kickoffMs, nowMs, config) {
  return (kickoffMs - nowMs) / 60000 >= config.schedule.minMinutesToKickoff;
}

if (typeof module !== 'undefined') {
  module.exports = { getActiveWindow, isExecutable, localTimeToEpochMs, nowMinutesInTz, localDateStr };
}
