import {readSSE, checkResponse} from '../sse.js';
import {pruneContext, userContent, wrapNudge, wrapLimit, limitReply, wrapTruncated} from '../turn-context.js';
import {ID, make as lderr} from '../lderr.js';

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

// adaptive thinking 只有 4.6 以後的模型收; haiku 4.5 / 4.5 以前送了會 400, 那些就不開 thinking
const OLD_THINKING = /^claude-(3|haiku-4|(opus|sonnet)-4(-[0-5])?(-\d{8})?$)/;
export function thinkingFor(model) {
  return OLD_THINKING.test(model || '') ? null : {type: 'adaptive'};
}

// browser 版 provider; 介面同 openai.js (見該檔說明)
// maxSteps / softSteps: 一輪之內的模型呼叫上限, 見 turn-context.js 的 wrapLimit。
// 由應用層決定 (createRuntime -> worker -> 這裡); 預設值是估的, 不是量的 —
// 要調到對得先有 proxy 那邊的用量記錄。
export function createSession({system, tools, runTool, api, model, headers, maxSteps, softSteps, history: seed}) {
  const url = (api || '/api/agent') + '/llm/anthropic';
  // 連續截斷幾次就放棄。跟 chat 的 maxOffer 是同一類東西: 重試要有上限,
  // 否則「每次都截斷」會變成另一種跑不完的迴圈。
  const MAX_TRUNCATED = 2;
  const hardMax = maxSteps > 0 ? maxSteps : 30;
  const softMax = softSteps > 0 ? Math.min(softSteps, hardMax) : Math.max(1, hardMax - 10);
  const toolDefs = tools.map(function(t) {
    return {name: t.name, description: t.description, input_schema: t.parameters};
  });
  let history = Array.isArray(seed) ? seed.slice() : [];

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
          // 解不開就是**被截斷**, 不是「沒有參數」。先前這裡靜靜給 {},
          // 於是 edit_file({}) 就送出去了 —— 改壞檔案而且沒有任何跡象。
          try { content[d.index].input = JSON.parse(partial[d.index] || '{}'); }
          catch(e) { content[d.index].input = {}; content[d.index].bad = true; }
        }
      } else if(d.type === 'message_delta') {
        if(d.delta && d.delta.stop_reason) { stopReason = d.delta.stop_reason; }
      } else if(d.type === 'error') {
        // proxy 中途中止 (額度用完) 時會注入一則帶 lderror duck type 的 error
        // —— 靠 id 分辨「這是 wagent 說的」, 不比對訊息字串。不注入的話這裡
        // 只會看到串流無故結束, 那是最難查的一種。
        const x = d.error || {};
        const e = new Error(x.message || 'stream error');
        if(x.name === 'lderror' && !isNaN(+x.id)) { e.id = +x.id; e.name = 'lderror'; }
        throw e;
      }
    }).then(function() {
      return {content: content.filter(Boolean), stop_reason: stopReason};
    });
  }

  function createMessage(cb) {
    const params = {
      model: model || 'claude-opus-4-8',
      max_tokens: 16000,
      system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
      tools: toolDefs,
      messages: history
    };
    const thinking = thinkingFor(params.model);
    if(thinking) { params.thinking = thinking; }
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
        if(!params.stream) { return r.json(); }
        return streamMessage(r, cb);
      });
  }

  function send(text, cb) {
    const startLen = history.length;
    // 舊的狀況描述先清掉再附上本輪的 — 只有最新一份是真的
    pruneContext(history);
    history.push({role: 'user', content: userContent(text, cb && cb.context)});
    const events = [];

    function runBlocks(blocks, i, results) {
      if(i >= blocks.length) { return Promise.resolve(results); }
      const b = blocks[i];
      if(b.type !== 'tool_use') { return runBlocks(blocks, i + 1, results); }
      if(b.bad) {
        // 參數是壞的, 不能拿去執行 —— 但也不能不回: tool_use 少了配對的
        // tool_result, provider 會拒絕整個請求。回一則錯誤讓模型自己重來。
        events.push({tool: b.name, input: {}, error: true});
        results.push({
          type: 'tool_result', tool_use_id: b.id, is_error: true,
          content: 'tool input was truncated and could not be parsed. ' +
            'retry with smaller arguments (e.g. edit in several steps).'
        });
        return runBlocks(blocks, i + 1, results);
      }
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

    let steps = 0;
    let warned = false;
    let truncated = 0;

    const step = function() {
      // hard limit: 不再呼叫模型。events 照常回傳 — 使用者要看得到做過什麼。
      if(steps >= hardMax) { return Promise.resolve({reply: limitReply(hardMax), events: events, limited: true}); }
      steps++;
      return createMessage(cb).then(function(response) {
        // 回應撞到 max_tokens 被截斷。先前這裡完全沒有檢查 —— 截斷的回覆會被
        // 當成完整的交出去, 而截斷的 tool 參數會被當成「沒有參數」。
        //
        // 不能把截斷的 assistant 訊息原樣接回去: 裡面的 tool_use 參數是壞的,
        // 配一個 tool_result 給它只是把錯誤往下傳。所以丟掉 tool_use、留下
        // 文字, 再附一段說明讓模型自己把工作拆小 —— 這比在 byte 層做續接
        // 穩健得多, 而且 loop 本來就是 agentic 的。
        if(response.stop_reason === 'max_tokens') {
          truncated++;
          if(truncated > MAX_TRUNCATED) {
            throw lderr(ID.TRUNCATED,
              '模型回應連續 ' + MAX_TRUNCATED + ' 次超過長度上限被截斷, 已停止。');
          }
          var texts = response.content.filter(function(b) { return b.type === 'text'; });
          // 空的 assistant 訊息不合法, 而 user 訊息也不能直接接在 user 之後
          history.push({
            role: 'assistant',
            content: texts.length ? texts : [{type: 'text', text: '(回覆被截斷)'}]
          });
          history.push({role: 'user', content: [{type: 'text', text: wrapTruncated()}]});
          return step();
        }
        history.push({role: 'assistant', content: response.content});
        if(response.stop_reason === 'tool_use') {
          return runBlocks(response.content, 0, []).then(function(results) {
            // 使用者執行中插的話: 只能接在 tool_result 之後 — 這則 user message
            // 已經含齊本輪所有 tool_result, 配對是完整的, 補一段 text 安全。
            const extra = cb && cb.nudge ? cb.nudge() : null;
            if(extra && extra.length) { results.push({type: 'text', text: wrapNudge(extra)}); }
            // soft limit 只提醒一次 —— 每輪都附一遍是在燒 token 叫模型省 token
            if(steps >= softMax && !warned) {
              warned = true;
              results.push({type: 'text', text: wrapLimit(steps, hardMax)});
            }
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
    reset: function() { history = []; },
    // 對話中換模型: 同一個 provider 的歷史直接沿用 (別的模型的 thinking block 上游會略過)
    format: 'anthropic',
    setModel: function(m) { model = m; },
    getModel: function() { return model; },
    getHistory: function() { return history; }
  };
}
