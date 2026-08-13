# Host 定義

wagent 從「對話產生圖表」升級為**編輯宿主(host)**:提供一個環境,讓 agent 能像人一樣操作它。

核心視角:**agent 是操作 host 的人。** host 開什麼窗口,agent 就能做什麼事。這與「host 提供一組 tool 給 agent」不同 — 後者把 agent 當成 host 的延伸,前者把 agent 當成使用者,兩者的擴充方式與邊界因此不同。


## 專案分層

    host        介面框架。持有 mounts、shell、sandbox、chat,決定 agent 看得到什麼。
      |
      +-- agent loop   依指示執行者。與 LLM 對話、呼叫 tool、回填結果。不認得任何領域概念。
      |
      +-- shell        esh 實例。檔案操作的指令介面層,host 可註冊自訂指令。
      |
      +-- sandbox      渲染環境。snapshot 的對象。

三者都在瀏覽器的同一個 worker / 主執行緒內(見 `logs/20260810-browser-runtime.md`),後端只剩 LLM proxy。


## Host 介面契約

一個環境要成為 **agent-compatible**,必須提供以下四塊,第五塊選用:

### 1. mounts — fs 組態

fs 本身由 esh / zenfs 提供;host 決定掛什麼、掛在哪、可否寫入。

    browser:  /home/workspace -> OPFS
    server:   /home/workspace -> Passthrough(node:fs, '<dir>')

同一份 host 定義前後端通用,差別只在 mount table。`@zenfs/core` 另有 `Fetch`(唯讀遠端)、`Port`(跨 worker)、`CoW` 等 backend 可用。

路徑語意:

 - **沒有 cwd 的概念暴露給 block。** block 取資源時,相對路徑相對於**該 block 自己的目錄**(對齊 `@plotdb/block` 的 `path(p)`),不是頁面根。
 - agent 有 cwd(shell 的),那是 agent 的工作狀態,與 block 無關。

### 2. shell — 指令介面層

esh 實例,負責路徑操作與探索(`ls` / `cat` / `grep` / `find` / `mkdir` / `rm` / `mv` / `sed`,含 pipe、glob、重導向)。

**host 可註冊自訂指令**,這是能力擴充的主要出口。新能力預設應該做成 shell 指令,而不是新的 LLM tool:

 - LLM 的 tool 清單保持固定且短,不隨環境膨脹(tool 一多,模型選擇品質下降)
 - 指令可組合(`ls blocks | grep chart`)
 - 發現機制現成(`help`、`--help`)

不要用 shell 寫入檔案內容 — 重導向的內容會經過 shell parser。內容一律走 content ops。

### 3. content ops — 內容讀寫

固定三個,不隨 host 變動:

 - `read_file(path)`
 - `write_file(path, content)` — 新檔或結構性重寫
 - `edit_file(path, old_string, new_string, replace_all?)` — 精確字串取代,小改用這個

`edit_file` 帶**樂觀鎖**:記住上次交給 LLM 的內容,edit 前重讀比對,被外部改過則拒絕並要求重讀。這是本專案特有的併發來源 — 使用者可能在 esh-term 動同一份 tree,未來 block 也可能寫檔。

### 4. snapshot — 觀察通道

**必要。** 「這個 host 是不是 agent-compatible」就是靠它定義。

    snapshot({image, mode, width, height, time, target}) -> {report, image?}

 - `report`(必回):空白偵測、渲染錯誤、與上一張的差異量。便宜,不花 vision token。
 - `image`(預設 false):要圖才給圖。來源優先序 = block 自報的 `capture` > 泛用的 DOM→圖(snapdom)。
 - `mode`:`live`(預設,使用者當下看到的)/ `fresh`(畫面外以指定尺寸另外掛一份,截完就丟)
 - `width` / `height`:fresh 模式的尺寸,用來做 responsive 檢查
 - `time`:有實作 `seek` 的 block,凍結並跳到指定時間再看
 - `target`:指定 block(預設為目前顯示的那個)

