// Concatenates lib/*.js (dependency order) into one JS string that can be
// pasted verbatim into an n8n Code node. This guarantees the logic tested by
// tests/run-tests.js is byte-identical to the logic that runs in production.
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const ORDER = [
  'config.js', 'schedule.js', 'math.js', 'fixtureProfile.js', 'devig.js', 'calibration.js',
  'scoring.js', 'gate.js', 'selection.js', 'marketUniverse.js', 'priceLookup.js', 'bet365Parser.js',
  'engine.js', 'executionRecheck.js', 'settlement.js', 'rateLimiter.js', 'telegram.js', 'diagnostics.js'
];

function bundleLib(files = ORDER) {
  const parts = files.map(f => {
    const src = fs.readFileSync(path.join(LIB_DIR, f), 'utf8');
    return `// ==== lib/${f} ====\n${src}`;
  });
  return parts.join('\n\n');
}

module.exports = { bundleLib, ORDER };
