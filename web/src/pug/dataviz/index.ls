/*
 * dataviz sample — 三個 sample 裡唯一**有領域**的一個。
 *
 * 另外兩個示範的是「wagent 不知道你在做什麼」; 這個示範的是反面 ——
 * 一個應用要怎麼把自己的領域講給 agent 聽, 以及**資料怎麼流到 block**:
 *
 *   使用者改試算表 -> store (應用層的文件狀態, 唯一真相)
 *                       ├─> sandbox: 以「值」餵給 block (opt.data), block 不讀檔
 *                       ├─> device dev/sheet: agent 用 cat / grep / wc 直接查
 *                       └─> sheet UI: 回寫視圖
 *
 * block 拿到的是值不是路徑, 所以換個環境、換份資料就能跑。這條線斷了不會報錯,
 * 只會畫出舊資料 —— 所以它需要一個活著的 sample 守著。
 */
api = '/api/dataviz'   # 與另外兩個 sample 不同: 這個 mount 有代入 dataviz 的 purpose

default-path = (type) ->
  switch type
  | 'js'  => 'index.min.js'
  | 'css' => 'index.min.css'
  | _     => 'index.html'

mgr = new block.manager do
  registry: (o) ->
    bust = if o.type is 'css' or o.type is 'js' then '' else "?t=#{Date.now!}"
    "/assets/lib/#{o.name}/#{o.version or 'main'}/#{o.path or default-path o.type}#{bust}"

wagent = '@plotdb/wagent'

create = (bid, root, d) ->
  mgr.get bid
    .then (cls) -> cls.create {root, data: d}
    .then (inst) -> inst.interface!

