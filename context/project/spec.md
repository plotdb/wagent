# 系統設計

以對話生成、編輯圖表 block 的 web 應用。設計原則沿用 `note.md`（AI Agent Runtime Platform 草案）：

 - workspace 是唯一 source of truth；圖表即檔案，不另建資料庫
 - LLM 不直接碰檔案系統，透過受控的 tool（`list_files` / `read_file` / `write_file`）操作，為 runtime commands 的雛形
 - LLM provider 可插拔


## 架構

    Browser (pug -> html)
      首頁: 圖表列表 (卡片 + 即時縮圖)
      編輯頁: 對話 + 單一圖表預覽
        |
        | /api/chat, /api/blocks, /api/provider, /api/reset
        v
    Express (server.js + api/index.js)
        |
        +-- providers/anthropic.js  (Claude, tool_use loop)
        +-- providers/openai.js     (OpenAI, tool_calls loop)
        |
        v
    workspace/            <- 唯一 source of truth
      data/               資料檔 (csv / json)
      blocks/<name>/index.js   圖表 block


## Block 格式

仿 `@plotdb/block` 的 `pkg` 宣告 + `init` 邏輯，但為瀏覽器端簡化版：

    module.exports = {
      pkg: {
        name: "@workspace/<block-name>",
        description: "這個 block 做什麼"
      },
      init: function({root, ctx}) {
        // root: 掛載的 DOM element
        // ctx.d3 (v7), ctx.Chart (Chart.js v4)
        // ctx.loadText(path) / ctx.loadJSON(path): 讀 workspace 檔案
        // 回傳 Promise
      }
    };

前端 loader 以 fetch 取得原始碼，用 module/exports shim 執行後呼叫 `init({root, ctx})`。同一份 loader 用於列表縮圖與編輯頁全幅預覽。


## Provider Adapter

`providers/` 下每個 provider 實作同一介面：

    available()  -> bool          // 檢查對應的 API key 是否存在
    createSession({system, tools, runTool})
      -> {send(text) -> Promise<{reply, events}>, reset()}

 - tool 定義採通用形式 `{name, description, parameters}`，由各 provider 轉為自己的 wire format
 - tool loop（多輪 tool 呼叫直到產生最終回覆）由各 provider 自行處理
 - 選擇邏輯：`LLM_PROVIDER` 環境變數優先，否則取第一個 `available()` 的（anthropic 優先）
 - 模型以 `ANTHROPIC_MODEL` / `OPENAI_MODEL` 覆寫，預設 `claude-opus-4-8` / `gpt-5`
 - 出錯時 rollback 該輪對話歷史，避免留下未配對的 tool 呼叫


## 對話 session 設計

 - 以圖表為單位：session key 為 block 名稱（新增模式為前端產生的 draft id）
 - system prompt 依情境組合：共通規則 + 「正在編輯 blocks/<name>」或「新增模式」
 - 歷史存於 server 記憶體，重啟即消失；圖表檔案不受影響


## 安全

 - tool 的路徑一律經 `safePath()` resolve 並確認在 `workspace/` 內，防止路徑逃逸
 - `.env` 不進 git


## 後續方向（未實作）

 - 對話歷史持久化（如 `blocks/<name>/chat.json`）
 - 圖表刪除、改名
 - git 版本管理（對應 `note.md` 的 Version Provider）
 - 資料檔上傳 UI
 - 擴充 tool 集為完整 runtime commands（ls / cat / edit / git）
