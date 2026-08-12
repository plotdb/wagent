# 2026-08-10 Browser Runtime(Phase A)

依 `tasks/20260809-browser-runtime.md`:key 留後端、tool use 全在瀏覽器。
後端縮到只剩 LLM proxy,agent loop 與檔案操作都在 Web Worker 內。


## 架構

    主執行緒 (純 UI)                          agent-worker (ESM module worker)
      chat block  ─ transport ────────────►    agent loop (provider adapter, fetch 版)
      sandbox block ─ connectShell.io ────►    esh shell + zenfs ── OPFS /home/workspace
      esh-term ─ 共用同一個 worker ────────►    serveShell (exec / fs / hello)
                                                      │
                                                      ▼ 只有 LLM 請求出去
                                              後端 POST /api/agent/llm/:provider

 - `@plotdb/esh` 0.2.0 以 library 身分 import 進我們的 worker(不是 worker 呼叫 worker);
   `serveShell(sh, self)` 掛標準協定,我們的 chat 協定(`chat` / `chat-delta` / `chat-tool` /
   `chat-done`)以 addEventListener 並存
 - tool 三個:`run_shell`(路徑操作與探索)、`read_file` / `write_file`(內容不經 shell parser)
 - block 讀資料改由 sandbox 注入 `opt.data.loadText / loadJSON`(workspace 在 OPFS,不能 fetch)


## 實作

 - `packages/agent/api/proxy.js`:LLM proxy — 注入 key、model 白名單、per-ip rate limit、SSE 原樣 pipe
 - `packages/agent/api/prompt.js`:compose 加 mode 參數(`server` / `browser`),IO 段落分流;
   新增 `GET /prompt` 讓 browser runtime 取 system prompt(prompt 邏輯仍只有一份)
 - `packages/agent/web/runtime/`:`agent-worker.js`(shell + agent loop + seed)、
   `client.js`(建 worker、connectShell、包 transport 與 io)、`tools.js`、
   `providers/{openai,anthropic}.js`(fetch 版,自行解析 SSE)、`sse.js`
 - 前端資產改置於 `packages/agent/web/{block,runtime}`,fedep `dir: 'web'` 出貨到
   `/assets/lib/@plotdb/agent/main/`
 - chat / sandbox base 抽象化:`data.transport` 有則走 browser runtime,無則 fallback 後端 `/chat`;
   `data.io` 有則從 OPFS 讀檔並以 `new block.class({code})` 建 block,無則走 URL — 視覺層零改動


## 驗證(測試頁 `/refactor-0810-esh/index.html`)

 - 三欄(chat / sandbox / esh-term)啟動正常,終端顯示 `/home 儲存: opfs`,無 console error
 - seed 後 `ls -R /home/workspace` 與 `io.listBlocks()` 一致;sample-bar 從 OPFS 渲染成功
 - 端到端(openai / gpt-5):「看一下有哪些檔案,然後用 sales 資料做各月訂單數折線圖」
   → run_shell → read_file → write_file → 自動切換並渲染,URL 同步
 - 後端 log 該次流程只有 4 筆 `[llm] -> openai gpt-5 (stream)`,無任何檔案操作
 - 終端 `ls blocks` 看得到 agent 剛寫的 block(cwd `/home/workspace`)— 人與 agent 同一份 working tree


## edit_file(2026-08-12 追加)

原本只有 `write_file`(全檔覆寫),小改一個顏色也要重寫整份 HTML — 慢、貴、容易誤改無關處。
照 Claude Code 的 Edit 工具設計加 `edit_file`,browser runtime 與 server wsenv 兩邊同步實作:

 - 精確字串取代(非 diff / 行號):`old_string` 需完全一致且唯一,`replace_all` 才允許多筆
 - 樂觀鎖:記住上次交給 LLM 的內容,edit 前重讀比對;檔案若被外部改過(如使用者在 esh-term 動手)
   就拒絕並要求重讀,避免拿舊內容覆寫。這是我們特有的併發來源 — Claude Code 沒有終端共用同一份 tree 的情境
 - 錯誤訊息寫明匹配數與下一步(「matched 3 times, add context or set replace_all」),讓 LLM 能自我修正
 - prompt 加使用準則:小改用 edit_file、新檔或結構性重寫用 write_file

順手修掉一個 bug:chat base 的 applyEvents 只認 `write_file`,edit_file 改完不會觸發重新渲染。

驗證:

 - server wsenv 與 browser runtime 各跑 6~7 個案例(未讀先改 / 唯一 / 多筆 / replace_all /
   找不到 / 外部改動),全部符合預期,拒絕時檔案未被覆寫
 - 端到端(openai / gpt-5):「把折線改成橘色並改標題」→ 兩組 read_file + edit_file → 即時重新渲染


## 備註

 - esh 的 grep 是 JS regex 近似品,`grep -c` 之類 flag 未實作(回空字串);
   之後可在 prompt 註明可用指令集,或改用 esh 的自訂指令補
 - 舊路徑(server 模式)全部保留:`/`、`/edit.html`、`/refactor-0809/`、`/refactor-0809-module/`
