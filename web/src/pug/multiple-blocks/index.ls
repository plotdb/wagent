/*
 * 多 block sample: 左邊是**唯讀的檔案樹**, 點檔案就換預覽對象。
 *
 * 與 single-block 的差別只有拓樸: 這裡的約定是 blocks/<name>/index.html,
 * 一個目錄一個 block。wagent 對兩種都一無所知 —— 目錄形狀是應用層的約定,
 * 它只透過 sandbox 的 source / data / list 三個窗口跟應用層要東西。
 *
 * 檔案樹是純瀏覽用的: 不能改內容 (沒有編輯器), 存在的理由是**跟 agent 溝通時
 * 看得到全貌**, 以及一鍵切換預覽對象。要編輯內容仍然是跟 agent 講。
 */
api = '/api/agent'
block-dir = 'blocks'

# heredoc 陷阱: 字面的 </script> 會把外層標籤提前關掉, 所以拆開拼;
# 另外 #aaa 這種字母開頭的 CSS 色碼會被當成 LiveScript 的簡寫插值, 要跳脫。
close-script = '</' + 'script>'
seed-name = 'hello'
seed = """
<div>
  <div class="empty">跟 AGENT 聊聊吧</div>
  <style>
    :scope { height: 100%; display: flex; align-items: center; justify-content: center; }
    .empty { color: \#aaa; font-size: 20px; letter-spacing: .05em; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {name: "hello", version: "main", description: "空白起點"},
      init: function(opt) {}
    };
  #{close-script}
</div>
"""

# 解析規則: 一條就夠。bid = (name, version, path) —— name 是模組, path 是模組內
# 的位置;省略 path 時依 type 取預設檔名。
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

# ── 檔案樹 ──────────────────────────────────────────────────────────
# esh 0.5.0 起有 io.readdir(path, {withFileTypes}) —— 回的是純 JSON 形狀
# ({name, isDirectory}) 而不是 Dirent, 因為要跨 worker 的 postMessage。
# 舊版用 `ls -R` 再解析 stdout, 得用「有沒有人以它為前綴」猜誰是目錄,
# 空目錄會被誤判成檔案。現在不必猜了。

# 一個檔案屬於哪個 block: blocks/<name>/... 的 <name>
block-of = (path) -> path.split('/').0 or null

