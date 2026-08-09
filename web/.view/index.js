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























































































pug_html = pug_html + "\u003Chtml\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1\"\u003E\u003Ctitle\u003E我的圖表\u003C\u002Ftitle\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fd3@7\u002Fdist\u002Fd3.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript src=\"https:\u002F\u002Fcdn.jsdelivr.net\u002Fnpm\u002Fchart.js@4\u002Fdist\u002Fchart.umd.min.js\"\u003E\u003C\u002Fscript\u003E\u003Cstyle type=\"text\u002Fcss\"\u003E* { box-sizing: border-box; }\nbody { margin: 0; font-family: -apple-system, \"Helvetica Neue\", \"PingFang TC\", sans-serif; background: #f5f5f2; min-height: 100vh; }\nheader { padding: 18px 28px; display: flex; align-items: baseline; gap: 12px; }\nheader h1 { font-size: 20px; margin: 0; }\nheader .sub { font-size: 12px; color: #999; }\n.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; padding: 0 28px 40px; }\n.card { background: #fff; border: 1px solid #e2e2de; border-radius: 10px; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; transition: box-shadow .15s; }\n.card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); }\n.card .thumb { height: 200px; padding: 10px; pointer-events: none; overflow: hidden; position: relative; }\n.card .thumb .err { color: #b3261e; font-size: 12px; padding-top: 80px; text-align: center; }\n.card .info { padding: 12px 16px; border-top: 1px solid #f0f0ec; }\n.card .info .name { font-size: 14.5px; font-weight: 600; }\n.card .info .desc { font-size: 12.5px; color: #888; margin-top: 3px; min-height: 16px; }\n.card.new { align-items: center; justify-content: center; min-height: 262px; border-style: dashed; color: #999; font-size: 15px; background: transparent; }\n.card.new:hover { color: #2b6cb0; border-color: #2b6cb0; }\n.card.new .plus { font-size: 36px; line-height: 1; margin-bottom: 8px; }\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Cheader\u003E\u003Ch1\u003E我的圖表\u003C\u002Fh1\u003E\u003Cdiv class=\"sub\"\u003E點擊卡片進入編輯 · 檔案存於 workspace\u002Fblocks\u002F\u003C\u002Fdiv\u003E\u003C\u002Fheader\u003E\u003Cdiv class=\"grid\" id=\"grid\"\u003E\u003C\u002Fdiv\u003E\u003Cscript\u003E(function() {\n  var ctx = {\n    d3: window.d3,\n    Chart: window.Chart,\n    loadText: function(p) {\n      return fetch('\u002Fworkspace\u002F' + p).then(function(r) {\n        if(!r.ok) { throw new Error('load failed: ' + p); }\n        return r.text();\n      });\n    },\n    loadJSON: function(p) {\n      return fetch('\u002Fworkspace\u002F' + p).then(function(r) {\n        if(!r.ok) { throw new Error('load failed: ' + p); }\n        return r.json();\n      });\n    }\n  };\n\n  function renderBlock(name, root) {\n    return fetch('\u002Fworkspace\u002Fblocks\u002F' + name + '\u002Findex.js?t=' + Date.now())\n      .then(function(r) {\n        if(!r.ok) { throw new Error('block not found'); }\n        return r.text();\n      })\n      .then(function(code) {\n        var module = {exports: {}};\n        new Function('module', 'exports', code)(module, module.exports);\n        if(!module.exports || typeof module.exports.init !== 'function') {\n          throw new Error('invalid block');\n        }\n        return module.exports.init({root: root, ctx: ctx});\n      });\n  }\n\n  var grid = document.getElementById('grid');\n\n  function card(b) {\n    var el = document.createElement('div');\n    el.className = 'card';\n    var thumb = document.createElement('div');\n    thumb.className = 'thumb';\n    var info = document.createElement('div');\n    info.className = 'info';\n    info.innerHTML = '\u003Cdiv class=\"name\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv class=\"desc\"\u003E\u003C\u002Fdiv\u003E';\n    info.querySelector('.name').textContent = b.name;\n    info.querySelector('.desc').textContent = b.description || '';\n    el.appendChild(thumb);\n    el.appendChild(info);\n    el.onclick = function() { location.href = '\u002Fedit.html?block=' + encodeURIComponent(b.name); };\n    renderBlock(b.name, thumb).catch(function(e) {\n      thumb.innerHTML = '\u003Cdiv class=\"err\"\u003E預覽失敗: ' + e.message + '\u003C\u002Fdiv\u003E';\n    });\n    return el;\n  }\n\n  fetch('\u002Fapi\u002Fblocks')\n    .then(function(r) { return r.json(); })\n    .then(function(blocks) {\n      var add = document.createElement('div');\n      add.className = 'card new';\n      add.innerHTML = '\u003Cdiv class=\"plus\"\u003E+\u003C\u002Fdiv\u003E\u003Cdiv\u003E新增圖表\u003C\u002Fdiv\u003E';\n      add.onclick = function() { location.href = '\u002Fedit.html'; };\n      grid.appendChild(add);\n      blocks.forEach(function(b) { grid.appendChild(card(b)); });\n    });\n})();\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 