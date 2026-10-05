// @plotdb/wagent/headless — 沒有使用者在場時的觀察通道。
//
// snapshot 是 host 契約裡唯一必要的那塊, 而它需要一個 renderer。Node 沒有 DOM,
// 所以「wagent 在 Node 上跑」若不解決這件事, 得到的是一個看不見自己成果的 agent。
//
// **renderer 不持有 fs。** 它拿到的是 source 字串與 data 值, 不是路徑 ——
// 跟 block 拿到 opt.data 而不是檔案路徑是同一條原則。讓 headless 那頁也持有一份
// fs (OPFS) 會變成「Node 一份、瀏覽器一份」, 那是本專案反覆出事的形狀。
//
//     Node                                   headless page
//     持有 fs / 跑 agent loop        ──►      掛上去、等穩定、出報告
//       {source, data, width, ...}   ◄──      {report, image}
//
// 圖走 CDP 截圖 (真實合成後的畫面), 不是 snapdom 的 foreignObject 重繪 ——
// 所以跨 origin 資源、CSS filter/blend、WebGL 都不會失真, 也不需要使用者授權。
// 報告仍由 sandbox 自己產生 (它才知道 client 能力、差異量、blank 判定)。

const path = require('path');
const fs = require('fs');

// 頁面需要的執行環境。與瀏覽器端同一組 —— 這裡不猜, 直接從 node_modules 解析,
// 版本才不會與應用層裝的那份分岔。
const LIBS = [
  'proxise/index.min.js',
  '@plotdb/semver/index.min.js',
  '@plotdb/csscope/index.min.js',
  '@plotdb/rescope/index.min.js',
  '@plotdb/block/index.min.js'
];

function resolveFrom(spec, from) {
  try { return require.resolve(spec, from ? {paths: [from]} : undefined); }
  catch(e) { return null; }
}

