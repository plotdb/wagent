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
    description: 'Create or overwrite a text file with exact content (parent dirs are created automatically). Always use this for file content instead of shell redirection.',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'path relative to workspace'},
        content: {type: 'string', description: 'full file content'}
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  }
];

function resolve(p) {
  return (p || '').charAt(0) === '/' ? p : `${ROOT}/${p}`;
}

// sh: esh shell (本地 createShell 或 connectShell 的 remote, 兩者同介面)
// log: function(name, input) 供 worker 回報 tool 事件
export function makeRunTool(sh, log) {
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
      return sh.io.readFile(resolve(input.path));
    }
    if(name === 'write_file') {
      return sh.io.writeFile(resolve(input.path), input.content).then(function() {
        return `wrote ${input.path} (${input.content.length} chars)`;
      });
    }
    return Promise.reject(new Error(`unknown tool: ${name}`));
  };
}
