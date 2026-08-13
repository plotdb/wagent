// block 資料綁定: block 在 block.json 宣告它要什麼資料, host 讀檔、解析後注入。
//
// 為什麼不讓 block 自己讀檔: block 會被發佈到別的地方跑 (composer / makechart / 任意網頁),
// 那些環境沒有這個 workspace, 也沒有 loadText。宣告式的資料需求讓同一個 block
// 換個 host、換份資料就能用 — 檔案怎麼來是 host 的事。
//
// 零依賴 (csv 自己解), 因為這層將來要能被 wagent 以外的 host 使用。

// ── 解析 ──────────────────────────────────────────────────────────────

// RFC4180: 逗號與換行可以出現在引號內, "" 是跳脫的引號。
// 自己寫是為了不綁 d3 — host 不該因為「有人要畫圖」而拖進一個視覺化函式庫。
function splitRows(text, sep) {
  var rows = [], row = [], field = '', quoted = false, i = 0;
  // BOM: Excel 匯出的 csv 幾乎都有, 不吃掉的話第一個欄位名會多一個看不見的字元
  if(text.charCodeAt(0) === 0xfeff) { i = 1; }
  for(; i < text.length; i++) {
    var c = text[i];
    if(quoted) {
      if(c !== '"') { field += c; continue; }
      if(text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if(c === '"') { quoted = true; continue; }
    if(c === sep) { row.push(field); field = ''; continue; }
    if(c === '\r') { continue; }
    if(c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if(field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 數值轉換以「整欄」為單位: 只要有一格不是數字就整欄留字串。
// 逐格轉會讓同一欄混出 number 與 string, 下游的比較與排序會安靜地出錯 —
// 郵遞區號、產品編號這類「看起來像數字」的欄位也才不會被吃掉前導零。
function numericColumns(rows, keys) {
  var num = {};
  keys.forEach(function(k) { num[k] = false; });
  keys.forEach(function(k) {
    var seen = false;
    for(var i = 0; i < rows.length; i++) {
      var v = rows[i][k];
      if(v === '' || v == null) { continue; }         // 空值不算破壞
      if(!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) { return; }
      if(/^-?0\d/.test(v)) { return; }                 // 前導零: 幾乎都是代碼不是數字
      seen = true;
    }
    num[k] = seen;
  });
  return num;
}

export function parseDSV(text, sep) {
  var rows = splitRows(text, sep);
  if(!rows.length) { return []; }
  var keys = rows[0].map(function(k) { return k.trim(); });
  var out = rows.slice(1)
    .filter(function(r) { return r.length > 1 || (r[0] != null && r[0] !== ''); })
    .map(function(r) {
      var o = {};
      keys.forEach(function(k, i) { o[k] = r[i] == null ? '' : r[i]; });
      return o;
    });
  var num = numericColumns(out, keys);
  out.forEach(function(o) {
    keys.forEach(function(k) {
      if(num[k] && o[k] !== '') { o[k] = +o[k]; }
    });
  });
  return out;
}

export function typeOf(src, declared) {
  if(declared) { return declared; }
  var m = /\.([a-z0-9]+)$/i.exec(src || '');
  var ext = m ? m[1].toLowerCase() : '';
  if(ext === 'json') { return 'json'; }
  if(ext === 'csv') { return 'csv'; }
  if(ext === 'tsv') { return 'tsv'; }
  return 'text';
}

export function parseData(text, type) {
  if(type === 'json') { return JSON.parse(text); }
  if(type === 'csv') { return parseDSV(text, ','); }
  if(type === 'tsv') { return parseDSV(text, '\t'); }
  return text;
}

// ── 解析 block.json 的 data 宣告 ────────────────────────────────────────

// 兩種寫法:
//   "data": {"orders": "data/orders.csv"}
//   "data": {"orders": {"src": "data/orders.csv", "type": "csv"}}
function specOf(v) {
  if(typeof v === 'string') { return {src: v}; }
  if(v && typeof v === 'object' && typeof v.src === 'string') { return v; }
  return null;
}

// load(path) -> Promise<string>。回傳 {key: 解析後的值}。
// 失敗一次收齊再拋 — 讓 agent 一輪就能把所有錯的路徑改完, 而不是修一個發現下一個。
export function resolveData(spec, load) {
  var keys = Object.keys(spec || {});
  if(!keys.length) { return Promise.resolve({}); }
  var out = {}, errors = [];
  return Promise.all(keys.map(function(k) {
    var s = specOf(spec[k]);
    if(!s) {
      errors.push('data.' + k + ': expected a path string or {src, type}');
      return null;
    }
    var type = typeOf(s.src, s.type);
    return Promise.resolve()
      .then(function() { return load(s.src); })
      .then(function(text) { out[k] = parseData(text, type); })
      .catch(function(e) {
        errors.push('data.' + k + ' (' + s.src + '): ' + String((e && e.message) || e));
      });
  })).then(function() {
    if(errors.length) {
      throw new Error('block data could not be resolved — ' + errors.join('; '));
    }
    return out;
  });
}

export default {parseDSV, parseData, typeOf, resolveData};
