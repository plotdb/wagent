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

    snapshot({target, width, height, mode, image}) -> {report, image?}

 - `report`(必回):空白偵測、渲染錯誤、與上一張的差異量。便宜,不花 vision token。
 - `image`(預設 false):要圖才給圖。host 內部可能來自 block 自報的 capture,或泛用的 DOM→圖(snapdom)。

參數空間現在就預留、實作可先忽略:

 - `target` — 未來:哪個 sandbox / 哪個 entry(block 可能有 `/index.html`、`/mobile/index.html`)
 - `width` / `height` — 未來:指定尺寸,做 responsive 檢查
 - `mode` — 未來:`live`(使用者當下看到的)/ `fresh`(以指定尺寸另外重繪一份)

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

 - **host → client**:host 提供服務給 block(i18n、資源解析等)
 - **client → host**:block 回報選用能力給 host。與 snapshot 相關的是 `capture` / `pause` / `seek` / `state` / `sample`
 - block 端必須有 **host 不存在時的 fallback** — block 會被發佈到別處(makechart、composer、任意網頁)執行,不能假設 host 存在

**資料不透過 fs 給 block。** agent 讀寫檔,host 解析後把資料畫進去(對照 makechart 的 binder:chart block 拿到的是資料,不是檔案路徑)。這讓 block 可攜:換個 host、換份資料就能跑。

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
 - **fs 變更事件**:block 或使用者寫檔後,host 需要知道以便重繪、agent 需要知道以免撞樂觀鎖。esh 目前無 watch。
