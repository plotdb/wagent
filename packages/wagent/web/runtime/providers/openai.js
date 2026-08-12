import {readSSE, checkResponse} from '../sse.js';

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
    history.push({role: 'user', content: text});
    const events = [];

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
          history.push({role: 'tool', tool_call_id: call.id, content: String(out)});
        })
        .catch(function(e) {
          events.push({tool: call.function.name, input: input, error: true});
          history.push({role: 'tool', tool_call_id: call.id, content: String((e && e.message) || e)});
        })
        .then(function() { return runCalls(calls, i + 1); });
    }

    const step = function() {
      return createMessage(cb).then(function(msg) {
        history.push(msg);
        if(msg.tool_calls && msg.tool_calls.length) {
          return runCalls(msg.tool_calls, 0).then(step);
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
