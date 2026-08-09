// llm session 管理: provider 選擇 + 依 key 的 session store
// 用法: const llm = require('./llm')({providers: [...]});
module.exports = function(opt) {
  opt = opt || {};
  const providers = opt.providers || [
    require('../../providers/anthropic'),
    require('../../providers/openai')
  ];
  const sessions = {};

  function pick() {
    const want = process.env.LLM_PROVIDER;
    if(want) {
      const p = providers.find(function(p) { return p.name === want; });
      if(!p) { throw new Error(`unknown LLM_PROVIDER: ${want}`); }
      return p;
    }
    return providers.find(function(p) { return p.available(); }) || null;
  }

  function info() {
    const p = pick();
    return {
      provider: p ? p.name : null,
      model: p ? (p.name === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-5')
        : (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8')) : null
    };
  }

  // key: session 識別 (如 block 名稱); makeOpt(): 建 session 時才取得 {system, tools, runTool}
  function getSession(key, makeOpt) {
    const provider = pick();
    if(!provider) {
      throw new Error('no LLM provider configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');
    }
    const id = `${provider.name}:${key}`;
    if(!sessions[id]) { sessions[id] = provider.createSession(makeOpt()); }
    return sessions[id];
  }

  function reset(key) {
    for(const id of Object.keys(sessions)) {
      if(!key || id.endsWith(`:${key}`)) { delete sessions[id]; }
    }
  }

  return {pick, info, getSession, reset};
};
