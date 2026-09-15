'use strict';
const fs = require('fs');
const path = require('path');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'out', 'SOCCER_RADAR_v6.26_QUALITY_FIRST_MULTI_MARKET_SELECTOR_FINAL.json'), 'utf8'));

// n8n Code nodes support top-level `await` (they run the pasted code inside an
// implicit async function), so validate with AsyncFunction, not plain Function.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let ok = 0, fail = 0;
for (const n of wf.nodes) {
  if (n.type !== 'n8n-nodes-base.code') continue;
  try {
    new AsyncFunction('$input', '$env', '$getWorkflowStaticData', '$node', '$json', n.parameters.jsCode);
    ok++;
  } catch (e) {
    fail++;
    console.error('SYNTAX ERROR in', n.name, ':', e.message);
  }
}
console.log(`Code nodes syntax-checked: ${ok} ok, ${fail} failed (of ${wf.nodes.filter(n => n.type === 'n8n-nodes-base.code').length} total)`);
if (fail > 0) process.exit(1);
