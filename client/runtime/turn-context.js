// 應用層每輪注入的「現在是什麼狀況」。
//
// 為什麼放在對話尾端而不是 system prompt:system prompt 是快取前綴,
// 把每輪都變的東西塞進去等於每輪打掉快取。
//
// 舊的不清、不換佔位 —— 歷史只能**往後接** (append-only):
//  - 改到任何一則已送出的訊息, 從那裡之後的 prompt cache 全部失效 (每輪重付整份前綴)
//  - 現行 Claude 的 thinking 綁著整段對話前綴 (preserved thinking), 改了前面的訊息,
//    後面的 thinking block 全部作廢 —— 新帳號直接 400
// 0.3 以前是把舊的換成佔位 (圖也一樣只留最新一張)。應用層實測 opus 5.5 一次 22 步的執行:
// 未快取的 input 是快取讀取的將近 4 倍, 成本大半花在重送同一段前綴。
//
// 「只有最新一份是真的」改由文字表達: 每份都標明它描述的是**附上當時**的狀況,
// 以最後一份為準。舊的留著反而有好處 —— 模型看得到狀況怎麼變過來的, 更不會
// 把「狀況變了」誤判成「我上次答錯了」(0.3 以前靠佔位防的就是這個)。
export const CONTEXT_TAG = '[application-context]';

// ── 語言 ────────────────────────────────────────────────────────────
// 這個檔案的文字都是給模型看的執行環境說明。語言跟著掛載點 ( api 的 lang, 經 /prompt 回報 ) 或
// createRuntime({lang}); 不給就是 zh ( 0.7 以前唯一的語言, 文字一字不差 )。
// 各函式最後一個參數是 lang, 認不得的值退回 zh。標籤 ( [application-context] 之類 ) 兩種語言共用
const T = {
  zh: {
    context: [
      '(此段由執行環境每輪自動附上, 描述「附上當時」的狀況; 不是用戶說的話。',
      '對話中較早的 [application-context] 都是當時的狀況, 已被這一份取代 —— 以最新一份為準。',
      '狀況會在兩輪之間改變 — 用戶可能自己切換了畫面或改了檔案。',
      '因此本輪與你先前回答不一致時, 預設是狀況變了, 而不是你之前答錯了。)'
    ],
    nudge: [
      '(以上是使用者在你執行期間補充的訊息 — 是用戶說的話, 不是執行環境的描述。',
      '把它納入接下來的做法; 若它改變了目標, 以它為準。)'
    ],
    limit: function(used, max) {
      return [
        `本輪已用 ${used}/${max} 步 (一步 = 一次模型呼叫)。`,
        '請開始收尾: 把手上這件事做完就好, 不要再開新的探索或重構。',
        '接著直接回覆使用者 —— 說明你做了什麼、現在是什麼狀態、還差什麼。',
        `到 ${max} 步會由執行環境強制停止, 那時你就沒有機會交代了。`,
        '(此段由執行環境附上, 不是使用者說的話。)'
      ];
    },
    limitReply: function(max) {
      return `⚠ 已達本輪步數上限 (${max} 步), 執行環境已停止。\n\n` +
        '工作可能停在中途 —— 上方的 tool 記錄是實際做過的事。' +
        '要繼續請再說一次你要的結果 (會以目前的檔案狀態接下去)。';
    },
    truncated: [
      '你上一則回覆超過長度上限被截斷了, 因此**沒有被執行**。',
      '請把這件事拆小: 一次改一個地方, 或先只回覆計畫、下一步再動手。',
      '不要重複剛才那則的內容, 直接從拆小之後的第一步開始。',
      '(此段由執行環境附上, 不是使用者說的話。)'
    ],
    truncatedReply: '(回覆被截斷)',
    truncatedStop: function(n) { return '模型回應連續 ' + n + ' 次超過長度上限被截斷, 已停止。'; },
    interrupted: function(why) {
      return '[interrupted] 這一輪在這裡中斷了 ( ' + why + ' )。上面的步驟已經做完, 檔案的變更都還在。' +
        '使用者之後若要你繼續, 先確認目前檔案的狀態, 再從這裡接著做。';
    }
  },
  en: {
    context: [
      '(Attached automatically by the runtime every turn; it describes the state at the time it was attached. It is not something the user said.',
      'Earlier [application-context] blocks in this conversation describe the state at their own time and are superseded by this one — the latest one wins.',
      'The state can change between turns — the user may have switched views or edited files themselves.',
      'So if this turn disagrees with an earlier answer of yours, assume the state changed, not that you were wrong before.)'
    ],
    nudge: [
      '(The above was added by the user while you were working — it is something the user said, not a description from the runtime.',
      'Take it into account from here on; if it changes the goal, it takes precedence.)'
    ],
    limit: function(used, max) {
      return [
        `This turn has used ${used}/${max} steps (one step = one model call).`,
        'Start wrapping up: just finish what you are doing; do not start new exploration or refactoring.',
        'Then reply to the user directly — say what you did, what state things are in now, and what is still missing.',
        `At ${max} steps the runtime will stop you, and you will have no chance to explain.`,
        '(Attached by the runtime; not something the user said.)'
      ];
    },
    limitReply: function(max) {
      return `⚠ Reached the step limit for this turn (${max} steps); the runtime has stopped.\n\n` +
        'The work may have stopped midway — the tool log above is what was actually done. ' +
        'To continue, say again what result you want (it will pick up from the current state of the files).';
    },
    truncated: [
      'Your previous reply was cut off at the length limit, so it was **not executed**.',
      'Break the task down: change one thing at a time, or reply with just a plan first and act in the next step.',
      'Do not repeat the content of that reply; start directly with the first of the smaller steps.',
      '(Attached by the runtime; not something the user said.)'
    ],
    truncatedReply: '(reply truncated)',
    truncatedStop: function(n) { return 'The model response was cut off at the length limit ' + n + ' times in a row; stopped.'; },
    interrupted: function(why) {
      return '[interrupted] This turn was interrupted here ( ' + why + ' ). The steps above are done and the file changes are still in place. ' +
        'If the user later asks you to continue, check the current state of the files first, then carry on from here.';
    }
  }
};
export const LANGS = Object.keys(T);
export function strings(lang) { return T[lang] || T.zh; }

