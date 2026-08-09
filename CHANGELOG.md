# Change Logs

## v0.1.0

 - init release: 對話生成圖表 block 的試作 (note.md Agent Runtime 構想的 Phase 1 簡化版)
 - `@plotdb/agent` 模組 (packages/agent, npm workspace):
   - api router (chat tool loop / blocks / provider / reset), wsenv (workspace fs), llm provider adapter (anthropic / openai)
   - chat / sandbox 前端 block (@plotdb/block 格式, base 邏輯層 + derived 視覺層)
   - streaming 三等級 (none / tool / token, SSE), 後端允許上限 + 前端期望協商
   - 渲染錯誤自動修正 (safe guard: 只修 LLM 剛寫的 block、次數上限、成功或手動發話歸零)
 - workspace 為唯一 source of truth: blocks/<name>/index.html + data/
 - 前端 lib 以 fedep 管理 (assets/lib/<name>/<version or main>/)
 - 測試頁 /refactor-0809-module/; 舊版 (/, /edit.html, /refactor-0809/) 暫留