`fresh` 不動使用者當下的畫面,而且尺寸確定、可重現 —— 前後對照與多尺寸檢查都靠它。
差異量(`changedSinceLast` / `changedRatio`)**分情境記錄**(live、各尺寸的 fresh 各自一份),
不同尺寸互相比較沒有意義。

**snapshot 不做成 shell 指令**,理由:fs 描述的是 block 的原始碼,snapshot 的對象是一次 render 的結果,而 render 參數(尺寸、entry、資料)是 host 的 session 狀態,不在 fs 裡。寫成 `snapshot index.html` 會看起來像檔案操作,實際上在操作 shell 看不見的東西。

snapshot 的輸出也不落地到 workspace — 成果目錄只放成果。需要落地(讓人看得到、存成 thumbnail、多 sandbox 定址)時,再考慮加 `/tmp`、`/dev` 這類端點。

### 5. tools(選用)— host 額外提供的 LLM tool

    host.tools() -> {tools: [{name, description, schema}], run(name, args)}

預設空。agent loop 把它併到固定的五個 tool 之後。

取捨準則(重要,否則這裡會變成所有新需求的預設出口):

> 能用 fs 表達的走 content ops,能用指令表達的走 shell 自訂指令,兩者都不合適的才當 tool。
> 典型是:**非檔案系統的操作、需要結構化參數、或要回傳二進位 / 非文字結果**。
> `snapshot` 是這類的第一個成員(且因為必要而被提升為固定 tool)。


## Agent loop 的職責

 - 取得固定五個 tool(`run_shell` / `read_file` / `write_file` / `edit_file` / `snapshot`)加上 host 選用的 tools
 - 與 LLM 對話、dispatch tool、回填結果、串流事件
 - **不認得任何領域概念**。它不知道自己在編 block 還是在編別的東西

錯誤約定:tool 一律回錯誤訊息而不是中斷 loop,訊息要寫明「發生什麼 + 下一步」,讓 LLM 能自我修正(如 `edit_file` 的「matched 3 times, add context or set replace_all」)。


## Block 與 host 的關係

`@plotdb/block` 已有 host / client 機制(`pkg.host` 宣告、caller 傳 `host: {bid, interface}`、block 以 `client({bid})` 回報能力),`@grantdash/composer` + `@makeform/*` 是既有實作參考。

目前的 host bid 是 **`@plotdb/wagent`**(sandbox 就是這個 host 的實作)。

 - **host → client**:host 提供服務給 block。目前是 `{loadText, loadJSON, mode}`
 - **client → host**:block 回報選用能力給 host,全部選用:

       pkg: {host: {name: '@plotdb/wagent'}, ...},
       client: function() {
         return {
           pause: function() {},      // 停掉 rAF 迴圈, 讓畫面可重現
           seek: function(t) {},      // 跳到指定時間 / 影格
           state: function() {},      // 結構化狀態, 併入 report 的 blockState
           capture: function() {}     // 自己截圖, 回 canvas / Blob / dataURL
         };
       }

 - `capture` 存在就優先用它 —— WebGL 自己 `readPixels` 遠比外部重繪準確,
   也繞開 `preserveDrawingBuffer` 的坑
 - `pause` / `seek` 是動畫與遊戲可被檢查的前提:不凍結時間,前後對照的 diff 全是噪音
 - `state` 通常比看圖更好用也更便宜(「玩家在哪、幾個敵人、選中什麼」),優先用它。
   但它的大小完全由 block 決定 — host 會在 2000 字元處截斷並要求 block 改回摘要,
   否則「便宜的報告」這個前提會被一個粒子模擬直接打破
 - report 會回報 `client.implements`(這個 block 實作了哪些)與 `client.seek`(seek 是否真的生效)。
   **要求了 `time` 但 block 沒實作 `seek` 時必須講明**,否則 agent 拿到的是一張隨機影格,卻以為自己看的是 t=N
 - block 端必須有 **host 不存在時的 fallback** — block 會被發佈到別處(makechart、composer、任意網頁)執行,不能假設 host 存在;
   host 端也一樣,client 沒實作就走泛用路徑

