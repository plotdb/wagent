const express = require('express');
const wsenv = require('./wsenv');
const makeLLM = require('./llm');
const prompt = require('./prompt');
const defaultLog = require('../../lib/log');

// api 模組: 回傳 express Router, 由外部決定掛載路徑。
// opt.workspace: workspace 目錄; opt.purpose: 領域 prompt (預設 dataviz); opt.log: logger
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || defaultLog;
  const env = wsenv({root: opt.workspace, log: log});
  const llm = makeLLM({providers: opt.providers});
  const purpose = opt.purpose || prompt.DATAVIZ;
  const router = express.Router();

  router.get('/provider', (req, res) => {
    res.json(llm.info());
  });

  router.get('/blocks', (req, res) => {
    res.json(env.listBlocks());
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
    log('chat', `<- [${key}]${body.block ? ` (block: ${body.block})` : ''} ${text.length > 80 ? text.slice(0, 80) + '…' : text}`);
    const started = Date.now();
    Promise.resolve()
      .then(() => {
        const session = llm.getSession(key, () => ({
          system: prompt.compose(purpose, body.block || null),
          tools: env.tools,
          runTool: env.runTool
        }));
        return session.send(text);
      })
      .then((r) => {
        log('chat', `-> [${key}] ${((Date.now() - started) / 1000).toFixed(1)}s, ${(r.events || []).length} tool calls, reply ${(r.reply || '').length} chars`);
        res.json({reply: r.reply, events: r.events});
      })
      .catch((e) => {
        log('chat', `!! [${key}] ${String((e && e.message) || e)}`);
        console.error(e);
        res.status(500).json({error: String((e && e.message) || e)});
      });
  });

  return router;
};
