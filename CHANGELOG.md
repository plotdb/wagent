# Change Logs

## master

 - tweaks:
   - `@plotdb/agent` 更名 `@plotdb/wagent`(`packages/agent` -> `packages/wagent`);
     專案定位由「對話生成圖表」升級為編輯宿主 (host),名稱與 repo 一致
   - `context/project/host.md`: Host 定義 — mounts / shell / content ops / snapshot / tools(選用)


## v0.2.0

 - features:
   - browser runtime (Phase A): agent loop 與 tool 執行移入 Web Worker,
     後端只剩 LLM proxy (`POST /api/agent/llm/:provider`;注入 key、model 白名單、rate limit、SSE pipe)
   - workspace 改由 `@plotdb/esh` 0.2.0 提供 (shell + zenfs,`/home/workspace` 掛 OPFS 持久化);
     tool 為 run_shell / read_file / write_file
   - esh-term 與 agent 共用同一個 worker:人與 agent 操作同一份 working tree
   - chat / sandbox block 抽象化:`data.transport` / `data.io` 有則走 browser runtime,
     無則 fallback 後端 `/chat` 與 workspace URL — 同一套 block 前後端兩用
   - prompt 分 server / browser 兩種 IO 模式;新增 `GET /prompt` 供 browser runtime 取用
   - edit_file tool(前後端兩邊):精確字串取代 + 樂觀鎖(檔案被外部改過則拒絕並要求重讀),
     錯誤訊息含匹配數與下一步供 LLM 自我修正;小改用 edit_file、新檔或重寫用 write_file
 - bugfixes:
   - chat base 的 applyEvents 只認 write_file,edit_file 改完不會觸發重新渲染
 - tweaks:
   - `@plotdb/agent` 前端資產改置於 `web/{block,runtime}`,fedep 以 `dir: 'web'` 出貨


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
