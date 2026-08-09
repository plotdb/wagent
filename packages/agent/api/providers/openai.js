const OpenAI = require('openai');

// provider interface: see providers/anthropic.js

module.exports = {
  name: 'openai',
  available: function() {
    return !!process.env.OPENAI_API_KEY;
  },
  createSession: function({system, tools, runTool}) {
    const client = new OpenAI();
    const model = process.env.OPENAI_MODEL || 'gpt-5';
    const toolDefs = tools.map(function(t) {
      return {
        type: 'function',
        function: {name: t.name, description: t.description, parameters: t.parameters}
      };
    });
    let history = [{role: 'system', content: system}];

    // 回傳 assistant message; cb.onDelta 時走 streaming 並累積 content / tool_calls
    function createMessage(cb) {
      const params = {
        model: model,
        max_completion_tokens: 16000,
        tools: toolDefs,
        messages: history
      };
      if(!cb || !cb.onDelta) {
        return client.chat.completions.create(params).then(function(r) { return r.choices[0].message; });
      }
      params.stream = true;
      return client.chat.completions.create(params).then(function(stream) {
        const msg = {role: 'assistant', content: '', tool_calls: []};
        const it = stream[Symbol.asyncIterator]();
        const pump = function() {
          return it.next().then(function(r) {
            if(r.done) { return; }
            const d = ((r.value.choices || [])[0] || {}).delta || {};
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
            return pump();
          });
        };
        return pump().then(function() {
          if(!msg.tool_calls.length) { delete msg.tool_calls; }
          return msg;
        });
      });
    }

    function send(text, cb) {
      const startLen = history.length;
      history.push({role: 'user', content: text});
      const events = [];
      const step = function() {
        return createMessage(cb).then(function(msg) {
          history.push(msg);
          if(msg.tool_calls && msg.tool_calls.length) {
            for(const call of msg.tool_calls) {
              let input = {};
              let out, isError = false;
              try {
                input = JSON.parse(call.function.arguments || '{}');
                out = runTool(call.function.name, input);
              } catch(e) {
                out = String(e.message || e);
                isError = true;
              }
              events.push({tool: call.function.name, input: input, error: isError});
              history.push({role: 'tool', tool_call_id: call.id, content: out});
            }
            return step();
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
};
