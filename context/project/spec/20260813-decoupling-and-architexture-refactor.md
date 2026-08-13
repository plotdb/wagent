# 分層解耦與架構修正 (2026-08-13)

一次設計討論的結論。起因是我(agent)實作了 `block.json` 資料綁定,被指出方向錯誤;
往下追之後發現錯的不只是那個檔案,而是**分層的位置感**。

這份文件記錄:錯在哪、正確的分層是什麼、下一步做什麼。


## 分層

    application            領域應用 (makechart / composer / 我們的測試頁)
      |                    擁有: 文件狀態、資料語意、領域慣例
      v
    wagent / host          介面框架。開窗口給 agent, 對領域一無所知
      |
      +-- agent loop       依指示執行者
      +-- shell            檔案操作指令層
      +-- sandbox          渲染環境, snapshot 的對象

**判準:一個拿 wagent 做遊戲、做 web component 的人,用不到的東西就不屬於 wagent。**

用這個判準去測 `blockdata.js`(csv parser):遊戲用不到 → 它屬於 application。
而我把它放進 `packages/wagent/web/runtime/` 並讓 sandbox 直接 import,放在了錯的一邊。


## 錯誤一:`block.json`

我做的:`blocks/<name>/block.json` 宣告 `{"data": {"orders": "data/orders.csv"}}`,
host 讀檔、解析後注入 `opt.data.orders`。理由寫的是「這讓 block 可攜」。

**為什麼錯:**

 - 理由是假的。`block.json` 裡放的是**這個 workspace 的路徑**,搬到 makechart 毫無意義。
   我用可攜性當理由,做出來的卻是把 workspace 的目錄結構焊進 block 的包裡
 - 它是 block html **沒有定義過的外部固定依賴**。`@plotdb/block` 完全不知道那個檔案存在;
   從 block 的角度它不存在,從 host 的角度它是必要的 — 這個落差就是問題本身
 - 等於私自定義了一個 `@plotdb/block` 不認得的打包格式
 - 沒有 `block.json` 的 block **每次 mount 都多一次註定失敗的讀取**;
   fresh 模式每截一個尺寸 mount 一次,檢查三個尺寸就是三次

**正確的模型(看了 makechart / composer 之後):**

`makechart` 的 `host.local.raw` 存的是**資料本身**,存在 sharedb 的協作文件裡。
xlsx 上傳 → `XLSX.utils.sheet_to_csv` → 變成 `local.raw`,從此那個檔案就不重要了。
`composer` 的 `hostitf.get/set` 從 `nodemgr` 依 node id 取,ctx 還會被 sharedb patch。

**兩邊的 block 都從來不讀檔,而且都沒有存路徑。**

所以正解不是「orders → data/orders.csv」,是「這份文件裡有這些資料」。
在 wagent 裡誰把 csv 搬進文件?**agent** — 它本來就握有 fs 與 shell,這正是它的工作。
路徑問題因此整個消失,因為不存在跨越邊界的路徑。

我先前一直在找「怎麼把路徑安全地傳給 block」,那個問題本身就是錯的。


## 錯誤二:領域知識滲進 host 層

同一個錯犯了兩次:`block.json` 的說明我寫進了 prompt 的 **`BASE`** 而不是 `DATAVIZ`。
`compose(purpose, block, mode)` 這個設計本來就是為了隔開領域,結果圖表的資料慣例
被塞進了所有 block 都會吃到的那一段。

現在需要 csv 純粹是因為我們剛好做了幾個圖表。這句話應該直接變成程式碼裡的邊界。


## 資料的三個層級

討論中釐清的分類 — 我先前把它們混成一種:

**Tier 1 — runtime data(用戶的資料,會變)**
不是依賴,不打包,不宣告。block 開 API(`chart.setRaw` 這種),由外面餵進來。
makechart 已經是這樣。**wagent 的圖表情境屬於這層。**

**Tier 2 — block 自己的小資料(關卡、對照表、demo)**
inline 在 html 裡就夠,`<script type="application/json">` 是最自然的載體 —
不執行、不渲染、內容是惰性文字。單檔、免宣告、bundle 免費附送,`@plotdb/block` 不用改。

