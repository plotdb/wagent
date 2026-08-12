// browser runtime 的 tool 集: 一個 shell + 一對內容讀寫。
//  - 路徑類操作 (mkdir / rm / mv / ls) 走 run_shell, 不另開 tool
//  - 任意內容 (html / csv) 一律走 read_file / write_file, 不經 shell parser
export const ROOT = '/home/workspace';

export const tools = [
  {
    name: 'run_shell',
    description: 'Run a shell command in the workspace (POSIX-like shell with pipes, glob, redirects; ls/cat/grep/find/mkdir/rm/mv/sed etc). Use for exploring and for path operations. Do NOT use it to write file content — use write_file instead.',
    parameters: {
      type: 'object',
      properties: {command: {type: 'string', description: 'shell command line, e.g. "ls -R blocks"'}},
      required: ['command'],
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file. Call this before editing an existing file.',
    parameters: {
      type: 'object',
      properties: {path: {type: 'string', description: 'path relative to workspace, e.g. data/sales.csv'}},
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file with exact content (parent dirs are created automatically). Use for new files or full rewrites; for small changes prefer edit_file. Always use this for file content instead of shell redirection.',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'path relative to workspace'},
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
        path: {type: 'string', description: 'path relative to workspace'},
        old_string: {type: 'string', description: 'exact text to replace, with enough surrounding context to be unique'},
        new_string: {type: 'string', description: 'replacement text'},
        replace_all: {type: 'boolean', description: 'replace every occurrence instead of requiring uniqueness'}
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false
    }
  }
];

function resolve(p) {
  return (p || '').charAt(0) === '/' ? p : `${ROOT}/${p}`;
}

// 取代邏輯與錯誤訊息 (訊息要能讓 LLM 自我修正, 故寫明匹配數與下一步)
export function applyEdit(cur, input) {
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

// sh: esh shell (本地 createShell 或 connectShell 的 remote, 兩者同介面)
// log: function(name, input) 供 worker 回報 tool 事件
export function makeRunTool(sh, log) {
  // 樂觀鎖: 記住上次交給 LLM 的內容; edit 前比對, 檔案若被外部改過 (如使用者在終端)
  // 就拒絕並要求重讀, 避免拿舊內容覆寫
  const lastRead = {};

  return function(name, input) {
    if(log) { log(name, input); }
    if(name === 'run_shell') {
      return sh.run(input.command).then(function(r) {
        const out = [];
        if(r.stdout) { out.push(r.stdout.replace(/\n$/, '')); }
        if(r.stderr) { out.push(`[stderr] ${r.stderr.replace(/\n$/, '')}`); }
        if(r.code) { out.push(`[exit ${r.code}]`); }
        return out.join('\n') || '(no output)';
      });
    }
    if(name === 'read_file') {
      const full = resolve(input.path);
      return sh.io.readFile(full).then(function(c) {
        lastRead[full] = c;
        return c;
      });
    }
    if(name === 'write_file') {
      const full = resolve(input.path);
      return sh.io.writeFile(full, input.content).then(function() {
        lastRead[full] = input.content;
        return `wrote ${input.path} (${input.content.length} chars)`;
      });
    }
    if(name === 'edit_file') {
      const full = resolve(input.path);
      return sh.io.readFile(full).then(function(cur) {
        if(lastRead[full] == null) {
          throw new Error(`read_file ${input.path} first, then edit.`);
        }
        if(lastRead[full] !== cur) {
          delete lastRead[full];
          throw new Error(`${input.path} changed since you read it (edited elsewhere). read_file again before editing.`);
        }
        const r = applyEdit(cur, input);
        return sh.io.writeFile(full, r.next).then(function() {
          lastRead[full] = r.next;
          return `edited ${input.path} (${r.count} replacement${r.count > 1 ? 's' : ''})`;
        });
      });
    }
    return Promise.reject(new Error(`unknown tool: ${name}`));
  };
}
