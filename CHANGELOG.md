# Change Logs

## v0.3.1

 - features:
   - 每個掛載點自己的模型設定 —— `require('@plotdb/wagent')({provider, model, models})`,env 退為 fallback
     - `models` 是該掛載點的白名單 ( 取代預設;`false` / `[]` = 不開放該 provider ),預設白名單以 `wagent.models` 匯出供擴充
     - 預設 model ( 含 env 設的 ) 一律放行 —— `ANTHROPIC_MODEL` 設成白名單沒有的新模型不再全部失敗
     - proxy:body 沒帶 model 就填預設;關掉的 provider 回 404
     - `GET /provider` 多回 `providers: {<name>: {model, models}}` ( 只列有 key 的 ),`provider` / `model` 不變
   - 對話中切換模型:`rt.listModels()` / `rt.getModel()` / `rt.setModel({provider, model})` / `rt.onModelChange(fn)`
     - 下一輪生效,不清對話;同 provider 直接沿用歷史,跨 provider ( anthropic ↔ openai ) 轉換對話紀錄後重建 session
   - 預設白名單加入 Claude 5 家族 ( `claude-opus-5-5`、`claude-opus-5`、`claude-sonnet-5`、`claude-fable-5-1`、
     `claude-fable-5`、`claude-haiku-4-5-20251001`、`claude-opus-4-6` ),舊的保留
 - fixes:
   - haiku 4.5 與更早的 Claude 不支援 adaptive thinking,不再對它們送 `thinking` ( 先前會 400 )
   - worker 取 `/provider` 時也帶 `headers`

## v0.3.0

 - packaging:
   - repo 根目錄就是 `@plotdb/wagent`,不再是 monorepo ( `packages/` 拿掉 )
     - `api/`:後端 ( 原 `packages/wagent/api` ),`require('@plotdb/wagent')`
     - `client/`:前端 runtime 與 block ( 原 `packages/wagent/web` ),fedep 用 `{name: '@plotdb/wagent', dir: 'client'}`
     - `headless/`:原 `@plotdb/wagent-headless`,改為 `require('@plotdb/wagent/headless')`,`playwright` 為 optional peer
   - demo 用的套件移到 devDependencies,執行期相依只剩 `express`;前端相依改列 peerDependencies,
     除了 `@plotdb/esh` 都是 optional ( 只用 runtime、不用 chat / sandbox block 的頁面不需要 )
   - 移除 `postinstall: fedep` ( 會在每個安裝 wagent 的專案裡執行 ),demo 改用 `npm run setup`
   - 以 `npm run release` ( `fedep publish -g --skip-dist` ) 發布到 github release branch
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