window.wagentRuntime
  # 每個 sample 自己的儲存 — 理由見 single-block 的同一處
  .then ({create-runtime}) ->
    create-runtime {api, mounts: {'/home': {backend: 'opfs', path: 'multiple-blocks'}}}
  .then (rt) ->
    window.rt = rt
    # 空的 workspace 才種 —— 使用者既有的東西不能蓋
    first = "#{block-dir}/#{seed-name}/index.html"
    rt.io.load-text first
      .catch -> rt.io.write-text first, seed
      .then -> rt

  .then (rt) ->
    current = null    # 目前預覽的 block 名字
    selected = null   # 樹上選取的檔案 (相對 blocks/)

    # 遞迴列目錄, 回扁平的 [{path, depth, dir}] —— path 相對 blocks/。
    # 目錄排前面、同類依名字, 這樣畫出來才像個樹而不是一堆亂序的列。
    walk = (dir, prefix, depth) ->
      rt.io.readdir dir, {withFileTypes: true}
        .then (entries) ->
          cmp = (a, b) ->
            if a.isDirectory isnt b.isDirectory => return if a.isDirectory then -1 else 1
            if a.name < b.name then -1 else 1
          list = (entries or []).slice!.sort cmp
          step = (acc, e) ->
            acc.then (rows) ->
              path = if prefix then "#{prefix}/#{e.name}" else e.name
              rows.push {path, depth, dir: e.isDirectory}
              if not e.isDirectory => return Promise.resolve rows
              (walk "#{dir}/#{e.name}", path, depth + 1).then (sub) ->
                [].push.apply rows, sub
                rows
          list.reduce step, Promise.resolve []
        .catch -> []

    sandbox-opt =
      api: api
      io: rt.io
      # 名字 -> 原始碼。這裡的目錄約定寫在應用層, wagent 不知道。
      source: (name) -> rt.io.load-text "#{block-dir}/#{name}/index.html"
      # data 不給 —— 這個 sample 沒有要餵給 block 的東西。
      # list 也不給: 切換的介面是左邊那棵樹, sandbox 內建的選單就收起來。

    create {name: wagent, path: 'block/sandbox/index.html'}, document.getElementById('sandbox-root'), sandbox-opt
    .then (sb) ->
      window.sb = sb
      chat = null
      tree-el = document.getElementById 'file-tree'
      current-el = document.getElementById 'current'

      show = (name) ->
        return if not name
        current := name
        current-el.textContent = "#{block-dir}/#{name}/index.html"
        sb.show name
        chat?.set-block name
        render-tree!

      # 點檔案 -> 換預覽對象。點的是 block 目錄底下的任何檔案都算 —
      # 使用者要的是「看這個東西」, 不是「開這個檔」。
      pick = (path) ->
        name = block-of path
        selected := path
        if name and name isnt current then show name else render-tree!

      render-rows = (rows) ->
        tree-el.innerHTML = ''
        if not rows.length
          el = document.createElement 'div'
          el.className = 'empty'
          el.textContent = '(空的)'
          return tree-el.appendChild el
        for row in rows
          el = document.createElement 'div'
          name = row.path.split('/').slice(-1).0
          el.className = "row #{if row.dir then 'dir' else 'file'}"
          el.className += ' on' if not row.dir and row.path is selected
          el.style.paddingLeft = "#{12 + row.depth * 14}px"
          el.textContent = (if row.dir then '▾ ' else '') + name
          if not row.dir
            do (p = row.path) -> el.addEventListener 'click', -> pick p
          tree-el.appendChild el

      # 列目錄是非同步的, 而 promise 不保證按送出順序 resolve —— agent 連續寫檔時
      # 兩次列目錄會同時在飛, 舊的那次後到就會把畫面蓋成舊的。用序號丟掉過期結果:
      # 失敗形式是「樹顯示的跟真相不一致, 而且看起來完全正常」, 這種最難發現。
      tree-seq = 0
      render-tree = ->
        seq = ++tree-seq
        walk block-dir, '', 0
          .then (rows) -> render-rows rows if seq is tree-seq
          .catch -> render-rows [] if seq is tree-seq

      # **什麼時候重畫是應用決定的。** 來源不只 agent — 使用者的終端機、
      # 之後的編輯器都算, 所以聽的是 fs 變更事件而不是「agent 說它寫檔了」。
      # 樹也一起更新: agent 新增 block 時左邊要看得到。
      rt.on-fs-change (o) ->
        render-tree!
        if not current => return
        if not o.paths => return sb.refresh!
        dir = "#{block-dir}/#{current}/"
        hit = o.paths.some (p) ->
          rel = if p.index-of("#{rt.root}/") is 0 then p.slice(rt.root.length + 1) else p
          rel.index-of(dir) is 0
        sb.refresh! if hit

      rt.register-host do
        # 觀察通道 —— 契約的必要項。
        snapshot: sb.snapshot

        # 應用層自己的 tool。wagent 不需要知道「block」是什麼:
        # composer 之類的應用在這裡註冊的會是「開啟某個 node」。
        tools: [
          * name: 'open_block'
            description: 'Show a block in the preview pane, making it the current editing target. ' +
              'Call this after creating a NEW block — otherwise the user keeps looking at the previous one. ' +
              'Not needed after editing the block that is already open.'
            parameters:
              type: 'object'
              properties: {name: {type: 'string', description: 'block directory name under blocks/'}}
              required: <[name]>
              additionalProperties: false
        ]
        run: (name, args) ->
          if name isnt 'open_block' => return Promise.reject new Error "unknown host tool: #{name}"
          n = (args?name or '').trim!
          if not n => return Promise.reject new Error 'name is required'
          show n
          Promise.resolve "now showing #{n}"

        brief: [
          '這個頁面: 左邊是 workspace 的檔案樹 (唯讀, 使用者點了會切換右邊預覽的對象),'
          '中間是對話, 右邊即時渲染「目前開啟的 block」。'
          '每個 block 是一個目錄: blocks/<name>/index.html。同目錄下可以放這個 block'
          '自己要用的東西, 但不要跨目錄互相引用 —— 那會讓 block 不能單獨搬走。'
          '沒有預先載入任何函式庫, 用原生 HTML / CSS / SVG / canvas 即可;'
          '真的需要外部函式庫時在 block 的 HTML 裡自己放 <script src="https://...">。'
          '改到「目前開啟的 block」時預覽會自己重畫, 不必做什麼;'
          '但**建立新 block 之後要呼叫 open_block**, 否則使用者看到的還是上一個。'
          '寫完或改完務必呼叫 snapshot 確認真的畫出來了 —— block 可能不拋錯卻是空白的,'
          '版面問題 (配色、間距、對齊) 則要加 image: true 才看得到。'
        ].join '\n'

        # 動態: 現在是什麼狀況。每輪取一次, 附在對話尾端。
        context: ->
          walk block-dir, '', 0
            .then (rows) ->
              openedBlock: current
              blocks: [r.path for r in rows when r.dir and r.depth is 0]
              files: [r.path for r in rows when not r.dir]
            .catch -> {openedBlock: current, blocks: [], files: []}

      show seed-name
      chat-opt = {api, block: seed-name, sandbox: sb, transport: rt.transport}
      create {name: wagent, path: 'block/chat/index.html'}, document.getElementById('chat-root'), chat-opt
      .then (c) -> chat := c

  .catch (e) ->
    document.body.textContent = '初始化失敗: ' + e.message
    console.error e
