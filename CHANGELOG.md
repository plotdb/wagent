# Change Logs

## master

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
 - bugfixes:
   - 要求 `time` 但 block 沒實作 `seek` 時默默回一張隨機影格,agent 會當成 t=N 的畫面;
     改成報告寫明 seek 未生效
   - `blockState` 大小由 block 決定,粒子模擬之類可吐出數十 KB 破壞「報告很便宜」的前提;
     2000 字元截斷並要求 block 改回摘要
   - 純色填滿的 canvas 被判成 blank(單一色階即視為空白);改成只有透明或接近全白才算空白,
     純色另報 `uniform` — 「畫了東西但沒有細節」與「什麼都沒畫」是兩回事
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
   - `@plotdb/esh` 升到 0.3.2(OPFS 靜默資料遺失修復、redirect 回讀驗證、
     sed `;` 多重運算式、grep `-c`/`-q` 與無符合 exit 1);API 無變動
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
