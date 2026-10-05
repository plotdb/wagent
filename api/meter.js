// 用量計量 — proxy 的記帳那一半。**兩個數字, 用途不同**:
//
//   billable  以 byte 計, 拿去扣款。任何情況都算得出來, 包含被切斷的呼叫
//   usage     provider 回的真實 token, telemetry —— 用來看毛利、看快取有沒有
//             在做事、之後調費率時有依據。正常結束才有
//
// 一個 provider 要能被計量, 給三個東西:
//   scan:  從一個 SSE 事件取出 usage 片段 (串流是分好幾次給的)
//   read:  從非串流的 response body 取出 usage
//   text:  從一個 SSE 事件取出「模型真的產出的內容」, 計價用

// 真實成本的權重 (以 input = 1 為基準)。**這條線只用於 telemetry**, 不是計價。
// output 5 倍、cache 讀取 1/10 是目前兩家共通的量級; 真正的定價各家各 model
// 不同, 要精算就在應用層用 record.usage 自己換算。
const TUNE = {input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25};

function credits(u, tune) {
  const t = tune || TUNE;
  return Math.round(
    (u.input || 0) * t.input +
    (u.output || 0) * t.output +
    (u.cacheRead || 0) * t.cacheRead +
    (u.cacheWrite || 0) * t.cacheWrite
  );
}

// ── 計價: byte, 不是 token ──────────────────────────────────────────
//
// 訂價權在我們, 不是 API 費用的抽傭制, 所以計價單位不必是 provider 的 token。
// 用 byte 的四個理由:
//
//  - **中途被切斷時, 那是我們唯一有的數字。** provider 的 usage 只在正常結束
//    時給 (openai 甚至只在最後一個 chunk), 而使用者關分頁是日常操作。
//  - 零相依、0.02ms。tokenizer 精確但 +76MB 常駐、載入 84ms, 而 Claude 3+
//    根本沒有公開 tokenizer (`@anthropic-ai/tokenizer` 是 Claude 2 世代)。
//  - provider 無關 —— 連沒有 usage 的 provider 都算得出來。
//  - 結構上 >= 成本: 快取只會讓真實成本更低, 而 byte 看不到快取。
//
// **不加安全係數。** 係數是為了蓋過某個真值而存在, 這裡 byte 就是單位本身,
// 沒有要蓋過的東西 —— ×1.1 只是把價格調高 10% 穿了工程的外衣。要調價就直接
// 調 RATE。(定費率時換算一次: 1 byte 約 1/4 個 token。)
//
// 已知的扭曲, 記在這裡以免日後有人以為它準: 實測一輪五次呼叫, byte 基準約
// 23000 而真實成本加權 10026 —— **2.3 倍**, 且倍率隨 turn 變長而升高 (前綴
// 一直重送, 但快取讓真實成本一直降)。所以 record 裡兩個數字都留著:
// billable 拿去扣款, usage 是 telemetry, 之後靠實際分佈調 RATE。
const RATE = {input: 1, output: 5};

// SSE 每個 token 包在自己的 `data: {...}` 信封裡, 所以回傳的 byte 數要扣掉
// 信封才是「模型真的產出的內容」。只算 delta 的內容, 不算整個串流。
function billable(inBytes, outBytes) {
  return Math.round(inBytes * RATE.input + outBytes * RATE.output);
}

const METERS = {
  anthropic: {
    // 串流分兩處: message_start 給 input (含 cache), message_delta 給 output
    scan: function(d) {
      if(d.type === 'message_start') {
        const u = (d.message && d.message.usage) || {};
        return {
          input: u.input_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          cacheWrite: u.cache_creation_input_tokens || 0
        };
      }
      if(d.type === 'message_delta' && d.usage) { return {output: d.usage.output_tokens || 0}; }
      return null;
    },
    // tool 參數 (input_json_delta) 一樣是模型產出的 token, 要算。
    // thinking 也算 —— 它是計費的 output, 只是使用者看不到。
    text: function(d) {
      if(d.type !== 'content_block_delta' || !d.delta) { return ''; }
      const x = d.delta;
      return x.text || x.thinking || x.partial_json || '';
    },
    read: function(j) {
      const u = j && j.usage;
      if(!u) { return null; }
      return {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0
      };
    }
  },
  openai: {
    // 串流時**預設不給 usage** — 要 stream_options.include_usage, 由 proxy 補上
    // (見 proxy.js 的 prepare)。給了才會在末尾多一個帶 usage 的 chunk。
    scan: function(d) {
      if(!d || !d.usage) { return null; }
      const c = d.usage.prompt_tokens_details || {};
      return {
        input: (d.usage.prompt_tokens || 0) - (c.cached_tokens || 0),
        output: d.usage.completion_tokens || 0,
        cacheRead: c.cached_tokens || 0
      };
    },
    read: function(j) { return METERS.openai.scan(j); },
    text: function(d) {
      const x = ((d.choices || [])[0] || {}).delta || {};
      let out = x.content || '';
      for(const tc of x.tool_calls || []) {
        out += (tc.function && tc.function.arguments) || '';
      }
      return out;
    }
  }
};

// 收集一次呼叫的用量。串流時 usage 分散在多個事件, 所以是累加的。
function createMeter(name, tune) {
  const m = METERS[name] || null;
  const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
  let got = false;
  let reqBytes = 0;
  let resBytes = 0;    // 整個串流 (含 SSE 信封), telemetry 用
  let contentBytes = 0;  // 模型真的產出的內容, 計價用

  function add(part) {
    if(!part) { return; }
    got = true;
    for(const k of Object.keys(usage)) { usage[k] += part[k] || 0; }
  }

  return {
    supported: !!m,
    request: function(body) { reqBytes = Buffer.byteLength(JSON.stringify(body || {}), 'utf8'); },
    // SSE 的一個 data: 行。**丟例外會被吞掉** —— 記帳絕不能影響串流。
    event: function(text) {
      if(!text || text === '[DONE]') { return; }
      resBytes += Buffer.byteLength(text, 'utf8');
      let d = null;
      try { d = JSON.parse(text); } catch(e) { return; }   // 不是 json: 只算 byte
      // 計價只算模型真的產出的內容, 不算 SSE 的信封與 metadata
      // 認得的 provider 只算內容; 不認得的就整包算 —— 保守, 會高估, 而高估
      // 的方向對我們是安全的 (寧可多收也不要漏守)。
      const part = m && m.text ? m.text(d) : text;
      contentBytes += Buffer.byteLength(part, 'utf8');
      if(!m) { return; }
      try { add(m.scan(d)); } catch(e) { /* 形狀變了: 略過, 但 byte 已經算到 */ }
    },
    // 非串流的完整 body
    body: function(text) {
      const n = Buffer.byteLength(text, 'utf8');
      resBytes += n;
      contentBytes += n;   // 非串流沒有信封可扣
      if(!m) { return; }
      try { add(m.read(JSON.parse(text))); } catch(e) { /* 同上 */ }
    },
    chunk: function(n) { resBytes += n; },
    result: function() {
      return {
        // 扣款用這個 —— 任何情況都算得出來, 包含被切斷的呼叫
        billable: billable(reqBytes, contentBytes),
        bytes: {request: reqBytes, response: resBytes, content: contentBytes},
        // telemetry: 真實成本。正常結束才有, 用來看毛利與快取有沒有在做事
        usage: got ? usage : null,
        cost: got ? credits(usage, tune) : null
      };
    }
  };
}

module.exports = {createMeter, credits, billable, TUNE, RATE, meters: METERS};
