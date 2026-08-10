# Browser Runtime 規劃(draft 概念的實作)

依 `context/project/draft/spec.md`(Runtime Commands + Command Registry + Provider 抽象)重新實作,
核心動機:**key 在後端、tool use 在前端** — 前端 action 不能讓後端執行任意操作,
整件事 scope 在瀏覽器中;框架本身前後端皆可跑,由 Provider 決定底層。


## 安全模型(為什麼這樣切)

 - 後端只剩一個 **LLM Proxy**:注入 key、轉發請求(含 SSE)、rate limit;不執行任何 tool
 - agent loop(LLM 回應解析、tool 分派)與所有 command 執行都在瀏覽器
 - tool 的作用範圍 = 瀏覽器沙盒(OPFS per-origin);最壞情況是搞壞自己分頁的 workspace,碰不到 server
 - 對照現況:現在 `/api/chat` 的 write_file 是後端 fs 寫入,靠 safePath 防護;新架構下這整類風險消失


## 模組切分

    packages/runtime/            # @plotdb/runtime — 核心框架 (前後端皆可跑)
      registry.js                # Command Registry: {name, description, parameters, permission, handler}
                                 #   -> 轉出 LLM tool defs; 分派執行
      commands/                  # 內建 commands: ls / cat / write (之後 edit / grep / mkdir / rm)
      workspace/                 # Workspace Provider interface + 實作
        itf.js                   #   read / write / list / remove / move
        opfs.js                  #   Browser OPFS
        mem.js                   #   in-memory (測試用)
        nodefs.js                #   Node fs (= 現在的 wsenv, 後端跑時用)
      llm/                       # LLM adapter (browser 端, 打 proxy)
        session.js               #   agent loop: send -> tool 分派 -> 回填 -> 迭代; 事件廣播
        anthropic.js openai.js   #   wire format 轉換 (從 packages/agent 移植, fetch 版)

    packages/agent/              # 現有模組, 沿用並收斂
      api: 增加 /llm proxy route (或獨立成 packages/llm-proxy)
      block: chat / sandbox 沿用; chat base 的「送 /api/chat」換成「呼叫 browser runtime session」
      現有後端 tool loop 保留 (= 框架跑在後端的參照實作, 用 nodefs provider)


## LLM Proxy 介面(後端唯一暴露面)

 - `POST /api/llm/:provider` — body 為 provider 原生 wire format,proxy 注入 key 後轉發,SSE 原樣 pipe 回
 - 白名單:model、max_tokens 上限、rate limit;不解析、不執行任何內容
 - 之後可加 per-user quota / auth


## Phase 規劃

### Phase A — runtime 核心 + browser workspace

 - registry + commands(ls / cat / write)+ workspace provider(opfs / mem)
 - llm session(agent loop in browser)+ proxy route
 - 測試頁 `refactor-08xx-runtime/`:chat / sandbox block 接 browser runtime
 - sandbox 渲染改從 workspace provider 讀(block html 由 OPFS 而非 /workspace URL)
 - 驗收:對話生成 block -> 寫入 OPFS -> 渲染,全程後端只見 LLM proxy 流量

### Phase B — 對齊 draft 的 runtime 能力

 - commands 擴充:edit(patch)、grep、find、mkdir、rm;permission 欄位生效(如 rm 需確認)
 - workspace import / export(zip 或 File System Access API),解決 per-browser 資料孤島
 - 後端跑同一套 runtime(nodefs provider)驗證「框架前後端皆可跑」

### Phase C — Version Provider(draft Phase 1 的最後一塊)

 - `Version.status / diff / commit / restore / history` 介面
 - browser 實作:isomorphic-git(或先做 snapshot 版)
 - Collaboration(CRDT)依 draft 屬更後期,不在此輪


## 與現有程式的關係

 - `@plotdb/agent` 不丟棄:chat / sandbox block、prompt 語意封裝、streaming 與 auto-fix 機制全部沿用
 - 改變的是「tool 在哪執行」:wsenv 降級為 nodefs provider 的一個實作;/api/chat 保留作為 server-mode
 - registry 取代寫死的 tools 陣列,LLM tool defs 由 registry 生成


## esh 整合修訂(2026-08-10)

評估 `@plotdb/esh` 後,原規劃的 Command Registry 與 Workspace Provider 兩層由 esh 承擔:

 - shell 直譯器(pipe / glob / redirect / control flow)+ ShellJS 指令 + `registerCommand()` = Command Registry,且符合 draft「Unix Shell 心智模型」
 - zenfs mounts(`/home` OPFS 持久、`/tmp` memfs、node 端真 fs)= Workspace Provider
 - shell 已跑在 Web Worker(OPFS 同步存取只在 worker 可用),與「scope 在 browser」的安全模型一致

