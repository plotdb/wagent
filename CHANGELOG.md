# Change Logs

## master

 - fixes:
   - `fs-change` 的路徑前綴改成跟著當下的 agent root 走。先前在建監聽時就把 root 存成
     常數,`setAgentRoot` 之後回報的路徑是拿舊 root 拼的 — 應用層比對落空 → 不重畫,
     而 agent 看到「檔案改了但畫面沒動」,會回頭去修一個沒壞的 block。
     順帶把 root 為 `/` 的情況正規化(原本會拼出 `//blocks/...`)。
     `setAgentRoot` 目前沒有呼叫點,所以從未觸發過
 - refactor:
   - **workspace 拓樸移出 wagent**。`blocks/<name>/index.html` 這個目錄約定原本寫死在
     prompt 的 Workspace 結構、`compose()`、`runtime` 的 `io.listBlocks`、sandbox 的
     `mount()` 與切換選單 — 判準與先前 SEED / DATAVIZ 同一條:單一 block 的應用
     根本沒有 `blocks/`。sandbox 改由應用層供給 `source(name)` 與 `list()`
     (`data(name)` 已在);`io.listBlocks` 移到 `packages/dataviz/web/blocks.js`;
     `BASE` 只講 block 的檔案格式,目錄約定寫在應用層的 brief / purpose。
     (server 模式的 `wsenv.listBlocks` / `/blocks` route 仍留著,舊 demo 在用)
   - `IO_BROWSER` 不再宣告 `opt.data` 注入的是 loader — 那與 dataviz purpose 的
     「不要 loadText」互相矛盾,agent 等於同時收到兩套指示
 - features:
   - host 觀察通道:`snapshot` tool — 回結構化報告(size / blank / canvas ink ratio /
     svg 圖形數 / 可見文字 / 與上次的差異量),不出圖不花 vision token。
     prompt 要求寫完 block 後自行確認畫面
   - worker → 主執行緒的反向 RPC(`host-call` / `host-result`),非檔案系統的 tool 在主執行緒執行;
     `registerHost({tools, run})` 讓 host 可再註冊額外 LLM tool
   - `tools.js` 依 host 契約分區 shell / content ops / host tools
   - snapshot 出圖(`image: true`):snapdom 把 DOM 轉圖(canvas / svg / shadow DOM 通吃),
     800px jpeg 控 token;tool 結果可為 `{text, image}`,anthropic 走 tool_result block、
     openai 補一則 user message,兩邊都只保留最新一張圖
   - snapshot `mode: 'fresh'` + `width` / `height`:畫面外以指定尺寸另掛一份再看,
     不干擾使用者當下畫面 — responsive 檢查;差異量分情境記錄
   - block 視覺協定(走 `@plotdb/block` 的 host / client,bid `@plotdb/wagent`):
     block 可選擇實作 `capture` / `pause` / `seek` / `state`,讓動畫、遊戲、WebGL 也能被檢查;
     沒實作就 fallback 泛用路徑。prompt 教 agent 寫出可被檢查的 block
   - snapshot 報告加 `client.implements` / `client.seek`:講明 block 實作了哪些能力、
     要求的 `time` 有沒有真的生效
   - **分層解耦**:`opt.data` 的內容改由應用層決定 —
     `create('sandbox', el, {data: function(blockName) {...}})`,不給就是空的。
     wagent 對「資料」的知識歸零,只把應用層給的物件原封不動交給 block
     (之後 composer 換 nodemgr、makechart 換 sharehub,換的是同一個位置)
   - workspace 的初始內容(範例 block)改由**應用層**植入(`packages/dataviz/web/seed.js`)—
     「新使用者第一次看到什麼」是領域決定;順帶把範例改成目前教的資料流
     (`opt.data.rows` + `client.data`),不再示範已淘汰的讀檔寫法
   - `packages/dataviz`:領域知識(d3 / Chart.js 慣例)搬出 wagent 成為獨立應用層,
     以 `purpose` 代入;wagent 不給 purpose 就是一個純粹的 block 編輯環境
   - **重繪的決定移到 application**:worker 發 `fs-change`(包在 shell 物件上,
     agent 的 tool 與使用者的終端機共用同一個 `sh`,一個發射點蓋住兩邊),
     `rt.onFsChange` 讓應用層自己決定要不要重畫。
     另外把「換一個東西給我看」拆成應用層註冊的 `open_block` tool —
     先前是用 `write_file` 的路徑去猜,兩件事混在一起,而且只猜得到 agent
   - **Tier 1 資料綁定(dataviz 應用層)**:資料改由應用層持有,以「值」餵給 block —
     `opt.data = {columns, rows}`,block 不讀檔、不持有任何路徑。
     `packages/dataviz/web/sheet-store.js` 是文件狀態(對照 makechart 的 `local.raw`),
     頁面上以 `@plotdb/sheet` 讓使用者直接編輯,改動即重畫。
     agent 以 `read_sheet` / `write_sheet` 存取(esh 的 device backend 到位後會變成 `/dev/sheet`)。
     csv parser 回到應用層 `packages/dataviz/web/csv.js` — 欄位型別由 dimensions 宣告,
     不再需要「整欄都是數字才轉」那套推測
   - **資料增量更新**:client 協定加 `data(v)` — 資料變動時 host 先呼叫它,
     沒實作(或它拋錯)才整個重掛。重掛會丟掉 block 的內部狀態,動畫類特別明顯。
     走 client 而非直接改 `inst.data`(host 不該動別人的內部狀態);
     `@plotdb/block` 的 `instance.update` 做好之後這層退位
   - snapshot 改成**只觀察不驅動渲染**:等進行中的渲染,但不再自己 refresh。
     那是重繪決定移交應用層之前的遺留 —— 留著會讓 `client.data` 的增量更新作廢
     (每次檢查畫面都重建)。實測:agent 改原始碼一輪 1 次重掛(原本 2 次)、
     改資料 0 次;`snapshot({refresh: true})` 仍可強制
   - **agent 的 fs 範圍(chroot)**:agent 與終端機改用不同 shell、同一份 fs —
     agent 關在 `root` 內(`pwd` 是 `/`、`cd ..` 出不去、`/etc/passwd` 不存在),
     終端機不受限。預設 root 是 workspace,`rt.setAgentRoot()` 可再縮。
     tool 的路徑因此改成 root-relative,不再前置 `/home/workspace`
   - **device 檔案**:應用層的文件狀態以唯讀檔案給 agent(`dev/sheet`,csv)—
     `cat` / `grep` / `wc` / `head -n` 直接查,不必為每種資料各開一個 tool。
     `createRuntime({devices: ['sheet']})` + `rt.setDevice(name, value)`;
     值必須同步可讀而真值在主執行緒,所以 worker 持**單向唯讀鏡像**,寫入仍走 tool
     (避免「worker 寫了但主執行緒還不知道」的雙向分岔)。`read_sheet` tool 因此退場
   - **應用層把自己講給 agent 聽**:`registerHost({tools, run, brief, context})` —
     `brief`(靜態,這是什麼應用)併進 system prompt;`context`(動態,現在什麼狀況)
     每輪取一次附在對話尾端。少了它,應用自己的文件狀態(composer 的 tree、
     makechart 的 raw/bind)對 agent 是全盲的,而它會用猜的。
     有界(2000 字元截斷並講明)、取不到要明講、volatile 不進 system prompt(保住快取前綴)
 - bugfixes:
   - 要求 `time` 但 block 沒實作 `seek` 時默默回一張隨機影格,agent 會當成 t=N 的畫面;
     改成報告寫明 seek 未生效
   - `blockState` 大小由 block 決定,粒子模擬之類可吐出數十 KB 破壞「報告很便宜」的前提;
     2000 字元截斷並要求 block 改回摘要
   - 純色填滿的 canvas 被判成 blank(單一色階即視為空白);改成只有透明或接近全白才算空白,
     純色另報 `uniform` — 「畫了東西但沒有細節」與「什麼都沒畫」是兩回事
   - block 根本沒跑起來時仍給「容器沒高度」「資料沒進到繪圖」的提示,把 agent 帶去修不存在的問題;
     有 error 就只講 error
   - 使用者在終端機改檔(或任何非 write_file 的變更)不會觸發重繪 — 先前只認
     `write_file` / `edit_file` 的路徑;改由 fs 變更事件驅動後,`sed -i` 也會重畫
   - **`settle()` 在增量更新路徑上失效**:它只輪詢到「畫面有東西」為止,
     那是為重掛路徑(空白 → 出現內容)設計的。`client.data` 沒有空白階段,
     第一次輪詢就返回,於是取樣落在動畫中途甚至更新之前 —— 報告說 `changedRatio: 0`,
     而 prompt 明白教 agent「你剛改過卻沒變就回去查」,它會去修一個好好的 block。
     改成等**畫面穩定**(連續兩次取樣一致且非空白);永遠不穩定的動畫類回報
     `stillChanging: true` 並講明差異量不可信
   - `client.implements` 漏報 `data`(`CLIENT_CAPS` 沒收錄),block 明明實作了卻不出現在報告裡
   - `sheet-store` 把內部陣列的參考交給 sheet widget,widget 就地補空白列 —
     `setRaw(4 列)` 同一次呼叫內變成 29 列,文件狀態被畫面狀態污染
     (agent 對 `dev/sheet` 下 `wc -l` 會拿到 29 而實際只有 4 筆)。
     `raw()` / `setRaw()` 一律回/存複本,並在入口 trim 尾端空白列
   - 每輪的應用狀況若把歷史裡舊的整個刪掉,使用者自己切換畫面後 agent 會判定成
     「我上次答錯了」並道歉一個不存在的錯誤(它上次是對的);改成留佔位,
     讓模型分得出「狀況變了」與「我搞錯了」
   - 用較短內容覆寫檔案時 OPFS 不截斷,舊內容的尾巴留著(session 內讀不出來,
     重新整理後 block 變成「新內容 + 舊程式碼殘骸」)。**esh 0.4.0 已修**,
     先前 write 前 unlink 的繞法已拆除
   - snapshot 在背景分頁永遠不 resolve(rAF 不觸發),改與 timeout 競賽
   - snapshot 抓到過期畫面(agent 在 tool loop 中途問,但畫面要整輪結束才重繪),改成預設先重繪
   - 失敗的 tool 在對話紀錄顯示成 ✓:tool 事件改分 `phase: 'start' | 'end'` 兩段
   - 新建 block 後的 snapshot 檢查到的是**舊 block**(sandbox 要整輪結束才切換);
     改成 tool 事件的 `end` 就即時切換並重繪,agent 檢查到的才是自己剛寫的東西
   - 背景分頁的空白畫面被誤診成 block 有 bug(Chrome 凍結 rendering pipeline,rAF 不跑,
     Chart.js 之類根本沒畫);改成偵測 rAF 是否觸發並據此換掉 hint,明講不是 block 的問題
   - 剛掛上的 block 還在載資料 / 跑動畫就被取樣;有 canvas 就輪詢到真的畫出東西為止
   - 沒要圖時模型會拿原始碼推測外觀還宣稱「已確認實際呈現」:tool description / prompt /
     報告內容三處收緊,`image: false` 時直接在報告裡寫明沒看到畫面
 - tweaks:
   - `@plotdb/esh` 升到 0.4.2(device `head` 的 64KB NUL padding — 我方回報;
     新增 `help` builtin;`sed` 僅支援 `s///`)。原 0.4.1(修 redirect 與 sync 寫入的佇列 race — 我方回報;
     實測 io→redirect ×30 / redirect 立即讀 ×30 / sed 交錯 ×20 全綠)。原 0.4.0(OPFS 靜默資料遺失、覆寫不截斷兩個修復;
     新增 scoped root `createShell({root})` / `sh.chroot()` 與 device backend,尚未接);
     API 無破壞性變動
   - `@plotdb/agent` 更名 `@plotdb/wagent`(`packages/agent` -> `packages/wagent`);
     專案定位由「對話生成圖表」升級為編輯宿主 (host),名稱與 repo 一致
   - `context/project/host.md`: Host 定義 — mounts / shell / content ops / snapshot / tools(選用)


