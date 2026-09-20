import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { once } from 'node:events';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { FIXTURES } from '../src/lib/chorus/fixtures.ts';

// Execute ONLY repository-owned fixture code. Never run caller-submitted verification code.
// The Pool adapter runs real SQL on PGlite; Express and JSON middleware are not mocked.
async function fixture(t, transform = s => s) {
  const database = new PGlite();
  await database.exec("CREATE TABLE users(name text); INSERT INTO users VALUES ('Alice'), ('Bob');");
  const Pool = class { query(sql, params) { return database.query(sql, params); } };
  const code = transform(FIXTURES.prompt.input).replace(/^import .*;\s*$/gm, '');
  const context = { express, Pool };
  runInNewContext(code + '\nglobalThis.fixtureApp = app;', context, { timeout: 1000 });
  context.fixtureApp.use((_err,_req,res,_next) => res.status(500).json({ error:'fixture failure' }));
  const server = context.fixtureApp.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{ server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: path=>fetch(base+path), post:(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}) };
}

test('visible concatenated query executes, with a benign baseline and injection contrast', async t=>{
  const app=await fixture(t);
  assert.equal((await(await app.get('/search?q=Alice')).json()).length,1);
  const injected=await(await app.get('/search?q='+encodeURIComponent("' OR 1=1 --"))).json();
  assert.equal(injected.length,2);
});
test('parameterization is a negative control, not a vulnerability claim', async t=>{
  const app=await fixture(t,s=>s.replace('db.query(q)','db.query("SELECT * FROM users WHERE name = $1", [String(req.query.q)])'));
  assert.equal((await(await app.get('/search?q=Alice')).json()).length,1);
  const response = await app.get('/search?q='+encodeURIComponent("' OR 1=1 --"));
  assert.deepEqual(await response.json(),[]);
});
test('old res.json({q}) pattern returns text, not executed database rows',async t=>{
  const app=await fixture(t,s=>s.replace('res.json((await db.query(q)).rows);','res.json({ q });'));
  const response = await app.get('/search?q='+encodeURIComponent("' OR 1=1 --"));
  const body = await response.json();
  assert.equal(Array.isArray(body),false);assert.equal(typeof body.q,'string');
});
test('the declared JSON middleware makes the harmless eval probe reachable',async t=>{
  const app=await fixture(t);
  assert.deepEqual(await(await app.post('/run',{code:'1+2'})).json(),{out:3});
});
test('removing the JSON parser prevents the same body-based evaluation',async t=>{
  const app=await fixture(t,s=>s.replace('app.use(express.json({ limit: "8kb" }));',''));
  assert.equal((await app.post('/run',{code:'1+2'})).status,500);
});
test('HTML reflection contrasts with a JSON response control',async t=>{
  const payload='<b>inert-review-probe</b>';
  const vulnerable=await fixture(t),safe=await fixture(t,s=>s.replace('res.send("<h1>Hello " + req.query.name + "</h1>");','res.json({ name: req.query.name });'));
  const a=await vulnerable.get('/hello?name='+encodeURIComponent(payload));
  assert.match(a.headers.get('content-type'),/text\/html/);assert.ok((await a.text()).includes(payload));
  const b=await safe.get('/hello?name='+encodeURIComponent(payload));
  assert.match(b.headers.get('content-type'),/application\/json/);assert.deepEqual(await b.json(),{name:payload});
});