### Tool 設計

 - `run_shell(command)`:走 esh worker 現成的 exec protocol;LLM 最熟的介面
 - `write_file` / `read_file`:structured tool,直接走 zenfs fs API(不經 shell parser,避免 heredoc escaping);與 shell 共用同一份 working tree
 - evaluator 為同步 — async 的事(LLM 呼叫等)一律留在 worker 外的 agent loop 層

### 架構定稿(2026-08-10 討論後)

**agent loop 跑在 worker 內**(esh 0.1.0 evaluator async 化後成立):

    agent-worker.js (我們寫的唯一 worker; esh 以 library 身分 import 進來跑)
      shell (esh createShell) ── zenfs ── OPFS /home
      agent loop ── fetch/SSE → 後端 /llm proxy
      tools: run_shell → sh.run(); write_file / read_file → fs 直呼 (零 RPC)
      對外協定: serveShell 的 exec + fs (見下) + 自己的 chat 訊息 (send / delta / tool / done)

    主執行緒 = 純 UI: chat / sandbox block + esh-term (createTerminal 傳 workerUrl 掛同一個 worker)

**跨執行緒介面一致化 → 提案給 esh**(`esh/context/project/tasks/serve-connect-shell.md`):

 - `serveShell(sh, target)`:worker 側掛標準協定 — exec 沿用 + fs op 白名單只有
   `readFile` / `writeFile`(control-plane 走 exec,data-plane 不經 shell parser;
   `writeFile` 自動建父目錄;結構化查詢用自訂指令輸出 JSON)
 - `connectShell(worker)`:主執行緒 client,介面與 `createShell()` 同形狀子集
   (`run()` + 內容讀寫)— 消費端不分本地 / worker shell 寫一次通用
 - dogfooding:esh-worker.js 與 esh-term client 改用這組 API

esh 主責 session 評估結論(2026-08-10,認可可做,排 0.2.0):

 - 同形狀問題:本地 `sh.fs` 是 zenfs node-style(sync/callback),remote 必然是 promise 版 —
   改為兩邊都掛 promise 子集 `sh.io = {readFile, writeFile}`,local / remote 才真正 drop-in
 - append 不開第三個 op:內容一樣不可過 parser,正解是 read + concat + write(單 worker 序列化無 race),寫進文件
 - 並存:`addEventListener` 掛(不賦值 `onmessage`),只認 exec / fs type;`serveShell` 回傳 `{dispose}`
 - 多 consumer 單 port 三細節:result 是廣播要靠 id 過濾;各 client id 加隨機前綴防撞號;
   加 `{type: 'hello'}` → `{type: 'ready'}` 握手(後掛的 client 等不到初始 ready)
 - binary 現在就定語意:writeFile 收 `string | Uint8Array`(structured clone,不用 base64),
   readFile 加 encoding 參數(預設 utf8 回 string,null 回 Uint8Array);transferable 留作之後優化

### 分工

 - esh 端:serveShell / connectShell(已發提案給 esh 主責 session 評估)
 - @plotdb/agent 端:
   - api 加 `/llm/:provider` proxy route:注入 key、SSE 原樣 pipe、model 白名單 + rate limit;後端唯一暴露面
   - `runtime/`(browser 端):agent-worker(esh + llm session;provider adapter 移植成 fetch 版)
   - chat base 抽象傳輸層:`data.session` 給一個有 `send(text)` 介面的物件即用之(browser runtime),不給則 fallback 現行 `/chat`(server mode)— chat / sandbox 視覺層零改動
   - sandbox 讀檔走 `connectShell(worker).fs.readFile`;渲染改用 `new block.class({code})` 以字串建 block,不再依賴 URL
 - workspace 佈局:`/home/workspace/{blocks,data}`(OPFS),首次 seed 範例資料

### 測試頁

 - `refactor-0810-esh/`:chat + sandbox + esh-term 三欄,共用同一個 worker 與 working tree —
   用戶可在終端 `ls` / `cat` 看 agent 的產出,agent 與人操作同一份 workspace
 - 驗收:對話生成 block → 寫入 OPFS → 渲染;後端流量只有 `/llm/:provider`

### Phase 重排

 - Phase A:esh worker fs protocol + client、llm proxy、browser agent loop、chat/sandbox 注入化、測試頁
 - Phase B:commands 補強(esh 端)、workspace import / export、permission(如 `rm` 需確認)
 - Phase C:Version Provider — isomorphic-git 掛同一份 zenfs(esh plan.md 已預留此路)


## 待決事項

 - browser runtime 放 `packages/agent/runtime/` 先行,還是直接開 `packages/runtime` 獨立模組(建議先前者,長大再拆)
 - esh worker fs protocol 由 esh 提供(升版)或 agent 端自包 worker(建議前者,user 擁有 esh)
 - OPFS 瀏覽器支援範圍(Safari 較晚支援 sync access)是否需要 IndexedDB fallback
 - block 執行本身的 iframe 沙盒化(獨立議題,可與 Phase A 並行或後續)
