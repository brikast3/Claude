'use strict';
const fs = require('fs');
const path = require('path');
const N = require('./assemble');

// ---------------------------------------------------------------------------
// Layout (purely cosmetic -- grid positions so the graph opens readable)
// ---------------------------------------------------------------------------
function layout(nodesInOrder, startY, startX = 40, dx = 260) {
  nodesInOrder.forEach((n, i) => { n.position = [startX + i * dx, startY]; });
}

layout([N.triggerMarketScout, N.codeMarketScout], 900);

layout([N.triggerSelector, N.codeLoadFixtures, N.loopFixtures, N.codeEvaluateFixture], 1200);
N.codeFinalizeQueue.position = [40 + 3 * 260, 1400];
layout([N.loopApproved, N.codeExecutionRecheck, N.ifExecutionApproved], 1600);
layout([N.codeInsertPick, N.telegramPublishPick, N.ifTelegramSuccessPublish], 1600 - 0);
N.codeInsertPick.position = [40 + 3 * 260, 1750];
N.telegramPublishPick.position = [40 + 4 * 260, 1750];
N.ifTelegramSuccessPublish.position = [40 + 5 * 260, 1750];
N.codeRegisterPublication.position = [40 + 6 * 260, 1680];
N.codeRegisterTelegramFailure.position = [40 + 6 * 260, 1820];
N.waitBetweenPicks.position = [40 + 7 * 260, 1750];
N.codeRecordExecutionRejected.position = [40 + 3 * 260, 1900];
N.codeFinalizeRun.position = [40 + 8 * 260, 1400];

layout([N.triggerSettlement, N.codeLoadOpenPicks, N.loopOpenPicks, N.codeSettlePick, N.ifNewlySettled], 2100);
N.codeReplyResult.position = [40 + 5 * 260, 2100];
N.telegramReplyResult.position = [40 + 6 * 260, 2100];

layout([N.triggerDailyReport, N.codeDailyReport, N.telegramDailyReport], 2400);

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
const nodes = [
  N.stickyHeader, N.stickyModuleA, N.stickyModuleB, N.stickyModuleC, N.stickyModuleD,

  N.triggerMarketScout, N.codeMarketScout,

  N.triggerSelector, N.codeLoadFixtures, N.loopFixtures, N.codeEvaluateFixture, N.codeFinalizeQueue,
  N.loopApproved, N.codeExecutionRecheck, N.ifExecutionApproved,
  N.codeInsertPick, N.telegramPublishPick, N.ifTelegramSuccessPublish,
  N.codeRegisterPublication, N.codeRegisterTelegramFailure, N.waitBetweenPicks,
  N.codeRecordExecutionRejected, N.codeFinalizeRun,

  N.triggerSettlement, N.codeLoadOpenPicks, N.loopOpenPicks, N.codeSettlePick, N.ifNewlySettled,
  N.codeReplyResult, N.telegramReplyResult,

  N.triggerDailyReport, N.codeDailyReport, N.telegramDailyReport
];

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
const connections = {};
function connect(fromName, fromOutput, toName, toInput = 0) {
  connections[fromName] = connections[fromName] || { main: [] };
  while (connections[fromName].main.length <= fromOutput) connections[fromName].main.push([]);
  connections[fromName].main[fromOutput].push({ node: toName, type: 'main', index: toInput });
}

// Module A
connect(N.triggerMarketScout.name, 0, N.codeMarketScout.name);

// Module B -- per-fixture loop
connect(N.triggerSelector.name, 0, N.codeLoadFixtures.name);
connect(N.codeLoadFixtures.name, 0, N.loopFixtures.name);
connect(N.loopFixtures.name, 1, N.codeEvaluateFixture.name); // loop output
connect(N.codeEvaluateFixture.name, 0, N.loopFixtures.name); // back for next batch
connect(N.loopFixtures.name, 0, N.codeFinalizeQueue.name); // done output

