// Assembles SOCCER_RADAR_v6.26_QUALITY_FIRST_MULTI_MARKET_SELECTOR_FINAL.json
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bundleLib } = require('./bundle');

const LIB_BUNDLE = bundleLib();

let idCounter = 0;
function uid() {
  idCounter++;
  return crypto.createHash('md5').update('sr626-node-' + idCounter).digest('hex').slice(0, 8) +
    '-0000-4000-8000-' + String(idCounter).padStart(12, '0');
}

let x = 0, laneY = {};
function pos(lane, dx) {
  laneY[lane] = laneY[lane] === undefined ? lane * 260 : laneY[lane];
  return [dx, laneY[lane]];
}

function node({ name, type, typeVersion = 1, parameters = {}, notes, credentials, webhookId }) {
  const n = { id: uid(), name, type, typeVersion, position: [0, 0], parameters };
  if (notes) n.notes = notes;
  if (credentials) n.credentials = credentials;
  if (webhookId) n.webhookId = webhookId;
  return n;
}

function stickyNote(name, content, position, size = [420, 240]) {
  return {
    id: uid(), name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position, parameters: { content, height: size[1], width: size[0] }
  };
}

function codeNode(name, jsCode, opts = {}) {
  return node({
    name, type: 'n8n-nodes-base.code', typeVersion: 2,
    parameters: { mode: opts.mode || 'runOnceForAllItems', jsCode },
    notes: opts.notes
  });
}

function scheduleTrigger(name, cronExpression, notes) {
  return node({
    name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: cronExpression }] } },
    notes
  });
}

function ifNode(name, leftValue, operator = { type: 'boolean', operation: 'true', singleValue: true }, rightValue = true) {
  return node({
    name, type: 'n8n-nodes-base.if', typeVersion: 2.2,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: uid(), leftValue, rightValue, operator }],
        combinator: 'and'
      },
      options: {}
    }
  });
}

function splitInBatches(name) {
  return node({ name, type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, parameters: { options: { reset: false } } });
}

function waitNode(name, seconds) {
  return node({ name, type: 'n8n-nodes-base.wait', typeVersion: 1.1, parameters: { amount: seconds } });
}

function telegramNode(name, textExpr) {
  const n = node({
    name, type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
    parameters: {
      chatId: '={{ $env.SR626_TELEGRAM_CHAT_ID }}',
      text: textExpr,
      additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' }
    },
    credentials: { telegramApi: { id: 'SR626_TELEGRAM_CREDENTIAL', name: 'Telegram account' } }
  });
  // A Telegram outage must never crash the run -- continue with the original
  // (message_id-less) item so downstream IFs can detect and record the failure.
  n.onError = 'continueRegularOutput';
  return n;
}

// ===========================================================================
// SHARED CODE PREAMBLE: every SOCCER RADAR v6.26 Code node starts with the
// full tested lib bundle, then n8n-specific glue below it.
// ===========================================================================
function withLib(glue) {
  return `${LIB_BUNDLE}\n\n// ==== n8n glue ====\n${glue}\n`;
}

