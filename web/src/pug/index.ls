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

# 應用層持有的資料。block 拿到的是**值**, 不是檔案路徑 —— 所以 agent 寫出來的
# block 不含任何 fetch / loadText / 路徑字串, 換個環境就能跑。
data =
  rows: [
    * label: '2026-01', value: 128
    * label: '2026-02', value: 115
    * label: '2026-03', value: 143
    * label: '2026-04', value: 156
    * label: '2026-05', value: 150
    * label: '2026-06', value: 171
  ]

# workspace 是空的時候放進去的初始內容。種什麼 (要不要種) 是應用決定,
# wagent 不決定新使用者第一眼看到什麼。
#
# close-script: 字面的 </script> 會把外層那個 <script> 標籤提前關掉, 所以拆開拼。
close-script = '</' + 'script>'
seed = """
<div>
  <div class="wrap"><canvas></canvas></div>
  <style>
    .wrap { height: 400px; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {name: "sample", version: "main", description: "長條圖 — 資料由執行環境注入"},
      init: function(opt) {
        var rows = (opt.data && opt.data.rows) || [];
        this.chart = new Chart(opt.root.querySelector("canvas"), {
          type: "bar",
          data: {
            labels: rows.map(function(r) { return r.label; }),
            datasets: [{label: "value", data: rows.map(function(r) { return r.value; }),
                        backgroundColor: "#2b6cb0"}]
          },
          options: {responsive: true, maintainAspectRatio: false}
        });
      }
    };
  #{close-script}
</div>
"""

# wagent 的 chat / sandbox 本身也是 @plotdb/block —— 用 manager 載入。
# ?t= 是開發期避免模組快取;正式環境不需要。
blocks-url = '/assets/lib/@plotdb/wagent/main/block/'
paths =
  "chat-base": 'chat/base.html'
  "chat": 'chat/index.html'
  "sandbox-base": 'sandbox/base.html'
  "sandbox": 'sandbox/index.html'

mgr = new block.manager do
  registry: (o) ->
    if o.type is 'block'
      if paths[o.name] => blocks-url + paths[o.name] + '?t=' + Date.now! else null
    else
      '/assets/lib/' + o.name + '/' + (o.version or 'main') + '/' + (o.path or 'index.min.js')

create = (name, root, d) ->
  mgr.get {name}
    .then (cls) -> cls.create {root, data: d}
    .then (inst) -> inst.interface!

window.wagent-runtime
  .then ({create-runtime}) -> create-runtime {api}
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
    create 'sandbox', document.getElementById('sandbox-root'), do
      api: api
      io: rt.io
      source: -> rt.io.load-text file
      data: -> data
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
          '這個頁面左邊是對話, 右邊即時渲染你正在編輯的 block。'
          '你只有一個檔案要顧: /index.html。改完它右邊就會自己重畫, 不必做什麼。'
          '寫完或改完務必呼叫 snapshot 確認真的畫出來了 —— block 可能不拋錯卻是空白的。'
        ].join '\n'

        # 動態: 現在是什麼狀況。每輪取一次, 附在對話尾端
        context: ->
          file: file
          data: {row-count: data.rows.length, first-row: data.rows.0}

        # tools / run 不給 —— 這個 sample 沒有額外的 host tool。
        # 多 block 的應用會在這裡註冊 open_block 之類的東西。

      sb.show file
      create 'chat', document.getElementById('chat-root'), do
        api: api, block: file, sandbox: sb, transport: rt.transport

  .catch (e) ->
    document.body.text-content = '初始化失敗: ' + e.message
    console.error e