Promise.all [window.wagentRuntime, window.dataviz]
  .then ([{create-runtime}, dv]) ->
    # 資料由應用層持有。sheet UI 與 device 都只是它的視圖。
    store = window.store = dv.create-store!

    # devices: 把文件狀態以檔案形式給 agent — 它就能用 grep / wc / head 去查,
    # 不必為每種資料各開一個 tool。名單要在建 shell 前就定。
    # 隔離有**兩層, 互相獨立**, 這個 sample 兩層都用著 —— 不是因為需要,
    # 是因為疊起來的行為要有人一直踩著, 不然哪天壞了沒人知道:
    #   mounts.path  換掉 /home 背後的儲存 (OPFS 的哪個子目錄)
    #   root         換掉 workspace 的虛擬路徑 (agent 看到的世界)
    # 於是實體位置是 OPFS:/dataviz/dataviz/。另外兩個 sample 只用第一層。
    # 選項先組成物件再傳。寫成 `create-runtime do` + 縮排屬性的話, 後面同一層的
    # `.then` 會被吃進最後一個屬性裡 (devices: ['sheet'].then(...)), 編譯得過、
    # 執行才炸 —— LiveScript 的 do-block 沒有結束標記, 只能靠縮排。
    rt-opt =
      api: api
      mounts: {'/home': {backend: 'opfs', path: 'dataviz'}}
      root: '/home/dataviz'
      devices: <[sheet]>

    create-runtime rt-opt
      .then (rt) ->
        window.rt = rt
        dv.seed rt.io .catch (e) -> console.warn 'seed failed', e
          .then -> [rt, dv, store]

  .then ([rt, dv, store]) ->
    current-el = document.getElementById \current
    sheet-info = document.getElementById \sheet-info
    chat = null

    sandbox-opt =
      api: api
      io: rt.io
      source: (name) -> rt.io.load-text dv.block-path name
      # **這裡就是那條線**: 給 block 的是解析好的值, 不是檔案路徑。
      data: (name) ->
        v = store.value!
        {columns: v.columns, rows: v.rows}
      list: -> dv.list-blocks rt

    create {name: wagent, path: 'block/sandbox/index.html'}, document.getElementById(\sandbox-root), sandbox-opt
    .then (sb) ->
      window.sb = sb

      show = (name) ->
        return if not name
        current-el.textContent = dv.block-path name
        sb.show name
        chat?.set-block name

      # ── 試算表 ────────────────────────────────────────────────────
      show-info = ->
        sheet-info.textContent = "#{store.value!rows.length} rows x #{store.dimensions.length} cols"

      sh = window.__sh = new sheet {root: \#sheet-root, data: store.raw!}
      from-sheet = false
      sh.on \change, ->
        from-sheet := true
        store.set-raw sh.data!
        from-sheet := false

      # store 是唯一真相, 所以同步放在這裡而不是放在某一條寫入路徑上。
      # 之前只在 write_sheet 裡同步, 結果從別的來源改 store 時 UI 就跟真值分岔
      # (畫面顯示舊資料, 圖卻是新的)。
      store.on ->
        rt.set-device \sheet, store.toCSV!    # device 是唯讀鏡像, 每次變更都推
        show-info!
        sh.data store.raw! if not from-sheet
        sb.update-data! if sb.current!         # 有 client.data 就增量更新, 否則重掛
      rt.set-device \sheet, store.toCSV!
      show-info!

      # 檔案變更仍然要重畫 —— 來源不只 agent (終端機、之後的編輯器都算)
      rt.on-fs-change (o) ->
        return if not sb.current!
        return sb.refresh! if not o.paths
        dir = "#{dv.BLOCK_DIR}/#{sb.current!}/"
        hit = o.paths.some (p) ->
          rel = if p.index-of("#{rt.root}/") is 0 then p.slice(rt.root.length + 1) else p
          rel.index-of(dir) is 0
        sb.refresh! if hit

      rt.register-host do
        snapshot: sb.snapshot

        tools: [
          * name: 'write_sheet'
            description: 'Replace the whole spreadsheet with the given CSV (first row must be the header). ' +
              'Use this to put sample data in. The chart redraws automatically.'
            parameters:
              type: 'object'
              properties: {csv: {type: 'string', description: 'full CSV including the header row'}}
              required: <[csv]>
              additionalProperties: false
          * name: 'open_block'
            description: 'Show a block in the preview pane, making it the current editing target. ' +
              'Call this after creating a NEW block — otherwise the user keeps looking at the previous one.'
            parameters:
              type: 'object'
              properties: {name: {type: 'string', description: 'block directory name under blocks/'}}
              required: <[name]>
              additionalProperties: false
        ]
        run: (name, args) ->
          switch name
          | 'write_sheet' =>
            n = store.fromCSV (args?csv)
            Promise.resolve "sheet now has #{n} data rows"
          | 'open_block' =>
            n = (args?name or '').trim!
            if not n => return Promise.reject new Error 'name is required'
            show n
            Promise.resolve "now showing #{n}"
          | _ => Promise.reject new Error "unknown host tool: #{name}"

        brief: [
          '這個頁面: 左邊是對話, 右邊即時渲染「目前開啟的 block」,'
          '下面是一張試算表 — 圖表的資料來源, 使用者可以直接編輯, 改了圖就重畫。'
          '試算表以唯讀檔案 dev/sheet 呈現 (csv): 用 cat / grep / wc / head 直接查, 不必另外開 tool。'
          '要改資料用 write_sheet。block 那端則由執行環境注入 opt.data, **不要讀檔**。'
          '改到「目前開啟的 block」時預覽會自己重畫;建立新 block 之後要呼叫 open_block,'
          '否則使用者看到的還是上一個。寫完務必呼叫 snapshot 確認真的畫出來了。'
        ].join '\n'

        context: ->
          dv.list-blocks rt .then (list) ->
            v = store.value!
            openedBlock: sb.current!
            blocks: [b.name for b in list]
            sheet:
              columns: ["#{c.name}:#{c.type}" for c in v.columns]
              rowCount: v.rows.length
              firstRow: v.rows.0 or null

      show 'sample-bar'
      create {name: wagent, path: 'block/chat/index.html'}, document.getElementById(\chat-root),
        {api, block: 'sample-bar', sandbox: sb, transport: rt.transport}
      .then (c) -> chat := c

  .catch (e) ->
    document.body.textContent = '初始化失敗: ' + e.message
    console.error e
