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

**嵌進既有站台時,打到 api 的請求常常需要額外 header** —— CSRF token、bearer 之類:
那些站台的 api 前面就擋著這類檢查,而 llm proxy 是 POST,逃不掉。
`createRuntime({headers})` 會把它們帶到 provider 的請求上;token 會過期
(session 重生、CSRF 換一輪),所以另外有 `rt.setHeaders(h)` 可以整份換掉 ——
只在建 runtime 時給一次是不夠的。

> `worker` / `esh` 這些 URL 若已經帶了 query(對資產加版本的站台就會 —— 沒有
> cachestamp 的話改了 wagent 卻載到舊的,而且完全沒有跡象),client 會用 `&` 接。
> 但注意 worker 的**靜態 import**(`./providers/*.js`)不會跟著帶版本,
> 開發時要嘛讓那個目錄不要被瀏覽器快取,要嘛清快取。


## Host 介面契約

一個環境要成為 **agent-compatible**,必須提供以下四塊,第五、六塊選用:

### 1. mounts — fs 組態

fs 本身由 esh / zenfs 提供;host 決定掛什麼、掛在哪、可否寫入。

    browser:  /home/workspace -> OPFS
    server:   /home/workspace -> Passthrough(node:fs, '<dir>')

由應用層以 `createRuntime({mounts})` 指定,不給就是 OPFS。只吃可 JSON 序列化的設定 ——
worker 是另一個 realm,傳不了 backend class。

**node 那半在 esh 0.5.0 成立了。** 走 `@plotdb/esh/node-zenfs`(不是預設的
`.` entry —— 那個仍是「零墊片」:直接綁真 `fs`,忽略 mounts、沒有 chroot 與 device),
mounts / chroot / device 三個在 Node 全通,`passthrough` backend 把真磁碟的子目錄
掛進虛擬 fs(對應瀏覽器的 opfs)。需 node ≥ 20.16。

`test/node-esh.mjs` 是這個組合的驗收(21 項):chroot 爬不出去、passthrough 雙向可見、
append 不清空、readdir/stat、device 的值不落磁碟、指向 jail 外的 symlink 讀不到。
**symlink 圍堵預設是開的** —— chroot 管不到真磁碟的 symlink,真 fs 解析會直接穿出去,
所以那條線是 esh 在 fs 層另外擋的。要關得明講 `followSymlinks: true`。

**隔離有兩層,互相獨立,可以只用一層也可以疊起來:**

    mounts: {'/home': {backend: 'opfs', path: 'dataviz'}}   換掉 /home 背後的儲存
    root:   '/home/dataviz'                                  換掉 workspace 的虛擬路徑

同一個 origin 上的頁面共用同一份 OPFS,兩層都不用就會互相看到對方的檔案。
`path` 需 esh 0.5.1(可多層,逐段建);`root` 省略就是 `/home/workspace`。
本 repo 的 sample:另外兩個只用儲存層,dataviz 兩層都用 —— 疊起來的行為要有人
一直踩著,實體位置因此是 `OPFS:/dataviz/dataviz/`。

**兩者都不是安全邊界** —— 同一個 origin、同一份配額,頁面上的 JS 隨時能繞過去。
真正的圍堵是 agent 的 chroot。

> 換了隔離方式之後,舊位置的東西會**留在原地變成孤兒**(不會被刪,也不會自動搬)。
> 更麻煩的是換 `mounts.path` 時:原本 `/home/x/` 底下的東西會浮成 `/home/` 底下 ——
> 因為 `/home` 指到的子目錄變了。看起來像檔案自己跑掉了,其實是掛載點換了。

`root`(東西放哪)與 `agentRoot`(agent 看得到哪一段)是兩件事:後者預設等於前者,
應用層可以再把它縮到單一 block 的目錄。

