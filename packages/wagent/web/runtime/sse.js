// 讀取 SSE 回應, 逐事件呼叫 onEvent({event, data}); data 為未解析的字串
export function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  function flush(chunk) {
    const lines = chunk.split('\n');
    let event = null;
    const data = [];
    for(const line of lines) {
      if(line.slice(0, 6) === 'event:') { event = line.slice(6).trim(); }
      else if(line.slice(0, 5) === 'data:') { data.push(line.slice(5).trim()); }
    }
    if(data.length) { onEvent({event: event, data: data.join('\n')}); }
  }

  function pump() {
    return reader.read().then(function(r) {
      if(r.done) {
        if(buf.trim()) { flush(buf); }
        return;
      }
      buf += dec.decode(r.value, {stream: true});
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for(const part of parts) {
        if(part.trim()) { flush(part); }
      }
      return pump();
    });
  }
  return pump();
}

// 檢查回應是否為錯誤, 是則丟出帶訊息的 Error
export function checkResponse(r) {
  if(r.ok) { return Promise.resolve(r); }
  return r.text().then(function(t) {
    let msg = t;
    try {
      const j = JSON.parse(t);
      msg = (j.error && (j.error.message || j.error)) || t;
    } catch(e) { /* 非 json, 用原文 */ }
    throw new Error(`${r.status}: ${msg}`);
  });
}
