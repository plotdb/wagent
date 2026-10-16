const {Readable} = require('stream');
const {createMeter} = require('./meter');
const lderr = require('./lderr');

// LLM proxy: 前端跑 agent loop 時, 唯一需要的後端能力 — 注入 key 後轉發, SSE 原樣 pipe。
// 不解析、不執行 body 內容; 只做 model 白名單、rate limit 與**用量記帳**。
//
// 記帳為什麼在這裡: agent loop 跑在瀏覽器, 使用者改得動也可以直接打這個 endpoint。
// 前端的步數上限 (見 client/runtime/turn-context.js) 是 UX 護欄, 真正的執行點只能是
// 持有 key 的這一層。
//
// 「不解析內容」那條線仍然成立: 記帳只從固定的計量欄位撈數字, 不看訊息語意、
// 不碰 tool。而且是 tee 出去算的 —— pipe 永遠是權威, 解析失敗不影響串流。
const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    key: function() { return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN; },
    headers: function(key) {
      return {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      };
    },
    models: [
      'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-fable-5',
      'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
      'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'
    ]
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    key: function() { return process.env.OPENAI_API_KEY; },
    headers: function(key) {
      return {'content-type': 'application/json', authorization: `Bearer ${key}`};
    },
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1']
  }
};

// 回給前端、畫面上看得到的訊息 ( 依掛載點的 lang )
const MSG = {
  zh: {quota: '額度不足以完成這次請求', quotaStop: '額度用完, 這次回應在中途被停止'},
  en: {quota: 'Not enough quota to complete this request', quotaStop: 'Quota used up; this response was stopped midway'}
};

// 極簡 sliding window rate limit (per ip)
function makeLimiter(opt) {
  const max = opt.max || 60;
  const windowMs = opt.windowMs || 60000;
  const hits = {};
  return function(ip) {
    const now = Date.now();
    const list = (hits[ip] || []).filter(function(t) { return now - t < windowMs; });
    list.push(now);
    hits[ip] = list;
    return list.length <= max;
  };
}

