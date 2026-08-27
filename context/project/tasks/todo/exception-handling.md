1. [x] 出錯時, 預設會修正; 在錯誤訊息處加個 switch, 開代表會自動讓 agent 修, 否則會出現一個按鈕, 按了才傳給 agent.
2. [x] agent 做事時, 用戶仍可送訊息, 訊息會 queue 起來, 等 agent 執行完一個指令時送出給 agent, 做為進一步的參考資訊
       ( 可以邊跑邊加入新想法或資訊的概念 )

---

實作 (2026-08-27):

1. chat base 的 `autoFix(v)` 是 getter/setter, 視覺層在 header 放 checkbox。
   關著、或自動修正已達上限, 都改發 `fix-offer` 事件帶一個 `fix()` — 視覺層畫成按鈕。
   **safe guard 不受開關影響**: 只碰 agent 這一輪真的寫過、而且是目前編輯對象的 block。

2. `transport.nudge(text)` -> worker 的 `nudges[]` -> provider 在
   「tool result 之後、下一輪 LLM 呼叫之前」來拿。那是唯一不破壞
   tool_use/tool_result 配對的插入點 (test/nudge.mjs 直接檢查 request body)。
   agent 沒呼叫 tool 就結束時 queue 會有剩 — 剩的自動再跑一輪, 不能靜靜丟掉。