**Tier 3 — block 自己的、大到不該 inline 的資料**
只有這層才需要宣告式依賴,也只有這層值得動 `@plotdb/block`。
**wagent 目前這層的數量是零** — 我做的 `block.json` 服務了一個不存在的情境,
同時把真正存在的 Tier 1 做錯了方向。


## 契約 vs 綁定

正確的切法(makechart 已經有完整實作,比我提的更好):

 - **契約在 block** — `host.chart.mod.dimension` 是 chart block 宣告的維度,
   `binder.ls` 的整個 UI 是**從那個宣告生成的**
 - **綁定在 host** — `host.local.bind` 由 `datum.type.bind raw, mod.dimension` 算出,host 持有

不需要重新設計,照抄形狀即可。


## 關於改 `@plotdb/block`

**現在不要。** 它同時被 composer / makeform / makechart 用,
為一個 wagent 還沒遇到的 Tier 3 去動共用依賴,方向是反的。

真的要做的時候,方向大致是:

 - 走 `pkg.dependencies`,不走 `custom`。`custom` 解決「額外資訊放哪」,
   但只有 block 知道它的意思 → **bundler 還是不能對它做任何事**,而那才是唯一難的問題
 - 需要宣告的真正理由是 **bundle**,不是可攜性:bundler 不執行 block,
   所以 runtime 的 fetch 它永遠看不到。檔案清單必須靜態可讀
 - 這比想像中更不像「擴充」:`{name, path, type}` 已經在了(`type: css`),
   bid 已經有 path 維度,而 `pkg.i18n` 本來就是**非程式碼的資料**,
   由 `@plotdb/block` materialize 成 `i18n` / `t` 注入 init。
   `type: 'data'` 是這個既有模式的第四個實例,不是新概念
 - 傾向 adapter 而非 host api:若讀檔是 host api,block 的可攜性就退化成
   「只能在有實作這組 api 的 host 裡跑」,等於把 host 種類綁進 block
 - 解析不該在 loading 層(會長出 csv/tsv/yaml/xlsx 格式動物園)。
   json 可破例,因為 `JSON.parse` 是平台內建
 - 時機要一致:一律**在 init 之前備妥**,否則會出現「打包後正常、開發時壞掉」

以上未定案,真要動之前得先讀 `ctx` 與 dependency 解析的實作(目前只讀了用法)。


## 待處理:application 如何把自己講給 agent 聽

**wagent 的核心是 agent 做事,而 agent 需要懂 application 在幹嘛。**

現況查證:

 - `opt.purpose` 是 **server 建 router 時決定的靜態字串**,`GET /prompt` 只吃 `block` / `mode`
 - agent 每個 session 只抓一次 system prompt

也就是:**`registerHost({tools, run})` 讓應用層可以動態說「你可以做什麼」,
但沒有對應的管道說「這是什麼應用」或「現在是什麼狀況」。**
能力是動態的,知識是開機時寫死的。

agent 需要的應用資訊有三種:

| | 管道 | 狀態 |
|---|---|---|
| 慣例(靜態) | `purpose` | 有,但**在錯的層**(server 決定,應用在瀏覽器) |
| 能力 | `registerHost` tools + esh 自訂指令 | 現況正確 |
| 狀況(動態) | — | **完全沒有** |

第三個最有牙齒:composer 的 node tree、makechart 的 `local.raw` / `local.bind`,
**既不在 fs 裡也不在 snapshot 裡** — 前者是文件狀態,後者只看畫面。agent 對它們全盲。

**原則:push the index, pull the content。**
每輪推一份很小、有界的狀況摘要,細節由 agent 用指令去拉。
這跟 report vs image 是同一個形狀 — 便宜的摘要一律給,貴的細節要了才給。

為什麼不做純 pull:這個專案一路上的失敗模式就是 **agent 會對沒看過的東西編故事**
(宣稱看過畫面、拿原始碼推測顏色,修了三處才壓下去)。文件狀態若只能 pull,它就會用猜的。