// opt.models / opt.provider / opt.model: 這個掛載點可用的模型與預設值, 見 config()
// opt.rate:   {max, windowMs}
// opt.usage:  function(record) — 每次呼叫結束後的用量。**不給就完全不記帳**,
//             行為與先前一字不差 (同 sandbox 的 adapt / source / list 那條判準:
//             帳戶與額度是應用層的領域知識, wagent 不知道也不該替它決定)。
//             record: {provider, model, stream, status, billable, bytes, usage, cost, ms, req}
// opt.tune:   覆寫各類 token 的權重 (見 meter.js)
// opt.lang:   'zh' (預設) / 'en' —— 額度錯誤的 message 用哪個語言 ( 前端以 id 分辨, message 是給人看的 )
// opt.budget: function(req) -> 這次呼叫最多能花多少 (billable 單位), 或 null/
//             Infinity 表示不限。**串流中途累積超過就中止上游** —— 額度是應用
//             層的知識, wagent 只負責守。不給就不守 (行為與先前一字不差)。
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const limiter = makeLimiter(opt.rate || {});
  const onUsage = typeof opt.usage === 'function' ? opt.usage : null;
  const budgetOf = typeof opt.budget === 'function' ? opt.budget : null;
  const cfg = opt.config || config(opt);
  const msg = MSG[opt.lang] || MSG.zh;

  return function(req, res) {
    const name = req.params.provider;
    const p = PROVIDERS[name];
    if(!p || !cfg.enabled(name)) { return res.status(404).json({error: `unknown provider: ${name}`}); }
    const key = p.key();
    if(!key) { return res.status(503).json({error: `no api key for ${name}`}); }
    // 490 + lderror body: lderror 的 id 空間跟 HTTP 4xx/5xx 沒有一對一關係,
    // 硬要對應就會把好幾種不同的情況擠進同一個 code (見 servebase 的
    // backend/engine/error-handler.ls)。前端靠 id 分辨, 不比對訊息字串。
    if(!limiter(req.ip)) {
      return res.status(lderr.HTTP).json(lderr.body(lderr.ID.THROTTLED, 'rate limit exceeded'));
    }

    const body = req.body || {};
    // 沒帶 model 就填這個掛載點的預設 —— 先前是原樣轉發, 由上游回一個看不懂的 400
    if(!body.model) { body.model = cfg.model(name); }
    if(cfg.allow(name).indexOf(body.model) < 0) {
      return res.status(400).json({error: `model not allowed: ${body.model}`});
    }

    // openai 串流時預設不回 usage — 要明講。沒有這行, 走 openai 的呼叫就只剩
    // bytes 估算, 而估算與實數差一個量級。
    if(onUsage && name === 'openai' && body.stream) {
      body.stream_options = Object.assign({}, body.stream_options, {include_usage: true});
    }

    const meter = createMeter(name, opt.tune);
    // budget 要守就一定要有 request 的 byte 數, 不能只在 onUsage 時才算
    if(onUsage || budgetOf) { meter.request(body); }

    // 這次最多能花多少。null / Infinity = 不限。
    let budget = null;
    if(budgetOf) {
      try { budget = budgetOf(req); }
      catch(e) { log('llm', `!! budget hook: ${String((e && e.message) || e)}`); }
      if(budget != null && isFinite(budget) && meter.result().billable > budget) {
        // input 本身就超過 —— 連送都不用送。這是唯一還能用 HTTP status 的時機:
        // 一旦開始 pipe, status 就定下來了 (見下面 abort 的註解)。
        return res.status(lderr.HTTP).json(lderr.body(lderr.ID.QUOTA,
          msg.quota, {need: meter.result().billable, budget: budget}));
      }
    }
    const t0 = Date.now();
    // 一次呼叫只記一次帳: end / error / 中途斷線可能不只觸發一個
    let reported = false;
    let done = false;      // 串流已經正常收尾 —— close 就不必再 abort
    const report = function(status) {
      if(!onUsage || reported) { return; }
      reported = true;
      const r = meter.result();
      try {
        onUsage(Object.assign({
          provider: name, model: body.model || null, stream: !!body.stream,
          status: status, ms: Date.now() - t0, req: req
        }, r));
      } catch(e) { log('llm', `!! usage hook: ${String((e && e.message) || e)}`); }
    };
    // 使用者關分頁 / 按停止 / 換頁時是 **res 這端**關閉, 上游的 readable 不一定
    // 會 emit end 或 error —— 少了這條, 那次呼叫完全不記帳。crash 是意外而且
    // 有界, 這個是日常操作: 一旦有人發現「快結束時關掉分頁就免費」, 有界損失
    // 就變成系統性白嫖。
    //
    // 正常結束時 close 也會發, 但 end 先跑, reported 已經是 true —— 這裡是
    // no-op。status 0 表示「沒有完整走完」。
    res.on('close', function() { report(0); });

    log('llm', `-> ${name} ${body.model || '(default)'}${body.stream ? ' (stream)' : ''}`);
    const ac = new AbortController();
    // 使用者離開時也要放掉上游 —— 不然我們已經不看了, 它還在生成 (而且還在
    // 計費)。這與 report(0) 是兩件事: 一個是記帳, 一個是停止花錢。
    res.on('close', function() { if(!done) { ac.abort(); } });
    fetch(p.url, {
      method: 'POST',
      headers: p.headers(key),
      body: JSON.stringify(body),
      signal: ac.signal
    })
      .then(function(r) {
        res.status(r.status);
        const ct = r.headers.get('content-type');
        if(ct) { res.set('Content-Type', ct); }
        if(!r.body) { report(r.status); return res.end(); }
        res.set('Cache-Control', 'no-cache');
        const stream = Readable.fromWeb(r.body);
        const sse = (ct || '').indexOf('event-stream') >= 0;
        // tee: 只讀不改, 也不擋 —— pipe 照舊。記帳失敗最多是少一筆帳,
        // 絕不能變成使用者那端斷掉的串流。
        //
        // 超出 budget 時 over() 被呼叫: 中止上游, 並**往串流裡寫一則我們自己的
        // 錯誤**。不寫的話前端只會看到串流無故斷掉 —— 那是最難查的一種, 而且
        // 額度用完是我們的決定, 不是上游的事實。
        //
        // 為什麼不能用 HTTP status: 這時 200 早就送出去了。中途的失敗只能走
        // 帶內 (in-band), 這是串流協定的性質, 不是我們的選擇。
        const over = function(used) {
          if(done) { return; }
          done = true;
          log('llm', `!! ${name} 超出額度, 中止 (${used} / ${budget})`);
          // **順序有意義**: 先 unpipe 再 end。反過來的話, pipe 手上還沒寫完的
          // chunk 會在 res 結束之後才寫出去 —— ERR_STREAM_WRITE_AFTER_END,
          // 而且是 unhandled 'error', 整個 process 掛掉。
          try { stream.unpipe(res); } catch(e) { /* 已經斷了 */ }
          try { ac.abort(); } catch(e) { /* 已經結束了 */ }
          try { stream.destroy(); } catch(e) { /* 同上 */ }
          try {
            if(sse && !res.writableEnded) { res.write(errorEvent(used, budget, msg)); }
          } catch(e) { /* 對面已經走了 */ }
          report(0);
          try { if(!res.writableEnded) { res.end(); } } catch(e) { /* 同上 */ }
        };
        if(onUsage || budgetOf) { tee(stream, meter, ct, budget, over); }
        stream.on('end', function() { done = true; report(r.status); });
        // abort 之後 fetch 的 body 會 emit error —— 沒接的話是 unhandled。
        // 這不是失敗, 是我們自己叫停的, 所以只記帳不多做事。
        stream.on('error', function() { report(r.status); });
        res.on('error', function() { /* 對面斷線: close 那條已經處理了 */ });
        stream.pipe(res);
      })
      .catch(function(e) {
        log('llm', `!! ${name} ${String((e && e.message) || e)}`);
        report(502);
        res.status(502).json({error: String((e && e.message) || e)});
      });
  };
};

