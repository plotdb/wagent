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























































































pug_html = pug_html + "\u003Chtml\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1\"\u003E\u003Ctitle\u003EBlock Agent (@plotdb\u002Fagent)\u003C\u002Ftitle\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fd3@7\u002Fdist\u002Fd3.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fchart.js@4\u002Fdist\u002Fchart.umd.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002Fproxise\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fsemver\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fcsscope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Frescope\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"\u002Fassets\u002Flib\u002F@plotdb\u002Fblock\u002Fmain\u002Findex.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cstyle type=\"text\u002Fcss\"\u003E* { box-sizing: border-box; }\nbody { margin: 0; font-family: -apple-system, \"Helvetica Neue\", \"PingFang TC\", sans-serif; height: 100vh; display: flex; background: #f5f5f2; }\n#chat-root { width: 420px; min-width: 320px; border-right: 1px solid #ddd; background: #fff; }\n#chat-root \u003E div { height: 100%; }\n#sandbox-root { flex: 1; min-width: 0; padding: 20px; overflow: auto; }\n#sandbox-root \u003E div { height: 100%; }\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Cdiv id=\"chat-root\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv id=\"sandbox-root\"\u003E\u003C\u002Fdiv\u003E\u003Cscript\u003E(function() {\n  var params = new URLSearchParams(location.search);\n  var blockName = params.get('block');  \u002F\u002F null = 新增模式\n  var stream = params.get('stream') || 'token';  \u002F\u002F 前端期望等級: none | tool | token\n  var API = '\u002Fapi\u002Fagent';\n\n  \u002F\u002F app block 的 registry: chat \u002F sandbox 及其 base 層\n  var paths = {\n    'chat-base': 'chat\u002Fbase.html',\n    'chat': 'chat\u002Findex.html',\n    'sandbox-base': 'sandbox\u002Fbase.html',\n    'sandbox': 'sandbox\u002Findex.html'\n  };\n  var mgr = new block.manager({\n    registry: function(o) {\n      if(o.type === 'block') {\n        if(!paths[o.name]) { return null; }\n        return '\u002Fassets\u002Flib\u002F@plotdb\u002Fagent\u002Fmain\u002Fblock\u002F' + paths[o.name] + '?t=' + Date.now();\n      }\n      return '\u002Fassets\u002Flib\u002F' + o.name + '\u002F' + (o.version || 'main') + '\u002F' + (o.path || 'index.min.js');\n    }\n  });\n\n  function create(name, root, data) {\n    return mgr.get({name: name})\n      .then(function(cls) { return cls.create({root: root, data: data}); })\n      .then(function(inst) { return inst.interface(); });\n  }\n\n  \u002F\u002F 先載 base 層讓 extend 可解析, 再依序起 sandbox -\u003E chat (chat 需要 sandbox interface)\n  mgr.get([{name: 'chat-base'}, {name: 'sandbox-base'}])\n    .then(function() {\n      return create('sandbox', document.getElementById('sandbox-root'), {api: API, workspace: '\u002Fworkspace'});\n    })\n    .then(function(sb) {\n      if(blockName) { sb.show(blockName); }\n      return create('chat', document.getElementById('chat-root'), {api: API, block: blockName, sandbox: sb, stream: stream});\n    })\n    .then(function(chat) {\n      chat.on('block', function(name) {\n        history.replaceState(null, '', location.pathname + '?block=' + encodeURIComponent(name));\n      });\n    })\n    .catch(function(e) {\n      document.body.textContent = '初始化失敗: ' + e.message;\n      console.error(e);\n    });\n})();\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 