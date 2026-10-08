# 歷史 append-only 與 host tool 逾時 (0.4.0)

## 起因

應用層 (shelf) 實測 claude-opus-5-5 一次 22 步的執行:未快取 input 約 662k token,
快取讀取只有 174k —— 3 美元的成本大半花在**重送同一段前綴而沒吃到快取**。

原因是 provider 每輪 / 每步都在改舊訊息:

 - `pruneContext`:新的一輪附上 context 前,把舊的 context 換成佔位
 - `pruneImages` (anthropic) / `flushImages` (openai):新圖進來時把舊圖換成 `[earlier image omitted]`

改到第 N 則訊息,第 N 則之後的快取就全部失效。而且只有 system 有 `cache_control`,
對話本身從來沒有快取點,就算沒改也讀不到上一步的前綴。

另一半:現行 Claude (Opus 5.5 / Fable 5.1 / Sonnet 5.5) 的 thinking block 綁著整段前綴
(preserved thinking),改了前面的訊息,後面的 thinking 全部作廢 —— 2026-08-31 之後開的帳號直接 400。

## 決定

 - 歷史 append-only。context 每輪照附,舊的不動;「以最新一份為準」寫在 wrapContext 的文字裡
 - anthropic 加 top-level `cache_control: {type: 'ephemeral'}` (自動快取,放在最後一個 block 並
   隨對話往後移),system 那個明確的快取點保留 —— 文件建議的 agent loop 組合
 - 圖:留著。一張約 1~2k token,快取讀取是 input 單價的 1/10 以下 (opus 5.5 是 0.05x),
   十幾張的成本仍小於一次快取失效。設上限 `maxImages` (預設 20),超過時在下一步之前
   **一次**重建:只留最新一張、其餘換佔位、anthropic 丟掉所有 thinking block
   (官方文件列為合法形狀),之後又是 append-only
 - host tool 逾時可逐個設 (`tool.timeout` > `registerHost({timeout})` > 20s),逾時訊息
   講明 host 可能還在做、別盲目重試

## 考慮過但沒做

 - **keep-tail 壓縮** (摘要舊的、保留最近幾輪原樣):保留的那幾輪的 thinking 是在完整歷史下
   產生的,接在摘要後面送回去會 400。要做就得丟 thinking,那跟現在的一次重建差不多,
   卻多了一次摘要呼叫
 - **server-side compaction / context editing** (beta):不算改歷史,是正解,但要 beta header,
   而且 openai 那邊沒有對應。等需要長對話時再說
 - **只在 turn 邊界重建**:單一輪就可能累積很多張 (改 → 看 → 改 → 看),所以每步檢查;
   檢查點在 tool_result 接上之後、下一次呼叫之前,不會切在 tool 回合中間
 - **context 用 mid-conversation system message** (`role: 'system'` 接在 messages 裡):
   anthropic 部分模型才收,openai 語意不同,而且轉換 (convert.js) 要多一種形狀。
   維持 user 訊息裡的 text block

## 沒改的

 - 截斷 (`max_tokens`) 時只留文字、丟掉 tool_use 的那則 assistant 訊息:那是**新**接上去的,
   不是改舊的 —— 截斷的那份從來沒送回去過
 - 出錯時 `history.length = startLen`:砍掉的是這一輪的尾巴,前綴不變
 - 跨 provider 換模型 (`convert.js`):本來就是新前綴,照舊只留最新一張圖

## 驗證

 - `test/append-only.mjs`:兩個 provider、兩輪多步,比對連續兩次 request body ——
   前一次的 messages 必須是後一次的前綴;重建後同樣成立;重建不動原本的物件
 - `test/host-timeout.mjs`:逐個逾時、預設、訊息、timeout 不送給 LLM
 - 實打 claude-opus-5-5 (兩輪四次呼叫,plain preset 的 system + 真 tool 定義):

       call  input  cacheWrite  cacheRead  output
       1     4      2121        0          49
       2     2      61          2121       51
       3     2      66          2182       13
       4     4      210         2248       4     <- 第二輪, 讀到第一輪的整段

   每步的未快取 input 只有個位數,thinking 原樣送回沒有被拒。
