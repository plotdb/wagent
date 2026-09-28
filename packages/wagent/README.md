# @plotdb/wagent

對話驅動的 block 生成/編輯模組:workspace-backed 的 LLM api + chat / sandbox 前端 block。


## 掛載

    const agent = require('@plotdb/wagent');
    app.use('/api/agent', agent({workspace: 'workspace', log: myLogger}));

選項:

 - `workspace`:workspace 目錄(檔案操作被限制在此目錄內)
 - `purpose`:領域 prompt,預設為資料視覺化;可用 `agent.prompt.BASE` / `agent.prompt.DATAVIZ` 參考組合
 - `preset`:應用的形狀,決定 system prompt 的基底與 `snapshot` tool 的樣子
   - `'block'`(預設):編輯 `@plotdb/block` 的環境 —— block 格式、sandbox 的 snapshot(`fresh` / `time` / `target`)、新增 / 編輯模式
   - `'plain'`:不編輯 block 的應用(聊天角色、裝置控制、表單…)—— 只留 workspace 的檔案操作與泛用的 snapshot(只有 `image`),
     其餘全由 `purpose` 與 host 的 `brief` / `tools` 描述
 - `log`:`function(tag, msg)`,預設不輸出
 - `providers`:覆寫 LLM provider 清單(預設 anthropic + openai,依 `.env` key 自動選擇)
 - `stream`:後端允許的最高即時等級,`'none'`(單次 JSON)/ `'tool'`(SSE 推送 tool 事件)/ `'token'`(SSE 再加文字逐段),預設 `'token'`


## Streaming

`/chat` 依 request body 的 `stream` 欄位決定回應形式,實際生效等級 = min(前端要求, 後端允許):

 - `none`:跑完 tool loop 後回單一 JSON `{reply, events}`
 - `tool` / `token`:回 `text/event-stream`,事件為 `{type: 'tool'|'delta'|'done'|'error', ...}`;
   `tool` 事件在每個 tool 執行當下推送,`delta` 為文字逐段(僅 token 等級),`done` 帶完整 `{reply, events}`

前端 chat block 以 `data.stream` 指定想要的等級(預設 `token`),從 `GET /provider` 的 `stream` 欄位得知後端允許值,
要求超過允許時 console warning 後 fallback;收到非 SSE 回應也會自動以 JSON 處理。


## 路由

 - `POST /chat` — `{message, block, session}`,跑完整 tool loop 後回覆 `{reply, events}`
 - `GET /blocks` — workspace 內的 block 清單
 - `GET /provider` — 目前 provider 與 model
 - `POST /reset` — 清除對話 session
 - `GET /block/*` — 模組內建的前端 block(chat / sandbox,含各自的 base 層)


## 前端

host 需自行提供入口頁:載入 `@plotdb/block` 全家(proxise、semver、csscope、rescope)與領域 lib(如 d3、Chart.js),
建 `block.manager`,registry 將 chat / sandbox 對應到本模組的 `/block/*`,起 sandbox 後把其 interface 交給 chat。

環境變數:`OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`(以及選用的 `LLM_PROVIDER` / `OPENAI_MODEL` / `ANTHROPIC_MODEL`)。