// 從轉發中的串流分一份出來記帳, 並在超出 budget 時呼叫 over()。
// 切事件的規則同 client/runtime/sse.js: 以空行分事件, 取 data: 那幾行。
// 非 SSE (非串流的 json) 就整包收起來 —— 那種情況沒有「中途」可言, 收到就是
// 全部, 所以不守 budget (該擋的在送出前就擋了)。
function tee(stream, meter, contentType, budget, over) {
  const sse = !!contentType && contentType.indexOf('event-stream') >= 0;
  const cap = (budget != null && isFinite(budget)) ? budget : null;
  let buf = '';
  let stopped = false;
  stream.on('data', function(chunk) {
    try {
      const text = chunk.toString('utf8');
      if(!sse) { buf += text; return; }
      buf += text;
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for(const part of parts) {
        const data = part.split('\n')
          .filter(function(l) { return l.slice(0, 5) === 'data:'; })
          .map(function(l) { return l.slice(5).trim(); })
          .join('\n');
        if(data) { meter.event(data); }
      }
      // 每個 chunk 檢查一次就夠 —— 這是純算術, 不碰 DB。超出的量最多是一個
      // chunk, 那是可接受的損失 (而且我們有定價權)。
      if(cap !== null && !stopped && meter.result().billable > cap) {
        stopped = true;
        over(meter.result().billable);
      }
    } catch(e) { /* 記帳絕不影響轉發 */ }
  });
  stream.on('end', function() {
    try { if(!sse && buf) { meter.body(buf); } } catch(e) { /* 同上 */ }
  });
}