function supabaseHeaders() {
  return [
    "const SUPABASE_URL = $env.SUPABASE_URL;",
    "const SUPABASE_KEY = $env.SUPABASE_SERVICE_KEY;",
    "const SB_HEADERS = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };",
    "// returnFullResponse + ignoreHttpStatusErrors: read the real status/body",
    "// ourselves instead of relying on however this n8n version shapes a thrown",
    "// HTTP error (that mismatch previously hid every real PostgREST error behind",
    "// 'status: 0, Request failed with status code 400').",
    "const sbRaw = (pathAndQuery, opts) => this.helpers.httpRequest({ url: SUPABASE_URL + pathAndQuery, headers: SB_HEADERS, json: true, timeout: 20000, returnFullResponse: true, ignoreHttpStatusErrors: true, ...(opts || {}) });",
    "const sbCall = async (pathAndQuery, method, body, diag) => {",
    "  const r = await httpWithRetry(async () => {",
    "    const extraHeaders = method === 'GET' ? SB_HEADERS : { ...SB_HEADERS, Prefer: 'return=representation,resolution=merge-duplicates' };",
    "    const resp = await sbRaw(pathAndQuery, { method, body, headers: extraHeaders });",
    "    const status = Number((resp && resp.statusCode) || 0);",
    "    if (status >= 400) {",
    "      const b = resp && resp.body;",
    "      const detail = b && (b.message || b.hint || b.error || b.details) || (typeof b === 'string' ? b.slice(0, 200) : null);",
    "      const e = new Error(detail || ('supabase ' + status));",
    "      e.statusCode = status;",
    "      e.retryAfterSeconds = Number(resp && resp.headers && resp.headers['retry-after']);",
    "      throw e;",
    "    }",
    "    return resp && resp.body;",
    "  }, CONFIG, {});",
    "  if (diag) {",
    "    diag.dbWrites++;",
    "    if (!r.ok) {",
    "      diag.dbWriteFailures++;",
    "      // Surfaced so a failed run is diagnosable from the node's own output JSON",
    "      // instead of digging through n8n's internal HTTP logs.",
    "      diag.lastDbError = { path: pathAndQuery, status: r.status, message: r.message };",
    "    }",
    "  }",
    "  return r;",
    "};",
    "const sbWrite = (pathAndQuery, method, body, diag) => sbCall(pathAndQuery, method, body, diag);",
    "// Reads fail soft: an error returns [] (an empty result set is always a safe",
    "// default here) instead of crashing the node, same fail-soft philosophy as",
    "// every provider/DB call in this workflow.",
    "const sbFetch = async (pathAndQuery, opts) => {",
    "  const method = (opts && opts.method) || 'GET';",
    "  const r = await sbCall(pathAndQuery, method, opts && opts.body, null);",
    "  return r.ok ? r.response : [];",
    "};"
  ].join('\n') + '\n';
}

function providerHeaders() {
  return [
    "const API_BASE = $env.SR626_PROVIDER_API_BASE || 'https://api.5dollarfootballapi.com/v1';",
    "const API_KEY = $env.SR626_PROVIDER_API_KEY;",
    "const providerRequest = (pathAndQuery) => this.helpers.httpRequest({ method: 'GET', url: API_BASE + pathAndQuery, headers: { Authorization: 'Bearer ' + API_KEY, Accept: 'application/json' }, json: true, timeout: 30000, returnFullResponse: true, ignoreHttpStatusErrors: true });",
    "// Shared pacing state lives in GLOBAL static data (not a local variable) because",
    "// provider calls happen from several different Code node executions across a",
    "// SplitInBatches loop -- a local variable would reset every iteration and the",
    "// shared 9/min ceiling (spec SS30) could be silently burst.",
    "const __pacer = $getWorkflowStaticData('global');",
    "const __paceSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const paceProviderCall = async () => {",
    "  const wait = waitBeforeNextCall(__pacer.lastProviderCallAtMs || 0, Date.now(), CONFIG);",
    "  if (wait > 0) await __paceSleep(wait);",
    "  __pacer.lastProviderCallAtMs = Date.now();",
    "};",
    "const callProvider = async (pathAndQuery, diag) => {",
    "  const r = await httpWithRetry(async () => {",
    "    await paceProviderCall();",
    "    const resp = await providerRequest(pathAndQuery);",
    "    const status = Number((resp && resp.statusCode) || 0);",
    "    if (status >= 400) { const e = new Error('provider ' + status); e.statusCode = status; e.retryAfterSeconds = Number(resp && resp.headers && resp.headers['retry-after']); throw e; }",
    "    return resp && resp.body;",
    "  }, CONFIG, {});",
    "  if (diag) {",
    "    diag.providerRequests += r.attempts.made;",
    "    diag.providerRetries += r.attempts.retries;",
    "    if (!r.ok) { diag.providerErrors++; diag.lastProviderError = { path: pathAndQuery, status: r.status, message: r.message }; }",
    "  }",
    "  return r;",
    "};"
  ].join('\n') + '\n';
}

module.exports = { node, stickyNote, codeNode, scheduleTrigger, ifNode, splitInBatches, waitNode, telegramNode, withLib, supabaseHeaders, providerHeaders, uid, pos };
