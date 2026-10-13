# Change Logs

## v0.6.0

 - features:
   - 對話訊息的格式化 ( chat base 的 `render` / `format` / `widget` ):預設把 LLM 的文字當 markdown 轉譯
     - 需要頁面載入 `marked` ( >= 5 ) 與 `DOMPurify`,缺任一個退回純文字;`data.markdown = false` 關閉
     - 安全:原始 html 當文字顯示、整份過 DOMPurify、連結開新分頁
     - 擴充點:```` ```wagent:<name> ```` 的程式碼區塊交給 `widget(name, fn)` 註冊的函式畫 ( 收完整才呼叫 ),
       之後的互動元素 ( 選項、表單、預覽卡 ) 走這裡;沒註冊的照程式碼區塊顯示
     - 預設外觀 ( block/chat/index.html ) 改用 `render`,串流中每個 frame 最多重畫一次
 - fixes:
   - LLM 代理回的 lderror ( 例如額度、點數不足 ) 的 `id` 與 `payload` 帶得到畫面:
     `checkResponse` 保留 `payload`,worker 的 `chat-error` 一併送出,client 重建成 lderror。
     先前跨過 worker 只剩英文 message,畫面無法依代碼組訊息
 - tweaks:
   - `test/lderr.mjs`:`checkResponse` 帶 id / payload


## v0.5.0

 - features:
   - LLM 呼叫的進度事件 —— 長的輸出 ( 例如整份 HTML 寫在 tool 參數裡 ) 不再只看得到「執行中」
     - provider ( anthropic / openai ) 逐段回報 `phase` ( `waiting` / `thinking` / `text` / `tool` / `done` / `error` )、
       tool 名稱與參數開頭的 `path`、`outChars` / `outTokensEst` ( 估計 )、`inTokens` ( 先估, 收到 usage 後換實際值 )、
       `startedAt`、`model`、`provider`;`done` 附 API 回報的 usage
     - 節流:最多約每 250ms 一則,phase 改變時立即送;進度不進對話歷史
     - worker -> `chat-progress` -> `transport.send(text, {onProgress})` -> chat block 的 `progress` 事件 ( 多帶本輪累計 `turn` )
     - chat 預設外觀:執行中顯示一行狀態 ( 模型 · 正在做什麼 · ↑ 送出 · ↓ 輸出 · 經過時間 · 本輪累計 ),每秒更新
 - tweaks:
   - provider 在只給 `onProgress` ( 沒有 `onDelta` ) 時也走 streaming
   - `test/progress.mjs`:以假的 SSE 串流驗 phase 轉換、tool 名稱、done / error、節流


## v0.4.0

 - 行為改變 ( 歷史語意 ):
   - 對話歷史 append-only —— 送出過的訊息一律不改。改舊訊息會讓 prompt cache 從那裡全部失效,
     而且現行 Claude ( Opus 5.5 / Fable 5.1 / Sonnet 5.5 ) 的 thinking block 綁著前綴,改了就作廢 ( 新帳號 400 )
     - `context()` 每輪照附,舊的不再換成佔位;文字改成「描述附上當時的狀況,以最新一份為準」
     - 圖不再逐張換成 `[earlier image omitted]`。超過 `createRuntime({maxImages})` ( 預設 20 ) 時一次重建:
       只留最新一張、anthropic 同時丟掉所有 thinking block,之後又是 append-only
     - 移除 `turn-context.js` 的 `pruneContext`
 - features:
   - anthropic:top-level 自動快取 ( `cache_control: {type: 'ephemeral'}` ),每一步都讀得到上一步的整段前綴
     ( 先前只有 system 有快取點 )
   - host tool 可逐個設逾時:`registerHost({tools: [{name, description, parameters, timeout}]})` ( ms ),
     `registerHost({timeout})` 管 snapshot 與沒設的,底是 20 秒。`timeout` 不會送給 LLM
   - 逾時訊息講明 host 可能還在做、別盲目重試 ( 避免慢的 tool 被一再重跑 )
   - `createRuntime({maxImages})`
 - fixes:
   - anthropic:被截斷的 tool input 不再在 tool_use block 上多掛 `bad` 欄位 ( 原樣送回會 400 )
 - tweaks:
   - host 呼叫的逾時與配對拆到 `client/runtime/host-call.js` ( 可在 node 測 )

## v0.3.1

 - features:
   - 每個掛載點自己的模型設定 —— `require('@plotdb/wagent')({provider, model, models})`,env 退為 fallback
     - `models` 是該掛載點的白名單 ( 取代預設;`false` / `[]` = 不開放該 provider ),預設白名單以 `wagent.models` 匯出供擴充
     - 預設 model ( 含 env 設的 ) 一律放行 —— `ANTHROPIC_MODEL` 設成白名單沒有的新模型不再全部失敗
     - proxy:body 沒帶 model 就填預設;關掉的 provider 回 404
     - `GET /provider` 多回 `providers: {<name>: {model, models}}` ( 只列有 key 的 ),`provider` / `model` 不變
   - 對話中切換模型:`rt.listModels()` / `rt.getModel()` / `rt.setModel({provider, model})` / `rt.onModelChange(fn)`
     - 下一輪生效,不清對話;同 provider 直接沿用歷史,跨 provider ( anthropic ↔ openai ) 轉換對話紀錄後重建 session
     - chat block 的 `data.models` ( 傳 runtime ):header 的 provider 文字換成模型選單;sample 皆已接上
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
