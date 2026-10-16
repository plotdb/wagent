import {readSSE, checkResponse} from '../sse.js';
import {userContent, countImages, compactHistory, MAX_IMAGES, wrapNudge, wrapLimit, limitReply, wrapTruncated, retainable, interruptedNote, strings} from '../turn-context.js';
import {ID, make as lderr} from '../lderr.js';
import {createProgress} from '../progress.js';

// browser 版 provider: 打後端 llm proxy (原生 wire format), 自行跑 tool loop。
// 介面同後端 providers/*: createSession({system, tools, runTool}) -> {send(text, cb), reset()}
// runTool 可回傳 Promise (前端 fs / shell 皆為 async)
// 歷史 append-only, 見 anthropic.js 的同一段。openai (chat completions) 的快取是自動的
// 前綴比對, 不必標快取點 —— 只要前面的訊息不改就吃得到。
export function createSession({system, tools, runTool, api, model, headers, maxSteps, softSteps, maxImages, lang, history: seed}) {
  const url = (api || '/api/agent') + '/llm/openai';
  // 見 anthropic.js 的同一段
  const MAX_TRUNCATED = 2;   // 見 anthropic.js
  const hardMax = maxSteps > 0 ? maxSteps : 30;
  const softMax = softSteps > 0 ? Math.min(softSteps, hardMax) : Math.max(1, hardMax - 10);
  const imageMax = maxImages > 0 ? maxImages : MAX_IMAGES;
  // 只挑 provider 認得的欄位 (host tool 的 timeout 之類不能送上去)
  const toolDefs = tools.map(function(t) {
    return {type: 'function', function: {name: t.name, description: t.description, parameters: t.parameters}};
  });
  let history = [{role: 'system', content: system}].concat(Array.isArray(seed) ? seed : []);

  // usage 正規化成 {input, output, cacheRead, cacheWrite}。prompt_tokens **含**快取,
  // 拆成 input ( 未快取 ) + cacheRead, 與 anthropic 同一個形狀; openai 沒有 cacheWrite
  function normUsage(u) {
    if(!u) { return null; }
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    return {
      input: u.prompt_tokens != null ? u.prompt_tokens - cached : null,
      output: u.completion_tokens != null ? u.completion_tokens : null,
      cacheRead: u.prompt_tokens != null ? cached : null,
      cacheWrite: null
    };
  }

  // 回傳 assistant message; cb.onDelta / cb.onProgress 時走 streaming 並累積 content / tool_calls
  // step: 這一輪的第幾次呼叫 ( 只給進度回報用 )
  function createMessage(cb, step) {
    const params = {
      model: model || 'gpt-5',
      max_completion_tokens: 16000,
      tools: toolDefs,
      messages: history
    };
    if(cb && (cb.onDelta || cb.onProgress)) { params.stream = true; }
    const body = JSON.stringify(params);
    // 送出量: chat completions 的 usage 只在串流最後一個 chunk ( proxy 補了 include_usage ),
    // 所以整個呼叫期間 inTokens 都是估計值, done 時才換成實際值
    const prog = createProgress({
      emit: cb && cb.onProgress, provider: 'openai', model: params.model, step: step, request: body
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
          return r.json().then(function(j) {
            var c = j.choices[0];
            prog.done(normUsage(j.usage), c.finish_reason);
            return Object.assign({}, c.message, {finish_reason: c.finish_reason});
          });
        }
        const msg = {role: 'assistant', content: '', tool_calls: []};
        let finish = null;
        let usage = null;
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
          if(chunk.usage) { usage = chunk.usage; }
          const c = (chunk.choices || [])[0] || {};
          if(c.finish_reason) { finish = c.finish_reason; }
          const d = c.delta || {};
          // 相容 api ( deepseek 之類 ) 會串 reasoning_content; openai 本身不串推理內容,
          // 那段期間只會停在 waiting
          const reasoning = d.reasoning_content || d.reasoning;
          if(typeof reasoning === 'string' && reasoning) { prog.out(reasoning, 'thinking'); }
          if(d.content) {
            msg.content += d.content;
            prog.out(d.content, 'text');
            if(cb.onDelta) { cb.onDelta(d.content); }
          }
          for(const tc of d.tool_calls || []) {
            const cur = msg.tool_calls[tc.index] = msg.tool_calls[tc.index] ||
              {id: '', type: 'function', function: {name: '', arguments: ''}};
            if(tc.id) { cur.id = tc.id; }
            if(tc.function && tc.function.name) { cur.function.name += tc.function.name; }
            // 新的一個 tool call ( 帶 id 的那則 ) —— 換一個 tool, target 重新找
            if(tc.id) { prog.phase('tool', cur.function.name); }
            if(tc.function && tc.function.arguments) {
              cur.function.arguments += tc.function.arguments;
              prog.out(tc.function.arguments, 'tool', cur.function.name);
            }
          }
        }).then(function() {
          if(!msg.tool_calls.length) { delete msg.tool_calls; }
          msg.finish_reason = finish;
          prog.done(normUsage(usage), finish);
          return msg;
        });
      })
      // 失敗也要送一次, 前端才能結束這次呼叫的顯示 ( 例外照樣往上丟 )
      .catch(function(e) { prog.fail(e); throw e; });
  }

  function send(text, cb) {
    const startLen = history.length;
    // 本輪的狀況描述接在後面; 舊的不動 (見 wrapContext)
    history.push({role: 'user', content: userContent(text, cb && cb.context, lang)});
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

    // 這一輪 tool 產生的圖補成一則 user message。更早的圖不動 (append-only);
    // 累積超過上限時在下一步之前一次重建, 見 step()
    function flushImages() {
      if(!images.length) { return; }
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
        history.push({role: 'user', content: [{type: 'text', text: wrapNudge(extra, lang)}]});
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
      history.push({role: 'user', content: [{type: 'text', text: wrapLimit(steps, hardMax, lang)}]});
    }

    const step = function() {
      if(steps >= hardMax) { return Promise.resolve({reply: limitReply(hardMax, lang), events: events, limited: true}); }
      steps++;
      // 圖超過上限: 一次性重建 (見 turn-context.js 的〈圖的上限〉); openai 沒有 thinking 要丟
      if(countImages(history) > imageMax) { history = compactHistory(history, {keep: 1}); }
      return createMessage(cb, steps).then(function(msg) {
        // 撞到長度上限被截斷 —— 見 anthropic.js 的同一段。
        // openai 的 tool 參數本來就是 JSON.parse 在 runCalls 裡丟例外 (會變成
        // 一則 error 的 tool 訊息), 所以壞掉的參數不會被當成「沒有參數」;
        // 但截斷的**文字**回覆一樣會被當成完整的交出去, 那才是這裡要擋的。
        if(msg.finish_reason === 'length') {
          truncated++;
          if(truncated > MAX_TRUNCATED) {
            throw lderr(ID.TRUNCATED,
              strings(lang).truncatedStop(MAX_TRUNCATED));
          }
          history.push({role: 'assistant', content: msg.content || strings(lang).truncatedReply});
          history.push({role: 'user', content: [{type: 'text', text: wrapTruncated(lang)}]});
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
    // 失敗: 可以重試的錯誤保留到最後一個完整的步驟 ( 見 turn-context.js 的〈一輪中途失敗〉 ),
    // 其他照舊整輪退回
    return step().catch(function(e) {
      if(!retainable(e)) { history.length = startLen; throw e; }
      // 還沒配齊結果的 tool_calls ( 與它後面的部分結果 ) 拿掉, provider 不接受沒有配對的呼叫
      for(let i = history.length - 1; i >= startLen; i--) {
        const m = history[i];
        if(m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
          const got = history.slice(i + 1).filter(function(x) { return x.role === 'tool'; }).length;
          if(got < m.tool_calls.length) { history.length = i; }
          break;
        }
      }
      history.push({role: 'assistant', content: interruptedNote(e, lang)});
      e.retained = true;
      throw e;
    });
  }

  return {
    send: send,
    reset: function() { history = [history[0]]; },
    // 見 anthropic.js。getHistory 不含 system: 那是 session 自己的, 換 provider 時不跟著走
    format: 'openai',
    setModel: function(m) { model = m; },
    getModel: function() { return model; },
    getHistory: function() { return history.slice(1); },
    // 整份換掉 ( 壓縮後, 見 compact.js ); system 留著. 只在兩輪之間呼叫
    setHistory: function(h) { history = [history[0]].concat(h || []); }
  };
}
