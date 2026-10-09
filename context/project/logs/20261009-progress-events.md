# LLM 呼叫的進度事件 (0.5.0, 未發佈)

## 起因

shelf 工作室實測:claude-opus-5-5 一次輸出約 2 萬 token ( 整份 HTML 寫在 write_file 的參數裡 )
要 3~4 分鐘。這段期間沒有 text_delta,chat 只顯示「執行中」,使用者分不出是在寫還是卡住。

provider 本來就逐段解析 SSE ( text / thinking / input_json / message_delta ),只是只有
text_delta 透過 `cb.onDelta` 往外送。所以這次只是把已經看得到的東西摘要出去。

## 做法

 - `client/runtime/progress.js`:`createProgress({emit, provider, model, step, request})`,
   provider 在 SSE 解析的各個點呼叫 `begin / phase / out / input / done / fail`。
   沒有 `emit` 就回 NOOP,provider 不必到處判斷
 - anthropic:`content_block_start` 決定 phase ( thinking / redacted_thinking → thinking,
   text → text,tool_use / server_tool_use → tool + name );`message_start.usage` → 實際送出量;
   `message_delta.usage.output_tokens` → done 的 outTokens
 - openai:沒有 block 開始事件,phase 由第一段 delta 決定;帶 `id` 的 tool_call delta 視為新 tool;
   `reasoning_content` / `reasoning` ( 相容 api ) 算 thinking;usage 只在最後的 chunk
 - worker `chat-progress {id, progress}` → client `cb.onProgress` → chat base `progress` 事件
   ( 加上本輪累計 `turn` ) → 預設外觀的狀態列
 - 只給 `onProgress` 沒給 `onDelta` 時也走 streaming

## 欄位

每則都是完整快照 ( 不是差量 ):

    provider, model, step          step = 這一輪 ( 一次 send ) 的第幾次呼叫, 插話續跑的那段從 1 重算
    phase                          waiting | thinking | text | tool | done | error
    tool, target                   phase = tool 時; target 抓得到才有
    outChars, outTokensEst         本次呼叫累積 ( text + thinking + tool 參數 )
    outTokens                      done 時, API 回報的實際值
    inTokens, inEstimated          送出量; inDetail = {input, cacheRead, cacheWrite} ( 實際值時, 合計 = inTokens )
    usage, stopReason              done 時
    error                          error 時
    startedAt, at                  ms
    turn                           ( chat block 才有 ) {startedAt, calls, outTokens, inTokens}

`inTokens` 用「合計」而不是只放 `input_tokens`:anthropic 的 input_tokens 不含快取,
多步的 agent loop 裡它常常是個位數,顯示「↑ 4」沒有意義;使用者要知道的是這次送了多大的上下文。
拆分放 `inDetail`,要算成本的自己拿。openai 的 prompt_tokens 本來就含快取,拆成 input + cacheRead
與 anthropic 同形狀。

## 節流

最多每 250ms 一則 ( `interval` 可調 ),phase 改變、換 tool block、第一次抓到 target、收到 usage 時立即送。
沒有 trailing timer:最後一份狀態在下一段 delta 或 done 時才送 —— delta 本來就密,
而經過時間由前端自己以 `startedAt` 每秒重算,不靠事件。
測試:200 個 delta 送了 7 則;1 秒 100 個 delta ( 假時鐘 ) 送 4 則。

## 估算

 - 輸出:ASCII 4 字元 / token,其他 ( CJK 等 ) 1 字元 / token,逐段累計字元數 ( 不重掃 )。
   tool 參數是 JSON 字串,跳脫字元 ( `\n`、`\"` ) 會讓它略為高估;程式碼與英文混排時誤差約 ±20%
 - 送出:對請求 body 用同一個估法,但先挖掉長度 ≥ 2000 的 base64 串、每張以 1600 token 計
   ( 一張幾百 KB 的 base64 照字元算會估到上十萬 )。JSON 的 key / 引號也算進去,會偏高。
   anthropic 在 message_start ( 通常 1 秒內 ) 就換成實際值,所以估計值只會閃一下
 - target:只在 tool 參數前 600 字元內用 regex 找 `path` / `file` / `file_path` / `filename` /
   `filepath` / `target`,找到或超過範圍就不再找

## 已知限制

 - openai ( chat completions ) 不串推理內容,reasoning 期間停在 `waiting`;送出量整個呼叫期間都是估計值
 - 沒有串流的路徑 ( 沒給 onDelta / onProgress ) 不會有進度;給了 onProgress 就一定走串流
 - target 只認得那幾個參數名,而且要排在參數開頭;edit_file / write_file 的 `path` 在第一個欄位,實際上抓得到
 - `step` 在插話續跑時重算;chat block 的 `turn.calls` 是以 waiting 事件數的,跨續跑也正確
 - turn 的 `outTokens` 混了實際值與估計值 ( 已結束的呼叫有實際值就用實際值 ),所以畫面上一律標 ≈
 - 錯誤發生在 fetch 之前 ( 例如 getSession 拿 /prompt 失敗 ) 時沒有任何 progress,
   畫面以 busy(false) 收掉顯示

## 驗證

 - `test/progress.mjs` ( 已加入 `npm test` ):假 SSE 串流,anthropic / openai 的 phase 轉換、tool 名稱、
   target ( 含 JSON 跳脫 )、實際送出量 ( 含快取 )、done 的 outTokens、error、listener 丟例外不影響呼叫、
   節流、進度不進歷史。28 項通過;既有 11 個測試照舊通過
 - 瀏覽器 smoke test:server + playwright,攔截 `/api/agent/llm/anthropic` 延遲 2.5 秒回假 SSE
   ( write_file → 文字收尾 ),single-block sample 的狀態列依序顯示
   `等待回應 · ↑ ≈2.9k … 本輪 0:03 · 2 次呼叫`,結束後隱藏,沒有 console error
