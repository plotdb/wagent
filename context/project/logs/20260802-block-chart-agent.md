# 2026-08-02 ~ 08-03 Block Chart Agent 試作

依 `note.md` 的 Agent Runtime 構想，試作「對話生成圖表 block」的前後端。


## 工作內容

### 基礎建置

 - 依 `context/shared` 慣例建立專案：`server.js`（Express + `@plotdb/srcbuild`）、`web/src/pug` -> `web/static`、純 JS（不用 LiveScript、避免 async/await）
 - `api/index.js`：`/api/chat` 跑 LLM tool loop；tool 為 `list_files` / `read_file` / `write_file`，以 `safePath()` 限制在 `workspace/` 內
 - block 採 `@plotdb/block` 的 `{pkg, init}` 概念，前端以 module shim 載入執行；ctx 注入 d3、Chart.js 與 `loadText` / `loadJSON`
 - 建立範例 `workspace/data/sales.csv` 與 `workspace/blocks/sample-bar`

### Provider adapter

 - 用戶希望改用 OpenAI（perks credit），將 LLM 呼叫抽成 `providers/` adapter：anthropic 與 openai 各自實作 `available()` + `createSession()`，tool 定義通用化
 - 依 key 自動選擇 provider，`LLM_PROVIDER` / `OPENAI_MODEL` / `ANTHROPIC_MODEL` 可覆寫
 - `.env` 極簡 loader（不加依賴），`.env` 加入 `.gitignore`

### 列表與編輯頁

 - 用戶需求：圖表要一格格存起來、有列表、可進入單一圖表繼續修改
 - 首頁改為卡片列表（即時縮圖 + 描述 + 新增卡片）；新增 `edit.pug` 編輯頁
 - 對話 session 改以圖表為單位，system prompt 註明當前編輯對象；新增模式建立後自動切換至該圖表


## 驗證結果

 - 以 openai / gpt-5 端到端測試通過：生成新圖表（各月訂單數折線圖）、修改既有圖表（改橘色 + 平均值虛線）均正確走完 read_file -> write_file -> 自動渲染
 - 瀏覽器實測列表縮圖、編輯頁預覽、多輪對話均正常，無 console error


## 備註

 - 對話歷史僅存於記憶體，server 重啟即消失；圖表檔案不受影響
 - 後續方向見 `spec.md` 末節（歷史持久化、刪除改名、git 版本管理等）
