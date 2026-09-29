// 03 · Build Telegram Message
const ENV = {};
for (const k of CL_ENV_KEYS) { try { ENV[k] = $env[k]; } catch (e) { /* env access blocked */ } }
const cfg = getCfg(ENV);
return $input.all().map(i => ({ json: { ...i.json, text: buildMessage(i.json.pick, cfg, Date.now()) } }));
