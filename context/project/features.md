# 已實作功能

## 圖表列表（首頁 `/`）

 - 讀取 `/api/blocks`，以卡片格呈現所有圖表
 - 卡片內即時渲染縮圖（直接執行 block）、顯示名稱與描述（取自 `pkg.description`）
 - 依檔案修改時間排序；「新增圖表」卡片導向編輯頁


## 圖表編輯頁（`/edit.html?block=<name>`）

 - 左側對話、右側該圖表全幅預覽
 - 帶 `block` 參數為編輯模式；不帶為新增模式，LLM 建立新 block 後自動切換（含 URL 更新）
 - 對話中顯示 tool 執行紀錄（read_file / write_file 與路徑）
 - block 或資料檔被寫入後自動重新渲染


## 對話與 tool loop

 - `POST /api/chat`：`{message, block, session}`，server 端跑完整 tool loop 後回覆
 - 每個圖表各自的對話 session（記憶體內），修改指令限定於當前圖表
 - `POST /api/reset` 可清除指定或全部 session
 - tool：`list_files`、`read_file`、`write_file`，路徑限制在 `workspace/` 內


## LLM Provider Adapter

 - `providers/anthropic.js`（Claude，預設 `claude-opus-4-8`）
 - `providers/openai.js`（OpenAI，預設 `gpt-5`）
 - 依 `.env` 的 key 自動選擇，`LLM_PROVIDER` 可強制指定
 - `GET /api/provider` 回報目前 provider 與 model，顯示於頁面 header


## 建置與伺服

 - `server.js`：Express + `@plotdb/srcbuild.lsp({base: 'web'})`
 - `web/src/pug/*.pug` 自動編譯至 `web/static/*.html`，watch 模式即時重建
 - `/workspace` 靜態服務 workspace 檔案供前端 loader 與資料讀取
 - 啟動時載入專案根目錄 `.env`（自製極簡 loader，無額外依賴）


## 已驗證流程（2026-08-02 ~ 08-03，openai / gpt-5）

 - 對話生成新圖表：「畫各月訂單數折線圖」→ LLM read_file 確認資料格式 → write_file 建立 block → 自動渲染
 - 對話修改既有圖表：「長條改橘色加平均值虛線」→ read_file 現有程式 → 覆寫 → 重新渲染
 - 多輪對話脈絡、列表縮圖、provider 自動偵測均正常
