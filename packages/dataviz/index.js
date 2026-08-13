// dataviz — 疊在 @plotdb/wagent 上的應用層。
//
// 分層:application (這裡) > wagent/host > agent loop, shell, sandbox
// wagent 對領域一無所知;要讓 agent 懂這個應用在幹嘛,是應用層的責任。
//
// 目前只有 purpose (靜態慣例)。之後還會有:
//  - 文件狀態 (資料本身, 對照 makechart 的 sharehub) 與交給 block 的 data provider
//  - csv -> 文件資料的轉換 (git history 有一份 parser, 需要時取回放這裡)
//  - brief / context — 讓 agent 知道「現在是什麼狀況」
// 見 context/project/spec/20260813-decoupling-and-architexture-refactor.md
module.exports = {
  purpose: require('./prompt')
};
