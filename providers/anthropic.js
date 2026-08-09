const Anthropic = require('@anthropic-ai/sdk');

// provider interface:
//   available() -> bool
//   createSession({system, tools, runTool}) -> {send(text) -> Promise<{reply, events}>, reset()}
// tools: [{name, description, parameters}] (generic JSON schema form)

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

    function send(text) {
      const startLen = history.length;
      history.push({role: 'user', content: text});
      const events = [];
      const step = function() {
        return client.messages.create({
          model: model,
          max_tokens: 16000,
          thinking: {type: 'adaptive'},
          system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
          tools: toolDefs,
          messages: history
        }).then(function(response) {
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
