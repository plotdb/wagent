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
   失敗時沒有補發。改成失敗時再補一則 `error: true`


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

待辦:0.3.2 發布後升級,順便把 `logs/20260810-browser-runtime.md` 備註裡
「esh 的 grep 是 JS regex 近似品,flag 未實作時回空字串」那條更新掉。另外 — **之前被清空但沒被空內容覆寫過的檔案,資料可能還在 OPFS 磁碟上**
(失真只發生在 zenfs 的鏡像層),必要時可用原生 `navigator.storage.getDirectory()` 直讀救回。


## 驗證

 - host RPC:直接 dispatch `host-call` → 拿到報告;未知 tool 回 `unknown host tool: <name>`,
   錯誤有正確傳回 worker 端
 - 報告內容:sample-bar 渲染後 `inkRatio 0.555 / levels 5 / blank false`;
   連續兩次 snapshot 得到 `changedSinceLast: false, changedRatio: 0`
 - 端到端(openai / gpt-5):「把長條圖改成橘色」→ read_file → edit_file → **snapshot**(模型自己叫的)
   → 回覆說明已改色並確認畫面正常。第二次「改成綠色」同樣走完
