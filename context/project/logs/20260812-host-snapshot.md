# 2026-08-12 Host 化與 snapshot 通道

依 `context/project/host.md`:把 tool 面收斂成 host 契約,並補上唯一缺的一塊 — 觀察通道。


## 做了什麼

 - `web/runtime/tools.js` 依契約分區:`shellTools` / `contentTools` / `snapshotTool`,
   `makeRunTool(sh, {log, host})` — shell 與 content 之外的 tool 一律轉給 host
 - **worker → 主執行緒的反向 RPC**(新機制):`host-call` / `host-result`,20s timeout;
   主執行緒一律回覆(含失敗),否則 agent loop 會空等
 - `host-tools`:主執行緒可註冊額外 LLM tool,worker 併進固定五個之後(目前沒人用,窗口先開著)
 - `client.js` 加 `registerHost({tools, run})`,對應 host.md 的第五塊
 - sandbox base 實作 `snapshot()`:回結構化報告 — size / elements / 可見文字 /
   canvas ink ratio + 色階數 / svg 圖形數 / `blank` / `changedSinceLast` + `changedRatio`
 - prompt 加使用時機:寫完 block 後呼叫 snapshot;blank 為 true 或改過卻沒變就回去查

snapshot 只回報告,不出圖 — 「空白 / 沒變化」這類最常見的問題不需要 vision token。
出圖(snapdom)與 image content block 留待下一步。


## 過程中修掉的三件事

 - **rAF 在背景分頁不觸發**:snapshot 等兩個 frame 才抓,分頁被切走時就永遠不 resolve,
   agent 會卡到 timeout。改成 rAF 與 300ms timeout 競賽
 - **snapshot 抓到過期畫面**:agent 是在 tool loop *中途* 問畫面的,但 chat 要整輪結束
   才觸發重繪 — edit_file 後的 snapshot 看到的是改動前那一版。改成 snapshot 預設先重繪
   (`refresh()` 會同步觸發視覺層的 render,再等 `self.rendering`)
 - **失敗的 tool 顯示成 ✓**:tool 事件是在 dispatch 當下發的(為了即時顯示在做什麼),
   失敗時沒有補發。改成 tool 事件分 `phase: 'start' | 'end'` 兩段
 - **新 block 的 snapshot 檢查到舊 block**(升級 0.3.2 時的端到端驗出):
   chat 原本要整輪結束才把 sandbox 切到新寫的 block,但 agent 寫完就馬上 snapshot —
   它「確認」的是上一個 block 的畫面。改成 tool 事件的 `end` 就即時套用(切換 / 重繪);
   必須是 `end` 不能是 `start`,否則會在寫入完成前就重繪、讀到舊檔。
   順帶好處:使用者也能即時看到 agent 的進度


## 出圖(snapdom)

`snapshot({image: true})` 才出圖,預設只回文字報告。

 - `@zumer/snapdom` 2.24.1(零依賴,155KB ESM),fedep pin 到
   `/assets/lib/@zumer/snapdom/main/`,只在第一次要圖時才動態 import
 - `snapdom.toCanvas(el, {width: 800, dpr: 1, backgroundColor: '#fff', fast: true})`
   → `toDataURL('image/jpeg', 0.8)`。800px + jpeg 是為了壓 token(實測 800x479 約 23KB)
 - canvas / svg / shadow DOM snapdom 自己處理,Chart.js 與 d3 都不必特別對待 —
   原本規劃的「canvas 直取 / SVG 序列化」那層省下來了
 - tool 結果的形狀擴充成:字串 或 `{text, image: {mediaType, data}}`
   - anthropic:tool_result 的 content 支援 block 陣列,圖直接放進去
   - openai:tool message 只吃字串,圖另外補一則 user message(`image_url` data URL)
   - 兩邊都做 `pruneImages`:**只留最新一張**,舊圖換成 `[earlier image omitted]` —
     否則每輪都要為同一張圖重付 token

保真度實測:把截到的圖貼回頁面比對,座標軸、刻度、圖例、長條全部正確。

