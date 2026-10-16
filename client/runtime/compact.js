// 對話壓縮 ( compact ): 對話長到超過門檻時, 把較舊的幾輪交給模型寫成一段摘要, 最近幾輪保留原文.
//
// 為什麼要壓: 對話紀錄會被存下來 ( 見 client.js 的 sessions ), 一個作品可以隔幾個月再打開接著做 ——
// 累積下來每次呼叫都要送整份紀錄, 又貴又可能超過模型的 context 上限.
//
// 原則:
//  - 平常的紀錄是 append-only ( prompt cache、Claude 的 thinking 都綁著前綴 ). 壓縮是唯一改動前綴的時機,
//    所以只在兩輪之間、超過門檻時做一次, 不要每輪都做
//  - 切點落在「一輪的開頭」( 使用者的發話, 不是 tool 結果 ): 不會把 tool 呼叫與它的結果拆開
//  - 保留的那幾輪拿掉 thinking block: 它們綁著原本的前綴, 前綴換了就作廢 ( anthropic 會拒絕 )
//  - 摘要用 host 指定的模型 ( 通常是便宜的 ), 經同一個 llm proxy 呼叫 ( 計費、限流照舊 )
//
// 畫面上的完整紀錄是另一份 ( chat base 的 transcript ), 不受壓縮影響.
import {estimateRequest} from './progress.js';

export const SUMMARY_TAG = '[conversation-summary]';

// 送出量估計 ( token ). 圖以固定數計 ( 見 progress.js )
export function estimateTokens(history) {
  return estimateRequest(JSON.stringify(history || []));
}

// 一則訊息是不是一輪的開頭 ( 使用者的發話; tool 結果不算 )
function isTurnStart(m, format) {
  if(!m || m.role !== 'user') { return false; }
  if(format === 'openai') { return true; }
  if(typeof m.content === 'string') { return true; }
  return !(m.content || []).some(function(b) { return b.type === 'tool_result'; });
}

// 切點: 保留最後 keep 輪的第一則的位置. 輪數不夠 ( 沒有可以壓的 ) 回 0
export function splitPoint(history, format, keep) {
  const starts = [];
  (history || []).forEach(function(m, i) { if(isTurnStart(m, format)) { starts.push(i); } });
  keep = keep > 0 ? keep : 4;
  if(starts.length <= keep) { return 0; }
  return starts[starts.length - keep];
}

