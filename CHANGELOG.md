# Change Logs

## master

 - features:
   - `preset` 選項 — `require('@plotdb/wagent')({preset})`,決定 system prompt 的基底與 `snapshot` tool 的樣子
     - `block` (預設):原本的行為,prompt 一字不差
     - `plain`:不編輯 block 的應用 —— 不帶 block 格式與新增 / 編輯模式,snapshot 只剩 `image`
     - 只在 api 決定一次:`GET /prompt` 回 `{system, preset}`,worker 以 `toolsFor(preset)` 取 tool;
       preset 打錯字在掛載時就丟錯
   - 以下為 master 自 0802-agent 搬出後、尚未進版的改動 (舊歷史與 v0.2.0 在 `dev/legacy/hosting`):
   - block 可引入 workspace 裡的其他 block (ns `local`)
   - 出錯自動修的開關;agent 執行中可插話 (queue)
   - sandbox 第四個窗口 `adapt` —— 資料以 block 自己的 interface 餵進去
   - `createRuntime({headers})` 與 `rt.setHeaders()` —— 嵌進有 CSRF / auth 的站台
   - 儲存層隔離 (esh 0.5.1 的 mounts path);workspace 位置可設定
   - 一輪之內的步數上限 (`maxSteps` / `softSteps`)
   - proxy 記帳 (`opt.usage`) 與額度守門 (`opt.budget`):計價改用 byte,送出前擋掉、中途超額中止上游
   - samples:single-block / multiple-blocks / dataviz
 - fixes:
   - 截斷的回應不再靜靜改壞檔案
   - fix-offer 節流,同一個渲染錯誤不再堆出一疊卡片
   - 檔案樹的過期渲染 race
 - tweaks:
   - sandbox 的 settle 也管 SVG 與純 DOM 的 block
   - 升級 esh 0.5.0 / 0.5.1
   - server port 交給 OS 挑,`npm start` 順手開瀏覽器 (`NO_OPEN=1` 可關)