### 兩個要記住的行為

 - **背景分頁截不到圖**。snapdom 需要 renderer 有在出 frame(它會等 image decode),
   Chrome 把背景分頁的 pipeline 凍結後就無限等。純 div 沒事,含 canvas 就卡住。
   所以 capture 一定要有 timeout(6s),逾時回 `imageError` 說明原因,文字報告照常回。
   端到端驗證時模型收到這個錯誤,如實說「截圖在背景分頁逾時未成功」再改用原始碼推論 — 符合預期。
 - **不要圖的時候模型會假裝看過**。第一版 prompt 寫「圖的成本遠高於報告,不要每次都要」,
   結果問「配色跟可讀性有沒有問題」時模型用 `image: false`,卻回「已拍快照確認實際呈現」,
   顏色其實是從原始碼推的。三處一起收緊後改掉:tool description 寫明
   「問到外觀就必須 image: true,拿原始碼推測外觀是錯的」、prompt 同步、
   而且 `image: false` 時報告裡直接加一句 `you have not seen the actual rendering`。
   修正後同樣的問題第一個 tool call 就是 `snapshot {"image": true}`。


## fresh 模式與 block 視覺協定(20260813)

snapshot 的預留參數開放,並把 block 的選用能力接上 `@plotdb/block` 既有的 host / client。

 - `mode: 'fresh'` + `width` / `height`:在畫面外(`position:fixed; left:-99999px`)以指定尺寸
   另外掛一份、截完 detach 丟掉。不動使用者當下的畫面,尺寸確定、可重現 — responsive 檢查靠它
 - `time`:配合 block 的 `seek` 凍結到指定時間再看
 - 差異量改**分情境記錄**(`live:<block>`、`fresh:<w>x<h>:<block>`);不同尺寸互相比較沒有意義
 - host bid = `@plotdb/wagent`。host → client 提供 `{loadText, loadJSON, mode}`;
   client → host 回報 `capture` / `pause` / `seek` / `state`,全部選用,沒有就走泛用路徑
 - `capture` 存在就優先用(WebGL 自己 readPixels 最準);`state` 併進 report 的 `blockState`

驗證(自寫兩個測試 block,驗完刪掉):

 - 同步繪圖 block:fresh 375x400 與 1200x400 都正確渲染(`inkRatio 1`,色階數不同),
   重跑同尺寸 `changedRatio: 0`,期間 live 的 block 沒被動到
 - client 測試 block:`pause` 被呼叫到(`paused: true`)、`seek(4)` 讓畫面真的變了
   (`changedRatio 0.164`)、`state` 出現在 `blockState`、`hostSeen: true` 證明 host interface 有到 block、
   `capture` 回的 40x20 圖取代了 snapdom 的輸出 — 優先序正確

### 又一個「觀察通道會說謊」的案例

fresh 模式在**背景分頁**會渲染出空白:Chart.js 靠 rAF 畫圖,而 Chrome 凍結背景分頁的
rendering pipeline(實測 600ms 內 rAF 觸發 0 次)。原本的報告會說
「block 沒拋錯但畫面空白 — 檢查資料有沒有進到繪圖」,**這是誤診,會把 agent 送去修一個不存在的 bug**。

改成 `settle()` 回報 rAF 到底有沒有觸發,空白時依此給不同的 hint:
rAF 沒跑就直說「分頁在背景、renderer 被凍結,這很可能不是 block 的問題,不要據此修改」。
誤導性的診斷比沒有診斷更糟 — 這已經是這個通道上第四個同類問題(rAF 卡死、畫面過期、看錯 block、誤診)。


## esh 的資料遺失問題(已回報 esh,esh 側已修)

**OPFS backend 上,檔案冷掉之後任何 shell 同步寫入(`>` 重導向、`sed -i`)→ 0 bytes,
exit code 0、stderr 空,完全無聲。**

    await io.writeText('x.txt', 'OLD'.repeat(200));
    await sleep(500);                                  // 關鍵: 讓檔案「冷掉」
    await sh.run('echo NEW > /home/workspace/x.txt');   // code 0
    (await io.loadText('x.txt')).length                // -> 0

縮範圍的過程值得記一下,因為第一版判斷是錯的:一開始以為是「併發讀 + `sed -i`」的競態,
但逐項排除後發現**併發完全無關**,真正的變數是距離上一次寫入的時間:

| 情況 | 結果 |
|---|---|
| 寫完立刻執行(0〜10ms) | 正常 |
| 冷掉後(≥20ms)`echo >` 或 `sed -i` | **0 bytes** |
| 冷掉後 `cat` / `grep` / `cp` | 正常(同步**讀**沒問題) |
| `sh.io.writeFile`(非同步寫) | 正常 |
| 記憶體 backend | 正常(OPFS 特有) |

門檻:10ms 還正常,20ms 就翻 — 像是某個 cache / flush 視窗。
推測同步寫入是先 truncate 再寫,而寫的那段在 OPFS 上沒落地;剛寫過的檔案還在記憶體所以看不出來。

