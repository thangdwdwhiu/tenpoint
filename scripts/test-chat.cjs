// Exercise actual route handlers with an isolated in-memory database adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let rows = [];
let failDb = false;
let allow = true;
const db = { async query(sql, params) {
  if (failDb) throw new Error('database unavailable');
  if (sql.includes('SELECT')) {
    const key = sql.includes('AND id >') ? 'id' : 'created_at';
    return { rows: rows.filter(m => m.node_id === params[0] && BigInt(m[key]) > BigInt(params[1])).slice(0, 20) };
  }
  return { rows: [] };
}};
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  function mockRequire(name) {
    if (name === '@/lib/db') return db;
    if (name === '@/lib/auth') return { verifySig: () => allow, checkAdmin: () => allow, corsHeaders: {}, optionsRes: () => new Response(null, { status: 204 }) };
    if (name === '@/lib/chat') return load('lib/chat.ts');
    return require(name);
  }
  new Function('require', 'module', 'exports', js)(mockRequire, module, module.exports);
  cache.set(relative, module.exports);
  return module.exports;
}
function request(body) {
  return new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) });
}
(async () => {
  const pull = load('app/api/nodes/messages/pull/route.ts').POST;
  const base = { node_id: 'customer', sig: 'test' };
  rows = Array.from({ length: 45 }, (_, i) => ({ node_id: 'customer', id: String(9007199254740993n + BigInt(i)), created_at: '123', body: String(i) }));
  let cursor = '0';
  let received = [];
  for (let i = 0; i < 4; i++) {
    const response = await pull(request({ ...base, last_id: cursor }));
    assert.equal(response.status, 200);
    const { messages } = await response.json();
    received.push(...messages);
    if (messages.length) cursor = messages.at(-1).id;
  }
  assert.equal(received.length, 45);
  assert.equal(new Set(received.map(m => m.id)).size, 45);
  assert.equal((await pull(request({ ...base, last_id: '-1' }))).status, 400);
  assert.equal((await pull(request({ ...base, last_id: '9223372036854775808' }))).status, 400);
  assert.equal((await pull(request({ ...base, since: 123 }))).status, 200);
  assert.equal((await pull(new Request('http://localhost/test', { method: 'POST', body: '{' }))).status, 400);
  allow = false;
  assert.equal((await pull(request(base))).status, 401);
  allow = true;
  for (const route of ['app/api/operator/messages/route.ts', 'app/api/nodes/messages/send/route.ts']) {
    const send = load(route).POST;
    for (const body of ['', '   ', 123, 'x'.repeat(5001)]) {
      assert.equal((await send(request({ ...base, body }))).status, 400);
    }
    assert.equal((await send(request({ ...base, body: 'Xin chào' }))).status, 200);
    allow = false;
    assert.equal((await send(request({ ...base, body: 'test' }))).status, 401);
    allow = true;
    failDb = true;
    const previousError = console.error;
    try {
      console.error = () => {};
      assert.equal((await send(request({ ...base, body: 'test' }))).status, 503);
    } finally {
      console.error = previousError;
      failDb = false;
    }
  }
  console.log('Chat routes passed: pagination, BIGINT IDs, validation, auth, database failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
