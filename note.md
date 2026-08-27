# 這個 repo 已經封存

初步開發(prototype)已完成,**之後的開發移到**:

    /Users/tkirby/workspace/plotdb/projects/wagent

那邊是同一個 GitHub repo(`plotdb/wagent`)的 `master`,不帶這裡的歷史包袱 ——
server 模式、舊的實驗頁、dataviz 的舊接法都沒有帶過去。這裡留著是為了歷史紀錄。

## 這裡的東西去哪了

    packages/wagent        搬過去了, 而且清理過 (拓樸抽掉、prompt 去領域化)
    packages/wagent-headless  搬過去了
    packages/dataviz       改寫成新 repo 的 sample/dataviz + web/src/pug/dataviz
    api/ providers/ llm.js server 模式 — 已判定是死路, 沒有帶過去
    web/src/pug/refactor-* 舊實驗頁, 沒有帶過去

## git 的狀態

remote 已改名為 `archive`(仍是 `plotdb/wagent`),遠端的對應:

    archive/master              新 repo (不是這裡的東西)
    archive/dev/legacy/draft    這裡的舊 master
    archive/dev/legacy/hosting  這裡的舊 dev/hosting

**注意**:本地沒有 `master` 分支。在這裡打 `git checkout master` 的話,git 會
自動從 `archive/master` 開一條新的 —— 拿到的是**新 repo 的內容**,而 untracked 的
`node_modules/`、`workspace/` 會留在原地變成兩個專案的混合體。要看新 repo 請直接去
上面那個路徑。

---

(以下是封存前的舊筆記)

設計草案已移至 `context/project/draft/spec.md`(討論過程見同目錄 `discuss.md`)。