同一份 host 定義前後端通用,差別只在 mount table。`@zenfs/core` 另有 `Fetch`(唯讀遠端)、`Port`(跨 worker)、`CoW` 等 backend 可用。

**agent 與使用者的終端機用不同的 shell、同一份 fs**(esh 0.4.2 的 per-shell root):

    sh       未限縮 — 終端機與主執行緒的 io (應用層要看整棵樹: 列 block、讀原始碼)
    shAgent  createShell({root}) — "/" 即 root, cd .. / 絕對路徑 / glob 都穿不出去

分開的理由:使用者仍想在整棵樹裡逛,agent 不該。共用一個 shell 就只能二選一。
「人與 agent 操作同一份 working tree」不受影響 —— 分的是**視野**,不是資料。

fs 變更事件回報的是**絕對路徑**,而 rooted shell 只知道相對 root 的路徑,所以要補前綴。
前綴必須**跟著當下的 root 走**:存啟動時的快照的話,`setAgentRoot` 之後回報的路徑
就是拿舊 root 拼的,應用層比對必定落空 → 畫面不重畫,而 agent 看到的是
「檔案改了但畫面沒動」,照 prompt 的指示回頭去修一個沒壞的 block。root 為 `/` 時
前綴要是空字串(給 `/` 會拼出 `//blocks/...`)。

預設 root 是 workspace。`rt.setAgentRoot(path)` 可再縮(host 端 API,shell 內呼叫不到),
但要注意縮到單一 block 目錄後 agent 就**建不了新 block**、也看不到掛在 workspace 層的 device ——
那是「應用決定編輯對象」的嵌入情境(composer / makechart)才適用,不是這個 demo 的工作流。

**device 的範圍屬於 workspace**(已定案),不是單一 block —— 所以 block 內容放在
約定的資料夾下(`blocks/<name>/`)。要做 per-block 的 chroot,前提是那個約定夠明確,
而 device 若也要進 block 範圍則需要 esh 的執行期 mount(目前沒有)。

**device 檔案**:應用層的文件狀態可以用檔案形式給 agent,它就能用 `cat` / `grep` / `wc` / `head -n` 去查:

    createRuntime({devices: ['sheet']})   ->  dev/sheet (唯讀 csv)
    rt.setDevice('sheet', csv)            ->  更新內容

值必須**同步**可讀(`readFileSync` 依 stat size 配 buffer),而真值在主執行緒,
所以 worker 持一份**單向唯讀鏡像**;寫入走 tool,避免「worker 寫了但主執行緒還不知道」的雙向分岔。
device 必須掛在 agent root 之內才看得到。

路徑語意:

 - **沒有 cwd 的概念暴露給 block。** block 取資源時,相對路徑相對於**該 block 自己的目錄**(對齊 `@plotdb/block` 的 `path(p)`),不是頁面根。
 - agent 有 cwd(shell 的),那是 agent 的工作狀態,與 block 無關。

### 2. shell — 指令介面層

esh 實例,負責路徑操作與探索(`ls` / `cat` / `grep` / `find` / `mkdir` / `rm` / `mv` / `sed`,含 pipe、glob、重導向)。

**host 可註冊自訂指令**,這是能力擴充的主要出口。新能力預設應該做成 shell 指令,而不是新的 LLM tool:

 - LLM 的 tool 清單保持固定且短,不隨環境膨脹(tool 一多,模型選擇品質下降)
 - 指令可組合(`ls src | grep util`)
 - 發現機制現成(`help`、`--help`)

不要用 shell 寫入檔案內容 — 重導向的內容會經過 shell parser。內容一律走 content ops。

### 3. content ops — 內容讀寫

固定三個,不隨 host 變動:

 - `read_file(path)`
 - `write_file(path, content)` — 新檔或結構性重寫
 - `edit_file(path, old_string, new_string, replace_all?)` — 精確字串取代,小改用這個

