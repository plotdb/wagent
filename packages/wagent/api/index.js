const path = require('path');
const express = require('express');
const prompt = require('./prompt');
const proxy = require('./proxy');

// @plotdb/wagent 模組入口: 回傳 express Router, 由 host 決定掛載路徑。
//
//   app.use('/api/agent', require('@plotdb/wagent')({purpose: '...'}))
//
// **後端只做三件事**: 轉發 LLM 請求 (注入 key)、給 system prompt、報告用哪個 provider。
// agent loop、workspace、tool 執行全部在瀏覽器 (見 web/runtime/agent-worker.js) —
// 所以這裡沒有 workspace 目錄, 也沒有任何 LLM SDK 相依。
//
// opt.purpose:   領域 prompt, 由應用層提供 (wagent 不內建領域;
//                不給就是一個純粹的 block 編輯環境)
// opt.log:       logger function(tag, msg)
// opt.models:    覆寫各 provider 的 model 白名單
// opt.rate:      proxy 的 rate limit {max, windowMs}
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const purpose = opt.purpose || '';
  const router = express.Router();

  // 前端資產: block (chat / sandbox) 與 runtime (browser agent worker)
  router.use('/block', express.static(path.join(__dirname, '..', 'web', 'block')));
  router.use('/runtime', express.static(path.join(__dirname, '..', 'web', 'runtime')));

  // browser 端 agent loop 用的 llm proxy — 後端唯一暴露的能力面
  router.post('/llm/:provider', proxy({log: log, models: opt.models, rate: opt.rate}));

  router.get('/provider', (req, res) => { res.json(proxy.info()); });

  // system prompt 只留一份, 在後端 (前端改不動, 也不必重複維護)
  router.get('/prompt', (req, res) => {
    res.json({system: prompt.compose(purpose, req.query.block || null)});
  });

  return router;
};

module.exports.prompt = prompt;