## v0.2.0

 - features:
   - browser runtime (Phase A): agent loop 與 tool 執行移入 Web Worker,
     後端只剩 LLM proxy (`POST /api/agent/llm/:provider`;注入 key、model 白名單、rate limit、SSE pipe)
   - workspace 改由 `@plotdb/esh` 0.2.0 提供 (shell + zenfs,`/home/workspace` 掛 OPFS 持久化);
     tool 為 run_shell / read_file / write_file
   - esh-term 與 agent 共用同一個 worker:人與 agent 操作同一份 working tree
   - chat / sandbox block 抽象化:`data.transport` / `data.io` 有則走 browser runtime,
     無則 fallback 後端 `/chat` 與 workspace URL — 同一套 block 前後端兩用
   - prompt 分 server / browser 兩種 IO 模式;新增 `GET /prompt` 供 browser runtime 取用
   - edit_file tool(前後端兩邊):精確字串取代 + 樂觀鎖(檔案被外部改過則拒絕並要求重讀),
     錯誤訊息含匹配數與下一步供 LLM 自我修正;小改用 edit_file、新檔或重寫用 write_file
 - bugfixes:
   - chat base 的 applyEvents 只認 write_file,edit_file 改完不會觸發重新渲染
 - tweaks:
   - `@plotdb/agent` 前端資產改置於 `web/{block,runtime}`,fedep 以 `dir: 'web'` 出貨


## v0.1.0

 - init release: 對話生成圖表 block 的試作 (note.md Agent Runtime 構想的 Phase 1 簡化版)
 - `@plotdb/agent` 模組 (packages/agent, npm workspace):
   - api router (chat tool loop / blocks / provider / reset), wsenv (workspace fs), llm provider adapter (anthropic / openai)
   - chat / sandbox 前端 block (@plotdb/block 格式, base 邏輯層 + derived 視覺層)
   - streaming 三等級 (none / tool / token, SSE), 後端允許上限 + 前端期望協商
   - 渲染錯誤自動修正 (safe guard: 只修 LLM 剛寫的 block、次數上限、成功或手動發話歸零)
 - workspace 為唯一 source of truth: blocks/<name>/index.html + data/
 - 前端 lib 以 fedep 管理 (assets/lib/<name>/<version or main>/)
 - 測試頁 /refactor-0809-module/; 舊版 (/, /edit.html, /refactor-0809/) 暫留
