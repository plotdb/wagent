/*
 * 這個 sample 展示 wagent 最小的用法: **一個 block、看得到、可以改**。
 *
 * 分層 (見 context/project/host.md):
 *   application  ← 就是這個檔案。持有文件狀態、決定什麼時候重畫、
 *                  決定 agent 看得到什麼
 *   wagent/host  ← 介面框架, 不認得任何領域
 *   agent loop / shell / sandbox
 *
 * 這裡的目錄約定是「workspace 根目錄就是那份文件」—— 只有 /index.html。
 * 多 block 的應用會有自己的約定 (例如 blocks/<name>/index.html),
 * 那是應用的事, wagent 兩種都不知道。
 */
# runtime 由 index.pug 先以 module script 取好 (LiveScript 的 `import` 是 `<<<`
# 運算子, 借不到動態 import 的語法 —— 寫 import(url) 會被編成物件合併)。
api = '/api/agent'
file = 'index.html'

# workspace 是空的時候放進去的初始內容。種什麼 (要不要種) 是應用決定,
# wagent 不決定新使用者第一眼看到什麼。
#
# heredoc 兩個陷阱:
#  - 字面的 </script> 會把外層那個 <script> 標籤提前關掉, 所以拆成 close-script 拼。
#  - **CSS 色碼小心 #aaa 這種**。LiveScript 的 #name 是簡寫插值 (不用大括號那種),
#    #aaa 剛好是合法識別字, 會被編成 " + aaa + " -> 頂層 ReferenceError, 整個模組
#    不執行、console 也沒訊息。#999 / #2b6cb0 這種數字開頭的不會中, 所以特別容易漏。
#    要用字母開頭的色碼就跳脫成 \#aaa。
close-script = '</' + 'script>'
seed = """
<div>
  <div class="empty">跟 AGENT 聊聊吧</div>
  <style>
    :scope { height: 100%; display: flex; align-items: center; justify-content: center; }
    .empty { color: #999; font-size: 20px; letter-spacing: .05em; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {name: "page", version: "main", description: "空白起點"},
      init: function(opt) {}
    };
  #{close-script}
</div>
"""

# 解析規則:**一條就夠**。bid = (name, version, path) —— name 是模組,
# path 是模組內的位置;省略 path 時依 type 取預設檔名 (block/js/css 各一個)。
#
# 先前這裡有個「wagent 的四個 block 查表」的分支, 那是因為我用通用名字
# (chat / sandbox) 去要它們, 於是應用層被迫知道那些名字住在哪 —— 模組之間的
# 隱涵假設。改成用 bid 要 ({name: '@plotdb/wagent', path: 'block/chat/index.html'})
# 之後這個分支就沒有存在的理由了, 別處來的 block 也一樣載得進來。
default-path = (type) ->
  switch type
  | 'js'  => 'index.min.js'
  | 'css' => 'index.min.css'
  | _     => 'index.html'

mgr = new block.manager do
  registry: (o) ->
    # ?t= 只是開發期避免快取, 正式環境不需要
    bust = if o.type is 'css' or o.type is 'js' then '' else "?t=#{Date.now!}"
    "/assets/lib/#{o.name}/#{o.version or 'main'}/#{o.path or default-path o.type}#{bust}"

wagent = '@plotdb/wagent'

create = (bid, root, d) ->
  mgr.get bid
    .then (cls) -> cls.create {root, data: d}
    .then (inst) -> inst.interface!

window.wagent-runtime
  # 每個 sample 自己的儲存。同一個 origin 共用一份 OPFS, 不分開的話三個 sample
  # 會互相看到對方的檔案 (dataviz 的 block 清單會冒出別人的 block)。
  # path 省略就是 origin root — 也就是舊行為。需 esh 0.5.1。
  .then ({create-runtime}) ->
    create-runtime {api, mounts: {'/home': {backend: 'opfs', path: 'single-block'}}}
  .then (rt) ->
    window.rt = rt   # 方便在 console 觀察 (rt.sh.run / rt.io)
    # 空的 workspace 才種 —— 使用者既有的東西不能蓋
    rt.io.load-text file
      .catch -> rt.io.write-text file, seed
      .then -> rt

  .then (rt) ->
    # sandbox 有三個應用層窗口, 三個都是「應用知道、wagent 不知道」的事:
    #   source(name) — 名字怎麼對應到原始碼 (這裡永遠是同一個檔案)
    #   data(name)   — 這個 block 該拿到什麼資料
    #   list()       — 有哪些可切換的東西 (單一 block 就不給, 選單會自己收起來)
    create {name: wagent, path: 'block/sandbox/index.html'}, document.getElementById('sandbox-root'), do
      api: api
      io: rt.io
      source: -> rt.io.load-text file
      # data 不給 —— 這個 sample 沒有要餵給 block 的東西, block 拿到空物件。
      # 有資料要餵的應用在這裡開窗口 (見 host.md 的 Tier 1)。
    .then (sb) ->
      window.sb = sb   # sb.snapshot(...) 可在 console 直接玩

      # **什麼時候重畫是應用決定的。** 來源不只 agent —— 使用者可能自己開
      # 終端機改檔, 之後也可能在頁面上加 codemirror。所以聽的是 fs 變更事件,
      # 不是「agent 說它寫檔了」。
      rt.on-fs-change (o) ->
        # paths 為 null = shell 動過但不知動了什麼 -> 保守重畫
        if !o.paths => return sb.refresh!
        if o.paths.some((p) -> p.index-of(file) >= 0) => sb.refresh!

      # 應用層把自己講給 agent 聽。少了這幾塊, agent 只看得到檔案與畫面,
      # 應用自己的狀態對它是全盲的 —— 而它會用猜的。
      rt.register-host do
        # 觀察通道。**契約的必要項** —— 沒接的話 agent 改完東西無法確認
        # 自己畫出了什麼, 只能靠猜。直接把 sandbox 的 snapshot 交出去,
        # 回覆格式 (report / image) 由 runtime 處理。
        snapshot: sb.snapshot

        # 靜態: 這是什麼應用。併進 system prompt (快取前綴)
        brief: [
          '這個頁面左邊是對話, 右邊即時渲染你正在編輯的東西。'
          '你只有一個檔案要顧: /index.html。改完它右邊就會自己重畫, 不必做什麼,'
          '也不要建別的檔案。'
          '沒有預先載入任何函式庫 —— 用原生 HTML / CSS / SVG / canvas 就好。'
          '需要外部函式庫時可以在 block 的 HTML 裡自己放 <script src="https://...">。'
          '寫完或改完務必呼叫 snapshot 確認真的畫出來了 —— block 可能不拋錯卻是空白的,'
          '版面問題 (配色、間距、對齊) 則要加 image: true 才看得到。'
        ].join '\n'

        # 動態: 現在是什麼狀況。每輪取一次, 附在對話尾端。
        # 這個 sample 的狀態很單純, 就一個檔案; 複雜的應用會在這裡報自己的文件狀態。
        context: -> {file}

        # tools / run 不給 —— 這個 sample 沒有額外的 host tool。
        # 多 block 的應用會在這裡註冊 open_block 之類的東西。

      sb.show file
      create {name: wagent, path: 'block/chat/index.html'}, document.getElementById('chat-root'), do
        api: api, block: file, sandbox: sb, transport: rt.transport

  .catch (e) ->
    document.body.text-content = '初始化失敗: ' + e.message
    console.error e