`edit_file` 帶**樂觀鎖**:記住上次交給 LLM 的內容,edit 前重讀比對,被外部改過則拒絕並要求重讀。這是本專案特有的併發來源 — 使用者可能在 esh-term 動同一份 tree,未來 block 也可能寫檔。

應用層自己則透過 `rt.io` 讀寫 workspace(相對路徑以 agent root 為基準):
`loadText` / `loadJSON` / `writeText`,以及 esh 0.5.0 起的 `readdir(path, {withFileTypes})`
/ `stat(path)`。後兩個回的是**純 JSON 形狀**(`{name, isDirectory}` /
`{size, mtimeMs, isFile, isDirectory}`)而不是 Node 的 Dirent/Stats —— 因為要跨
worker 的 postMessage,local 與 remote 才能是同一組 API。

`rt.io` 刻意**不提供「列出 block」**:那需要知道 block 放在哪個目錄、檔名叫什麼,
而目錄形狀是應用層的約定(見〈拓樸〉)。要畫檔案樹就用 `readdir` 自己遞迴 ——
`multiple-blocks` 的 sample 就是這樣做的。不要用 `ls -R` 解析 stdout:那得靠
「有沒有人以它為前綴」猜誰是目錄,空目錄會被誤判成檔案。

> **應用層自己的模組放哪。** 這個 repo 的 `sample/dataviz/` 是一個有領域的應用:
> 文件狀態、csv、seed、目錄約定、領域 prompt。它不經 srcbuild(那是頁面的事),
> 由 server 直接以 ES module 交出去;`purpose` 則掛在**自己的 api mount**
> (`/api/dataviz`)—— 一台 server 上可以有好幾個應用,各有各的領域 prompt。
> 分這一刀的理由:應用換個頁面照樣能用。

### 4. snapshot — 觀察通道

**必要。** 「這個 host 是不是 agent-compatible」就是靠它定義。

    snapshot({image, mode, width, height, time, target}) -> {report, image?}

 - `report`(必回):空白偵測、渲染錯誤、與上一張的差異量。便宜,不花 vision token。
 - **取樣前要等畫面穩定**(連續兩次取樣一致),不是等「有東西」。
   只等「有東西」是為重掛路徑設計的;增量更新沒有空白階段,會取樣到動畫中途,
   報出 `changedRatio: 0` —— 而 agent 被教的是「剛改過卻沒變就回去查」,於是去修一個好好的 block。
   永遠不穩定的動畫類回報 `stillChanging` 並講明差異量不可信(那種情況該用 `pause` / `seek`)
 - **snapshot 只觀察,不驅動渲染。** 它等進行中的渲染,但不自己發動重繪 ——
   「什麼時候重畫」是應用層的事(fs 變更 / 資料變更都由它判斷)。
   先前這裡預設會 refresh,那是重繪決定移交應用層之前的遺留;留著會讓
   `client.data` 的增量更新完全作廢(每次檢查畫面都重建一次)。要強制重繪傳 `refresh: true`
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

#### headless renderer — 沒有使用者在場時的觀察通道

snapshot 是契約裡**唯一必要**的那塊,而它需要一個 renderer。Node 沒有 DOM,
所以「wagent 在 Node 上跑」如果不解決這件事,得到的是一個**看不見自己成果的 agent** ——
而這整個分支的工作有一半是在建立那條觀察通道。

解法是把渲染交給 headless 瀏覽器。附帶的好處不小:CDP 的 `Page.captureScreenshot`
抓的是**真實合成後的畫面**,不是 snapdom 的 foreignObject 重繪,所以下方「未定案」
裡 `getDisplayMedia` 想解決的失真問題,以及 WebGL `preserveDrawingBuffer`、
`capture` 沒實作的情況,在這條路上一併消失 —— 而且不需要使用者手勢授權。