對我們的影響:agent 走 `sh.io.*`(非同步)所以安全,但**終端裡的人**用的是 shell,
一個 `sed -i` 就把檔案清掉 — 我們是人機共用同一份 working tree,這條路一定會被走到。
prompt 早就要求內容一律走 content ops,那只擋得住 agent。

已寫成 task 交給 esh:`esh/context/project/tasks/opfs-sync-write-loss.md`,
並附帶一個請求 — 即使根因要往 zenfs 追,至少要讓它出聲(寫入沒落地就回非 0 exit code)。

**esh 側已找到根因並修好(0.3.2,待發布)**:根因在 zenfs 的 Async mixin,不在 esh 的寫入路徑。
async backend 的 sync 寫入 = 寫記憶體鏡像 + 排 async replay;zenfs 用 **stack 字串比對**判斷
某次 async 呼叫是不是 replay(是就不把參數 echo 回鏡像),但 **bundle 之後 stack 格式對不上**,
每個 replay 都被誤判成新呼叫。sync 寫入的三段式(pre-truncate `{size:0}` → write → touch `{size:n}`)
被 replay 時,`{size:0}` 的 echo 把鏡像的 stat size 歸零;而 `readFileSync` 按 stat size 配 buffer,
size 0 就讀到空字串 —— 資料其實還在。所以 `sed -i` 讀到空再寫回空(這步才真的沒了)。
我們量到的 10〜20ms 門檻就是 replay echo 相對於下一次讀的時序。

esh 的修法:`hardenAsyncMounts()` 把 stack 偵測換成明確的 reentrancy flag;
`>` / `>>` 改 async 寫 + 回讀驗證,失敗回 stderr + code 1;`writeFileSync` 寫後驗 size,不符丟 EIO。
API 無變動,發布後升級即可。

同一輪回報的兩個小問題 esh 也一併修進 0.3.2:`sed` 的 `;` 串接多重運算式現在兩段都套用
(任一段解析失敗整條 code 1,不再靜默吃掉後半);`grep` 補了 `-c` / `-q`,
**且無符合時 exit code 改回 POSIX 的 1**(先前一律 0)—— 升級後 agent 用 `$?` 判斷 grep 結果才可靠。
另確認 `echo x > f && cat f` 這類 read-after-write 有保證(redirect 寫入被 await 到底 + 回讀驗證)。

### 升級 0.3.2 與回歸(20260813)

`^0.2.0` → `^0.3.2`(`packages/wagent` 的 peerDependencies 同步放寬,原本卡在 `^0.2.0` 會 ERESOLVE)。
fedep 重新 pin 到 `/assets/lib/@plotdb/esh/0.3.2`。API 無變動,我們的程式一行沒改。

回歸(瀏覽器實機,`/home` 掛 OPFS):

 - 原始 bug:冷寫入延遲掃描 0 / 10 / 20 / 50 / 100 / 500ms **全部正確**(修正前 ≥20ms 就歸零)
 - 冷 `sed -i` 正確;`echo x > f && cat f` 讀得到
 - `sed -i 's/AAA/BBB/;s/CCC/DDD/'` 兩段都套用
 - `grep -c` 回計數;無符合回 **exit 1**(POSIX)
 - snapshot 兩種模式都正常(report `inkRatio 0.555`;image 800x479 / 23KB)
 - 端到端建新 block:read_file → write_file → run_shell → snapshot → 回覆,圖表正確渲染另外 — **之前被清空但沒被空內容覆寫過的檔案,資料可能還在 OPFS 磁碟上**
(失真只發生在 zenfs 的鏡像層),必要時可用原生 `navigator.storage.getDirectory()` 直讀救回。


## 驗證

 - host RPC:直接 dispatch `host-call` → 拿到報告;未知 tool 回 `unknown host tool: <name>`,
   錯誤有正確傳回 worker 端
 - 報告內容:sample-bar 渲染後 `inkRatio 0.555 / levels 5 / blank false`;
   連續兩次 snapshot 得到 `changedSinceLast: false, changedRatio: 0`
 - 端到端(openai / gpt-5):「把長條圖改成橘色」→ read_file → edit_file → **snapshot**(模型自己叫的)
   → 回覆說明已改色並確認畫面正常。第二次「改成綠色」同樣走完


---

## 端到端驗證 client 協定, 與 block.json 資料綁定 (08/13)

### 讓 agent 自己寫一個會動的 block

