const {Readable} = require('stream');

// LLM proxy: 前端跑 agent loop 時, 唯一需要的後端能力 — 注入 key 後轉發, SSE 原樣 pipe。
// 不解析、不執行 body 內容; 只做 model 白名單與 rate limit。
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
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const limiter = makeLimiter(opt.rate || {});

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
        if(!r.body) { return res.end(); }
        res.set('Cache-Control', 'no-cache');
        Readable.fromWeb(r.body).pipe(res);
      })
      .catch(function(e) {
        log('llm', `!! ${name} ${String((e && e.message) || e)}`);
        res.status(502).json({error: String((e && e.message) || e)});
      });
  };
};

module.exports.providers = PROVIDERS;