// sandbox 的 base 層 —— 它自己的註解就寫著「headless, 負責載入並執行 block、
// 對外提供操作 api」。視覺層 (index.html: 下拉選單 + 重繪鈕) 在這裡用不到。
function sandboxBasePath(opt) {
  if(opt && opt.sandbox) { return opt.sandbox; }
  // 同一個套件裡, 不必再從 node_modules 找 @plotdb/wagent
  const local = path.join(__dirname, '..', 'client', 'block', 'sandbox', 'base.html');
  if(fs.existsSync(local)) { return local; }
  throw new Error('找不到 sandbox/base.html — 用 {sandbox: <path>} 指定');
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  #stage { padding: 0; }
</style>
</head><body><div id="host"></div><div id="stage"></div></body></html>`;

/**
 * createRenderer(opt) -> Promise<renderer>
 *
 *   opt.browser   已經開好的 playwright browser (不給就自己 launch, close 時一併關掉)
 *   opt.launch    傳給 chromium.launch 的選項
 *   opt.scripts   額外要注入頁面的 script 檔案路徑或 URL (Chart.js / d3 之類) —
 *                 這是**應用層**的事, wagent 不內建任何函式庫
 *   opt.sandbox   sandbox/base.html 的路徑 (預設是本套件的 client/block/sandbox/base.html)
 *   opt.width / opt.height   viewport 預設值
 */
async function createRenderer(opt) {
  opt = opt || {};
  let playwright;
  try { playwright = require('playwright'); }
  catch(e) {
    try { playwright = require('playwright-core'); }
    catch(e2) {
      throw new Error('@plotdb/wagent/headless 需要 playwright (peer dependency): npm i playwright');
    }
  }

  const width = opt.width || 900;
  const height = opt.height || 600;
  const ownBrowser = !opt.browser;
  const browser = opt.browser ||
    await playwright.chromium.launch(Object.assign({headless: true}, opt.launch));
  const page = await (await browser.newContext({viewport: {width, height}})).newPage();
  await page.setContent(PAGE, {waitUntil: 'domcontentloaded'});

  // 執行環境: 先 libs, 再應用層的 scripts (順序有意義 — 應用層可能依賴 block)
  for(const spec of LIBS) {
    const p = resolveFrom(spec, process.cwd()) || resolveFrom(spec);
    if(!p) { throw new Error(`找不到 ${spec} — headless renderer 需要與瀏覽器端相同的執行環境`); }
    await page.addScriptTag({path: p});
  }
  for(const s of (opt.scripts || [])) {
    if(/^https?:/.test(s)) { await page.addScriptTag({url: s}); }
    else { await page.addScriptTag({path: s}); }
  }

  const sandboxCode = fs.readFileSync(sandboxBasePath(opt), 'utf8');

  // sandbox-base 掛在頁面上。source / data 由 Node 每次呼叫時餵進來 ——
  // 這兩個窗口本來就是給應用層的, headless 只是另一個應用層。
  await page.evaluate(async (code) => {
    const mgr = new window.block.manager({
      registry: function() { return null; }   // 沒有 lib 要解析: 需要的都已在全域
    });
    const cls = new window.block['class']({
      name: 'sandbox-base', version: 'main', code: code, manager: mgr
    });
    const inst = await cls.create({
      root: document.getElementById('host'),
      data: {
        // 每次 snapshot 前由 Node 換掉 —— renderer 不知道 workspace 存在
        source: function() { return window.__src || ''; },
        data: function() { return window.__data || {}; }
      }
    });
    const base = await inst.interface();
    // 視覺層在 headless 用不到, 但 'show' -> render 這條線要自己接上,
    // 否則 self.current 有值而畫面沒東西 (報告會說 rendered: false)
    base.on('show', function(name) {
      const stage = document.getElementById('stage');
      stage.innerHTML = '';
      const el = document.createElement('div');
      stage.appendChild(el);
      base.render(name, el).catch(function(e) { console.error('render failed', e); });
    });
    window.__base = base;
  }, sandboxCode);

  const renderer = {
    page: page,
    browser: browser,

    /**
     * snapshot({source, data, name, width, height, time, image, ...}) -> {report, image?}
     *
     * source 必填 —— renderer 沒有 fs, 名字對不到任何東西。name 只是報告上的標籤。
     * 其餘參數原樣傳給 sandbox 的 snapshot (mode / time / refresh ...)。
     */
    snapshot: async function(o) {
      o = o || {};
      if(typeof o.source !== 'string' || !o.source) {
        throw new Error('snapshot 需要 source (block 原始碼) — renderer 不讀檔');
      }
      const name = o.name || 'block';
      if(o.width || o.height) {
        await page.setViewportSize({width: o.width || width, height: o.height || height});
      }
      const args = Object.assign({}, o);
      delete args.source; delete args.data; delete args.image;

      const report = await page.evaluate(async (a) => {
        window.__src = a.src;
        window.__data = a.data || {};
        const base = window.__base;
        // 每次都重掛: Node 端每次呼叫都可能是不同的 source, 沒有「同一個 block 被改了」
        // 這種增量情境 —— 那是瀏覽器端有使用者在看時才有的狀態
        base.show(a.name);
        const r = await base.snapshot(a.opt);
        return r.report;
      }, {src: o.source, data: o.data || null, name: name, opt: args});

      if(!o.image) { return {report: report}; }
      // CDP 截圖: 真實合成後的畫面。抓 stage 而不是整頁, 尺寸才與報告一致。
      const el = await page.$('#stage');
      const buf = await el.screenshot({type: 'jpeg', quality: 80});
      const box = await el.boundingBox();
      return {
        report: report,
        image: {
          mediaType: 'image/jpeg',
          data: buf.toString('base64'),
          width: box ? Math.round(box.width) : null,
          height: box ? Math.round(box.height) : null
        }
      };
    },

    close: async function() {
      await page.close().catch(function() {});
      if(ownBrowser) { await browser.close().catch(function() {}); }
    }
  };
  return renderer;
}

module.exports = {createRenderer};