**關鍵限制:renderer 不持有 fs。**

    Node 端                                headless page
    ─────────────────────────────────      ────────────────────────
    持有 fs (真磁碟)                        沒有 fs
    跑 agent loop                    ──►    掛上去、等穩定、出報告
    決定要畫什麼                             {report, image}
                                     ◄──
      { source, data, width, height, time }

讓 headless 那頁也持有一份 fs(OPFS)是**明確錯誤的做法** —— Node 一份、瀏覽器一份,
就又是「兩份狀態、一條要自己維護的同步線」,本專案反覆出事的形狀
(store/UI、snapshot/實際渲染、fs-change prefix/root)。

正確的模型跟我們對 block 做的事**是同一條原則**:餵值,不餵路徑。block 拿到的是
`opt.data` 的值所以換環境就能跑;renderer 拿到的是 `source` 的字串,所以它不需要知道
workspace 存在。sandbox 那塊程式碼因此一行都不用改 —— 它本來就只吃 `source` 與 `data`
兩個應用層窗口。

**打包:** headless 依賴瀏覽器本體(數百 MB),不能是 `@plotdb/wagent` 的必要相依。
獨立套件 + `playwright` 列 peer,由使用情境決定裝不裝。

**已知待驗:** headless 對背景頁的節流行為與一般分頁不同,而我們已經有一條
「背景分頁凍結 rAF」的提示。headless 下該調哪些 flag、那條提示還準不準,要實測。

### 5. tools(選用)— host 額外提供的 LLM tool

    host.tools() -> {tools: [{name, description, schema}], run(name, args)}

預設空。agent loop 把它併到固定的五個 tool 之後。

取捨準則(重要,否則這裡會變成所有新需求的預設出口):

> 能用 fs 表達的走 content ops,能用指令表達的走 shell 自訂指令,兩者都不合適的才當 tool。
> 典型是:**非檔案系統的操作、需要結構化參數、或要回傳二進位 / 非文字結果**。
> `snapshot` 是這類的第一個成員(且因為必要而被提升為固定 tool)。

### 6. brief / context — 應用層把自己講給 agent 聽

    registerHost({tools, run, brief, context})

wagent 的核心是 agent 做事,而 agent 需要懂**應用層**在幹嘛。少了這格,agent 只看得到
檔案(shell)與畫面(snapshot);應用自己的文件狀態 —— composer 的 node tree、
makechart 的 `raw` / `bind` —— 對它是全盲的,而**它會用猜的**。

 - `brief`(靜態):這是什麼應用、慣例是什麼。併進 system prompt
 - `context`(動態):現在是什麼狀況。**每輪取一次**,附在對話尾端

**原則:push the index, pull the content。** 每輪推一份很小的摘要,細節由 agent 用指令去拉 ——
與 report vs image 同一個形狀。不做純 pull,是因為這個專案一路上的失敗模式就是
**agent 會對沒看過的東西編故事**;只能 pull 的狀態它就會用猜的。

