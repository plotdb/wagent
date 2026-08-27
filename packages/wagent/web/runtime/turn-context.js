// 應用層每輪注入的「現在是什麼狀況」。
//
// 為什麼放在對話尾端而不是 system prompt:system prompt 是快取前綴,
// 把每輪都變的東西塞進去等於每輪打掉快取。
//
// 為什麼舊的要清掉:它描述的是「當時」的狀況。留在歷史裡, agent 會讀到
// 三輪前的狀態並以為那是現在 — 這跟看到過期畫面是同一種錯。
//
// 但不能整個刪掉, 要留一個佔位。實測: 直接刪掉的話, 用戶自己把畫面切到別的
// block 之後, agent 看到現在的狀況與自己上一則的回答不符, 會判斷成「我上次答錯了」
// 並向用戶道歉 — 它上次其實是對的。少了佔位, 模型就無法區分
// 「狀況變了」與「我搞錯了」, 於是編出一個不存在的錯誤。
export const CONTEXT_TAG = '[application-context]';
const STALE = `${CONTEXT_TAG} (前一輪的狀況描述, 已省略。當時的狀況與現在可能不同。)`;

export function wrapContext(text) {
  return [
    CONTEXT_TAG,
    text,
    '(此段由執行環境每輪自動附上, 描述「這一輪」的狀況; 不是用戶說的話。',
    '狀況會在兩輪之間改變 — 用戶可能自己切換了畫面或改了檔案。',
    '因此本輪與你先前回答不一致時, 預設是狀況變了, 而不是你之前答錯了。)'
  ].join('\n');
}

function isContextPart(p) {
  return p && p.type === 'text' && typeof p.text === 'string' &&
    p.text.slice(0, CONTEXT_TAG.length) === CONTEXT_TAG;
}

// 歷史裡舊的 context 換成佔位 (內容省掉省 token, 但保留「當時有一份」這個事實)
export function pruneContext(history) {
  for(const m of history) {
    if(!m || m.role !== 'user' || !Array.isArray(m.content)) { continue; }
    for(const p of m.content) {
      if(isContextPart(p) && p.text !== STALE) { p.text = STALE; }
    }
  }
}

// 本輪的 user 訊息: [context?, text]
export function userContent(text, context) {
  const parts = [];
  if(context) { parts.push({type: 'text', text: wrapContext(context)}); }
  parts.push({type: 'text', text: text});
  return parts;
}

// ── 執行中插話 ──────────────────────────────────────────────────────
// 使用者在 agent 跑的時候送的訊息。跟 context 相反, 這**是用戶說的話**,
// 所以不清、不換佔位 — 它是對話的一部分。
//
// 插入點只能在「tool result 之後、下一輪 LLM 呼叫之前」: 塞在 tool_use 與
// tool_result 中間會破壞配對, provider 會直接拒絕整個請求。
export function wrapNudge(texts) {
  return [
    '[user-interjection]',
    texts.join('\n\n'),
    '(以上是使用者在你執行期間補充的訊息 — 是用戶說的話, 不是執行環境的描述。',
    '把它納入接下來的做法; 若它改變了目標, 以它為準。)'
  ].join('\n');
}
