// 用量計量 — proxy 的記帳那一半。
//
// 為什麼不是單純數傳輸量: 成本結構是不對稱的。output 大約是 input 的 5 倍價,
// 而命中快取的 input 只有 1/10。用 bytes 計的話:
//  - 命中快取的請求 body 很大但幾乎不花錢 → 被重罰。而 turn-context.js 那整套
//    (system prompt 是快取前綴、每輪變的東西放尾端) 就是為了保住快取 ——
//    等於用計費機制懲罰自己的優化
//  - body 小但吐滿 output 的請求 → 被低估
//  - SSE 每個 token 包在自己的 `data: {...}\n\n` 信封裡, 膨脹好幾倍且比例浮動
//  - base64 的圖 bytes 極大, token 成本卻只有約 w×h/750
//
// 所以: 有 usage 的 provider 就讀 usage, 沒有的才退回 bytes。額度單位是我們
// 自己的 (credit), 不必等於任何 provider 的 token —— 但要與真實成本同向。
//
// 一個 provider 要能被計量, 給三個東西:
//   tune:  各類 token 的權重 (以 input = 1 為基準)
//   read:  從非串流的 response body 取出 usage
//   scan:  從一個 SSE 事件取出 usage 片段 (串流是分兩次給的)

// input = 1 為基準。output 5 倍、cache 讀取 1/10 是目前兩家共通的量級;
// 真正的定價各家各 model 不同, 要精算就在應用層用 record.usage 自己換算 ——
// 這裡要的是一個穩定、與成本同向的內部單位。
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

// bytes fallback: 沒有 usage 的 provider。粗估 4 bytes = 1 token, 回傳的
// SSE 再除以信封膨脹。**這是下界不是實數** —— 只用來擋失控, 不適合拿來計費。
const BYTES_PER_TOKEN = 4;
const SSE_OVERHEAD = 6;

function fromBytes(reqBytes, resBytes) {
  return {
    input: Math.round(reqBytes / BYTES_PER_TOKEN),
    output: Math.round(resBytes / BYTES_PER_TOKEN / SSE_OVERHEAD),
    estimated: true
  };
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
    read: function(j) { return METERS.openai.scan(j); }
  }
};

// 收集一次呼叫的用量。串流時 usage 分散在多個事件, 所以是累加的。
function createMeter(name, tune) {
  const m = METERS[name] || null;
  const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
  let got = false;
  let reqBytes = 0;
  let resBytes = 0;

  function add(part) {
    if(!part) { return; }
    got = true;
    for(const k of Object.keys(usage)) { usage[k] += part[k] || 0; }
  }

  return {
    supported: !!m,
    request: function(body) { reqBytes = Buffer.byteLength(JSON.stringify(body || {})); },
    // SSE 的一個 data: 行。**丟例外會被吞掉** —— 記帳絕不能影響串流。
    event: function(text) {
      if(!m || !text || text === '[DONE]') { return; }
      resBytes += text.length;
      try { add(m.scan(JSON.parse(text))); } catch(e) { /* 不是 json 或形狀變了: 略過 */ }
    },
    // 非串流的完整 body
    body: function(text) {
      resBytes += text.length;
      if(!m) { return; }
      try { add(m.read(JSON.parse(text))); } catch(e) { /* 同上 */ }
    },
    chunk: function(n) { resBytes += n; },
    result: function() {
      // 有 usage 就用 usage; 沒有 (或 provider 沒回) 才退回 bytes 估算
      const u = got ? usage : fromBytes(reqBytes, resBytes);
      return {
        usage: u,
        credits: credits(u, tune),
        bytes: {request: reqBytes, response: resBytes},
        estimated: !got
      };
    }
  };
}

module.exports = {createMeter, credits, TUNE, meters: METERS};
