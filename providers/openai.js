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

    function send(text) {
      const startLen = history.length;
      history.push({role: 'user', content: text});
      const events = [];
      const step = function() {
        return client.chat.completions.create({
          model: model,
          max_completion_tokens: 16000,
          tools: toolDefs,
          messages: history
        }).then(function(response) {
          const msg = response.choices[0].message;
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