暫定形狀:

    rt.registerHost({
      tools, run,
      brief:   function() {...},   // 靜態: 這是什麼應用、慣例
      context: function() {...}    // 動態: 現在的狀況, 有界
    })

`brief` 併進 system prompt,順便把 `purpose` 從 server 開機參數移回應用層,
`DATAVIZ` 也就不用再賴在 `packages/wagent` 裡。server 只保留 BASE / IO 的組裝邏輯。

兩個已知的坑:

 - **有界**。`blockState` 吐 19KB 那件事會原封不動重演 — composer 的 tree 可以任意大。
   要在 host 這層截,而且截掉要講
 - **prompt cache**。每輪都變的東西塞進 system prompt = 每輪打掉快取前綴。
   volatile 的部分要放尾端,不能跟穩定的慣例混在一起


## 執行計畫

**批次一(本次):decoupling**

 - 退掉 `block.json`(sandbox 的 `blockData` / `blockdataUrl`、prompt 的說明)
 - sandbox 不再自己決定資料怎麼來,改由上層給:
   `create('sandbox', el, {api, io, data})`,`data` 是應用層提供的 provider,
   沒給就是空的 — block 拿不到任何東西也能跑
 - 測試頁(`refactor-0810-esh/index.pug`,這就是 application 層)自己傳
   `{loadText, loadJSON}`。**行為完全不變,但那個決定從 wagent 移到了應用層**
 - `blockdata.js` 的 csv parser 移到應用側,`resolveData` 刪掉
 - prompt 的 `block.json` 段落從 `BASE` 拿掉

目標:**wagent 這層對「資料」的知識歸零** — 它只知道有一個 `opt.data` 會交給 block,
內容是什麼它不看也不碰。之後 composer 換 nodemgr、makechart 換 sharehub,換的是同一個位置。

**批次二:application → agent 的知識管道 — 已完成**

`registerHost({tools, run, brief, context})`。實測四項:

 - 應用層切換畫面後(不經過 agent),agent 下一輪就知道 — 且**不用任何 tool**
 - `context` 拋錯時 agent 回「無法確定」,而不是沿用上一輪狀態
 - 19929 字元的 context 截到 2000,agent 正確回報被截斷且看不到尾端的 marker
 - **舊 context 不能整個刪掉**(見下)

`purpose` 維持由 server 代入(`server.js` 就是應用層的進入點,沒有分層問題);
瀏覽器端的應用要動態補充就用 `brief`,兩者相加。

### 實測抓到的新問題:刪掉舊 context 會讓 agent 編出不存在的錯誤

第一版把歷史裡舊的 context **整個移除**(理由:過期狀態會被當成現在)。
結果使用者自己把畫面切到別的 block 之後:

> 現在開啟的是 sokoban-game。**不一樣;我上一則誤答成 sample-bar,抱歉。**

它上一則是**對的**。移除佔位之後,模型看到的歷史裡只有自己說過 sample-bar、
而現在的狀況是 sokoban-game,沒有任何證據顯示那當時為真 ——
於是它無法區分「狀況變了」與「我搞錯了」,選了後者,並向使用者道歉一個不存在的錯誤。

修法:舊 context 換成佔位(內容省掉、保留「當時有一份」這個事實),
並在每輪的 context 裡明說狀況會在兩輪之間改變、不一致時預設是狀況變了。
修完再測:「這跟我上一則回答的不一樣(上一則是 sample-bar)」— 陳述變化,不再道歉。

這是同一個主題的第 N 個實例:**觀察通道的價值取決於它報告的是不是真相**,
而這次說謊的不是通道本身,是通道的**保留策略**。


## 附帶記錄:又一個 esh OPFS bug

用較短內容覆寫檔案時 OPFS **不截斷**,舊內容的尾巴留著。session 內讀不出來
(記憶體鏡像是對的),重新整理後才爆。已回報 esh
(`tasks/opfs-overwrite-no-truncate.md`),wagent 端在 `write_file` / `edit_file`
先刪再寫繞過,修好後拿掉。

嚴重度高:「把檔案改短」是 agent 最常做的事之一,而寫完當下所有檢查都會過。