export function wrapContext(text, lang) {
  return [CONTEXT_TAG, text].concat(strings(lang).context).join('\n');
}

// 本輪的 user 訊息: [context?, text]
export function userContent(text, context, lang) {
  const parts = [];
  if(context) { parts.push({type: 'text', text: wrapContext(context, lang)}); }
  parts.push({type: 'text', text: text});
  return parts;
}

// ── 圖的上限 ────────────────────────────────────────────────────────
// 圖不再逐張換成佔位 (那是改歷史, 理由同上)。留著的圖每步都會重送, 但吃得到快取
// (讀取是 input 單價的 1/10 以下), 一張約 1~2k token, 十幾張的成本仍小於一次快取失效。
//
// 真正要擋的是無上限累積 (context 變大、品質下降)。所以設上限, 超過時**一次**重建:
// 只留最新 keep 張, 其餘換佔位 —— 等於從那裡開一段新的前綴, 快取失效一次, 之後又是
// append-only。anthropic 要同時丟掉所有 thinking block: 它們綁著舊前綴, 前綴改了
// 還送回去會被拒 (400)。丟光 thinking 是官方文件給的合法形狀; 代價是模型失去先前的推理。
export const IMAGE_OMITTED = '[earlier image omitted]';
export const MAX_IMAGES = 20;

function isImage(b) { return b && (b.type === 'image' || b.type === 'image_url'); }

// 依出現順序列出每張圖的位置 (含 anthropic tool_result 內層的)
function imageSlots(history) {
  const at = [];
  history.forEach(function(m, i) {
    if(!m || !Array.isArray(m.content)) { return; }
    m.content.forEach(function(b, j) {
      if(isImage(b)) { at.push([i, j, -1]); }
      else if(b && b.type === 'tool_result' && Array.isArray(b.content)) {
        b.content.forEach(function(x, k) { if(isImage(x)) { at.push([i, j, k]); } });
      }
    });
  });
  return at;
}

export function countImages(history) { return imageSlots(history).length; }

