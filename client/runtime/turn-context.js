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

// ── 步數上限 ────────────────────────────────────────────────────────
// 一輪 = 一次 send, 但 tool_use 會讓它自己接下去, 沒有上限。實務上失控的
// 不是單次呼叫的大小 (max_tokens 擋住了), 是「改檔 → 重畫 → 看畫面 → 再改」
// 這種可以跑到天亮的迴圈。
//
// 兩段式: soft 只提醒 (模型還有 max - soft 步可以收尾), hard 才真的停。
// 只有 hard 的話, 使用者拿到的是一個做到一半、沒有交代的狀態 —— 而畫面上
// 是改到一半的 block, 他不會知道發生了什麼。
//
// **不能用 wrapNudge 包這個**: nudge 是「用戶說的話」, 這是執行環境的陳述。
// 混在一起模型會以為使用者在催他 —— 與 wrapContext 註解裡那個「誤以為自己
// 答錯而道歉」是同一類錯。
export const LIMIT_TAG = '[execution-limit]';

export function wrapLimit(used, max) {
  return [
    LIMIT_TAG,
    `本輪已用 ${used}/${max} 步 (一步 = 一次模型呼叫)。`,
    '請開始收尾: 把手上這件事做完就好, 不要再開新的探索或重構。',
    '接著直接回覆使用者 —— 說明你做了什麼、現在是什麼狀態、還差什麼。',
    `到 ${max} 步會由執行環境強制停止, 那時你就沒有機會交代了。`,
    '(此段由執行環境附上, 不是使用者說的話。)'
  ].join('\n');
}

// hard limit 到了: 不再呼叫模型, 直接回這則。deterministic —— 這時候再花一次
// 呼叫請模型總結, 正好是我們想擋的那件事。
export function limitReply(max) {
  return `⚠ 已達本輪步數上限 (${max} 步), 執行環境已停止。\n\n` +
    '工作可能停在中途 —— 上方的 tool 記錄是實際做過的事。' +
    '要繼續請再說一次你要的結果 (會以目前的檔案狀態接下去)。';
}

// 回應撞到 max_tokens 被截斷。
//
// 為什麼是「請把工作拆小」而不是在 byte 層做續接: 續接要把截斷的那半當成
// assistant 訊息接回去再問一次, 整份 context 重送 (有快取會便宜, 但不是免費);
// 而 tool call 的 partial JSON 沒有乾淨的續接方式, 接錯就是把參數拼壞。
// loop 本來就是 agentic 的 —— 讓模型自己把大編輯拆成幾次, 穩健得多。
export function wrapTruncated() {
  return [
    LIMIT_TAG,
    '你上一則回覆超過長度上限被截斷了, 因此**沒有被執行**。',
    '請把這件事拆小: 一次改一個地方, 或先只回覆計畫、下一步再動手。',
    '不要重複剛才那則的內容, 直接從拆小之後的第一步開始。',
    '(此段由執行環境附上, 不是使用者說的話。)'
  ].join('\n');
}