// 交給摘要模型的純文字版紀錄. tool 的參數與結果截短, 圖與 thinking 略過
const CLIP = function(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
export function transcriptText(history, format, max) {
  const lines = [];
  (history || []).forEach(function(m) {
    const who = m.role === 'assistant' ? 'Assistant' : (m.role === 'tool' ? 'Tool result' : 'User');
    if(typeof m.content === 'string') {
      if(m.content) { lines.push(who + ': ' + (m.role === 'tool' ? CLIP(m.content, 500) : m.content)); }
    } else {
      (m.content || []).forEach(function(b) {
        if(b.type === 'text' && b.text) { lines.push(who + ': ' + b.text); }
        else if(b.type === 'tool_use') { lines.push('Assistant called ' + b.name + ' ' + CLIP(JSON.stringify(b.input || {}), 300)); }
        else if(b.type === 'tool_result') {
          const c = typeof b.content === 'string' ? b.content :
            (b.content || []).filter(function(x) { return x.type === 'text'; }).map(function(x) { return x.text; }).join(' ');
          lines.push('Tool result: ' + CLIP(c, 500));
        }
        else if(b.type === 'image' || b.type === 'image_url') { lines.push(who + ': [image]'); }
      });
    }
    if(format === 'openai' && m.tool_calls) {
      m.tool_calls.forEach(function(c) {
        lines.push('Assistant called ' + (c.function && c.function.name) + ' ' + CLIP(c.function && c.function.arguments, 300));
      });
    }
  });
  let text = lines.join('\n');
  // 太長只留後段 ( 越新的越重要 )
  max = max > 0 ? max : 300000;
  if(text.length > max) { text = '…\n' + text.slice(text.length - max); }
  return text;
}

export const SUMMARY_PROMPT = [
  'You compress an earlier part of a conversation between a user and a coding / creative agent, so the agent can keep working without the full transcript.',
  'Write a concise summary in the same language the user writes in. Include:',
  '- what the user wants ( goals, requirements, preferences, things they rejected )',
  '- decisions made and why',
  '- the current state of the work ( which files exist or were changed, what is done, what is half done )',
  '- open tasks and anything the user asked to do next',
  'Do not invent details. Plain text or short bullet points, no preamble.'
].join('\n');

// 壓縮後的開頭兩則 ( 摘要 + 確認 ), 讓紀錄仍是一來一往. lang: 'zh' ( 預設 ) / 'en'
const HEAD = {
  zh: {head: ' 以下是先前對話的摘要 ( 較早的部分已壓縮, 細節以目前的檔案為準 ):\n\n', ack: '了解, 我會依照這份摘要接著做。'},
  en: {head: ' Summary of the earlier conversation ( the older part was compacted; the current files are the source of truth for details ):\n\n', ack: 'Understood, I will continue based on this summary.'}
};
export function summaryMessages(summary, format, lang) {
  const t = HEAD[lang] || HEAD.zh;
  const head = SUMMARY_TAG + t.head + summary;
  const ack = t.ack;
  if(format === 'openai') {
    return [{role: 'user', content: head}, {role: 'assistant', content: ack}];
  }
  return [{role: 'user', content: [{type: 'text', text: head}]}, {role: 'assistant', content: [{type: 'text', text: ack}]}];
}

// 保留的部分拿掉 thinking ( 前綴換了就作廢 ); 拿掉後空了的 assistant 補一個佔位
export function stripThinking(history, format) {
  if(format === 'openai') { return history.slice(); }
  return history.map(function(m) {
    if(m.role !== 'assistant' || !Array.isArray(m.content)) { return m; }
    const c = m.content.filter(function(b) { return b.type !== 'thinking' && b.type !== 'redacted_thinking'; });
    return Object.assign({}, m, {content: c.length ? c : [{type: 'text', text: '…'}]});
  });
}

// 請摘要模型寫摘要. call(body) -> Promise<回應 json>, 由呼叫端負責送到 proxy ( 帶 header )
export function summarize({history, format, provider, model, call}) {
  const text = transcriptText(history, format);
  const body = provider === 'anthropic'
    ? {model: model, max_tokens: 4000, system: SUMMARY_PROMPT, messages: [{role: 'user', content: text}]}
    : {model: model, messages: [{role: 'system', content: SUMMARY_PROMPT}, {role: 'user', content: text}]};
  return call(body).then(function(j) {
    const out = provider === 'anthropic'
      ? (j.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n')
      : ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
    if(!out.trim()) { throw new Error('compact: empty summary'); }
    return out.trim();
  });
}

// 壓縮一份紀錄. 回傳新的紀錄; 不需要 ( 沒超過門檻或輪數不夠 ) 回 null
//   opt: {at ( token 門檻 ), keep ( 保留幾輪 ), provider, model ( 摘要用 ), call, lang ( 摘要開頭那兩則的語言 )}
export function compact(history, format, opt) {
  if(!(opt && opt.at > 0) || estimateTokens(history) < opt.at) { return Promise.resolve(null); }
  const cut = splitPoint(history, format, opt.keep);
  if(cut <= 0) { return Promise.resolve(null); }
  return summarize({history: history.slice(0, cut), format: format, provider: opt.provider, model: opt.model, call: opt.call})
    .then(function(summary) { return summaryMessages(summary, format, opt.lang).concat(stripThinking(history.slice(cut), format)); });
}
