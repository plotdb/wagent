// browser runtime 的 tool 集。依 host 契約 (context/project/host.md) 分區:
//  - shell:       路徑操作與探索。內容不走這裡 (會經 shell parser)
//  - content ops: 內容讀寫, 含樂觀鎖。固定三個, 不隨 host 變動
//  - host tools:  非檔案系統的操作。snapshot 為必要成員, 其餘由 host 自行註冊
export const ROOT = '/home/workspace';

export const shellTools = [
  {
    name: 'run_shell',
    description: 'Run a shell command in the workspace (POSIX-like shell with pipes, glob, redirects; ls/cat/grep/find/mkdir/rm/mv/sed etc). Use for exploring and for path operations. Do NOT use it to write file content — use write_file instead.',
    parameters: {
      type: 'object',
      properties: {command: {type: 'string', description: 'shell command line, e.g. "ls -R blocks"'}},
      required: ['command'],
      additionalProperties: false
    }
  }
];

export const contentTools = [
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

// snapshot: 觀察通道, 由 host 實作 (渲染參數是 host 的 session 狀態, 不在 fs 裡)。
export const snapshotTool = {
  name: 'snapshot',
  description: 'Inspect the rendered block. Without image, returns a cheap structured report: size, whether it looks blank, canvas/svg content signals, visible text, render errors, and how much it changed since the last snapshot — enough to verify a write actually rendered (a block can render without throwing and still be blank). With image:true it also returns a picture of it. You MUST set image:true whenever the question is about how it LOOKS — colors, layout, spacing, overlapping labels, readability, "does this look right". The report cannot answer those, and describing appearance from source code instead of the picture is wrong. Do not claim to have seen the rendering unless you requested the image.',
  parameters: {
    type: 'object',
    properties: {
      image: {type: 'boolean', description: 'also return a picture of the rendered block. default false — use only when you need to judge something visual'},
      mode: {
        type: 'string', enum: ['live', 'fresh'],
        description: '"live" (default) inspects what the user is currently looking at. "fresh" renders another copy off-screen at the given width/height and inspects that — use it to check how the block behaves at a specific size (e.g. mobile) without disturbing the user\'s view.'
      },
      width: {type: 'number', description: 'fresh mode only: render width in px (default 375)'},
      height: {type: 'number', description: 'fresh mode only: render height in px (default 600)'},
      time: {type: 'number', description: 'for animated blocks that implement seek(): freeze and jump to this time before looking'},
      target: {type: 'string', description: 'block name to inspect; defaults to the one currently shown'}
    },
    additionalProperties: false
  }
};

export const tools = shellTools.concat(contentTools, [snapshotTool]);

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
// opt.log:  function(name, input) 供 worker 回報 tool 事件
// opt.host: function(name, args) -> Promise<string>; shell / content 以外的 tool 一律轉給它
export function makeRunTool(sh, opt) {
  opt = opt || {};
  const log = opt.log;
  const host = opt.host;
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
    // 其餘一律是 host tool (snapshot 與 host 自行註冊的)
    if(host) { return host(name, input); }
    return Promise.reject(new Error(`unknown tool: ${name}`));
  };
}