**資料不透過 fs 給 block。** agent 讀寫檔,host 解析後把資料畫進去(對照 makechart 的 binder:chart block 拿到的是資料,不是檔案路徑)。這讓 block 可攜:換個 host、換份資料就能跑。

實作:`blocks/<name>/block.json` 宣告需求,host 讀檔、依副檔名(或 `type`)解析後注入 `opt.data.<key>`。

    {"data": {"orders": "data/orders.csv", "cfg": {"src": "data/c.json", "type": "json"}}}

 - csv / tsv → 物件陣列;**整欄**都是數字才轉 number。逐格轉會讓同一欄混出 number 與 string,
   下游的排序與比較會安靜地出錯,而且郵遞區號、產品編號這種前導零代碼會被吃掉
 - 解析器自己寫(`runtime/blockdata.js`,零依賴)。host 不該因為「有人要畫圖」而拖進 d3
 - 讀不到 / 解析失敗要**一次列出全部**再拋,而不是修一個發現下一個;
   而且必須讓 render 失敗,別讓 block 拿著 undefined 畫出一片空白 — 空白會被歸因到別的地方
 - `loadText` / `loadJSON` 仍在,給還沒轉過來的 block

edge case:檔案多 / 大 / 動態的 block(遊戲素材、地圖圖磚)可能真的需要 fs 存取。這是 host 的選用能力,尚未實作;方向是 host 為每個 block instance 組一張掛載表(而非路徑白名單),並優先考慮用 Service Worker 把 fs 映成 URL 前綴,讓 block 維持標準 web 寫法(`fetch` / `<img src>` / CSS `url()`)。


## 邊界:host ↔ agent 是唯一必須 message-safe 的線

    agent (worker)  ──[ 必須 Promise + structured-cloneable ]──►  host
                                                                   │ 同 realm, 可傳 DOM / closure
                                                                   ▼
                                                                 blocks

agent 在 worker、host 未來可能在 iframe,所以這條線的參數與回傳值必須可 structured clone。

host ↔ block 之間**不需要**這個約束 — 若整個 host(含 block tree)搬進 iframe,邊界是畫在 host 外面,裡面仍是同 realm。composer 現行那種吃 DOM 的 handler 因此不需要改寫。


## 未定案

 - **多 entry / nested block**:`/index.html` 之外可能有 `/mobile/index.html`、`/editing.html`;巢狀 block 的組合方式未定義。snapshot 的 `target` 為此預留。
 - **`/dev`、`/tmp`**:把 renderer 當裝置、把暫存輸出與成果分離。概念清楚但需要先定義「裝置是什麼、有幾個、怎麼定址」,現在做等於先賭。
 - **composer 整合**:composer 的 node tree 是「這個頁面要長這樣」的**文件狀態**,不該映射成 fs;fs 在那個情境下管的是這些 node 用到的**程式碼**(近似 node_modules)。tree 操作會是 host 的領域指令(可掛成 shell 自訂指令,依 id 操作,不需要是檔案)。
 - **高保真截圖(`getDisplayMedia`)**:snapdom 走的是 foreignObject 重繪 — 它畫的是「瀏覽器依 DOM 重新畫一次」的結果,不是使用者真正看到的那張。跨 origin 資源、CSS filter/blend、部分字體、以及任何非 DOM 的合成(video、WebGL 疊層)都可能失真。`getDisplayMedia` 抓的是**真實合成後的畫面**,能繞開全部這些。代價:需要使用者授權且只能由使用者手勢觸發(agent 無法自行開啟),抓的是整個分頁/視窗要再裁切,而且背景分頁一樣不更新。方向是當成**選用的高保真模式** — 使用者按一次「允許 agent 看畫面」,host 留住 stream,之後 snapshot 走 `ImageCapture` / `drawImage` 取幀,失敗再退回 snapdom。這也順帶解決 WebGL `preserveDrawingBuffer` 與 `capture` 沒實作的情況。
 - **fs 變更事件**:block 或使用者寫檔後,host 需要知道以便重繪、agent 需要知道以免撞樂觀鎖。esh 目前無 watch。
