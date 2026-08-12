import {readSSE, checkResponse} from '../sse.js';

// tool 結果可以是字串, 或 {text, image: {mediaType, data}} — anthropic 的 tool_result
// content 支援 block 陣列, 圖可以直接放進去
function toResultContent(out) {
  if(!out || typeof out !== 'object' || !out.image) { return String(out); }
  const blocks = [];
  if(out.text) { blocks.push({type: 'text', text: String(out.text)}); }
  blocks.push({
    type: 'image',
    source: {type: 'base64', media_type: out.image.mediaType, data: out.image.data}
  });
  return blocks;
}

// 舊圖留在對話裡每輪都要重付一次 token, 只保留最新一張
function pruneImages(history) {
  let seen = false;
  for(let i = history.length - 1; i >= 0; i--) {
    const c = history[i].content;
    if(!Array.isArray(c)) { continue; }
    for(const b of c) {
      if(b.type !== 'tool_result' || !Array.isArray(b.content)) { continue; }
      const idx = b.content.findIndex(function(x) { return x.type === 'image'; });
      if(idx < 0) { continue; }
      if(!seen) { seen = true; continue; }
      b.content[idx] = {type: 'text', text: '[earlier image omitted]'};
    }
  }
}

// browser 版 provider; 介面同 openai.js (見該檔說明)
export function createSession({system, tools, runTool, api, model}) {
  const url = (api || '/api/agent') + '/llm/anthropic';
  const toolDefs = tools.map(function(t) {
    return {name: t.name, description: t.description, input_schema: t.parameters};
  });
  let history = [];

  // streaming 時把 content_block_* 事件組回完整 content 陣列
  function streamMessage(r, cb) {
    const content = [];
    const partial = {};  // index -> tool_use 的 input json 字串
    let stopReason = null;
    return readSSE(r, function(ev) {
      const d = JSON.parse(ev.data);
      if(d.type === 'content_block_start') {
        content[d.index] = Object.assign({}, d.content_block);
        if(d.content_block.type === 'tool_use') { partial[d.index] = ''; }
      } else if(d.type === 'content_block_delta') {
        const b = content[d.index] || (content[d.index] = {});
        if(d.delta.type === 'text_delta') {
          b.text = (b.text || '') + d.delta.text;
          cb.onDelta(d.delta.text);
        } else if(d.delta.type === 'thinking_delta') {
          b.thinking = (b.thinking || '') + d.delta.thinking;
        } else if(d.delta.type === 'signature_delta') {
          b.signature = (b.signature || '') + d.delta.signature;
        } else if(d.delta.type === 'input_json_delta') {
          partial[d.index] = (partial[d.index] || '') + d.delta.partial_json;
        }
      } else if(d.type === 'content_block_stop') {
        if(partial[d.index] != null) {
          try { content[d.index].input = JSON.parse(partial[d.index] || '{}'); }
          catch(e) { content[d.index].input = {}; }
        }
      } else if(d.type === 'message_delta') {
        if(d.delta && d.delta.stop_reason) { stopReason = d.delta.stop_reason; }
      } else if(d.type === 'error') {
        throw new Error((d.error && d.error.message) || 'stream error');
      }
    }).then(function() {
      return {content: content.filter(Boolean), stop_reason: stopReason};
    });
  }

  function createMessage(cb) {
    const params = {
      model: model || 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: {type: 'adaptive'},
      system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
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
        if(!params.stream) { return r.json(); }
        return streamMessage(r, cb);
      });
  }

  function send(text, cb) {
    const startLen = history.length;
    history.push({role: 'user', content: text});
    const events = [];

    function runBlocks(blocks, i, results) {
      if(i >= blocks.length) { return Promise.resolve(results); }
      const b = blocks[i];
      if(b.type !== 'tool_use') { return runBlocks(blocks, i + 1, results); }
      return Promise.resolve()
        .then(function() { return runTool(b.name, b.input); })
        .then(function(out) {
          events.push({tool: b.name, input: b.input, error: false});
          results.push({type: 'tool_result', tool_use_id: b.id, content: toResultContent(out)});
        })
        .catch(function(e) {
          events.push({tool: b.name, input: b.input, error: true});
          results.push({
            type: 'tool_result', tool_use_id: b.id,
            content: String((e && e.message) || e), is_error: true
          });
        })
        .then(function() { return runBlocks(blocks, i + 1, results); });
    }

    const step = function() {
      return createMessage(cb).then(function(response) {
        history.push({role: 'assistant', content: response.content});
        if(response.stop_reason === 'tool_use') {
          return runBlocks(response.content, 0, []).then(function(results) {
            history.push({role: 'user', content: results});
            pruneImages(history);
            return step();
          });
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
