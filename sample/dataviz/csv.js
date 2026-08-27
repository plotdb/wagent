// CSV 解析 / 輸出。應用層的東西 — wagent 不該因為「有人要畫圖」而認得 csv。
//
// 這份原本在 packages/wagent/web/runtime/blockdata.js, 隨 block.json 一起退場;
// 現在有真正的消費者了 (sheet 與 agent 之間以 csv 交換), 放回它該在的層。
//
// 與當初的差別: 拿掉了「整欄都是數字才轉 number」那套推測。
// 這裡的欄位型別是 dimensions 事先宣告的 (見 sheet-store.js), 不必用猜的 —
// 這正是「預先定義 sheet 結構」帶來的好處。

// RFC4180: 逗號與換行可以出現在引號內, "" 是跳脫的引號
export function parseCSV(text, sep) {
  sep = sep || ',';
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

function cell(v) {
  var s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(rows) {
  return (rows || []).map(function(r) {
    return (r || []).map(cell).join(',');
  }).join('\n') + '\n';
}