四個必要性質(都已實測):

 - **有界**:`context` 超過 2000 字元截斷並講明原長度。大小由應用層決定,不設界就會重演
   `blockState` 吐 19KB 那件事
 - **失敗要明講**:取不到時附上 `(unavailable: ...)` 而不是靜靜略過 ——
   靜靜略過會讓 agent 沿用上一輪的狀態繼續做
 - **volatile 不進 system prompt**:system 是快取前綴,每輪都變的東西塞進去等於每輪打掉快取
 - **舊的換成佔位,不能整個刪掉**:實測發現直接刪掉的話,使用者自己切換畫面後,
   agent 看到現在的狀況與自己上一則回答不符,會判定成「我上次答錯了」並向使用者道歉 ——
   它上次其實是對的。少了佔位,模型無法區分「狀況變了」與「我搞錯了」,於是**編出一個不存在的錯誤**


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
           data: function(v) {},      // 資料更新 (見下), 沒實作就整個重掛
           pause: function() {},      // 停掉 rAF 迴圈, 讓畫面可重現
           seek: function(t) {},      // 跳到指定時間 / 影格
           state: function() {},      // 結構化狀態, 併入 report 的 blockState
           capture: function() {}     // 自己截圖, 回 canvas / Blob / dataURL
         };
       }

 - `capture` 存在就優先用它 —— WebGL 自己 `readPixels` 遠比外部重繪準確,
   也繞開 `preserveDrawingBuffer` 的坑
 - `pause` / `seek` 是動畫與遊戲可被檢查的前提:不凍結時間,前後對照的 diff 全是噪音
 - `data` 是**過渡措施**。資料變動時 host 呼叫它做增量更新,沒實作就重新 mount
   (重掛會丟掉 block 的內部狀態:動畫重來、選取消失)。
   語意上它有點偏 —— `client()` 原本是「我對這個 host 回報的能力」,而餵資料
   比較像 block 的公開行為。**它已不再是唯一的擴充點**:那個「公開行為」的位子
   本來就是 `interface`,`adapt` 讓應用層直接用它(見下節)。
   `@plotdb/block` 的 instance 另外留了 `update` 的位子(原始碼標著 TBD),
   那個做好之後 `data` 就退位。**host 不該直接改 `inst.data`** — 那是伸手動別人的內部狀態;
   代價是 `inst.data` 兩種做法都會過期(只有 instance 自己能改),
   目前無害,因為 `run()` 只在 init / destroy 讀它
 - `state` 通常比看圖更好用也更便宜(「玩家在哪、幾個敵人、選中什麼」),優先用它。
   但它的大小完全由 block 決定 — host 會在 2000 字元處截斷並要求 block 改回摘要,
   否則「便宜的報告」這個前提會被一個粒子模擬直接打破
 - report 會回報 `client.implements`(這個 block 實作了哪些)與 `client.seek`(seek 是否真的生效)。
   **要求了 `time` 但 block 沒實作 `seek` 時必須講明**,否則 agent 拿到的是一張隨機影格,卻以為自己看的是 t=N
 - block 端必須有 **host 不存在時的 fallback** — block 會被發佈到別處(makechart、composer、任意網頁)執行,不能假設 host 存在;
   host 端也一樣,client 沒實作就走泛用路徑

### 拓樸:wagent 不知道檔案放哪

**目錄形狀是應用層的約定。** 一個只編輯單一 block 的應用,檔案就在 `/index.html`,
根本沒有 `blocks/`;一個拿 wagent 做遊戲的人,目錄長什麼樣是他自己的事。
判準與資料、與 prompt 的 purpose 同一條。

先前這個假設漏在 wagent 五個地方(`blocks/<name>/index.html` 寫死在 prompt 的
Workspace 結構、`compose()` 拼出的編輯對象、`runtime` 的 `io.listBlocks`、
sandbox 的 `mount()` 與切換選單),已經全部移到應用層。sandbox 因此有**四個窗口**:

    create('sandbox', el, {
      io,                                  // 泛用讀寫 (不含「列出 block」)
      data:   function(name) { ... },      // 這個 block 拿到的 opt.data
      source: function(name) { ... },      // 名字 -> 原始碼 (不給就把 name 當路徑)
      list:   function() { ... },          // 可切換的清單 (不給就收起選單)
      adapt:  function(itf, value) { ... } // 資料怎麼進 block (不給就走 client.data)
    })

`adapt` 是「資料怎麼進 block」的第二條路,見下方〈資料進 block 的兩條路〉。

prompt 那側也一樣:`BASE` 只講 block 的**檔案格式**,不講它放哪;
`compose()` 只說「正在編輯 block 甲」,不拼路徑。目錄約定由應用層寫在 `brief` / `purpose`
(見 `packages/dataviz/prompt.js` 與 `packages/dataviz/web/blocks.js`)。

