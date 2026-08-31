用量守門 — 邊流邊守, 用 bytes 當計價單位
=========================================

已完成的前置 (5f860c4 / ddff4c4 / c1cac48): 步數上限、proxy 記帳、sqlite demo。
這一份接在後面, 目標是**額度真的擋得住**, 而不是只記帳。

## 決策

 - **計價單位是 byte, 不是 token。** 訂價權在我們, 不是 API 費用的抽傭制。
   bytes 與 token 差 3~5 倍 (中文 3.19 / 英文 5.03 / 程式碼 3.41 bytes per token,
   實測), 但那只在「拿 bytes 猜 token」時才是誤差 — 當 bytes 就是單位本身,
   額度、計費、守門三者同一個尺, 就沒有高估這回事。定費率時換算一次即可。
   **所以不加安全係數** — 係數是為了蓋過某個真值而存在的, 這裡沒有那個真值,
   ×1.1 只是把價格調高 10% 穿了工程的外衣。要調價就直接調費率。
 - **兩個數字都記。** 計費用 billable bytes, 真實 usage 留作 telemetry。
   實測一輪 (五次呼叫): bytes 基準約 23000, 真實成本加權 10026 — **2.3 倍**,
   而且倍率隨 turn 變長而升高 (前綴一直重送, 但快取讓真實成本一直降)。
   結構上 bytes >= 成本 (快取只會讓成本更低, 而 bytes 看不到快取), 所以毛利
   安全; 要擔心的是相反方向, 那要靠實際分佈調費率, 不是靠現在猜。
 - **不用 tokenizer。** gpt-tokenizer 精確但 +76MB 常駐、載入 84ms, 而 Claude
   3+ 根本沒有公開 tokenizer (`@anthropic-ai/tokenizer` 是 Claude 2 世代)。
   `Buffer.byteLength` 是 0.02ms、零相依, 而且**中途被切斷時那是我們唯一有的
   數字** — provider 的 usage 只在正常結束時給。
 - **不做 reserve/settle。** t=0 只檢查不扣款, 串流中用 bytes 守著, 結束時扣
   一次。損失被限制在一次呼叫之內, 換掉 settle 原語 + schema migration +
   串流中途的 DB 交易。servebase 的 `consume` 直接就能用, 不必他們改任何東西。

## 順序

排序的理由: (1) 是其他三項的前提 — (2)(3)(4) 都會製造截斷的回應, 而現在截斷
是**靜靜改壞檔案**。

1. [ ] **截斷處理 + lderror id**
       `providers/anthropic.js` 收了 `stop_reason` 卻沒有任何地方檢查它;
       tool input 被截斷時 `JSON.parse` 失敗會靜靜變成 `{}`, 於是
       `edit_file({})` 就送出去了。這是現在就存在的洞, 只是 max_tokens 16000
       很少撞到所以沒露出來 — 而 (4) 的中止會讓它變成常態。
       改成明確的錯誤, 帶 lderror duck type (`{id, name: 'lderror'}`),
       前端靠 id 分辨而不是比對訊息字串。

2. [ ] **`res.on('close')`**
       使用者關分頁 / 按停止 / 換頁時是 `res` 這端關閉, 上游 readable 不一定
       emit end 或 error — 那次呼叫**完全不記帳**。crash 是意外且有界, 這個是
       日常操作; 一旦有人發現「快結束時關掉分頁就免費」就是系統性白嫖。

3. [ ] **`meter.js` 加 billable bytes**
       計費數字改為加權 bytes; 真實 usage 留在 record 裡當 telemetry。
       命名不要叫 token — 半年後看到 `bytes` 欄位的人會以為是網路流量或 token
       數, 而那兩個誤會都會讓人算錯價。

4. [ ] **`AbortController` + 超額中止**
       proxy 現在是 `Readable.fromWeb(r.body).pipe(res)`, 沒有中止的能力。
       串流中累加 bytes, 超過餘額就中止上游, 並**往串流裡注入我們自己的
       error 事件** — 中止是我們的決定不是上游的事實, 不注入的話前端只會看到
       串流無故斷掉, 那是最難查的一種。注入的事件要能被明確分辨出「這是
       wagent 說的」而不是混進上游的 error。

## 未定 (需要另外討論)

 - **proxy 的定位是 transport 還是 gateway。** 注入事件是第一次往串流裡寫我們
   自己的東西。這個決定會影響後面很多事 (要不要重寫 tool 定義、要不要注入
   system prompt、要不要做 provider fallback), 值得單獨定義清楚。
 - **HTTP 490 + lderror。** servebase 的 `error-handler.ls` 用 490 表示「這是
   一個 lderror, 細節在 body」, 因為 lderror 的 id 空間跟 HTTP 4xx/5xx 沒有
   一對一關係。proxy 現在硬塞 402, 要跟著改 — 但那會動到前端 `sse.js` 的
   `checkResponse`, 跟 (1) 一起做比較省。
 - **費率與換算。** 1 byte 約 1/4 token, 所以每 byte 的價格約是心裡那個每
   token 價格的四分之一。等 (3) 跑出實際分佈再定。
