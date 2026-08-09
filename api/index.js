const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..', 'workspace');

const providers = [
  require('../providers/anthropic'),
  require('../providers/openai')
];

function pickProvider() {
  const want = process.env.LLM_PROVIDER;
  if(want) {
    const p = providers.find(function(p) { return p.name === want; });
    if(!p) { throw new Error(`unknown LLM_PROVIDER: ${want}`); }
    return p;
  }
  return providers.find(function(p) { return p.available(); }) || null;
}

// resolve a user/model supplied relative path, confined to workspace/
function safePath(p) {
  const full = path.resolve(WORKSPACE, p || '.');
  if(full !== WORKSPACE && !full.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`path escapes workspace: ${p}`);
  }
  return full;
}

function listFiles(dir, prefix) {
  const out = [];
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  for(const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if(e.isDirectory()) { out.push(...listFiles(path.join(dir, e.name), rel)); }
    else { out.push(rel); }
  }
  return out;
}

// generic tool definitions; providers map these to their own wire format
const tools = [
  {
    name: 'list_files',
    description: 'List all files in the workspace (recursively). Returns relative paths.',
    parameters: {type: 'object', properties: {}, additionalProperties: false}
  },
  {
    name: 'read_file',
    description: 'Read a text file from the workspace. Call this before editing an existing file, or to inspect data files before writing a chart block.',
    parameters: {
      type: 'object',
      properties: {path: {type: 'string', description: 'relative path inside workspace, e.g. data/sales.csv'}},
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file in the workspace. Use this to create data files (data/*.csv, data/*.json) and chart blocks (blocks/<name>/index.js).',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'relative path inside workspace'},
        content: {type: 'string', description: 'full file content'}
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  }
];

function runTool(name, input) {
  if(name === 'list_files') {
    return listFiles(WORKSPACE).join('\n') || '(workspace is empty)';
  }
  if(name === 'read_file') {
    return fs.readFileSync(safePath(input.path), 'utf8');
  }
  if(name === 'write_file') {
    const full = safePath(input.path);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, input.content);
    return `wrote ${input.path} (${input.content.length} chars)`;
  }
  throw new Error(`unknown tool: ${name}`);
}

const SYSTEM = `你是一個資料視覺化助手,幫用戶在 workspace 裡建立「block」來繪製圖表。

Workspace 結構:
 - data/    — 資料檔 (csv / json)
 - blocks/<block-name>/index.js — 圖表 block,一個目錄一個 block

Block 格式 (仿 @plotdb/block 概念,pkg 宣告 + init 邏輯):

module.exports = {
  pkg: {
    name: "@workspace/<block-name>",
    description: "這個 block 做什麼"
  },
  init: function({root, ctx}) {
    // root: 掛載用的 DOM element (div)
    // ctx.d3: d3 v7
    // ctx.Chart: Chart.js v4
    // ctx.loadText(path):  fetch workspace 檔案,回傳 Promise<string>,path 例如 "data/sales.csv"
    // ctx.loadJSON(path):  fetch workspace 檔案,回傳 Promise<object>
    // 回傳 Promise 即可
  }
};

規則:
 - JS 縮排兩個空白,大括號不獨立成行,避免 async/await,優先用 Promise。
 - 用 Chart.js 時,先在 root 裡建立 <canvas> 再 new ctx.Chart(canvas, config)。
 - 用 d3 時直接在 root 裡建 svg。root 大小可用 root.clientWidth / 高度自訂 (預設約 400px 高)。
 - CSV 解析可用 ctx.d3.csvParse。
 - 寫 block 前若要用既有資料檔,先 read_file 確認格式。
 - 用戶沒提供資料時,可自行生成合理的範例資料檔到 data/。
 - 完成後簡短告訴用戶你建立/修改了哪些檔案;頁面會自動重新渲染。
 - 回覆使用與用戶相同的語言。`;

function systemFor(block) {
  if(!block) {
    return SYSTEM + '\n\n目前是「新增圖表」模式:請為用戶建立一個新的 block (目錄名用簡短英文 kebab-case),不要修改既有 block。';
  }
  return SYSTEM + `\n\n目前正在編輯的圖表是 blocks/${block}/index.js。用戶的要求都是針對這個 block 的修改,除非明確說要建新的。修改前先 read_file 看目前內容。`;
}

module.exports = ({app}) => {
  // one chat session per chart (key = block name, or a client draft id for new charts)
  const sessions = {};

  function getSession(key, block) {
    const provider = pickProvider();
    if(!provider) {
      throw new Error('no LLM provider configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env');
    }
    const id = `${provider.name}:${key}`;
    if(!sessions[id]) {
      sessions[id] = provider.createSession({system: systemFor(block), tools: tools, runTool: runTool});
    }
    return sessions[id];
  }

  app.get('/api/provider', (req, res) => {
    const p = pickProvider();
    res.json({
      provider: p ? p.name : null,
      model: p ? (p.name === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-5')
        : (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8')) : null
    });
  });

  app.get('/api/blocks', (req, res) => {
    const dir = path.join(WORKSPACE, 'blocks');
    if(!fs.existsSync(dir)) { return res.json([]); }
    const list = fs.readdirSync(dir, {withFileTypes: true})
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.js')))
      .map((e) => {
        const file = path.join(dir, e.name, 'index.js');
        const src = fs.readFileSync(file, 'utf8');
        const m = src.match(/description:\s*(['"])((?:\\.|(?!\1).)*)\1/);
        return {
          name: e.name,
          description: m ? m[2] : '',
          updatedAt: fs.statSync(file).mtimeMs
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(list);
  });

  app.post('/api/reset', (req, res) => {
    const key = (req.body || {}).session;
    for(const id of Object.keys(sessions)) {
      if(!key || id.endsWith(`:${key}`)) { delete sessions[id]; }
    }
    res.json({ok: true});
  });

  app.post('/api/chat', (req, res) => {
    const body = req.body || {};
    const text = body.message;
    if(!text) { return res.status(400).json({error: 'message required'}); }
    const key = body.session || body.block || 'default';
    Promise.resolve()
      .then(() => getSession(key, body.block || null).send(text))
      .then((r) => res.json({reply: r.reply, events: r.events}))
      .catch((e) => {
        console.error(e);
        res.status(500).json({error: String((e && e.message) || e)});
      });
  });
};