先前 client 協定只用我手寫的測試 block 驗過。這次直接叫 agent 做
「彈跳球動畫」, 看它會不會自己實作協定 — 會。它在第一句就說要
「實作 client 介面讓執行環境可暫停/定位時間以利檢查」, 產出的 block
四個都實作了 (pause / seek / state / capture)。

seek 的可重現性也成立: `seek(3)` 兩次 `changedRatio` 為 0, `seek(9)` 才變。
這正是動畫類 block 能做前後對照的前提。

### 但報告在三個地方說謊

同一輪測試抓到三個問題, 形狀都一樣 — **報告看起來很正常, 但講的不是實情**:

1. **要求 `time` 但 block 沒實作 `seek`** → 默默回一張隨機影格。
   agent 會拿它當 t=N 的畫面來比較, 而它其實是隨機的。
   改成回報 `client.implements` 與 `client.seek`, 沒生效就明講。
2. **`blockState` 大小由 block 決定** → 一個 400 entity 的 state 吐了 19KB。
   「報告很便宜, 不花 vision token」這個賣點直接被打破。
   2000 字元截斷 + 要求 block 改回摘要。
3. **純色填滿的 canvas 被判成 blank** — `levels <= 1` 一律當空白。
   但「全透明 / 全白」與「填滿 #39c」是兩件事, 後者是畫了東西。
   改成只有透明或接近全白才算 blank, 純色另報 `uniform`。

第四個在做資料綁定時冒出來: block 因為資料錯誤而**根本沒跑起來**時,
報告仍給「容器沒有高度, 給 wrapper 一個明確尺寸」。這會讓 agent 去改 CSS。
有 error 就只講 error, 其餘都是它的後果。

這已經是這個觀察通道上第 N 個同類問題。結論不變:
**誤導性的診斷比沒有診斷更糟** — 沒有報告 agent 會去查, 錯的報告 agent 會照做。

### block.json 資料綁定

block 不再自己讀檔, 改成宣告需求:

    {"data": {"orders": "data/orders.csv", "cfg": {"src": "data/c.json", "type": "json"}}}

init 直接拿 `opt.data.orders`(已解析)。這是 block 可攜性的關鍵 —
發佈到 composer / makechart / 任意網頁時, 那邊沒有這個 workspace 也沒有 loadText。

實作在 `runtime/blockdata.js`, 零依賴。兩個刻意的決定:

 - **csv 自己解, 不用 d3。** host 不該因為「有人要畫圖」而拖進一個視覺化函式庫。
 - **數值轉換以整欄為單位。** 逐格轉會讓同一欄混出 number 與 string, 下游排序與
   比較會安靜地出錯; 前導零 (`007`, 郵遞區號) 也一律留字串。

驗證: `qty` 轉 number、`code=007` 留 string、引號內的逗號與 `""` 跳脫都正確;
壞路徑一次列齊全部再拋, 且讓 render 失敗 (不讓 block 拿著 undefined 畫出空白)。

### 又一個 esh OPFS bug: 覆寫較短內容時不截斷

做資料綁定時, block.json 改短後重新整理變成 `{...}` 加一段上一版的殘句,
`JSON.parse` 直接爆掉。最小重現:

    writeFile('probe.txt', 'A'.repeat(200))
    writeFile('probe.txt', 'B'.repeat(20))
    readFile('probe.txt')            // 20  ← session 內正確
    // --- 重新整理 ---
    readFile('probe.txt')            // 200: 20 個 B + 180 個 A

跟 0.3.2 修掉的那個是同一個形狀(**記憶體鏡像正確、OPFS 實際內容不正確**),
但成因不同 — 這次是寫入沒有 truncate。

嚴重度高: 「把檔案改短」是 agent 最常做的事之一, 而且寫完當下所有檢查都會過,
錯誤延遲到下一次載入才出現, 現場幾乎不可能歸因到寫檔。

已回報 esh (`tasks/opfs-overwrite-no-truncate.md`)。wagent 這邊先在
`write_file` / `edit_file` 繞過(寫之前先刪), 實測經 agent 真實路徑寫入後
重新整理內容乾淨。esh 修好後把這層拿掉。

### 順帶

`getDisplayMedia` 記進 host.md 未定案: snapdom 是 foreignObject 重繪,
畫的是「瀏覽器依 DOM 重新畫一次」而非使用者真正看到的那張;
getDisplayMedia 抓的是真實合成畫面, 適合當選用的高保真模式
(代價是需要使用者手勢授權, agent 無法自行開啟)。
