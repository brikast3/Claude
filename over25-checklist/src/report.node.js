// 41 · Build Daily Report — previous local day, plus all-time totals.
const ENV = {};
for (const k of CL_ENV_KEYS) { try { ENV[k] = $env[k]; } catch (e) { /* env access blocked */ } }
const cfg = getCfg(ENV);
const st = initState($getWorkflowStaticData('global'));
const text = buildDailyReport(st.history, Date.now(), cfg.tz);
if (!text) return [];
return [{ json: { report_text: text, chat_id: cfg.chatId } }];
