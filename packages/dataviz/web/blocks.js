// 這個應用的 workspace 拓樸 —— **應用層的東西**。
//
// 原本在 packages/wagent 的 runtime/client.js (io.listBlocks)。但「block 放在
// blocks/<name>/index.html」是這個 app 的目錄約定, 不是 wagent 的知識:
// 一個只編輯單一 block 的應用, 檔案就在 /index.html, 根本沒有 blocks/;
// 一個拿 wagent 做遊戲的人, 目錄長什麼樣是他自己的事。
//
// 判準與 seed.js、prompt.js 的 purpose 是同一條。

export const BLOCK_DIR = 'blocks';
export const BLOCK_FILE = 'index.html';

export function blockPath(name) { return `${BLOCK_DIR}/${name}/${BLOCK_FILE}`; }

// rt: createRuntime 的回傳值 (要用 rt.sh 未限縮的 shell 與 rt.io)
// 回 [{name, description}] — description 從原始碼的 pkg 撈, 給 agent 看清單用
export function listBlocks(rt) {
  return rt.sh.run(`ls ${rt.root}/${BLOCK_DIR}`).then(function(r) {
    const names = (r.stdout || '').split('\n')
      .map(function(s) { return s.trim(); })
      .filter(Boolean);
    return Promise.all(names.map(function(n) {
      return rt.io.loadText(blockPath(n))
        .then(function(src) {
          const m = src.match(/description:\s*(['"])((?:\\.|(?!\1).)*)\1/);
          return {name: n, description: m ? m[2] : ''};
        })
        .catch(function() { return null; });
    })).then(function(list) { return list.filter(Boolean); });
  });
}
