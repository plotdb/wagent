# Block Chart Agent

以對話生成圖表的前後端試作。用戶在網頁上與 LLM 對談，LLM 讀取 workspace 內的資料檔並生成採 `@plotdb/block` 概念的圖表 block，前端即時渲染；圖表以檔案形式持久化於 `workspace/blocks/`。

上位設計參考專案根目錄的 `note.md`（AI Agent Runtime Platform 設計草案）；本試作對應其 Phase 1 的簡化版：workspace 為唯一 source of truth、LLM 透過 tool（runtime commands 的雛形）操作 workspace。


## Quick Guide

 - 啟動：`PORT=3457 npm start`（`.env` 需設 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`）；`npm run log` 看後端 log
 - 主要頁面 `/refactor-0809-module/index.html`（chat + sandbox，經 `@plotdb/agent` 模組）；`?block=<name>` 進入編輯模式
 - 核心模組在 `packages/wagent/`（`@plotdb/wagent`，npm workspace）：api router、wsenv、llm adapter、chat / sandbox block
 - 前端源碼在 `web/src/pug/`，由 `@plotdb/srcbuild` 自動編譯至 `web/static/`；前端 lib 由 fedep 複製到 `web/static/assets/lib/`
 - 圖表與資料存於 `workspace/`（`blocks/<name>/index.html`、`data/`），為唯一 source of truth
 - 舊版：首頁 `/` 與 `/edit.html`（自製 js block 格式）、`/refactor-0809/`（模組化前），確認新版 ok 後移除


## 文件結構

 - `host.md` — **Host 定義**(mounts / shell / content ops / snapshot / tools)。目前的上位設計
 - `spec.md` — 舊的系統設計(尚未隨 browser runtime 與 host 化更新,以 `host.md` 為準)
 - `features.md` — 目前已實作的功能
 - `logs/` — 工作記錄
