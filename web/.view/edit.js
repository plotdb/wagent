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























































































pug_html = pug_html + "\u003Chtml\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1\"\u003E\u003Ctitle\u003E編輯圖表\u003C\u002Ftitle\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fd3@7\u002Fdist\u002Fd3.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fchart.js@4\u002Fdist\u002Fchart.umd.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cstyle type=\"text\u002Fcss\"\u003E* { box-sizing: border-box; }\nbody { margin: 0; font-family: -apple-system, \"Helvetica Neue\", \"PingFang TC\", sans-serif; height: 100vh; display: flex; background: #f5f5f2; }\n.chat-pane { width: 420px; min-width: 320px; display: flex; flex-direction: column; border-right: 1px solid #ddd; background: #fff; }\n.chat-header { padding: 12px 16px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; gap: 8px; }\n.chat-header .left { min-width: 0; }\n.chat-header h1 { font-size: 15px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.chat-header .sub { font-size: 11px; color: #999; }\n.chat-header a { font-size: 12px; color: #2b6cb0; text-decoration: none; white-space: nowrap; }\n.chat-log { flex: 1; overflow-y: auto; padding: 12px; }\n.msg { margin-bottom: 10px; max-width: 92%; padding: 8px 12px; border-radius: 10px; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }\n.msg.user { background: #2b6cb0; color: #fff; margin-left: auto; }\n.msg.assistant { background: #f0f0ec; color: #222; }\n.msg.event { background: transparent; color: #888; font-size: 12px; padding: 2px 6px; font-family: Menlo, monospace; }\n.msg.error { background: #fdecea; color: #b3261e; }\n.chat-input { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }\n.chat-input textarea { flex: 1; resize: none; height: 60px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13.5px; font-family: inherit; }\n.chat-input button { padding: 0 18px; border: 0; border-radius: 6px; background: #2b6cb0; color: #fff; cursor: pointer; font-size: 14px; }\n.chat-input button:disabled { background: #aaa; }\n.main-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }\n.preview { flex: 1; padding: 20px; overflow: auto; }\n.preview-inner { background: #fff; border: 1px solid #e2e2de; border-radius: 8px; min-height: 440px; padding: 16px; }\n.preview-empty { color: #999; font-size: 14px; text-align: center; padding-top: 180px; }\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Cdiv class=\"chat-pane\"\u003E\u003Cdiv class=\"chat-header\"\u003E\u003Cdiv class=\"left\"\u003E\u003Ch1 id=\"title\"\u003E新增圖表\u003C\u002Fh1\u003E\u003Cdiv class=\"sub\" id=\"provider-info\"\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Ca href=\"\u002F\"\u003E← 回列表\u003C\u002Fa\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"chat-log\" id=\"chat-log\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"chat-input\"\u003E\u003Ctextarea id=\"chat-text\" placeholder=\"輸入訊息,Enter 送出,Shift+Enter 換行\"\u003E\u003C\u002Ftextarea\u003E\u003Cbutton id=\"send-btn\"\u003E送出\u003C\u002Fbutton\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"main-pane\"\u003E\u003Cdiv class=\"preview\"\u003E\u003Cdiv class=\"preview-inner\" id=\"preview\"\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Cscript\u003E(function() {\n  var params = new URLSearchParams(location.search);\n  var block = params.get('block');  \u002F\u002F null = new chart mode\n  var draftId = 'draft-' + Math.random().toString(36).slice(2, 10);\n\n  var log = document.getElementById('chat-log');\n  var input = document.getElementById('chat-text');\n  var sendBtn = document.getElementById('send-btn');\n  var preview = document.getElementById('preview');\n  var title = document.getElementById('title');\n\n  function addMsg(cls, text) {\n    var d = document.createElement('div');\n    d.className = 'msg ' + cls;\n    d.textContent = text;\n    log.appendChild(d);\n    log.scrollTop = log.scrollHeight;\n    return d;\n  }\n\n  var ctx = {\n    d3: window.d3,\n    Chart: window.Chart,\n    loadText: function(p) {\n      return fetch('\u002Fworkspace\u002F' + p).then(function(r) {\n        if(!r.ok) { throw new Error('load failed: ' + p); }\n        return r.text();\n      });\n    },\n    loadJSON: function(p) {\n      return fetch('\u002Fworkspace\u002F' + p).then(function(r) {\n        if(!r.ok) { throw new Error('load failed: ' + p); }\n        return r.json();\n      });\n    }\n  };\n\n  function renderPreview() {\n    if(!block) {\n      preview.innerHTML = '\u003Cdiv class=\"preview-empty\"\u003E尚無圖表 — 用左側對話描述你要的圖表\u003C\u002Fdiv\u003E';\n      return;\n    }\n    preview.innerHTML = '';\n    var root = document.createElement('div');\n    root.style.minHeight = '400px';\n    preview.appendChild(root);\n    fetch('\u002Fworkspace\u002Fblocks\u002F' + block + '\u002Findex.js?t=' + Date.now())\n      .then(function(r) {\n        if(!r.ok) { throw new Error('block not found: ' + block); }\n        return r.text();\n      })\n      .then(function(code) {\n        var module = {exports: {}};\n        new Function('module', 'exports', code)(module, module.exports);\n        if(!module.exports || typeof module.exports.init !== 'function') {\n          throw new Error('invalid block: missing init()');\n        }\n        return module.exports.init({root: root, ctx: ctx});\n      })\n      .catch(function(e) {\n        preview.innerHTML = '\u003Cdiv class=\"preview-empty\"\u003E渲染失敗: ' + e.message + '\u003C\u002Fdiv\u003E';\n        console.error(e);\n      });\n  }\n\n  function setBlock(name) {\n    block = name;\n    title.textContent = name;\n    history.replaceState(null, '', '\u002Fedit.html?block=' + encodeURIComponent(name));\n    renderPreview();\n  }\n\n  function send() {\n    var text = input.value.trim();\n    if(!text || sendBtn.disabled) { return; }\n    input.value = '';\n    addMsg('user', text);\n    sendBtn.disabled = true;\n    var thinking = addMsg('event', '思考中…');\n    fetch('\u002Fapi\u002Fchat', {\n      method: 'POST',\n      headers: {'Content-Type': 'application\u002Fjson'},\n      body: JSON.stringify({message: text, block: block, session: block || draftId})\n    })\n      .then(function(r) {\n        return r.json().then(function(j) {\n          if(!r.ok) { throw new Error(j.error || r.status); }\n          return j;\n        });\n      })\n      .then(function(j) {\n        thinking.remove();\n        (j.events || []).forEach(function(ev) {\n          var p = ev.input && ev.input.path ? ' ' + ev.input.path : '';\n          addMsg('event', (ev.error ? '✗ ' : '✓ ') + ev.tool + p);\n        });\n        addMsg('assistant', j.reply || '(無回覆)');\n        var written = (j.events || []).filter(function(ev) {\n          return ev.tool === 'write_file' && !ev.error &&\n            \u002F^blocks\\\u002F([^\\\u002F]+)\\\u002Findex\\.js$\u002F.test(ev.input.path);\n        });\n        if(written.length) {\n          setBlock(written[written.length - 1].input.path.split('\u002F')[1]);\n        } else if(written.length === 0 && j.events && j.events.some(function(ev) {\n          return ev.tool === 'write_file' && !ev.error;\n        })) {\n          renderPreview();  \u002F\u002F data file changed — re-render current block\n        }\n      })\n      .catch(function(e) {\n        thinking.remove();\n        addMsg('error', '錯誤: ' + e.message);\n      })\n      .then(function() { sendBtn.disabled = false; input.focus(); });\n  }\n\n  sendBtn.onclick = send;\n  input.addEventListener('keydown', function(e) {\n    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }\n  });\n\n  if(block) {\n    title.textContent = block;\n    addMsg('assistant', '正在編輯「' + block + '」。告訴我你要怎麼修改,例如換圖表類型、改顏色、加資料欄位。');\n  } else {\n    addMsg('assistant', '描述你想要的圖表,我會建立一個新的 block。例如:「用 sales 資料畫營收與訂單數的雙軸圖」。');\n  }\n  renderPreview();\n  fetch('\u002Fapi\u002Fprovider').then(function(r) { return r.json(); }).then(function(j) {\n    document.getElementById('provider-info').textContent =\n      j.provider ? j.provider + ' \u002F ' + j.model : '未設定 API key (.env)';\n  });\n  input.focus();\n})();\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 