> 註:server 模式的 `wsenv.listBlocks()` 與 `/blocks` route 仍留著同樣的假設。
> 那條路徑目前只有舊的 refactor-0809 demo 在用,拆掉會動到它,尚未處理。

### 組合:block 引入 block

block 可以把同一個 workspace 裡的其他 block 掛進自己的畫面,用 ns `local` 定址:

    opt.manager.from({ns: 'local', name: 'clock'}, {root: el})

sandbox 給 block 的 manager 有兩條解析規則:**沒有 ns 的走 `/assets/lib/...`(已發佈的
資產),ns 為 `local` 的走 `registry.fetch` callback,由應用層的 `source(name)` 交出原始碼**。
分開的理由是 workspace 裡的 block 不在任何 URL 上(fs 在 OPFS 裡)、而且隨時會被改,
跟發佈出去的東西不是同一種東西。

`manager.from(bid, opt)` 的第二個參數是**選項物件**(`{root: el}`),不是 DOM 元素 ——
傳元素進去會靜靜地什麼都不掛(`attach` 讀的是 `opt.root`)。

### 資料:wagent 不碰

`opt.data` 的**內容由應用層決定,wagent 對它一無所知**。sandbox 只是把應用層給的物件原封不動交給 block。

 - 不給 `data` 就是空的 — block 拿不到任何東西也應該能跑
 - 資料的語意(csv 怎麼解、哪一欄對哪個維度)屬於應用層。判準:**一個拿 wagent 做遊戲、
   做 web component 的人用不到的東西,就不屬於 wagent**
 - 之後 composer 換成 `nodemgr`、makechart 換成 `sharehub`,換的都是這個位置

正確的模型是**文件狀態,不是檔案路徑**:makechart 的 `host.local.raw` 存的是資料本身(在 sharedb 裡),
composer 的 `hostitf.get/set` 依 node id 從 `nodemgr` 取。兩邊的 block 都不讀檔、也不持有路徑。
在 wagent 裡把檔案變成文件資料的是 **agent** —— 它本來就握有 fs 與 shell。

目前測試框架注入的是 `{loadText, loadJSON}`(block 自己按路徑讀),**那是過渡做法**,
記在 `spec/20260813-decoupling-and-architexture-refactor.md`。

### 資料進 block 的兩條路

預設那條是 `opt.data` 進 block、變動時 `client.data` 增量更新。它假設 block 是為
這個 host 寫的 —— 宣告 `pkg.host`、實作 `client()`。

**早於 host / client 機制存在的 block 不是這樣。** 它們透過 `interface` 對外提供方法,
而那正是 `@plotdb/block` 本來就設計來讓 block 公開行為的地方(instance 的 `update`
至今仍標著 TBD,`interface` 則一直可用)。makechart 的圖表就是這種:host 拿到
interface 之後自己 `config` / `setRaw`,block 從不讀 `opt.data`。

要它們改寫成 `client.data` 是本末倒置 —— 那等於為了一個 host 去改一批早就有公開介面
的 block。所以 sandbox 開第四個窗口:

    adapt: function(itf, value) {
      itf.config(value.config);
      itf.setRaw(value.rows, value.bind);
    }

`itf` 是 block instance 的 `interface()`,`value` 就是 `data(name)` 回的東西。
掛好之後與資料變動時各呼叫一次;回 Promise 的話 sandbox 會等它,失敗則退回重掛
(與 `client.data` 同一套約定 —— 不能留著舊畫面假裝更新過了)。

判準與 `source` / `list` 同一條:**「資料怎麼進 block」是應用層的領域知識**,
wagent 不知道也不該替它決定,所以開窗口而不是規定做法。給了 `adapt` 就走它,
沒給就是原本的 `client.data`,兩者都沒有就重掛。

report 的 `client.dataVia` 會講明走的是哪一條。不講的話,走 `adapt` 的應用會讓 agent
看到「`implements` 是空的」卻又畫得出東西 —— 而它對看不懂的狀況會編故事。


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
