const fs = require('fs');
const path = require('path');

// workspace env: fs 操作的封裝, 之後可抽換成別的 env (如 git-backed)
// 用法: const env = wsenv({root: '/path/to/workspace'});
module.exports = function(opt) {
  opt = opt || {};
  const ROOT = path.resolve(opt.root || 'workspace');
  const log = opt.log || function() {};

  function safePath(p) {
    const full = path.resolve(ROOT, p || '.');
    if(full !== ROOT && !full.startsWith(ROOT + path.sep)) {
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
      description: 'Read a text file from the workspace. Call this before editing an existing file.',
      parameters: {
        type: 'object',
        properties: {path: {type: 'string', description: 'relative path inside workspace, e.g. data/sales.csv'}},
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a text file in the workspace, e.g. data files (data/*) or blocks (blocks/<name>/index.js).',
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
    log('tool', name + (input && input.path ? ' ' + input.path : ''));
    if(name === 'list_files') {
      return listFiles(ROOT).join('\n') || '(workspace is empty)';
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

  function listBlocks() {
    const dir = path.join(ROOT, 'blocks');
    if(!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir, {withFileTypes: true})
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.html')))
      .map((e) => {
        const file = path.join(dir, e.name, 'index.html');
        const src = fs.readFileSync(file, 'utf8');
        const m = src.match(/description:\s*(['"])((?:\\.|(?!\1).)*)\1/);
        return {
          name: e.name,
          description: m ? m[2] : '',
          updatedAt: fs.statSync(file).mtimeMs
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return {root: ROOT, safePath, tools, runTool, listBlocks};
};
