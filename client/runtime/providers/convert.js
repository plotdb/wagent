// 對話紀錄在 anthropic 與 openai 兩種 wire format 之間轉換 —— 對話中跨 provider 換模型用。
// 兩邊 user 訊息的 text part 形狀相同 ({type: 'text', text}), context / 插話 / 步數提醒都不用動;
// 要轉的只有 tool 呼叫的配對與圖片。thinking 只對產生它的模型有意義, 直接丟掉。
// 圖片只留最新一張: 換 provider 本來就是一段新的前綴 (快取從頭來), 順便把累積的圖清掉 ——
// 這裡改的是轉出來的新歷史, 原本那份不動。

const OMITTED = {type: 'text', text: '[earlier image omitted]'};

// tool id: anthropic 只收 [a-zA-Z0-9_-]
function safeId(id) { return String(id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function textOf(content) {
  if(typeof content === 'string') { return content; }
  return (content || []).filter(function(b) { return b && b.type === 'text'; })
    .map(function(b) { return b.text; }).join('\n');
}

// 第一張以外的圖都換成佔位 (只留最新一張)
function keepLastImage(out, type) {
  const at = [];
  out.forEach(function(m) {
    if(m.role !== 'user' || !Array.isArray(m.content)) { return; }
    m.content.forEach(function(b, i) { if(b.type === type) { at.push({c: m.content, i: i}); } });
  });
  at.slice(0, -1).forEach(function(x) { x.c[x.i] = OMITTED; });
  return out;
}

// anthropic messages -> openai messages (不含 system)
export function toOpenAI(history) {
  const out = [];
  for(const m of history || []) {
    const content = typeof m.content === 'string' ? [{type: 'text', text: m.content}] : (m.content || []);
    if(m.role === 'assistant') {
      const calls = content.filter(function(b) { return b.type === 'tool_use'; }).map(function(b) {
        return {id: safeId(b.id), type: 'function', function: {name: b.name, arguments: JSON.stringify(b.input || {})}};
      });
      const msg = {role: 'assistant', content: textOf(content)};
      if(calls.length) { msg.tool_calls = calls; }
      out.push(msg);
      continue;
    }
    // user: tool_result 各自變成一則 role:'tool' (必須緊接在 assistant 之後), 其餘併成一則 user
    const rest = [];
    for(const b of content) {
      if(b.type === 'tool_result') {
        const parts = Array.isArray(b.content) ? b.content : [{type: 'text', text: String(b.content == null ? '' : b.content)}];
        const imgs = parts.filter(function(x) { return x.type === 'image'; });
        out.push({
          role: 'tool', tool_call_id: safeId(b.tool_use_id),
          content: textOf(parts) + (imgs.length ? '\n(image attached in the next message)' : '')
        });
        imgs.forEach(function(x) { rest.push(x); });
      } else if(b.type === 'text' || b.type === 'image') {
        rest.push(b);
      }
    }
    if(!rest.length) { continue; }
    out.push({role: 'user', content: rest.map(function(b) {
      if(b.type !== 'image') { return {type: 'text', text: b.text}; }
      return {type: 'image_url', image_url: {url: `data:${b.source.media_type};base64,${b.source.data}`}};
    })});
  }
  return keepLastImage(out, 'image_url');
}

// openai messages -> anthropic messages (system 那則略過, 由 session 自己帶)
export function toAnthropic(history) {
  const out = [];
  let pendingResults = null;   // 連續的 role:'tool' 收成一則 user, 後面的 user 也併進來
  const flush = function() { if(pendingResults) { out.push({role: 'user', content: pendingResults}); pendingResults = null; } };
  for(const m of history || []) {
    if(m.role === 'system') { continue; }
    if(m.role === 'tool') {
      pendingResults = pendingResults || [];
      pendingResults.push({type: 'tool_result', tool_use_id: safeId(m.tool_call_id), content: String(m.content == null ? '' : m.content)});
      continue;
    }
    if(m.role === 'user') {
      const parts = (typeof m.content === 'string' ? [{type: 'text', text: m.content}] : (m.content || [])).map(function(b) {
        if(b.type !== 'image_url') { return {type: 'text', text: b.text}; }
        const hit = /^data:([^;]+);base64,(.*)$/.exec((b.image_url && b.image_url.url) || '');
        return hit ? {type: 'image', source: {type: 'base64', media_type: hit[1], data: hit[2]}} : OMITTED;
      });
      if(pendingResults) { pendingResults = pendingResults.concat(parts); flush(); }
      else { out.push({role: 'user', content: parts}); }
      continue;
    }
    flush();
    // assistant
    const content = [];
    const text = typeof m.content === 'string' ? m.content : textOf(m.content);
    if(text) { content.push({type: 'text', text: text}); }
    for(const c of m.tool_calls || []) {
      let input = {};
      try { input = JSON.parse((c.function && c.function.arguments) || '{}'); } catch(e) { input = {}; }
      content.push({type: 'tool_use', id: safeId(c.id), name: c.function.name, input: input});
    }
    // 空的 assistant 訊息不合法
    out.push({role: 'assistant', content: content.length ? content : [{type: 'text', text: '(empty)'}]});
  }
  flush();
  return keepLastImage(out, 'image');
}

export function convert(history, from, to) {
  if(from === to) { return history; }
  if(to === 'openai') { return toOpenAI(history); }
  if(to === 'anthropic') { return toAnthropic(history); }
  throw new Error(`cannot convert history to ${to}`);
}
