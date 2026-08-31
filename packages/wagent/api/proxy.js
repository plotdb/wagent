const {Readable} = require('stream');
const {createMeter} = require('./meter');

// LLM proxy: 前端跑 agent loop 時, 唯一需要的後端能力 — 注入 key 後轉發, SSE 原樣 pipe。
// 不解析、不執行 body 內容; 只做 model 白名單、rate limit 與**用量記帳**。
//
// 記帳為什麼在這裡: agent loop 跑在瀏覽器, 使用者改得動也可以直接打這個 endpoint。
// 前端的步數上限 (見 web/runtime/turn-context.js) 是 UX 護欄, 真正的執行點只能是
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
    models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']
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

// opt.models: 覆寫白名單 {anthropic: [...], openai: [...]}; opt.rate: {max, windowMs}
// opt.usage:  function(record) — 每次呼叫結束後的用量。**不給就完全不記帳**,
//             行為與先前一字不差 (同 sandbox 的 adapt / source / list 那條判準:
//             帳戶與額度是應用層的領域知識, wagent 不知道也不該替它決定)。
//             record: {provider, model, stream, status, usage, credits, estimated, bytes, ms, req}
// opt.tune:   覆寫各類 token 的權重 (見 meter.js)
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const limiter = makeLimiter(opt.rate || {});
  const onUsage = typeof opt.usage === 'function' ? opt.usage : null;

  return function(req, res) {
    const name = req.params.provider;
    const p = PROVIDERS[name];
    if(!p) { return res.status(404).json({error: `unknown provider: ${name}`}); }
    const key = p.key();
    if(!key) { return res.status(503).json({error: `no api key for ${name}`}); }
    if(!limiter(req.ip)) { return res.status(429).json({error: 'rate limit exceeded'}); }

    const body = req.body || {};
    const allow = (opt.models || {})[name] || p.models;
    if(body.model && allow.indexOf(body.model) < 0) {
      return res.status(400).json({error: `model not allowed: ${body.model}`});
    }

    // openai 串流時預設不回 usage — 要明講。沒有這行, 走 openai 的呼叫就只剩
    // bytes 估算, 而估算與實數差一個量級。
    if(onUsage && name === 'openai' && body.stream) {
      body.stream_options = Object.assign({}, body.stream_options, {include_usage: true});
    }

    const meter = createMeter(name, opt.tune);
    if(onUsage) { meter.request(body); }
    const t0 = Date.now();
    // 一次呼叫只記一次帳: end / error / 中途斷線可能不只觸發一個
    let reported = false;
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

    log('llm', `-> ${name} ${body.model || '(default)'}${body.stream ? ' (stream)' : ''}`);
    fetch(p.url, {
      method: 'POST',
      headers: p.headers(key),
      body: JSON.stringify(body)
    })
      .then(function(r) {
        res.status(r.status);
        const ct = r.headers.get('content-type');
        if(ct) { res.set('Content-Type', ct); }
        if(!r.body) { report(r.status); return res.end(); }
        res.set('Cache-Control', 'no-cache');
        const stream = Readable.fromWeb(r.body);
        // tee: 只讀不改, 也不擋 —— pipe 照舊。記帳失敗最多是少一筆帳,
        // 絕不能變成使用者那端斷掉的串流。
        if(onUsage) { tee(stream, meter, r.headers.get('content-type')); }
        stream.on('end', function() { report(r.status); });
        stream.on('error', function() { report(r.status); });
        stream.pipe(res);
      })
      .catch(function(e) {
        log('llm', `!! ${name} ${String((e && e.message) || e)}`);
        report(502);
        res.status(502).json({error: String((e && e.message) || e)});
      });
  };
};

// 從轉發中的串流分一份出來記帳。切事件的規則同 web/runtime/sse.js:
// 以空行分事件, 取 data: 那幾行。非 SSE (非串流的 json) 就整包收起來。
function tee(stream, meter, contentType) {
  const sse = !!contentType && contentType.indexOf('event-stream') >= 0;
  let buf = '';
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
    } catch(e) { /* 記帳絕不影響轉發 */ }
  });
  stream.on('end', function() {
    try { if(!sse && buf) { meter.body(buf); } } catch(e) { /* 同上 */ }
  });
}

module.exports.providers = PROVIDERS;

// 目前會用哪個 provider / model。挑法與 proxy 的 key 查找一致 —
// 兩邊分開就會出現「畫面說 anthropic, 實際打 openai」這種分岔。
// LLM_PROVIDER 可指定; 否則取第一個有 key 的。
const DEFAULT_MODEL = {anthropic: 'claude-opus-4-8', openai: 'gpt-5'};
const ENV_MODEL = {anthropic: 'ANTHROPIC_MODEL', openai: 'OPENAI_MODEL'};

module.exports.info = function() {
  const want = process.env.LLM_PROVIDER;
  const names = Object.keys(PROVIDERS);
  let name = null;
  if(want) {
    if(!PROVIDERS[want]) { throw new Error(`unknown LLM_PROVIDER: ${want}`); }
    name = PROVIDERS[want].key() ? want : null;
  } else {
    name = names.find(function(n) { return !!PROVIDERS[n].key(); }) || null;
  }
  return {
    provider: name,
    model: name ? (process.env[ENV_MODEL[name]] || DEFAULT_MODEL[name]) : null
  };
};
