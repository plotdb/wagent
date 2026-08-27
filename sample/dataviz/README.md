# dataviz — 有領域的應用層

`sample/` 底下是**應用**,不是頁面。這裡的東西不經 srcbuild,由 server 直接以
ES module 交出去(`app.use('/sample', express.static('sample'))`);對應的 demo 頁面
在 `web/src/pug/dataviz/`,跟另外兩個 sample 一樣。

分這一刀的理由:一個應用換個頁面照樣能用,而頁面是這個 repo 的展示品。

## 這個 sample 在守什麼

另外兩個 sample 示範「wagent 不知道你在做什麼」。這個示範反面 —— 一個應用怎麼把
自己的領域講給 agent 聽,以及**資料怎麼流到 block**:

    使用者改試算表 ─> store (應用層的文件狀態, 唯一真相)
                       ├─> sandbox: 以「值」餵給 block (opt.data) — block 不讀檔
                       ├─> device dev/sheet: agent 用 cat / grep / wc 直接查
                       └─> sheet UI: 回寫視圖

block 拿到的是**值**不是路徑,所以換個環境、換份資料就能跑。這條線斷掉不會報錯,
只會畫出舊資料 —— 所以它需要一個活著的 sample 守著。

## 檔案

    sheet-store.js   文件狀態。唯一真相, 其餘都是它的視圖
    csv.js           與 agent 之間的交換格式
    seed.js          workspace 的初始內容 (一張長條圖) — 「新使用者看到什麼」是領域決定
    blocks.js        這個 app 的目錄約定 (blocks/<name>/index.html)
    prompt.js        領域 prompt, 以 wagent 的 purpose 代入

`prompt.js` 由 `server.js` 掛在**第二個 api mount** 上:

    app.use('/api/dataviz', require('@plotdb/wagent')({purpose: require('./sample/dataviz/prompt')}));

一台 server 上可以有好幾個應用,各有各的領域 prompt。`/api/agent`(另外兩個 sample 用的)
沒有 purpose —— 那是純粹的 block 編輯環境。

## workspace 的隔離

三個 sample 在同一個 origin,共用同一份 OPFS。隔離有**兩層,互相獨立**:

    mounts: {'/home': {backend: 'opfs', path: 'dataviz'}}   換儲存 (OPFS 的哪個子目錄)
    root:   '/home/dataviz'                                  換虛擬路徑 (agent 看到的世界)

另外兩個 sample 只用第一層。這個兩層都用 —— 不是因為需要,是因為疊起來的行為要有人
一直踩著,不然哪天壞了沒人知道。於是實體位置是 `OPFS:/dataviz/dataviz/`。

兩者省略時都是原行為(`path` 省略 = origin root,`root` 省略 = `/home/workspace`)。
哪一層都**不是安全邊界**:同一個 origin、同一份配額。真正的圍堵是 agent 的 chroot。
