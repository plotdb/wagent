const path = require('path');
const express = require('express');
const wsenv = require('./wsenv');
const makeLLM = require('./llm');
const prompt = require('./prompt');

// stream 等級: none (單次 JSON) < tool (SSE 推送 tool 事件) < token (SSE 再加文字逐段)
const LEVELS = {none: 0, tool: 1, token: 2};
function levelOf(v, fallback) {
  return LEVELS[v] != null ? v : fallback;
}

// @plotdb/agent 模組入口: 回傳 express Router, 由 host 決定掛載路徑。
//   app.use('/api/agent', require('@plotdb/agent')({workspace: 'workspace'}))
// 前端 block (chat / sandbox) 由 router 的 /block/* 提供。
// opt.workspace: workspace 目錄 (必填); opt.purpose: 領域 prompt (預設 dataviz);
// opt.log: logger function(tag, msg); opt.providers: 覆寫 llm provider 清單;
// opt.stream: 後端允許的最高 stream 等級 'none' | 'tool' | 'token' (預設 'token')
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const env = wsenv({root: opt.workspace, log: log});
  const llm = makeLLM({providers: opt.providers});
  const purpose = opt.purpose || prompt.DATAVIZ;
  const allowed = levelOf(opt.stream, 'token');
  const router = express.Router();

  // 進行中 request 的 tool 事件 hook (key: session key); runTool 執行時即時回報
  const hooks = {};

  function makeOpt(key, block) {
    return () => ({
      system: prompt.compose(purpose, block),
      tools: env.tools,
      runTool: (name, input) => {
        let error = false;
        try {
          return env.runTool(name, input);
        } catch(e) {
          error = true;
          throw e;
        } finally {
          if(hooks[key]) { hooks[key]({tool: name, input: input, error: error}); }
        }
      }
    });
  }

  // 前端資產: block (chat / sandbox) 與 runtime (browser agent worker)
  router.use('/block', express.static(path.join(__dirname, '..', 'web', 'block')));
  router.use('/runtime', express.static(path.join(__dirname, '..', 'web', 'runtime')));

  // browser 端 agent loop 用的 llm proxy (後端唯一暴露面)
  router.post('/llm/:provider', require('./proxy')({log: log, models: opt.models, rate: opt.rate}));

  router.get('/provider', (req, res) => {
    res.json(Object.assign({stream: allowed}, llm.info()));
  });

  router.get('/blocks', (req, res) => {
    res.json(env.listBlocks());
  });

  // browser runtime 取 system prompt (prompt 邏輯只留一份, 在後端)
  router.get('/prompt', (req, res) => {
    res.json({system: prompt.compose(purpose, req.query.block || null, req.query.mode || 'browser')});
  });

  router.post('/reset', (req, res) => {
    llm.reset((req.body || {}).session);
    res.json({ok: true});
  });

  router.post('/chat', (req, res) => {
    const body = req.body || {};
    const text = body.message;
    if(!text) { return res.status(400).json({error: 'message required'}); }
    const key = body.session || body.block || 'default';
    const want = levelOf(body.stream, 'none');
    const mode = LEVELS[want] <= LEVELS[allowed] ? want : allowed;
    log('chat', `<- [${key}]${body.block ? ` (block: ${body.block})` : ''}${mode !== 'none' ? ` (stream: ${mode})` : ''} ${text.length > 80 ? text.slice(0, 80) + '…' : text}`);
    const started = Date.now();

    const finishLog = (r) => {
      log('chat', `-> [${key}] ${((Date.now() - started) / 1000).toFixed(1)}s, ${(r.events || []).length} tool calls, reply ${(r.reply || '').length} chars`);
    };
    const failLog = (e) => {
      log('chat', `!! [${key}] ${String((e && e.message) || e)}`);
      console.error(e);
    };

    if(mode === 'none') {
      return Promise.resolve()
        .then(() => llm.getSession(key, makeOpt(key, body.block || null)).send(text))
        .then((r) => {
          finishLog(r);
          res.json({reply: r.reply, events: r.events});
        })
        .catch((e) => {
          failLog(e);
          res.status(500).json({error: String((e && e.message) || e)});
        });
    }

    // SSE: data: {type: 'tool' | 'delta' | 'done' | 'error', ...}
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const push = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    hooks[key] = (ev) => push(Object.assign({type: 'tool'}, ev));
    const cb = mode === 'token' ? {onDelta: (t) => push({type: 'delta', text: t})} : null;
    Promise.resolve()
      .then(() => llm.getSession(key, makeOpt(key, body.block || null)).send(text, cb))
      .then((r) => {
        finishLog(r);
        push({type: 'done', reply: r.reply, events: r.events});
      })
      .catch((e) => {
        failLog(e);
        push({type: 'error', error: String((e && e.message) || e)});
      })
      .then(() => {
        delete hooks[key];
        res.end();
      });
  });

  return router;
};

module.exports.prompt = prompt;
