// 05 · Save Open Pick — remembers the Telegram message id so settlement can reply to it.
const st = initState($getWorkflowStaticData('global'));
const prior = $('03 · Build Telegram Message').all();
return $input.all().map((it, idx) => {
  const p = prior[idx] && prior[idx].json;
  const msgId = Number(it.json.message_id ?? (it.json.result && it.json.result.message_id) ?? 0);
  if (!p || !p.pick) throw new Error('OVER25_CHECKLIST: липсва pick за Telegram отговор #' + idx);
  if (!Number.isFinite(msgId) || msgId <= 0) throw new Error('OVER25_CHECKLIST: Telegram не върна message_id');
  st.open[p.pick.fixture_id] = { ...p.pick, telegram_message_id: msgId, chat_id: p.chat_id, published_at: new Date().toISOString() };
  return { json: { saved: true, fixture_id: p.pick.fixture_id, telegram_message_id: msgId } };
});
