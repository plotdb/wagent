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
      description: 'Create or overwrite a text file in the workspace. Use for new files or full rewrites; for small changes prefer edit_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {type: 'string', description: 'relative path inside workspace'},
          content: {type: 'string', description: 'full file content'}
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    {
      name: 'edit_file',
      description: 'Replace an exact string in a file. Preferred for small changes. You must read_file first; old_string must match exactly (including whitespace) and be unique unless replace_all is set.',
      parameters: {
        type: 'object',
        properties: {
          path: {type: 'string', description: 'relative path inside workspace'},
          old_string: {type: 'string', description: 'exact text to replace, with enough surrounding context to be unique'},
          new_string: {type: 'string', description: 'replacement text'},
          replace_all: {type: 'boolean', description: 'replace every occurrence instead of requiring uniqueness'}
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false
      }
    }
  ];

  // 樂觀鎖: 記住上次交給 LLM 的內容, edit 前比對 (與 web/runtime/tools.js 同一設計)
  const lastRead = {};

  // 錯誤訊息要能讓 LLM 自我修正, 故寫明匹配數與下一步
  function applyEdit(cur, input) {
    const parts = cur.split(input.old_string);
    const count = parts.length - 1;
    if(!count) {
      throw new Error('old_string not found. read_file again and copy the exact text (whitespace included).');
    }
    if(count > 1 && !input.replace_all) {
      throw new Error(`old_string matched ${count} times. Add surrounding context to make it unique, or set replace_all.`);
    }
    return {next: parts.join(input.new_string), count: count};
  }

  function runTool(name, input) {
    log('tool', name + (input && input.path ? ' ' + input.path : ''));
    if(name === 'list_files') {
      return listFiles(ROOT).join('\n') || '(workspace is empty)';
    }
    if(name === 'read_file') {
      const full = safePath(input.path);
      const content = fs.readFileSync(full, 'utf8');
      lastRead[full] = content;
      return content;
    }
    if(name === 'write_file') {
      const full = safePath(input.path);
      fs.mkdirSync(path.dirname(full), {recursive: true});
      fs.writeFileSync(full, input.content);
      lastRead[full] = input.content;
      return `wrote ${input.path} (${input.content.length} chars)`;
    }
    if(name === 'edit_file') {
      const full = safePath(input.path);
      const cur = fs.readFileSync(full, 'utf8');
      if(lastRead[full] == null) {
        throw new Error(`read_file ${input.path} first, then edit.`);
      }
      if(lastRead[full] !== cur) {
        delete lastRead[full];
        throw new Error(`${input.path} changed since you read it (edited elsewhere). read_file again before editing.`);
      }
      const r = applyEdit(cur, input);
      fs.writeFileSync(full, r.next);
      lastRead[full] = r.next;
      return `edited ${input.path} (${r.count} replacement${r.count > 1 ? 's' : ''})`;
    }
    throw new Error(`unknown tool: ${name}`);
  }

  return {root: ROOT, safePath, tools, runTool};
};
