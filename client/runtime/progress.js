// 單次 LLM 呼叫的進度回報 —— 給前端顯示「正在做什麼、輸出多少、經過多久」。
//
// 為什麼要有: 一次輸出上萬 token ( 例如整份 HTML 寫在 tool 參數裡 ) 要好幾分鐘,
// 這段期間沒有 text_delta, 畫面只剩「執行中」, 使用者分不出是在寫還是卡住。
// provider 本來就逐段解析 SSE, 這裡只是把那些事件摘要成一份狀態往外送。
//
// 進度**不是**對話的一部分: 不寫進歷史, 也不影響 provider 的行為。
// 回報失敗 (listener 丟例外) 一律吞掉, 不能讓顯示層的 bug 打斷 LLM 呼叫。
//
// 事件欄位 ( 每次 emit 都是一份完整的快照, 不是差量 ):
//   provider      'anthropic' | 'openai'
//   model         本次呼叫的模型
//   step          這一輪 ( 一次 send ) 裡的第幾次模型呼叫, 從 1 起算
//   phase         'waiting'  請求已送出、還沒收到第一段輸出
//                 'thinking' 正在輸出 thinking
//                 'text'     正在輸出文字回覆
//                 'tool'     正在產生工具參數
//                 'done'     本次呼叫結束 ( 之後可能是執行 tool, 再開下一次呼叫 )
//                 'error'    本次呼叫失敗 ( 附 error )
//   tool          phase 為 tool 時的工具名稱
//   target        tool 參數裡的 path / file 之類 ( 抓得到才有, 只看參數開頭幾百字元 )
//   outChars      本次呼叫目前累積的輸出字元數 ( text + thinking + tool 參數 )
//   outTokensEst  輸出 token 的**估計**值 ( 見 estimate )
//   outTokens     API 回報的實際 output tokens ( 只在 done, 且 API 有回才有 )
//   inTokens      送出量 ( token )。先用請求內容估, 收到 API 的 usage 後改成實際值
//   inEstimated   inTokens 是不是估計值
//   inDetail      實際值的拆分 {input, cacheRead, cacheWrite}; inTokens = 三者合計
//                 ( anthropic 的 input_tokens 不含快取, 所以要加回去才是「送出量」 )
//   usage         done 時附上 {input, output, cacheRead, cacheWrite} ( API 有回的才有值 )
//   stopReason    done 時附上 ( anthropic stop_reason / openai finish_reason )
//   error         phase 為 error 時的訊息
//   startedAt     本次呼叫開始的時間 ( ms, Date.now )
//   at            這份快照的時間 ( ms )

// 估 token: ASCII 約 4 字元 / token, 其他 ( CJK 等 ) 約 1 字元 / token。
// 只是估計 —— 程式碼、JSON 跳脫字元、罕用字都會讓它偏差, 實際值以 done 的 outTokens 為準。
export function countChars(s) {
  let ascii = 0, other = 0;
  for(let i = 0; i < s.length; i++) {
    if(s.charCodeAt(i) < 128) { ascii++; } else { other++; }
  }
  return {ascii: ascii, other: other};
}
export function estimate(ascii, other) {
  return Math.round(ascii / 4 + other);
}

// 請求的送出量估計。base64 的圖不能照字元算 ( 一張幾百 KB 的 base64 實際約 1~2k token ),
// 所以先挖掉長串 base64、每張以 IMAGE_TOKENS 計。JSON 的 key 與引號也算進去了, 會稍微高估。
const IMAGE_TOKENS = 1600;
const BASE64 = /[A-Za-z0-9+/=]{2000,}/g;
export function estimateRequest(body) {
  let images = 0;
  const s = String(body || '').replace(BASE64, function() { images++; return ''; });
  const c = countChars(s);
  return estimate(c.ascii, c.other) + images * IMAGE_TOKENS;
}

// tool 參數裡的目標檔案。只在參數開頭 TARGET_SCAN 字元內找 ( 通常 path 會排在前面 ),
// 找到或超過範圍就不再找 —— 不要每個 delta 都重掃整段參數。
const TARGET_SCAN = 600;
const TARGET = /"(path|file|file_path|filename|filepath|target)"\s*:\s*"((?:[^"\\]|\\.){1,300})"/;

