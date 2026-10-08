const path = require('path');
const express = require('express');
const prompt = require('./prompt');
const proxy = require('./proxy');

// @plotdb/wagent 模組入口: 回傳 express Router, 由 host 決定掛載路徑。
//
//   app.use('/api/agent', require('@plotdb/wagent')({purpose: '...'}))
//
// **後端只做三件事**: 轉發 LLM 請求 (注入 key)、給 system prompt、報告用哪個 provider。
// agent loop、workspace、tool 執行全部在瀏覽器 (見 client/runtime/agent-worker.js) —
// 所以這裡沒有 workspace 目錄, 也沒有任何 LLM SDK 相依。
//
// opt.purpose:   領域 prompt, 由應用層提供 (wagent 不內建領域;
//                不給就是一個純粹的 block 編輯環境)
// opt.preset:    應用的形狀, 'block' (預設) 或 'plain' (不編輯 block 的應用)。
//                決定 system prompt 的基底與 snapshot tool 的樣子, 見 api/prompt.js
// opt.log:       logger function(tag, msg)
// opt.provider:  預設 provider ('anthropic' / 'openai'); 不給就看 env LLM_PROVIDER
// opt.model:     預設 model, 字串或 {anthropic, openai}; 不給就看 env ANTHROPIC_MODEL / OPENAI_MODEL
// opt.models:    各 provider 的 model 白名單 {anthropic: [...], openai: [...]} (取代預設;
//                false / [] = 不開放)。前端只能在這裡面切換。見 proxy.js 的 config()
// opt.rate:      proxy 的 rate limit {max, windowMs}
// opt.usage:     function(record) — 每次 LLM 呼叫的用量 (見 proxy.js / meter.js)。
//                不給就不記帳; 帳戶與額度是應用層的事, wagent 只負責把數字算出來。
// opt.budget:    function(req) -> 這次呼叫最多能花多少 (billable 單位)。
//                串流中途累積超過就中止上游。不給就不守。
// opt.tune:      覆寫計量權重
module.exports = function(opt) {
  opt = opt || {};
  const log = opt.log || function() {};
  const purpose = opt.purpose || '';
  const preset = prompt.preset(opt.preset);
  // 模型設定只在掛載點決定一次, proxy 的白名單與 /provider 的回報共用它
  const models = proxy.config(opt);
  const router = express.Router();

  // 前端資產: block (chat / sandbox) 與 runtime (browser agent worker)
  router.use('/block', express.static(path.join(__dirname, '..', 'client', 'block')));
  router.use('/runtime', express.static(path.join(__dirname, '..', 'client', 'runtime')));

  // browser 端 agent loop 用的 llm proxy — 後端唯一暴露的能力面
  router.post('/llm/:provider', proxy({
    log: log, config: models, rate: opt.rate,
    usage: opt.usage, budget: opt.budget, tune: opt.tune
  }));

  // {provider, model, providers: {<name>: {model, models}}} — 前端的模型選單由此而來
  router.get('/provider', (req, res) => { res.json(models.info()); });

  // system prompt 只留一份, 在後端 (前端改不動, 也不必重複維護)。
  // preset 一併回傳: worker 依它挑 snapshot tool 的定義 —— tool 定義在前端,
  // 但「這是哪一種應用」只在這裡決定一次, 兩邊才不會各說各話。
  router.get('/prompt', (req, res) => {
    res.json({system: prompt.compose(purpose, req.query.block || null, preset), preset: preset});
  });

  return router;
};

module.exports.prompt = prompt;
// 預設白名單, 要擴充時用: wagent({models: {anthropic: wagent.models.anthropic.concat([...])}})
module.exports.models = proxy.models;
