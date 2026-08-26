import {readSSE, checkResponse} from '../sse.js';
import {pruneContext, userContent} from '../turn-context.js';

// browser 版 provider: 打後端 llm proxy (原生 wire format), 自行跑 tool loop。
// 介面同後端 providers/*: createSession({system, tools, runTool}) -> {send(text, cb), reset()}
// runTool 可回傳 Promise (前端 fs / shell 皆為 async)
export function createSession({system, tools, runTool, api, model}) {
  const url = (api || '/api/agent') + '/llm/openai';
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
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(params)
    })
      .then(checkResponse)
      .then(function(r) {
        if(!params.stream) {
          return r.json().then(function(j) { return j.choices[0].message; });
        }
        const msg = {role: 'assistant', content: '', tool_calls: []};
        return readSSE(r, function(ev) {
          if(ev.data === '[DONE]') { return; }
          const chunk = JSON.parse(ev.data);
          const d = ((chunk.choices || [])[0] || {}).delta || {};
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

    const step = function() {
      return createMessage(cb).then(function(msg) {
        history.push(msg);
        if(msg.tool_calls && msg.tool_calls.length) {
          return runCalls(msg.tool_calls, 0).then(flushImages).then(step);
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
