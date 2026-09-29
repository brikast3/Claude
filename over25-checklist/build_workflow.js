#!/usr/bin/env node
// Builds OVER25_CHECKLIST_AUTOMATION_v1.0.json (importable into n8n) from src/*.js.
// The shared logic in src/lib.js is inlined into every Code node, so what runs in n8n
// is exactly what tests/ exercises.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'OVER25_CHECKLIST_AUTOMATION_v1.0.json');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const lib = read('lib.js').replace(/\/\* EXPORTS-START \*\/[\s\S]*?\/\* EXPORTS-END \*\/\n?/, '');
const code = f => `// ===== shared logic (src/lib.js) =====\n${lib}\n// ===== ${f} =====\n${read(f)}`;

const uuid = name => {
  const h = crypto.createHash('sha1').update('over25-checklist:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const TG = { telegramApi: { id: 'HRAZxfaNbMK1280u', name: 'Telegram account' } }; // same credential as the Fusion Engine
const nodes = [];
const add = (name, type, typeVersion, parameters, position, extra = {}) =>
  nodes.push({ parameters, id: uuid(name), name, type, typeVersion, position, ...extra });
const cron = (name, expression, position) => add(name, 'n8n-nodes-base.scheduleTrigger', 1.2,
  { rule: { interval: [{ field: 'cronExpression', expression }] } }, position);
const codeNode = (name, file, position) => add(name, 'n8n-nodes-base.code', 2, { jsCode: code(file) }, position);
const ifTrue = (name, expr, position) => add(name, 'n8n-nodes-base.if', 2, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ id: uuid(name + ':cond'), leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  }, options: {},
}, position);

const N = {
  manual: 'T · Manual test (dry)', sched: '00 · Schedule every 10m', analyze: '01 · Discover + Checklist',
  ifPub: '02 · IF Pick Published?', msg: '03 · Build Telegram Message', tg: '04 · Telegram Publish',
  save: '05 · Save Open Pick', settleSched: '30 · Settlement every 15m · offset 07', settle: '31 · Settle Open Picks',
  ifReply: '32 · IF Reply?', reply: '33 · Telegram Reply WON / LOSS', dailySched: '40 · Daily Report 06:35',
  daily: '41 · Build Daily Report', dailyTg: '42 · Telegram Daily Report',
};

add('NOTE · OVER 2.5 CHECKLIST', 'n8n-nodes-base.stickyNote', 1, {
  height: 420, width: 620,
  content: [
    '## OVER 2.5 · 10-БАЛЕН ЧЕК-ЛИСТ · v1.0',
    'Автоматизира 10-точковия чек-лист за Над 2.5 гола (Bet365, доставчик 5dollar).',
    '',
    '**Автоматично:** 1 проходимост ТБ2.5 · 2 среден тотал · 4 атака домакин · 5 атака гост · 6 дупки в защитата · 7 BTTS · 10 value.',
    '**Ръчно (🔎 в съобщението):** 3 xG · 8 състави/контузии · 9 мотивация — доставчикът няма тези данни.',
    'Правило: ≥80% от проверимите точки (при 7 → 6/7; при 10 → 8/10) + задължителен value.',
    '',
    '**БЕЗОПАСНО ПО ПОДРАЗБИРАНЕ:** нищо не се праща в Telegram, докато не зададеш env `SR_CL_PUBLISH=true`.',
    'Нужен env: `SR626_PROVIDER_API_KEY` (същият като във Fusion Engine). Останалите `SR_CL_*` са по избор — виж README.',
    'Състоянието (отворени залози, история) е в static data на workflow-а; работи само при АКТИВЕН workflow.',
  ].join('\n'),
}, [-1000, 1000]);

add(N.manual, 'n8n-nodes-base.manualTrigger', 1, {}, [-1000, 1460]);
cron(N.sched, '*/10 * * * *', [-1000, 1620]);
codeNode(N.analyze, 'analyze.node.js', [-720, 1540]);
ifTrue(N.ifPub, '={{ $json.publish }}', [-440, 1540]);
codeNode(N.msg, 'message.node.js', [-180, 1460]);
add(N.tg, 'n8n-nodes-base.telegram', 1.2, {
  chatId: '={{ $json.chat_id }}', text: '={{ $json.text }}',
  additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' },
}, [80, 1460], { webhookId: uuid(N.tg + ':wh'), credentials: TG });
codeNode(N.save, 'save.node.js', [340, 1460]);

cron(N.settleSched, '7,22,37,52 * * * *', [-1000, 1900]);
codeNode(N.settle, 'settle.node.js', [-720, 1900]);
ifTrue(N.ifReply, '={{ $json.reply }}', [-440, 1900]);
add(N.reply, 'n8n-nodes-base.telegram', 1.2, {
  chatId: '={{ $json.chat_id }}', text: '={{ $json.reply_text }}',
  additionalFields: { appendAttribution: false, disable_web_page_preview: true, reply_to_message_id: '={{ $json.telegram_message_id }}' },
}, [-180, 1900], { webhookId: uuid(N.reply + ':wh'), credentials: TG });

cron(N.dailySched, '35 6 * * *', [-1000, 2200]);
codeNode(N.daily, 'report.node.js', [-720, 2200]);
add(N.dailyTg, 'n8n-nodes-base.telegram', 1.2, {
  chatId: '={{ $json.chat_id }}', text: '={{ $json.report_text }}',
  additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' },
}, [-440, 2200], { webhookId: uuid(N.dailyTg + ':wh'), credentials: TG });

const edges = [
  [N.manual, N.analyze, 0], [N.sched, N.analyze, 0], [N.analyze, N.ifPub, 0],
  [N.ifPub, N.msg, 0], [N.msg, N.tg, 0], [N.tg, N.save, 0],
  [N.settleSched, N.settle, 0], [N.settle, N.ifReply, 0], [N.ifReply, N.reply, 0],
  [N.dailySched, N.daily, 0], [N.daily, N.dailyTg, 0],
];
const connections = {};
for (const [a, b, o] of edges) {
  connections[a] = connections[a] || { main: [] };
  while (connections[a].main.length <= o) connections[a].main.push([]);
  connections[a].main[o].push({ node: b, type: 'main', index: 0 });
}

const wf = {
  name: 'OVER 2.5 · 10-POINT CHECKLIST · v1.0',
  nodes, pinData: {}, connections, active: false,
  settings: { executionOrder: 'v1', binaryMode: 'separate' },
  versionId: uuid('version'), meta: {}, id: uuid('workflow').slice(0, 16), tags: [],
};
fs.writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${nodes.length} nodes)`);
