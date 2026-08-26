const fs = require('fs');
const path = require('path');

// 同時寫 stdout 與 logs/server.log; `npm run log` 即 tail 該檔
const FILE = path.resolve(__dirname, '..', 'logs', 'server.log');
fs.mkdirSync(path.dirname(FILE), {recursive: true});

module.exports = function(tag, msg) {
  const d = new Date();
  const ts = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const line = `[${ts}] [${tag}] ${msg}`;
  console.log(line);
  fs.appendFile(FILE, line + '\n', function() {});
};
