// 帳戶與用量 — **這是應用層的東西**, 所以在 repo 根目錄的 lib/ 而不是
// packages/wagent 裡。wagent 只負責把每次呼叫的用量算出來 (api/meter.js),
// 「誰在用、額度多少、存在哪、怎麼查」全部是 caller 的領域知識。
// 判準與 sandbox 的 source / list / adapt 同一條。
//
// 這一份是**給測試用的最小實作**: node:sqlite (Node 22.5+ 內建, 不必裝東西) +
// 幾個假帳號。真實系統換掉這個檔就好, 對 wagent 的介面不變。

const {DatabaseSync} = require('node:sqlite');

// 假帳號: key -> {name, quota}。quota 是 credit (見 meter.js), 不是 token ——
// 刻意給得很小, 這樣跑幾輪就會撞到上限, 不必等一天才知道限額有沒有生效。
const SEED = [
  {key: 'demo-alice', name: 'alice', quota: 200000},
  {key: 'demo-bob', name: 'bob', quota: 50000},
  {key: 'demo-tight', name: 'tight (故意給很少, 用來看撞上限的樣子)', quota: 2000},
  {key: 'demo-zero', name: 'zero (已用完)', quota: 0}
];

function open(file) {
  const db = new DatabaseSync(file || 'logs/usage.db');
  db.exec(`
    create table if not exists account (
      key text primary key, name text not null, quota integer not null default 0
    );
    create table if not exists usage (
      id integer primary key autoincrement,
      key text not null, at integer not null,
      provider text, model text, status integer,
      input integer default 0, output integer default 0,
      cache_read integer default 0, cache_write integer default 0,
      credits integer default 0, estimated integer default 0,
      req_bytes integer default 0, res_bytes integer default 0, ms integer default 0
    );
    create index if not exists usage_key on usage(key, at);
  `);
  const ins = db.prepare('insert or ignore into account (key, name, quota) values (?, ?, ?)');
  for(const a of SEED) { ins.run(a.key, a.name, a.quota); }
  return db;
}

module.exports = function(opt) {
  opt = opt || {};
  const db = open(opt.file);
  const log = opt.log || function() {};

  const qSpent = db.prepare('select coalesce(sum(credits), 0) as n from usage where key = ?');
  const qAcct = db.prepare('select * from account where key = ?');
  const qList = db.prepare('select * from account order by name');
  const qRecent = db.prepare('select * from usage where key = ? order by at desc limit ?');
  const insUsage = db.prepare(`insert into usage
    (key, at, provider, model, status, input, output, cache_read, cache_write,
     credits, estimated, req_bytes, res_bytes, ms)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // 誰在用。demo 走 header; 真實系統換成 session / JWT / cookie ——
  // 認證方式是 caller 的事, wagent 那端只透過 createRuntime 的 headers 帶過來。
  function resolve(req) {
    const key = req.get('x-wagent-account') || '';
    return key ? (qAcct.get(key) || null) : null;
  }

  function spent(key) { return qSpent.get(key).n; }

  return {
    resolve: resolve,
    spent: spent,
    balance: function(key) {
      const a = qAcct.get(key);
      if(!a) { return null; }
      const used = spent(key);
      return {key: a.key, name: a.name, quota: a.quota, spent: used, left: a.quota - used};
    },
    list: function() {
      return qList.all().map(function(a) {
        const used = spent(a.key);
        return {key: a.key, name: a.name, quota: a.quota, spent: used, left: a.quota - used};
      });
    },
    recent: function(key, n) { return qRecent.all(key, n || 20); },

    // 額度檢查。**只能擋在呼叫之前, 而那時還不知道這次要花多少** ——
    // 真實用量要等回應結束, 而串流一開始就不能反悔。所以設計上接受
    // 「最多超支一次呼叫」, 而不是假裝擋得準。
    check: function(key) {
      const b = this.balance(key);
      if(!b) { return {ok: false, reason: 'unknown account'}; }
      if(b.left <= 0) { return {ok: false, reason: `quota exhausted (${b.spent}/${b.quota})`, balance: b}; }
      return {ok: true, balance: b};
    },

    // 記帳。proxy 的 opt.usage 直接接這個。
    charge: function(key, r) {
      const u = r.usage || {};
      insUsage.run(
        key, Date.now(), r.provider || null, r.model || null, r.status || 0,
        u.input || 0, u.output || 0, u.cacheRead || 0, u.cacheWrite || 0,
        r.credits || 0, r.estimated ? 1 : 0,
        (r.bytes && r.bytes.request) || 0, (r.bytes && r.bytes.response) || 0, r.ms || 0
      );
      const b = this.balance(key);
      log('usage', `${key} +${r.credits}${r.estimated ? '~' : ''} cr ` +
        `(in ${u.input || 0} out ${u.output || 0} cache ${u.cacheRead || 0}) ` +
        `→ ${b.spent}/${b.quota}`);
    },

    accounts: SEED.map(function(a) { return a.key; })
  };
};
