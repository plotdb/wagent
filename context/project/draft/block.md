 2 block 協定的部分, 考慮到規格上用戶在製作block 的時候應該要很彈性，所以我們可能會要把它框在一個 scope 中. @plotdb/block 有 host, clients 的設計概念, 你可翻翻看有無文件: /Users/tkirby/workspace/plotdb/projects/block
  @grantdash/composer 有實作的參考: /Users/tkirby/workspace/grantdash/projects/composer 有點亂但主要應該在 /Users/tkirby/workspace/grantdash/projects/composer/src 下. makeform 元件目前都有支援, 你可參考:
  /Users/tkirby/workspace/makeform/blocks
  其下 base, common 是入口點, input > common > base, 他們使用 grantdash composer host, 這個設計架構你可以參考.

  因為 grantdash/composer 那邊等於是 block 的視覺編輯介面, 我們很有可能會把這邊 ( 現在先叫他 @plotdb/wagent ) 整到那邊去用來開發 block.

  3. makechart.io 是我開發的圖表服務, 他也是走 @plotdb/block 機制, 有既定介面提供客製化機制, 甚至可以在網頁上編輯源碼; 我考慮之後也要把 wagent 整過去, 你可以先參考一下: /Users/tkirby/workspace/makechart/server/frontend/web/src/pug/editor

