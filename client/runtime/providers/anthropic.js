import {readSSE, checkResponse} from '../sse.js';
import {userContent, countImages, compactHistory, MAX_IMAGES, wrapNudge, wrapLimit, limitReply, wrapTruncated, retainable, interruptedNote} from '../turn-context.js';
import {ID, make as lderr} from '../lderr.js';
import {createProgress} from '../progress.js';

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

// adaptive thinking 只有 4.6 以後的模型收; haiku 4.5 / 4.5 以前送了會 400, 那些就不開 thinking
const OLD_THINKING = /^claude-(3|haiku-4|(opus|sonnet)-4(-[0-5])?(-\d{8})?$)/;
export function thinkingFor(model) {
  return OLD_THINKING.test(model || '') ? null : {type: 'adaptive'};
}

// browser 版 provider; 介面同 openai.js (見該檔說明)
// maxSteps / softSteps: 一輪之內的模型呼叫上限, 見 turn-context.js 的 wrapLimit。
// 由應用層決定 (createRuntime -> worker -> 這裡); 預設值是估的, 不是量的 —
// 要調到對得先有 proxy 那邊的用量記錄。
// maxImages: 歷史裡最多留幾張圖, 見 turn-context.js 的〈圖的上限〉。
//
// 歷史是 append-only: 送出過的訊息一律不改 (prompt cache 與 preserved thinking
// 都綁著前綴)。唯一的例外是圖超過上限時的一次性重建 (compactHistory)。
export function createSession({system, tools, runTool, api, model, headers, maxSteps, softSteps, maxImages, history: seed}) {
  const url = (api || '/api/agent') + '/llm/anthropic';
  // 連續截斷幾次就放棄。跟 chat 的 maxOffer 是同一類東西: 重試要有上限,
  // 否則「每次都截斷」會變成另一種跑不完的迴圈。
  const MAX_TRUNCATED = 2;
  const hardMax = maxSteps > 0 ? maxSteps : 30;
  const softMax = softSteps > 0 ? Math.min(softSteps, hardMax) : Math.max(1, hardMax - 10);
  const imageMax = maxImages > 0 ? maxImages : MAX_IMAGES;
  // 只挑 provider 認得的欄位 —— host tool 的 timeout 之類是給 runtime 的, 不能送上去
  const toolDefs = tools.map(function(t) {
    return {name: t.name, description: t.description, input_schema: t.parameters};
  });
  let history = Array.isArray(seed) ? seed.slice() : [];

  // usage 正規化成 {input, output, cacheRead, cacheWrite} ( 同 api/proxy 的記帳形狀 )
  function normUsage(u, out) {
    if(!u && out == null) { return null; }
    u = u || {};
    return {
      input: u.input_tokens != null ? u.input_tokens : null,
      output: out != null ? out : (u.output_tokens != null ? u.output_tokens : null),
      cacheRead: u.cache_read_input_tokens != null ? u.cache_read_input_tokens : null,
      cacheWrite: u.cache_creation_input_tokens != null ? u.cache_creation_input_tokens : null
    };
  }

  // streaming 時把 content_block_* 事件組回完整 content 陣列
  // prog: 進度回報 ( 見 progress.js ), 只讀不改這裡的狀態
  function streamMessage(r, cb, prog) {
    const content = [];
    const partial = {};  // index -> tool_use 的 input json 字串
    const bad = {};      // tool_use id -> input 解不開 (被截斷)
    let stopReason = null;
    let usageIn = null;  // message_start 的 usage ( input / 快取 )
    let usageOut = null; // message_delta 的 output_tokens ( 累計值, 取最後一個 )
    return readSSE(r, function(ev) {
      const d = JSON.parse(ev.data);
      if(d.type === 'message_start') {
        usageIn = (d.message && d.message.usage) || null;
        if(usageIn) { prog.input(normUsage(usageIn)); }
      } else if(d.type === 'content_block_start') {
        content[d.index] = Object.assign({}, d.content_block);
        const t = d.content_block.type;
        if(t === 'tool_use') { partial[d.index] = ''; }
        if(t === 'tool_use' || t === 'server_tool_use') { prog.phase('tool', d.content_block.name); }
        else if(t === 'thinking' || t === 'redacted_thinking') { prog.phase('thinking'); }
        else if(t === 'text') { prog.phase('text'); }
      } else if(d.type === 'content_block_delta') {
        const b = content[d.index] || (content[d.index] = {});
        if(d.delta.type === 'text_delta') {
          b.text = (b.text || '') + d.delta.text;
          prog.out(d.delta.text, 'text');
          if(cb.onDelta) { cb.onDelta(d.delta.text); }
        } else if(d.delta.type === 'thinking_delta') {
          b.thinking = (b.thinking || '') + d.delta.thinking;
          prog.out(d.delta.thinking, 'thinking');
        } else if(d.delta.type === 'signature_delta') {
          b.signature = (b.signature || '') + d.delta.signature;
        } else if(d.delta.type === 'input_json_delta') {
          partial[d.index] = (partial[d.index] || '') + d.delta.partial_json;
          prog.out(d.delta.partial_json, 'tool', b.name);
        }
      } else if(d.type === 'content_block_stop') {
        if(partial[d.index] != null) {
          // 解不開就是**被截斷**, 不是「沒有參數」。先前這裡靜靜給 {},
          // 於是 edit_file({}) 就送出去了 —— 改壞檔案而且沒有任何跡象。
          // 壞掉的記在旁邊, 不寫進 block —— block 會原樣送回 provider, 多一個欄位就是 400
          try { content[d.index].input = JSON.parse(partial[d.index] || '{}'); }
          catch(e) { content[d.index].input = {}; bad[content[d.index].id] = true; }
        }
      } else if(d.type === 'message_delta') {
        if(d.delta && d.delta.stop_reason) { stopReason = d.delta.stop_reason; }
        if(d.usage && d.usage.output_tokens != null) { usageOut = d.usage.output_tokens; }
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
      prog.done(normUsage(usageIn, usageOut), stopReason);
      return {content: content.filter(Boolean), stop_reason: stopReason, bad: bad};
    });
  }

  // step: 這一輪的第幾次呼叫 ( 只給進度回報用 )
  function createMessage(cb, step) {
    const params = {
      model: model || 'claude-opus-4-8',
      max_tokens: 16000,
      // 兩個快取點: system 一個明確的 (tools + system 這段固定前綴一定讀得到),
      // 再加 top-level 的自動快取 —— 它放在最後一個 block 上並隨對話往後移,
      // 所以每一步都讀得到上一步的整段前綴。前提是歷史 append-only。
      system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
      cache_control: {type: 'ephemeral'},
      tools: toolDefs,
      messages: history
    };
    const thinking = thinkingFor(params.model);
    if(thinking) { params.thinking = thinking; }
    // 要逐段輸出或進度回報就走 streaming ( 進度要靠 delta 才看得到 )
    if(cb && (cb.onDelta || cb.onProgress)) { params.stream = true; }
    const body = JSON.stringify(params);
    const prog = createProgress({
      emit: cb && cb.onProgress, provider: 'anthropic', model: params.model, step: step, request: body
    });
    prog.begin();
    return fetch(url, {
      method: 'POST',
      // headers 是 getter: token 會過期, 每次呼叫都要拿當下的那一份
      headers: Object.assign({'Content-Type': 'application/json'},
        (typeof headers === 'function' ? headers() : headers) || {}),
      body: body
    })
      .then(checkResponse)
      .then(function(r) {
        if(!params.stream) {
          return r.json().then(function(j) { prog.done(normUsage(j.usage), j.stop_reason); return j; });
        }
        return streamMessage(r, cb, prog);
      })
      // 失敗也要送一次, 前端才能結束這次呼叫的顯示 ( 例外照樣往上丟 )
      .catch(function(e) { prog.fail(e); throw e; });
  }

  function send(text, cb) {
    const startLen = history.length;
    // 本輪的狀況描述接在後面; 舊的不動 (「以最新一份為準」寫在文字裡, 見 wrapContext)
    history.push({role: 'user', content: userContent(text, cb && cb.context)});
    const events = [];

    function runBlocks(blocks, bad, i, results) {
      if(i >= blocks.length) { return Promise.resolve(results); }
      const b = blocks[i];
      if(b.type !== 'tool_use') { return runBlocks(blocks, bad, i + 1, results); }
      if(bad[b.id]) {
        // 參數是壞的, 不能拿去執行 —— 但也不能不回: tool_use 少了配對的
        // tool_result, provider 會拒絕整個請求。回一則錯誤讓模型自己重來。
        events.push({tool: b.name, input: {}, error: true});
        results.push({
          type: 'tool_result', tool_use_id: b.id, is_error: true,
          content: 'tool input was truncated and could not be parsed. ' +
            'retry with smaller arguments (e.g. edit in several steps).'
        });
        return runBlocks(blocks, bad, i + 1, results);
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
        .then(function() { return runBlocks(blocks, bad, i + 1, results); });
    }

    let steps = 0;
    let warned = false;
    let truncated = 0;

    const step = function() {
      // hard limit: 不再呼叫模型。events 照常回傳 — 使用者要看得到做過什麼。
      if(steps >= hardMax) { return Promise.resolve({reply: limitReply(hardMax), events: events, limited: true}); }
      steps++;
      // 圖超過上限: 一次性重建 (只在 tool_result 已接上之後, 不會切在 tool 回合中間)
      if(countImages(history) > imageMax) {
        history = compactHistory(history, {keep: 1, drop: ['thinking', 'redacted_thinking']});
      }
      return createMessage(cb, steps).then(function(response) {
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
          return runBlocks(response.content, response.bad || {}, 0, []).then(function(results) {
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
    // 失敗: 可以重試的錯誤保留到最後一個完整的步驟 ( 見 turn-context.js 的〈一輪中途失敗〉 ),
    // 其他照舊整輪退回
    return step().catch(function(e) {
      if(!retainable(e)) { history.length = startLen; throw e; }
      // 最後一則若是還沒拿到結果的 tool_use, 拿掉 ( 沒有配對的 tool_result, provider 會拒絕整個請求 )
      const last = history[history.length - 1];
      if(last && last.role === 'assistant' && Array.isArray(last.content) &&
        last.content.some(function(b) { return b.type === 'tool_use'; })) { history.pop(); }
      history.push({role: 'assistant', content: [{type: 'text', text: interruptedNote(e)}]});
      e.retained = true;
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
    getHistory: function() { return history; },
    // 整份換掉 ( 壓縮後, 見 compact.js ). 只在兩輪之間呼叫
    setHistory: function(h) { history = (h || []).slice(); }
  };
}
