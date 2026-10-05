import {readSSE, checkResponse} from '../sse.js';
import {pruneContext, userContent, wrapNudge, wrapLimit, limitReply, wrapTruncated} from '../turn-context.js';
import {ID, make as lderr} from '../lderr.js';

// browser 版 provider: 打後端 llm proxy (原生 wire format), 自行跑 tool loop。
// 介面同後端 providers/*: createSession({system, tools, runTool}) -> {send(text, cb), reset()}
// runTool 可回傳 Promise (前端 fs / shell 皆為 async)
export function createSession({system, tools, runTool, api, model, headers, maxSteps, softSteps}) {
  const url = (api || '/api/agent') + '/llm/openai';
  // 見 anthropic.js 的同一段
  const MAX_TRUNCATED = 2;   // 見 anthropic.js
  const hardMax = maxSteps > 0 ? maxSteps : 30;
  const softMax = softSteps > 0 ? Math.min(softSteps, hardMax) : Math.max(1, hardMax - 10);
  const toolDefs = tools.map(function(t) {
    return {type: 'function', function: {name: t.name, description: t.description, parameters: t.parameters}};
  });
  let history = [{role: 'system', content: system}];

  // 回傳 assistant message; cb.onDelta 時走 streaming 並累積 content / tool_calls
  function createMessage(cb) {
    const params = {
      model: model || 'gpt-5',
      max_completion_tokens: 16000,
      tools: toolDefs,
      messages: history
    };
    if(cb && cb.onDelta) { params.stream = true; }
    return fetch(url, {
      method: 'POST',
      // headers 是 getter: token 會過期, 每次呼叫都要拿當下的那一份
      headers: Object.assign({'Content-Type': 'application/json'},
        (typeof headers === 'function' ? headers() : headers) || {}),
      body: JSON.stringify(params)
    })
      .then(checkResponse)
      .then(function(r) {
        if(!params.stream) {
          return r.json().then(function(j) {
            var c = j.choices[0];
            return Object.assign({}, c.message, {finish_reason: c.finish_reason});
          });
        }
        const msg = {role: 'assistant', content: '', tool_calls: []};
        let finish = null;
        return readSSE(r, function(ev) {
          if(ev.data === '[DONE]') { return; }
          const chunk = JSON.parse(ev.data);
          // proxy 注入的中止事件 (見 api/proxy.js 的 errorEvent)。
          // openai 的串流本身沒有 error 事件, 所以這一則一定是我們的。
          if(chunk.type === 'error' || chunk.error) {
            const x = chunk.error || {};
            const e = new Error(x.message || 'stream error');
            if(x.name === 'lderror' && !isNaN(+x.id)) { e.id = +x.id; e.name = 'lderror'; }
            throw e;
          }
          const c = (chunk.choices || [])[0] || {};
          if(c.finish_reason) { finish = c.finish_reason; }
          const d = c.delta || {};
          if(d.content) {
            msg.content += d.content;
            cb.onDelta(d.content);
          }
          for(const tc of d.tool_calls || []) {
            const cur = msg.tool_calls[tc.index] = msg.tool_calls[tc.index] ||
              {id: '', type: 'function', function: {name: '', arguments: ''}};
            if(tc.id) { cur.id = tc.id; }
            if(tc.function && tc.function.name) { cur.function.name += tc.function.name; }
            if(tc.function && tc.function.arguments) { cur.function.arguments += tc.function.arguments; }
          }
        }).then(function() {
          if(!msg.tool_calls.length) { delete msg.tool_calls; }
          msg.finish_reason = finish;
          return msg;
        });
      });
  }

  function send(text, cb) {
    const startLen = history.length;
    // 舊的狀況描述先清掉再附上本輪的 — 只有最新一份是真的
    pruneContext(history);
    history.push({role: 'user', content: userContent(text, cb && cb.context)});
    const events = [];

    // tool 結果若帶圖: openai 的 tool message 只吃字串, 圖要另外補一則 user message
    const images = [];

    // 依序執行 tool calls (共用同一個 shell, 不併行)
    function runCalls(calls, i) {
      if(i >= calls.length) { return Promise.resolve(); }
      const call = calls[i];
      let input = {};
      return Promise.resolve()
        .then(function() {
          input = JSON.parse(call.function.arguments || '{}');
          return runTool(call.function.name, input);
        })
        .then(function(out) {
          events.push({tool: call.function.name, input: input, error: false});
          const img = (out && typeof out === 'object' && out.image) ? out.image : null;
          if(img) { images.push(img); }
          history.push({
            role: 'tool', tool_call_id: call.id,
            content: img ? ((out.text || '') + '\n(image attached in the next message)') : String(out)
          });
        })
        .catch(function(e) {
          events.push({tool: call.function.name, input: input, error: true});
          history.push({role: 'tool', tool_call_id: call.id, content: String((e && e.message) || e)});
        })
        .then(function() { return runCalls(calls, i + 1); });
    }

    // 這一輪 tool 產生的圖補成一則 user message; 同時把更早的圖換掉 —
    // 舊圖留在對話裡每輪都要重付一次 token, 只保留最新一張
    function flushImages() {
      if(!images.length) { return; }
      for(const m of history) {
        if(m.role !== 'user' || !Array.isArray(m.content)) { continue; }
        const idx = m.content.findIndex(function(x) { return x.type === 'image_url'; });
        if(idx >= 0) { m.content = [{type: 'text', text: '[earlier image omitted]'}]; }
      }
      const content = [{type: 'text', text: 'snapshot of the rendered block:'}];
      for(const img of images) {
        content.push({
          type: 'image_url',
          image_url: {url: 'data:' + img.mediaType + ';base64,' + img.data}
        });
      }
      history.push({role: 'user', content: content});
      images.length = 0;
    }

    // 使用者執行中插的話。openai 的 tool 結果是獨立的 role:'tool' 訊息, 所以
    // 補一則 user message 即可 — 但必須等所有 tool_call 都有對應的 tool 訊息,
    // 少一個 provider 就整包拒絕。
    function flushNudges() {
      const extra = cb && cb.nudge ? cb.nudge() : null;
      if(extra && extra.length) {
        history.push({role: 'user', content: [{type: 'text', text: wrapNudge(extra)}]});
      }
    }

    let steps = 0;
    let warned = false;
    let truncated = 0;

    // soft limit: openai 的 tool 結果是獨立訊息, 所以補一則 user message
    // (同 flushNudges 的理由 — 必須等所有 tool_call 都有對應的 tool 訊息)
    function flushLimit() {
      if(steps < softMax || warned) { return; }
      warned = true;
      history.push({role: 'user', content: [{type: 'text', text: wrapLimit(steps, hardMax)}]});
    }

    const step = function() {
      if(steps >= hardMax) { return Promise.resolve({reply: limitReply(hardMax), events: events, limited: true}); }
      steps++;
      return createMessage(cb).then(function(msg) {
        // 撞到長度上限被截斷 —— 見 anthropic.js 的同一段。
        // openai 的 tool 參數本來就是 JSON.parse 在 runCalls 裡丟例外 (會變成
        // 一則 error 的 tool 訊息), 所以壞掉的參數不會被當成「沒有參數」;
        // 但截斷的**文字**回覆一樣會被當成完整的交出去, 那才是這裡要擋的。
        if(msg.finish_reason === 'length') {
          truncated++;
          if(truncated > MAX_TRUNCATED) {
            throw lderr(ID.TRUNCATED,
              '模型回應連續 ' + MAX_TRUNCATED + ' 次超過長度上限被截斷, 已停止。');
          }
          history.push({role: 'assistant', content: msg.content || '(回覆被截斷)'});
          history.push({role: 'user', content: [{type: 'text', text: wrapTruncated()}]});
          return step();
        }
        delete msg.finish_reason;   // 不是對話的一部分, 別送回 provider
        history.push(msg);
        if(msg.tool_calls && msg.tool_calls.length) {
          return runCalls(msg.tool_calls, 0).then(flushImages).then(flushNudges).then(flushLimit).then(step);
        }
        return {reply: msg.content || '', events: events};
      });
    };
    return step().catch(function(e) {
      history.length = startLen;
      throw e;
    });
  }

  return {
    send: send,
    reset: function() { history = [history[0]]; }
  };
}
