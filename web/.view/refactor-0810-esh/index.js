 (function() { function pug_attr(t,e,n,r){if(!1===e||null==e||!e&&("class"===t||"style"===t))return"";if(!0===e)return" "+(r?t:t+'="'+t+'"');var f=typeof e;return"object"!==f&&"function"!==f||"function"!=typeof e.toJSON||(e=e.toJSON()),"string"==typeof e||(e=JSON.stringify(e),n||-1===e.indexOf('"'))?(n&&(e=pug_escape(e))," "+t+'="'+e+'"'):" "+t+"='"+e.replace(/'/g,"&#39;")+"'"}
function pug_escape(e){var a=""+e,t=pug_match_html.exec(a);if(!t)return e;var r,c,n,s="";for(r=t.index,c=0;r<a.length;r++){switch(a.charCodeAt(r)){case 34:n="&quot;";break;case 38:n="&amp;";break;case 60:n="&lt;";break;case 62:n="&gt;";break;default:continue}c!==r&&(s+=a.substring(c,r)),c=r+1,s+=n}return c!==r?s+a.substring(c,r):s}
var pug_match_html=/["&<>]/;function template(locals) {var pug_html = "", pug_mixins = {}, pug_interp;;
    var locals_for_with = (locals || {});
    
    (function (libLoader, version) {
      pug_html = pug_html + "\u003C!DOCTYPE html\u003E";
if(!libLoader) {
  libLoader = {
    js: {url: {}},
    css: {url: {}},
    root: function(r) { libLoader._r = r; },
    _r: "/assets/lib",
    _v: "",
    version: function(v) { libLoader._v = (v ? "?v=" + v : ""); }
  }
  if(version) { libLoader.version(version); }
}























































































pug_html = pug_html + "\u003Chtml\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1\"\u003E\u003Ctitle\u003EBlock Agent (browser runtime)\u003C\u002Ftitle\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fd3@7\u002Fdist\u002Fd3.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fchart.js@4\u002Fdist\u002Fchart.umd.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002Fproxise\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fsemver\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fcsscope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Frescope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fblock\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Clink rel=\"stylesheet\" href=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fsheet\u002Fmain\u002Findex.min.css\"\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fsheet\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Clink rel=\"stylesheet\" href=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fesh\u002Fmain\u002Fesh-term.iife.css\"\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fesh\u002Fmain\u002Fesh-term.iife.js\"\u003E\u003C\u002Fscript\u003E\u003Cstyle type=\"text\u002Fcss\"\u003E* { box-sizing: border-box; }\nbody { margin: 0; font-family: -apple-system, \"Helvetica Neue\", \"PingFang TC\", sans-serif; height: 100vh; display: flex; background: #f5f5f2; }\n#chat-root { width: 420px; min-width: 320px; border-right: 1px solid #ddd; background: #fff; }\n.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }\n#sandbox-root { flex: 1; min-height: 0; padding: 20px; overflow: auto; }\n.sheet-pane { height: 200px; border-top: 1px solid #ddd; background: #fff; display: flex; flex-direction: column; }\n.sheet-bar { font: 11px Menlo, monospace; color: #888; padding: 4px 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }\n.sheet-bar b { color: #333; font-weight: 600; }\n#sheet-root { flex: 1; min-height: 0; overflow: hidden; }\n.term-pane { height: 240px; border-top: 1px solid #ddd; background: #1e1e1e; display: flex; flex-direction: column; }\n.term-bar { font: 11px Menlo, monospace; color: #aaa; padding: 4px 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }\n.term-bar b { color: #ddd; font-weight: 600; }\n#term-root { flex: 1; min-height: 0; }\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Cdiv id=\"chat-root\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"main\"\u003E\u003Cdiv id=\"sandbox-root\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"sheet-pane\"\u003E\u003Cdiv class=\"sheet-bar\"\u003E\u003Cspan\u003E\u003Cb\u003Esheet\u003C\u002Fb\u003E — 資料由應用層持有, 改這裡圖會跟著重畫\u003C\u002Fspan\u003E\u003Cspan id=\"sheet-info\"\u003E\u003C\u002Fspan\u003E\u003C\u002Fdiv\u003E\u003Cdiv id=\"sheet-root\"\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"term-pane\"\u003E\u003Cdiv class=\"term-bar\"\u003E\u003Cspan\u003E\u003Cb\u003Eworkspace shell\u003C\u002Fb\u003E — agent 與你共用同一份 working tree\u003C\u002Fspan\u003E\u003Cspan id=\"persist-info\"\u003E\u003C\u002Fspan\u003E\u003C\u002Fdiv\u003E\u003Cdiv id=\"term-root\"\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Cscript type=\"module\"\u003Eimport {createRuntime} from '\u002Fassets\u002Flib\u002F@plotdb\u002Fwagent\u002Fmain\u002Fruntime\u002Fclient.js';\n\u002F\u002F 開發期避免模組快取 (與上面 block registry 的 ?t= 同一個理由) —\n\u002F\u002F 沒有它時改了 app 程式碼卻沒生效, 會被誤判成邏輯有問題\nconst {createStore} = await import('\u002Fassets\u002Flib\u002Fdataviz\u002Fmain\u002Fsheet-store.js?t=' + Date.now());\nconst {seed} = await import('\u002Fassets\u002Flib\u002Fdataviz\u002Fmain\u002Fseed.js?t=' + Date.now());\nconst {listBlocks, blockPath, BLOCK_DIR} = await import('\u002Fassets\u002Flib\u002Fdataviz\u002Fmain\u002Fblocks.js?t=' + Date.now());\n\n\u002F\u002F ── 應用層的文件狀態 ──────────────────────────────────────────────\n\u002F\u002F 資料由應用層持有 (Tier 1)。block 拿到的是「值」, 不是檔案路徑 —\n\u002F\u002F 對照 makechart 的 host.local.raw \u002F composer 的 nodemgr。\nvar store = createStore();\n\nvar params = new URLSearchParams(location.search);\nvar blockName = params.get('block');  \u002F\u002F null = 新增模式\nvar chat = null;                      \u002F\u002F open_block tool 要用, 稍後才建立\nvar API = '\u002Fapi\u002Fagent';\nvar BLOCKS = '\u002Fassets\u002Flib\u002F@plotdb\u002Fwagent\u002Fmain\u002Fblock\u002F';\n\n\u002F\u002F app block (chat \u002F sandbox 及其 base 層) 的 registry\nvar paths = {\n  'chat-base': 'chat\u002Fbase.html',\n  'chat': 'chat\u002Findex.html',\n  'sandbox-base': 'sandbox\u002Fbase.html',\n  'sandbox': 'sandbox\u002Findex.html'\n};\nvar mgr = new block.manager({\n  registry: function(o) {\n    if(o.type === 'block') {\n      if(!paths[o.name]) { return null; }\n      return BLOCKS + paths[o.name] + '?t=' + Date.now();\n    }\n    return '\u002Fassets\u002Flib\u002F' + o.name + '\u002F' + (o.version || 'main') + '\u002F' + (o.path || 'index.min.js');\n  }\n});\n\nfunction create(name, root, data) {\n  return mgr.get({name: name})\n    .then(function(cls) { return cls.create({root: root, data: data}); })\n    .then(function(inst) { return inst.interface(); });\n}\n\n\u002F\u002F devices: 把應用層的文件狀態以檔案形式給 agent — 它就能用 grep \u002F wc \u002F head 去查,\n\u002F\u002F 不必為每種資料各開一個 tool (host.md 的取捨準則: 能用指令表達的就別當 tool)\ncreateRuntime({api: API, devices: ['sheet']})\n  .then(function(rt) {\n    window.rt = rt;  \u002F\u002F 方便在 console 觀察 (rt.sh.run \u002F rt.io)\n    document.getElementById('persist-info').textContent = rt.sh.ready ? '' : '';\n    \u002F\u002F 終端與 agent 共用同一個 worker (同一個 shell、同一份 workspace)\n    eshTerm.createTerminal(document.getElementById('term-root'), {\n      worker: rt.worker, home: rt.root\n    });\n    \u002F\u002F workspace 的初始內容由應用層植入 (wagent 不決定新使用者看到什麼)\n    return seed(rt.io).catch(function(e) {\n      console.warn('seed failed', e);\n    }).then(function() { return rt; });   \u002F\u002F base 層不必預載: block 的 pkg.extend 會自己經 manager 解析\n  })\n  .then(function(rt) {\n    \u002F\u002F ── 應用層決定 block 拿到什麼資料 ──────────────────────────────\n    \u002F\u002F wagent 對資料的語意一無所知, 它只負責把這個物件交給 block。\n    \u002F\u002F 給的是解析好的值 ({columns, rows}), block 不讀檔、不持有路徑,\n    \u002F\u002F 換個環境換份資料就能跑。\n    \u002F\u002F\n    \u002F\u002F loadText \u002F loadJSON 仍附上, 給還在用舊寫法的既有 block (過渡)。\n    var dataFor = function(name) {\n      var v = store.value();\n      return {\n        columns: v.columns, rows: v.rows,\n        loadText: rt.io.loadText, loadJSON: rt.io.loadJSON\n      };\n    };\n    \u002F\u002F source: 名字 -\u003E 原始碼。目錄約定 (blocks\u002F\u003Cname\u003E\u002Findex.html) 是這個 app 的,\n    \u002F\u002F 所以由這裡告訴 sandbox, 而不是 sandbox 自己假設。\n    var sourceFor = function(name) { return rt.io.loadText(blockPath(name)); };\n    return create('sandbox', document.getElementById('sandbox-root'),\n                  {api: API, io: rt.io, data: dataFor, source: sourceFor,\n                   list: function() { return listBlocks(rt); }})\n      .then(function(sb) {\n        window.sb = sb;  \u002F\u002F 方便在 console 觀察 (sb.snapshot)\n        window.store = store;\n\n        \u002F\u002F ── 試算表: 使用者編輯資料的地方 ────────────────────────────\n        var sheetInfo = document.getElementById('sheet-info');\n        function showInfo() {\n          sheetInfo.textContent = store.value().rows.length + ' rows x ' +\n            store.dimensions.length + ' cols';\n        }\n        var sh = window.__sh = new sheet({root: '#sheet-root', data: store.raw()});\n        var fromSheet = false;\n        sh.on('change', function() {\n          fromSheet = true;\n          store.setRaw(sh.data());\n          fromSheet = false;\n        });\n        \u002F\u002F 文件狀態變了 -\u003E 應用層決定重畫。與 fs 變更是同一個模式:\n        \u002F\u002F 「我正在看的東西變了」由應用層判斷, 不是 chat 也不是 agent。\n        \u002F\u002F\n        \u002F\u002F store 是唯一真相, sheet UI 只是它的一個視圖 — 所以同步要放在這裡,\n        \u002F\u002F 而不是放在某個特定的寫入路徑上。之前只在 write_sheet 裡同步,\n        \u002F\u002F 結果從別的來源改 store 時 UI 就跟真值分岔了 (畫面顯示舊資料, 圖卻是新的)。\n        \u002F\u002F device 是唯讀鏡像, 應用層是唯一真相 — 每次變更都推過去\n        function pushDevice() { rt.setDevice('sheet', store.toCSV()); }\n        pushDevice();\n        store.on(function() {\n          pushDevice();\n          showInfo();\n          if(!fromSheet) { sh.data(store.raw()); }\n          \u002F\u002F 資料變了 -\u003E 有實作 client.data 的 block 增量更新, 其餘重掛\n          if(sb.current()) { sb.updateData(); }\n        });\n        showInfo();\n        \u002F\u002F sandbox 即 host 的觀察通道: 把 snapshot 交給 agent\n        \u002F\u002F ── 誰決定重畫: application ────────────────────────────────\n        \u002F\u002F 兩件不同的事:\n        \u002F\u002F  1. 「我正在看的東西變了」-\u003E fs 變更事件 (來源不只 agent:\n        \u002F\u002F     使用者的終端機、之後頁面上的 codemirror 都算)\n        \u002F\u002F  2. 「換一個東西給我看」  -\u003E agent 明講的 open_block tool\n        \u002F\u002F 先前是用 write_file 的路徑去猜, 兩件事混在一起, 而且只猜得到 agent。\n        function currentDir() {\n          return sb.current() ? BLOCK_DIR + '\u002F' + sb.current() + '\u002F' : null;\n        }\n        rt.onFsChange(function(o) {\n          if(!sb.current()) { return; }\n          \u002F\u002F paths 為 null = shell 動過但不知動了什麼 -\u003E 保守重畫\n          if(!o.paths) { return sb.refresh(); }\n          var dir = currentDir();\n          var hit = o.paths.some(function(p) {\n            var rel = p.indexOf(rt.root + '\u002F') === 0 ? p.slice(rt.root.length + 1) : p;\n            return rel.indexOf(dir) === 0 || rel.indexOf('data\u002F') === 0;\n          });\n          if(hit) { sb.refresh(); }\n        });\n\n        rt.registerHost({\n          \u002F\u002F 應用層自己的 tool。wagent 不需要知道「block」是什麼 —\n          \u002F\u002F composer 在這裡註冊的會是「開啟某個 node」之類的東西。\n          tools: [{\n            name: 'write_sheet',\n            description: 'Replace the whole spreadsheet with the given CSV (first row must be the header). ' +\n              'Use this to put sample data in. The chart redraws automatically.',\n            parameters: {\n              type: 'object',\n              properties: {csv: {type: 'string', description: 'full CSV including the header row'}},\n              required: ['csv'],\n              additionalProperties: false\n            }\n          }, {\n            name: 'open_block',\n            description: 'Show a block in the preview pane, making it the current editing target. ' +\n              'Call this after creating a NEW block — otherwise the user keeps looking at the previous one. ' +\n              'Not needed after editing the block that is already open (the preview refreshes by itself).',\n            parameters: {\n              type: 'object',\n              properties: {name: {type: 'string', description: 'block directory name under blocks\u002F'}},\n              required: ['name'],\n              additionalProperties: false\n            }\n          }],\n          run: function(name, args) {\n            if(name === 'write_sheet') {\n              var n = store.fromCSV(args && args.csv);\n              return Promise.resolve('sheet now has ' + n + ' data rows');\n            }\n            if(name === 'open_block') {\n              var n = (args && args.name || '').trim();\n              if(!n) { return Promise.reject(new Error('name is required')); }\n              sb.show(n);\n              if(chat) { chat.setBlock(n); }\n              \u002F\u002F 不必等渲染: snapshot 自己會等 sandbox 的 rendering\n              return Promise.resolve('now showing ' + n);\n            }\n            if(name !== 'snapshot') {\n              return Promise.reject(new Error('unknown host tool: ' + name));\n            }\n            return sb.snapshot(args).then(function(r) {\n              var text = JSON.stringify(r.report, null, 1);\n              \u002F\u002F tool 結果可以是字串, 或 {text, image} — provider 各自轉成自己的格式\n              return r.image ? {text: text, image: r.image} : text;\n            });\n          },\n          \u002F\u002F 靜態: 這是什麼應用。併進 system prompt (快取前綴)\n          brief: [\n            '這個環境是一個 block 編輯器: 左邊是對話, 右邊即時渲染「目前開啟的 block」,',\n            '中間是一張試算表 — 圖表的資料來源, 用戶可以直接編輯, 改了圖就會重畫。',\n            '試算表以唯讀檔案 dev\u002Fsheet 呈現 (csv): 用 cat \u002F grep \u002F wc \u002F head 直接查, 不必另外開 tool。',\n            '要改資料用 write_sheet。block 那端則由執行環境注入 opt.data, 不必自己讀。',\n            '最下面是一個與你共用同一份 workspace 的終端機 (用戶可能會自己動檔案)。',\n            '你改到「目前開啟的 block」或 data\u002F 底下的檔案時, 預覽會自己重畫, 不必做什麼;',\n            '但建立新 block 之後要呼叫 open_block, 否則用戶看到的還是上一個。',\n            '每輪對話開頭會附上一段 [application-context], 描述當下的狀況 — 那是執行環境給的,',\n            '不是用戶說的話。以它為準, 不要用上一輪的狀況推測現在。'\n          ].join('\\n'),\n          \u002F\u002F 動態: 現在是什麼狀況。每輪取一次, 附在對話尾端\n          context: function() {\n            return listBlocks(rt).then(function(list) {\n              var v = store.value();\n              return {\n                openedBlock: sb.current() || null,\n                blocks: list.map(function(b) { return b.name; }),\n                sheet: {\n                  columns: v.columns.map(function(c) { return c.name + ':' + c.type; }),\n                  rowCount: v.rows.length,\n                  firstRow: v.rows[0] || null\n                }\n              };\n            });\n          }\n        });\n        if(blockName) { sb.show(blockName); }\n        return create('chat', document.getElementById('chat-root'), {\n          api: API, block: blockName, sandbox: sb, transport: rt.transport\n        });\n      });\n  })\n  .then(function(c) {\n    chat = c;\n    chat.on('block', function(name) {\n      history.replaceState(null, '', location.pathname + '?block=' + encodeURIComponent(name));\n    });\n  })\n  .catch(function(e) {\n    document.body.textContent = '初始化失敗: ' + e.message;\n    console.error(e);\n  });\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 