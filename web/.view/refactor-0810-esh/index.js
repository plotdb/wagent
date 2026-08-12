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























































































pug_html = pug_html + "\u003Chtml\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1\"\u003E\u003Ctitle\u003EBlock Agent (browser runtime)\u003C\u002Ftitle\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fd3@7\u002Fdist\u002Fd3.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fchart.js@4\u002Fdist\u002Fchart.umd.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002Fproxise\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fsemver\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fcsscope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Frescope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fblock\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Clink rel=\"stylesheet\" href=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fesh\u002Fmain\u002Fesh-term.iife.css\"\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fesh\u002Fmain\u002Fesh-term.iife.js\"\u003E\u003C\u002Fscript\u003E\u003Cstyle type=\"text\u002Fcss\"\u003E* { box-sizing: border-box; }\nbody { margin: 0; font-family: -apple-system, \"Helvetica Neue\", \"PingFang TC\", sans-serif; height: 100vh; display: flex; background: #f5f5f2; }\n#chat-root { width: 420px; min-width: 320px; border-right: 1px solid #ddd; background: #fff; }\n.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }\n#sandbox-root { flex: 1; min-height: 0; padding: 20px; overflow: auto; }\n.term-pane { height: 240px; border-top: 1px solid #ddd; background: #1e1e1e; display: flex; flex-direction: column; }\n.term-bar { font: 11px Menlo, monospace; color: #aaa; padding: 4px 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }\n.term-bar b { color: #ddd; font-weight: 600; }\n#term-root { flex: 1; min-height: 0; }\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Cdiv id=\"chat-root\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"main\"\u003E\u003Cdiv id=\"sandbox-root\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"term-pane\"\u003E\u003Cdiv class=\"term-bar\"\u003E\u003Cspan\u003E\u003Cb\u003Eworkspace shell\u003C\u002Fb\u003E — agent 與你共用同一份 working tree\u003C\u002Fspan\u003E\u003Cspan id=\"persist-info\"\u003E\u003C\u002Fspan\u003E\u003C\u002Fdiv\u003E\u003Cdiv id=\"term-root\"\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003C\u002Fdiv\u003E\u003Cscript type=\"module\"\u003Eimport {createRuntime} from '\u002Fassets\u002Flib\u002F@plotdb\u002Fwagent\u002Fmain\u002Fruntime\u002Fclient.js';\n\nvar params = new URLSearchParams(location.search);\nvar blockName = params.get('block');  \u002F\u002F null = 新增模式\nvar API = '\u002Fapi\u002Fagent';\nvar BLOCKS = '\u002Fassets\u002Flib\u002F@plotdb\u002Fwagent\u002Fmain\u002Fblock\u002F';\n\n\u002F\u002F app block (chat \u002F sandbox 及其 base 層) 的 registry\nvar paths = {\n  'chat-base': 'chat\u002Fbase.html',\n  'chat': 'chat\u002Findex.html',\n  'sandbox-base': 'sandbox\u002Fbase.html',\n  'sandbox': 'sandbox\u002Findex.html'\n};\nvar mgr = new block.manager({\n  registry: function(o) {\n    if(o.type === 'block') {\n      if(!paths[o.name]) { return null; }\n      return BLOCKS + paths[o.name] + '?t=' + Date.now();\n    }\n    return '\u002Fassets\u002Flib\u002F' + o.name + '\u002F' + (o.version || 'main') + '\u002F' + (o.path || 'index.min.js');\n  }\n});\n\nfunction create(name, root, data) {\n  return mgr.get({name: name})\n    .then(function(cls) { return cls.create({root: root, data: data}); })\n    .then(function(inst) { return inst.interface(); });\n}\n\ncreateRuntime({api: API})\n  .then(function(rt) {\n    window.rt = rt;  \u002F\u002F 方便在 console 觀察 (rt.sh.run \u002F rt.io)\n    document.getElementById('persist-info').textContent = rt.sh.ready ? '' : '';\n    \u002F\u002F 終端與 agent 共用同一個 worker (同一個 shell、同一份 workspace)\n    eshTerm.createTerminal(document.getElementById('term-root'), {\n      worker: rt.worker, home: rt.root\n    });\n    return mgr.get([{name: 'chat-base'}, {name: 'sandbox-base'}]).then(function() { return rt; });\n  })\n  .then(function(rt) {\n    return create('sandbox', document.getElementById('sandbox-root'), {api: API, io: rt.io})\n      .then(function(sb) {\n        \u002F\u002F sandbox 即 host 的觀察通道: 把 snapshot 交給 agent\n        rt.registerHost({\n          run: function(name, args) {\n            if(name !== 'snapshot') {\n              return Promise.reject(new Error('unknown host tool: ' + name));\n            }\n            return sb.snapshot(args).then(function(r) {\n              var text = JSON.stringify(r.report, null, 1);\n              \u002F\u002F tool 結果可以是字串, 或 {text, image} — provider 各自轉成自己的格式\n              return r.image ? {text: text, image: r.image} : text;\n            });\n          }\n        });\n        if(blockName) { sb.show(blockName); }\n        return create('chat', document.getElementById('chat-root'), {\n          api: API, block: blockName, sandbox: sb, transport: rt.transport\n        });\n      });\n  })\n  .then(function(chat) {\n    chat.on('block', function(name) {\n      history.replaceState(null, '', location.pathname + '?block=' + encodeURIComponent(name));\n    });\n  })\n  .catch(function(e) {\n    document.body.textContent = '初始化失敗: ' + e.message;\n    console.error(e);\n  });\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 