const NOOP = {
  begin: function() {}, phase: function() {}, out: function() {},
  input: function() {}, done: function() {}, fail: function() {}
};

// o: {emit, provider, model, step, request ( 請求 body 字串, 用來估送出量 ), interval, now}
// emit 沒給就回一個什麼都不做的物件, provider 不必到處判斷。
export function createProgress(o) {
  if(!o || typeof o.emit !== 'function') { return NOOP; }
  const now = o.now || Date.now;
  // 節流: delta 很密 ( 每秒數十則 ), 最多每 interval ms 送一次; phase / tool 改變時立即送。
  // 沒有 trailing timer —— 最後一份狀態會在下一則 delta 或 done 時送出, 前端的經過時間自己跑。
  const interval = o.interval > 0 ? o.interval : 250;
  const st = {
    provider: o.provider || null,
    model: o.model || null,
    step: o.step || 1,
    phase: 'waiting',
    outChars: 0,
    outTokensEst: 0,
    inTokens: estimateRequest(o.request),
    inEstimated: true,
    startedAt: now()
  };
  let ascii = 0, other = 0;
  let last = 0;
  let ended = false;
  let scan = '';   // 目前這個 tool 參數的開頭 ( 找 target 用 )

  function emit() {
    last = now();
    const ev = Object.assign({}, st, {at: last});
    try { o.emit(ev); } catch(e) { /* 顯示層的錯不能打斷呼叫 */ }
  }
  function maybe() {
    if(now() - last >= interval) { emit(); }
  }

  // 進入新的 content block。tool 參數是逐個 block 的, 每個 tool block 都重新找 target
  function phase(p, tool) {
    if(ended) { return; }
    const changed = p !== st.phase || p === 'tool';
    st.phase = p;
    if(p === 'tool') {
      st.tool = tool || null;
      delete st.target;
      scan = '';
    } else {
      delete st.tool;
      delete st.target;
    }
    if(changed) { emit(); }
  }

  return {
    begin: function() { emit(); },
    phase: phase,
    // 一段輸出。kind: 'text' | 'thinking' | 'tool'。只有 kind 與目前 phase 不同時才切換
    // ( openai 沒有 block 開始的事件, phase 由第一段 delta 決定 )
    out: function(text, kind, tool) {
      if(ended || !text) { return; }
      if(kind && (kind !== st.phase || (kind === 'tool' && tool && tool !== st.tool))) {
        phase(kind, tool);
      }
      const c = countChars(text);
      ascii += c.ascii; other += c.other;
      st.outChars += text.length;
      st.outTokensEst = estimate(ascii, other);
      let found = false;
      if(kind === 'tool' && !st.target && scan.length < TARGET_SCAN) {
        scan += text;
        const m = TARGET.exec(scan.slice(0, TARGET_SCAN + 300));
        if(m) {
          try { st.target = JSON.parse('"' + m[2] + '"'); } catch(e) { st.target = m[2]; }
          found = true;
        }
      }
      if(found) { emit(); } else { maybe(); }
    },
    // API 回報的送出量 ( anthropic message_start; openai 只在最後的 usage chunk )
    input: function(u) {
      if(ended || !u) { return; }
      const d = {input: u.input || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0};
      st.inTokens = d.input + d.cacheRead + d.cacheWrite;
      st.inDetail = d;
      st.inEstimated = false;
      emit();
    },
    // 本次呼叫結束。usage: {input, output, cacheRead, cacheWrite}, 缺的就是 API 沒回
    done: function(usage, stopReason) {
      if(ended) { return; }
      if(usage && (usage.input != null || usage.cacheRead != null || usage.cacheWrite != null)) {
        const d = {input: usage.input || 0, cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0};
        st.inTokens = d.input + d.cacheRead + d.cacheWrite;
        st.inDetail = d;
        st.inEstimated = false;
      }
      ended = true;
      st.phase = 'done';
      delete st.tool; delete st.target;
      if(usage && usage.output != null) { st.outTokens = usage.output; }
      st.usage = usage || null;
      st.stopReason = stopReason || null;
      emit();
    },
    fail: function(e) {
      if(ended) { return; }
      ended = true;
      st.phase = 'error';
      delete st.tool; delete st.target;
      st.error = String((e && e.message) || e);
      emit();
    }
  };
}