// Module B -- publication queue loop
connect(N.codeFinalizeQueue.name, 0, N.loopApproved.name);
connect(N.loopApproved.name, 1, N.codeExecutionRecheck.name);
connect(N.codeExecutionRecheck.name, 0, N.ifExecutionApproved.name);
connect(N.ifExecutionApproved.name, 0, N.codeInsertPick.name); // true
connect(N.ifExecutionApproved.name, 1, N.codeRecordExecutionRejected.name); // false
connect(N.codeInsertPick.name, 0, N.telegramPublishPick.name);
connect(N.telegramPublishPick.name, 0, N.ifTelegramSuccessPublish.name);
connect(N.ifTelegramSuccessPublish.name, 0, N.codeRegisterPublication.name); // true
connect(N.ifTelegramSuccessPublish.name, 1, N.codeRegisterTelegramFailure.name); // false
connect(N.codeRegisterPublication.name, 0, N.waitBetweenPicks.name);
connect(N.codeRegisterTelegramFailure.name, 0, N.waitBetweenPicks.name);
connect(N.waitBetweenPicks.name, 0, N.loopApproved.name); // back for next batch
connect(N.codeRecordExecutionRejected.name, 0, N.loopApproved.name); // back for next batch (no wait needed)
connect(N.loopApproved.name, 0, N.codeFinalizeRun.name); // done output

// Module C -- settlement loop
connect(N.triggerSettlement.name, 0, N.codeLoadOpenPicks.name);
connect(N.codeLoadOpenPicks.name, 0, N.loopOpenPicks.name);
connect(N.loopOpenPicks.name, 1, N.codeSettlePick.name);
connect(N.codeSettlePick.name, 0, N.ifNewlySettled.name);
connect(N.ifNewlySettled.name, 0, N.codeReplyResult.name); // true
connect(N.codeReplyResult.name, 0, N.telegramReplyResult.name);
connect(N.telegramReplyResult.name, 0, N.loopOpenPicks.name); // back for next batch
connect(N.ifNewlySettled.name, 1, N.loopOpenPicks.name); // false -- back directly, no reply

// Module D
connect(N.triggerDailyReport.name, 0, N.codeDailyReport.name);
connect(N.codeDailyReport.name, 0, N.telegramDailyReport.name);

// ---------------------------------------------------------------------------
// Assemble + write
// ---------------------------------------------------------------------------
const workflow = {
  name: 'SOCCER RADAR v6.26 · QUALITY-FIRST MULTI-MARKET SELECTOR',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', timezone: 'Europe/Sofia' },
  versionId: 'sr-v626-final-1',
  meta: { instanceId: 'sr-v626' },
  id: 'SR626FINAL',
  tags: []
};

const outPath = path.join(__dirname, '..', 'out', 'SOCCER_RADAR_v6.26_QUALITY_FIRST_MULTI_MARKET_SELECTOR_FINAL.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));

// ---------------------------------------------------------------------------
// Structural self-check (dangling connections, isolated nodes)
// ---------------------------------------------------------------------------
const nodeNames = new Set(nodes.map(n => n.name));
let danglingRefs = 0;
for (const [from, c] of Object.entries(connections)) {
  if (!nodeNames.has(from)) { console.error('DANGLING SOURCE:', from); danglingRefs++; }
  for (const outputArr of c.main) {
    for (const target of outputArr) {
      if (!nodeNames.has(target.node)) { console.error('DANGLING TARGET:', from, '->', target.node); danglingRefs++; }
    }
  }
}
const executableTypes = new Set(['n8n-nodes-base.code', 'n8n-nodes-base.if', 'n8n-nodes-base.splitInBatches', 'n8n-nodes-base.telegram', 'n8n-nodes-base.wait']);
const hasIncoming = new Set();
const hasOutgoing = new Set(Object.keys(connections));
for (const c of Object.values(connections)) for (const arr of c.main) for (const t of arr) hasIncoming.add(t.node);
const triggerNames = new Set([N.triggerMarketScout.name, N.triggerSelector.name, N.triggerSettlement.name, N.triggerDailyReport.name]);
let isolated = 0;
for (const n of nodes) {
  if (!executableTypes.has(n.type) && n.type !== 'n8n-nodes-base.scheduleTrigger') continue; // skip sticky notes
  const isTrigger = triggerNames.has(n.name);
  if (!isTrigger && !hasIncoming.has(n.name)) { console.error('NO INCOMING CONNECTION:', n.name); isolated++; }
  if (!hasOutgoing.has(n.name) && n.type !== 'n8n-nodes-base.telegram') {
    // terminal Code nodes (Finalize Run, Reply chain ends via loop-back) are expected to have no outgoing in a few cases; only warn for Code/IF nodes that aren't documented terminals.
  }
}

let connectionCount = 0;
for (const c of Object.values(connections)) for (const arr of c.main) connectionCount += arr.length;

console.log('Nodes:', nodes.length);
console.log('Connections:', connectionCount);
console.log('Dangling refs:', danglingRefs);
console.log('Nodes with no incoming (excluding triggers):', isolated);
console.log('Written to', outPath);

if (danglingRefs > 0 || isolated > 0) process.exit(1);
