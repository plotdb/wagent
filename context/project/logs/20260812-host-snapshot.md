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


## esh 的資料遺失問題(已回報 esh,未修)

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


## 驗證

 - host RPC:直接 dispatch `host-call` → 拿到報告;未知 tool 回 `unknown host tool: <name>`,
   錯誤有正確傳回 worker 端
 - 報告內容:sample-bar 渲染後 `inkRatio 0.555 / levels 5 / blank false`;
   連續兩次 snapshot 得到 `changedSinceLast: false, changedRatio: 0`
 - 端到端(openai / gpt-5):「把長條圖改成橘色」→ read_file → edit_file → **snapshot**(模型自己叫的)
   → 回覆說明已改色並確認畫面正常。第二次「改成綠色」同樣走完
