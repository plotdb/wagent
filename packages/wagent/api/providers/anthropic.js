const Anthropic = require('@anthropic-ai/sdk');

// provider interface:
//   available() -> bool
//   createSession({system, tools, runTool}) -> {send(text, cb) -> Promise<{reply, events}>, reset()}
// tools: [{name, description, parameters}] (generic JSON schema form)
// cb (optional): {onDelta(text)} — 有 onDelta 時改走 streaming API, 文字逐段回呼

module.exports = {
  name: 'anthropic',
  available: function() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  },
  createSession: function({system, tools, runTool}) {
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
    const toolDefs = tools.map(function(t) {
      return {name: t.name, description: t.description, input_schema: t.parameters};
    });
    let history = [];

    function createMessage(cb) {
      const params = {
        model: model,
        max_tokens: 16000,
        thinking: {type: 'adaptive'},
        system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
        tools: toolDefs,
        messages: history
      };
      if(!cb || !cb.onDelta) { return client.messages.create(params); }
      const stream = client.messages.stream(params);
      stream.on('text', function(t) { cb.onDelta(t); });
      return stream.finalMessage();
    }

    function send(text, cb) {
      const startLen = history.length;
      history.push({role: 'user', content: text});
      const events = [];
      const step = function() {
        return createMessage(cb).then(function(response) {
          history.push({role: 'assistant', content: response.content});
          if(response.stop_reason === 'tool_use') {
            const results = [];
            for(const block of response.content) {
              if(block.type !== 'tool_use') { continue; }
              let out, isError = false;
              try {
                out = runTool(block.name, block.input);
              } catch(e) {
                out = String(e.message || e);
                isError = true;
              }
              events.push({tool: block.name, input: block.input, error: isError});
              results.push({type: 'tool_result', tool_use_id: block.id, content: out, is_error: isError});
            }
            history.push({role: 'user', content: results});
            return step();
          }
          if(response.stop_reason === 'pause_turn') { return step(); }
          const reply = response.content
            .filter(function(b) { return b.type === 'text'; })
            .map(function(b) { return b.text; })
            .join('\n');
          return {reply: reply, events: events};
        });
      };
      return step().catch(function(e) {
        history.length = startLen;
        throw e;
      });
    }

    return {
      send: send,
      reset: function() { history = []; }
    };
  }
};
