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

// Regression guard: self-hosted n8n's task-runner sandbox defines `require`
// as a function that THROWS "Module 'X' is disallowed" rather than leaving it
// undefined. Any lib file that gates a require() call on `typeof require !==
// 'undefined'` alone (instead of also checking the target is not already
// defined) will crash in production even though it passes locally. Load the
// bundle under a require() that always throws to catch this class of bug.
const vm = require('vm');
const { bundleLib } = require('./bundle');
const src = bundleLib();
const fakeSandbox = { require: (m) => { throw new Error(`Module '${m}' is disallowed`); } };
vm.createContext(fakeSandbox);
try {
  vm.runInContext(src, fakeSandbox);
  console.log('Bundle loads cleanly under a throwing require() (matches self-hosted n8n sandbox behavior).');
} catch (e) {
  console.error('BUNDLE FAILS under a throwing require():', e.message);
  fail++;
}

if (fail > 0) process.exit(1);