// 回傳**新的**歷史, 不動原本的物件 (舊陣列可能還被別人拿著, 例如測試、getHistory)。
// 訊息一對一保留 (index 不變), 只換掉圖與 drop 列的 block 型別。
export function compactHistory(history, opt) {
  opt = opt || {};
  const keep = opt.keep == null ? 1 : opt.keep;
  const drop = opt.drop || [];
  const slots = imageSlots(history);
  const omit = {};
  slots.slice(0, Math.max(0, slots.length - keep)).forEach(function(s) { omit[s.join(',')] = true; });
  const ph = {type: 'text', text: IMAGE_OMITTED};
  return history.map(function(m, i) {
    if(!m || !Array.isArray(m.content)) { return m; }
    let changed = false;
    let content = [];
    m.content.forEach(function(b, j) {
      if(drop.indexOf(b && b.type) >= 0) { changed = true; return; }
      if(omit[[i, j, -1].join(',')]) { changed = true; content.push(ph); return; }
      if(b && b.type === 'tool_result' && Array.isArray(b.content)) {
        const inner = b.content.map(function(x, k) { return omit[[i, j, k].join(',')] ? ph : x; });
        if(inner.some(function(x, k) { return x !== b.content[k]; })) {
          changed = true;
          content.push(Object.assign({}, b, {content: inner}));
          return;
        }
      }
      content.push(b);
    });
    if(!changed) { return m; }
    // 空的 assistant 訊息不合法 (只有 thinking 的那種, 丟掉之後就空了)
    if(!content.length) { content = [{type: 'text', text: '(empty)'}]; }
    return Object.assign({}, m, {content: content});
  });
}

// ── 執行中插話 ──────────────────────────────────────────────────────
// 使用者在 agent 跑的時候送的訊息。跟 context 不同, 這**是用戶說的話** —— 對話的一部分。
//
// 插入點只能在「tool result 之後、下一輪 LLM 呼叫之前」: 塞在 tool_use 與
// tool_result 中間會破壞配對, provider 會直接拒絕整個請求。
export function wrapNudge(texts, lang) {
  return ['[user-interjection]', texts.join('\n\n')].concat(strings(lang).nudge).join('\n');
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

export function wrapLimit(used, max, lang) {
  return [LIMIT_TAG].concat(strings(lang).limit(used, max)).join('\n');
}

// hard limit 到了: 不再呼叫模型, 直接回這則。deterministic —— 這時候再花一次
// 呼叫請模型總結, 正好是我們想擋的那件事。
export function limitReply(max, lang) {
  return strings(lang).limitReply(max);
}

// 回應撞到 max_tokens 被截斷。
//
// 為什麼是「請把工作拆小」而不是在 byte 層做續接: 續接要把截斷的那半當成
// assistant 訊息接回去再問一次, 整份 context 重送 (有快取會便宜, 但不是免費);
// 而 tool call 的 partial JSON 沒有乾淨的續接方式, 接錯就是把參數拼壞。
// loop 本來就是 agentic 的 —— 讓模型自己把大編輯拆成幾次, 穩健得多。
export function wrapTruncated(lang) {
  return [LIMIT_TAG].concat(strings(lang).truncated).join('\n');
}

// ── 一輪中途失敗 ───────────────────────────────────────────────────
// 一輪 ( 一次 send ) 裡模型會被呼叫好幾次。中途失敗時, 已經完成的步驟 ( 讀檔、寫檔 ) 不該
// 跟著消失: 檔案已經改了, 對話卻忘了為什麼改, 使用者說「繼續」時 agent 也接不上。
// 所以「可以重試」的錯誤保留到最後一個完整的步驟, 並補一則 assistant 說明中斷;
// 其他錯誤 ( 例如 400: 請求本身有問題 ) 照舊整輪退回 —— 保留壞掉的紀錄會讓之後每一輪都失敗。
//
// 可以重試: 額度 / 點數不足、限流、上游服務失敗、使用者中止、回應一直被截斷、
// 網路錯誤 ( 沒有 status ) 與 5xx
const RETAIN_IDS = [1004, 1024, 1047, 10001, 11001, 11005, 11012];
export function retainable(e) {
  if(!e) { return false; }
  if(e.name === 'lderror' && RETAIN_IDS.indexOf(+e.id) >= 0) { return true; }
  if(e.name === 'lderror') { return false; }
  if(e.status == null) { return true; }
  return e.status >= 500;
}
// 中斷說明 ( 補在保留下來的紀錄最後, 讓紀錄維持一來一往; 下一句話接在它後面 )
export function interruptedNote(e, lang) {
  const why = (e && e.message) ? String(e.message).slice(0, 200) : 'error';
  return strings(lang).interrupted(why);
}
