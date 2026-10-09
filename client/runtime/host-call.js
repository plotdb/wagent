// worker -> 主執行緒的 host 呼叫 (snapshot / host 註冊的 tool / context)。
// 從 agent-worker.js 拆出來是為了能在 node 裡測 (worker 本身要 esh 與 self)。
//
// 逾時的優先序: 呼叫端指定 > tool 自己的 timeout > registerHost 的 timeout > HOST_TIMEOUT。
// 為什麼要能逐個設: 生圖之類的 host tool 正常就要 30~60 秒, 固定 20 秒的話 agent 每次都
// 看到「逾時」—— 而 host 那邊其實做完了, 模型於是一再重試, 每次都多做一份。
export const HOST_TIMEOUT = 20000;

function ms(v) {
  const n = +v;
  return n > 0 && isFinite(n) ? n : 0;
}

// 給 provider 的 tool 定義只留這三個欄位: timeout 是給 runtime 的, 不是 schema 的一部分
export function toolSchema(t) {
  return {name: t.name, description: t.description, parameters: t.parameters};
}

// 逾時回給模型的訊息。重點是「host 可能還在做」—— 只說 timed out 的話, 模型的合理反應
// 就是再叫一次, 而那正是重複執行的來源。
export function timeoutMessage(name, timeout) {
  return `${name} timed out after ${Math.round(timeout / 1000)}s with no response from the host. ` +
    'The host may still be working on it and finish later. Calling it again right away will most ' +
    'likely start a duplicate job and time out the same way — do not blindly retry. Check its effect ' +
    'first (e.g. snapshot, or read the state it changes), then decide; if it is not done yet, tell the user.';
}

// post: 送訊息給主執行緒的 function
export function createHostCaller(post) {
  const pending = {};
  let seq = 0;
  let timeouts = {};      // tool name -> ms
  let fallback = 0;       // registerHost({timeout})

  // host 重新註冊時整份換掉 (同 worker 的 hostTools)
  function setTools(tools, timeout) {
    timeouts = {};
    (tools || []).forEach(function(t) {
      if(t && t.name && ms(t.timeout)) { timeouts[t.name] = ms(t.timeout); }
    });
    fallback = ms(timeout);
  }

  function timeoutOf(name, opt) {
    return ms(opt.timeout) || timeouts[name] || fallback || HOST_TIMEOUT;
  }

  function call(name, args, opt) {
    opt = opt || {};
    const id = `h${++seq}`;
    const kind = opt.kind || 'tool';
    const timeout = timeoutOf(name, opt);
    return new Promise(function(resolve, reject) {
      const timer = setTimeout(function() {
        delete pending[id];
        // context 之類不是模型叫的, 不需要「別重試」那段
        reject(new Error(kind === 'tool' ? timeoutMessage(name, timeout) :
          `${name} timed out (no response from host)`));
      }, timeout);
      pending[id] = {resolve: resolve, reject: reject, timer: timer};
      post({type: 'host-call', id: id, kind: kind, name: name, args: args || {}});
    });
  }

  // 主執行緒的回覆。逾時之後才到的直接略過 —— 那時模型已經拿到逾時訊息了
  function result(msg) {
    const p = pending[msg.id];
    if(!p) { return; }
    delete pending[msg.id];
    clearTimeout(p.timer);
    return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
  }

  return {setTools: setTools, call: call, result: result, timeoutOf: function(name) { return timeoutOf(name, {}); }};
}