// 注入串流的錯誤事件。**這是 proxy 唯一往串流裡寫自己的東西的地方。**
//
// 用 anthropic 的 error 事件形狀是因為前端 (client/runtime/sse.js + providers)
// 本來就認得它; 但 data 裡帶了 lderror 的 duck type, 所以前端分辨得出「這是
// wagent 說的」而不是上游的錯誤 —— 靠 id, 不靠訊息字串。
function errorEvent(used, budget, msg) {
  const payload = {
    type: 'error',
    error: lderr.body(lderr.ID.QUOTA, (msg || MSG.zh).quotaStop,
      {used: used, budget: budget, partial: true})
  };
  return `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
}

module.exports.providers = PROVIDERS;

// 目前會用哪個 provider / model。挑法與 proxy 的 key 查找一致 —
// 兩邊分開就會出現「畫面說 anthropic, 實際打 openai」這種分岔。
const DEFAULT_MODEL = {anthropic: 'claude-opus-4-8', openai: 'gpt-5'};
const ENV_MODEL = {anthropic: 'ANTHROPIC_MODEL', openai: 'OPENAI_MODEL'};

// 每個掛載點自己的模型設定。env 只是 fallback, 而且每次都現讀 (應用可能在掛載後才填 env)。
//   models:   {anthropic: [...], openai: [...]} 取代該 provider 的預設白名單;
//             false 或 [] = 這個掛載點不開放該 provider。要擴充就拿 module.exports.models 去 concat
//   provider: 預設 provider (其次 LLM_PROVIDER, 再其次第一個有 key 的)
//   model:    預設 model。字串 = 給預設 provider; {anthropic, openai} = 各自的預設
//             (其次 ANTHROPIC_MODEL / OPENAI_MODEL, 再其次 DEFAULT_MODEL)
// 預設 model 一律在白名單內: 那是管理者選的, 被自己的白名單擋掉 (先前 env 設新模型就是這樣全滅) 沒有意義。
function config(opt) {
  opt = opt || {};
  const models = opt.models || {};
  if(opt.provider && !PROVIDERS[opt.provider]) { throw new Error(`unknown provider: ${opt.provider}`); }
  Object.keys(models).forEach(function(n) {
    if(!PROVIDERS[n]) { throw new Error(`unknown provider in models: ${n}`); }
  });
  const names = Object.keys(PROVIDERS);
  const enabled = function(n) {
    return !!PROVIDERS[n] && models[n] !== false && !(Array.isArray(models[n]) && !models[n].length);
  };
  const list = function(n) { return Array.isArray(models[n]) ? models[n] : PROVIDERS[n].models; };
  // 字串 model 屬於哪個 provider: 有明講就是它, 否則看誰的白名單有, 再不然看名字
  const owner = typeof opt.model === 'string' ? (opt.provider || names.find(function(n) {
    return list(n).indexOf(opt.model) >= 0;
  }) || (/^claude-/.test(opt.model) ? 'anthropic' : 'openai')) : null;
  const model = function(n) {
    if(typeof opt.model === 'string' && n === owner) { return opt.model; }
    if(opt.model && typeof opt.model === 'object' && opt.model[n]) { return opt.model[n]; }
    return process.env[ENV_MODEL[n]] || DEFAULT_MODEL[n];
  };
  const allow = function(n) {
    if(!enabled(n)) { return []; }
    const l = list(n).slice();
    const m = model(n);
    if(m && l.indexOf(m) < 0) { l.unshift(m); }
    return l;
  };
  const available = function(n) { return enabled(n) && !!PROVIDERS[n].key(); };
  const info = function() {
    const want = opt.provider || process.env.LLM_PROVIDER;
    let name = null;
    if(want) {
      if(!PROVIDERS[want]) { throw new Error(`unknown LLM_PROVIDER: ${want}`); }
      name = available(want) ? want : null;
    } else {
      name = names.find(available) || null;
    }
    // 只列有 key 的: 前端的選單不該出現按了必失敗的選項
    const providers = {};
    names.filter(available).forEach(function(n) { providers[n] = {model: model(n), models: allow(n)}; });
    return {provider: name, model: name ? model(name) : null, providers: providers};
  };
  return {enabled: enabled, allow: allow, model: model, info: info};
}

module.exports.config = config;
module.exports.models = {};
Object.keys(PROVIDERS).forEach(function(n) { module.exports.models[n] = PROVIDERS[n].models.slice(); });
// 0.3.0 的介面: 只看 env 的那一份
module.exports.info = function() { return config({}).info(); };
