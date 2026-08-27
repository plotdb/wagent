// dataviz 應用層的「文件狀態」。
//
// 這是 Tier 1 的實作 (見 context/project/spec/20260813-decoupling-and-architexture-refactor.md):
// 資料由應用層持有, 以「值」餵給 block — block 不讀檔、不持有任何路徑,
// 換個環境、換份資料就能跑。對照 makechart 的 host.local.raw (存在 sharedb 裡的
// 是資料本身, 不是檔案路徑), composer 的 nodemgr。
//
// 這裡刻意用最笨的儲存 (記憶體 + 一份 localStorage 快照)。重點不是持久化,
// 是「誰持有資料、誰決定形狀」這條線畫在哪。真的要上線就換成 sharedb / db。

import {parseCSV, toCSV} from './csv.js';

// 圖表要的 sheet 結構是**事先定義**的: 每一欄對應一個視覺化維度。
// 因為欄位型別已知, 讀進來就不必猜哪一欄是數字 (先前 csv parser 那套整欄推測就不需要了)。
export const DIMENSIONS = [
  {key: 'label', name: 'label', type: 'string', desc: 'x 軸 / 分類名稱'},
  {key: 'value', name: 'value', type: 'number', desc: '主要數值'},
  {key: 'series', name: 'series', type: 'string', desc: '分組 (可留空)'}
];

const KEY = 'dataviz-sheet';
const SAMPLE = [
  DIMENSIONS.map(function(d) { return d.name; }),
  ['2026-01', 128, 'A'],
  ['2026-02', 115, 'A'],
  ['2026-03', 143, 'A'],
  ['2026-04', 156, 'A'],
  ['2026-05', 150, 'A'],
  ['2026-06', 171, 'A']
];

// sheet widget 會自己補一堆空白列給使用者往下打 (設 5 列進去, data() 回 29 列)。
// 那是**畫面狀態**不是文件內容, 所以在進 store 的邊界就濾掉 —
// 而不是每個出口 (csv / value / 存檔) 各濾一次。單一真相要在入口就成立。
function trimBlank(rows) {
  var last = rows.length - 1;
  while(last > 0 && !(rows[last] || []).some(function(c) { return c !== '' && c != null; })) { last--; }
  return rows.slice(0, last + 1);
}

function coerce(v, type) {
  if(type !== 'number') { return v == null ? '' : String(v); }
  if(v === '' || v == null) { return null; }
  var n = +v;
  return isNaN(n) ? null : n;
}

export function createStore() {
  var rows = null;
  try {
    var saved = localStorage.getItem(KEY);
    if(saved) { rows = JSON.parse(saved); }
  } catch(e) { rows = null; }
  if(!Array.isArray(rows) || !rows.length) { rows = SAMPLE.map(function(r) { return r.slice(); }); }

  var listeners = [];
  function fire() {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch(e) { /* 滿了就算了 */ }
    listeners.forEach(function(fn) {
      try { fn(); } catch(e) { console.error('sheet listener failed', e); }
    });
  }

  return {
    dimensions: DIMENSIONS,
    on: function(fn) { listeners.push(fn); },
    // 給 sheet UI 的原始 2D 陣列 (含表頭)。
    //
    // **一定要回複本。** sheet widget 拿到陣列後會直接在上面補空白列,
    // 回傳內部參考的話它就把我們的文件狀態改掉了 — 實測 setRaw(4 列) 進去、
    // 同一次呼叫內就變成 29 列 (fire -> listener -> sh.data(raw()) -> widget 就地 push)。
    // 兩個地方共用同一個陣列 = 兩份狀態, 這禮拜第五次。
    raw: function() { return rows.map(function(r) { return (r || []).slice(); }); },
    setRaw: function(next) {
      rows = trimBlank(next || []).map(function(r) { return (r || []).slice(); });
      fire();
    },
    // 給 block 的資料: 已經解析好、型別正確的物件陣列。
    // block 拿到的是「值」, 不是檔案 — 這就是 Tier 1 的重點。
    value: function() {
      var head = rows[0] || [];
      var idx = {};
      DIMENSIONS.forEach(function(d) {
        var i = head.indexOf(d.name);
        idx[d.key] = i >= 0 ? i : DIMENSIONS.indexOf(d);
      });
      var out = rows.slice(1)
        .filter(function(r) { return (r || []).some(function(c) { return c !== '' && c != null; }); })
        .map(function(r) {
          var o = {};
          DIMENSIONS.forEach(function(d) { o[d.key] = coerce(r[idx[d.key]], d.type); });
          return o;
        });
      return {columns: DIMENSIONS, rows: out};
    },
    // 與 agent 之間以 csv 交換。讀走 device 檔案 (dev/sheet, 唯讀) —
    // agent 用 cat / grep / wc 直接查, 不必為此開 tool;寫仍走 write_sheet tool。
    toCSV: function() { return toCSV(rows); },
    fromCSV: function(text) {
      var next = trimBlank(parseCSV(String(text || '')));
      if(!next.length) { throw new Error('csv is empty'); }
      rows = next;
      fire();
      return rows.length - 1;
    }
  };
}
