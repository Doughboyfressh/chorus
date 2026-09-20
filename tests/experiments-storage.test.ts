import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before,after,describe,it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Sql } from '../src/lib/db.ts';
import { experimentsStore } from '../src/lib/chorus/experiments/storage.ts';
import { makePlan,requestFor,canonical } from '../src/lib/chorus/experiments/contracts.ts';
import { executeNext } from '../src/lib/chorus/experiments/runner.ts';
import { experimentHttp } from '../src/lib/chorus/experiments/http.ts';
import { writeSnapshot } from '../src/lib/chorus/snapshot-store.ts';
const db=new PGlite();
const query=async <T>(q:string,p:unknown[]=[]) => (await db.query<T>(q,p)).rows;
const sql=Object.assign(async <T>(s:TemplateStringsArray,...v:unknown[]) => query<T>(s.reduce((q,t,i)=>q+(i?`$${i}`:'')+t,''),v),{query}) as Sql;
const store=experimentsStore(sql);
const policy={model:'pinned-test-model',outputTokens:1200,inputUsdPerMillion:1,outputUsdPerMillion:2,dailyUsd:5,timeoutMs:40000};
const args={baseline:'Review only the source code.',candidate:'Review source-to-sink paths and avoid assuming omitted context.',hypothesis:'Reduce false-positive labels on clean and missing-context samples.'};
let vault:string,other:string,experiment:string;
before(async()=>{
  for(const file of ['0003_mcp_sittings.sql','0004_exam_attempts.sql','0005_experiments.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const one=await store.createVault();vault=await store.authenticate(one.key);
  other=await store.authenticate((await store.createVault()).key);
  experiment=(await store.create(vault,{name:'Saved experiment'})).id;
});
after(async()=>db.close());
async function fresh(overrides:Record<string,unknown>={}) {return (await store.createComparison(vault,experiment,makePlan({...args,...overrides},policy))).id;}
const synthetic:typeof fetch=async(_url,init)=>{
  const req=JSON.parse(String(init?.body));assert.equal(req.model,policy.model);assert.ok(!String(init?.body).includes('api-key-secret'));
  return new Response(JSON.stringify({id:'synthetic-receipt',model:policy.model,choices:[{finish_reason:'stop',message:{content:'{"findings":[],"limitations":["Only supplied context was considered."]}'}}],usage:{prompt_tokens:100,completion_tokens:50}}),{headers:{'content-type':'application/json'}});
};
describe('durable saved experiments and access boundaries',()=>{
  it('hashes recovery keys and rejects guessed credentials',async()=>{
    const rows=await sql<any>`select key_hash from chorus_vaults`;assert.ok(rows.every(r=>/^[a-f0-9]{64}$/.test(r.key_hash)));
    await assert.rejects(store.authenticate('cv_'+'a'.repeat(64)),/Invalid/);
  });
  it('separates vaults for reads, saves, forks and receipts',async()=>{
    await assert.rejects(store.detail(other,experiment),/not found/);await assert.rejects(store.create(other,{name:'bad',parentId:experiment}),/not found/);
    await assert.rejects(store.saveClient(other,experiment,{artifact:'private'}),/not found/);
  });
  it('saves client records honestly and removes known secret fields',async()=>{
    await store.saveClient(vault,experiment,{synthesis:{deliverable:'full artifact'},slot:{apiKey:'not-safe'}});
    const detail=await store.detail(vault,experiment);const c:any=await store.checkpoint(vault,experiment,(detail.checkpoints[0] as any).id);
    assert.equal(c.provenance,'client_supplied_unverified');assert.ok(!JSON.stringify(c).includes('not-safe'));
  });
  it('pins an actual sitting and checkpoints every subsequent confirmed revision',async()=>{
    const sit=crypto.randomUUID();await writeSnapshot(sql,sit,JSON.stringify({id:sit,lock:'private-writer',current:'original',scores:[],pairs:[]}),0);
    await store.pin(vault,experiment,sit);
    const long='raw complete evidence '.repeat(500);
    await writeSnapshot(sql,sit,JSON.stringify({id:sit,current:'new',evidence:long,scores:[],pairs:[]}),1);
    const rows=await sql<any>`select payload from chorus_checkpoints where sitting_id=${sit} order by id`;
    assert.equal(rows.length,2);assert.equal(rows[1].payload.evidence,long);assert.ok(!JSON.stringify(rows[0]).includes('private-writer'));
    const e=(await store.create(other,{name:'other'})).id;await assert.rejects(store.pin(other,e,sit),/already saved/);
  });
  it('saving an already-linked revision is idempotent',async()=>{
    const child=await store.child(vault,experiment,'prompt');
    await store.pin(vault,experiment,child.sittingId);await store.pin(vault,experiment,child.sittingId);
    assert.equal((await sql`select id from chorus_checkpoints where sitting_id=${child.sittingId}`).length,1);
  });
  it('does not let stale writes create false checkpoints',async()=>{
    const child=await store.child(vault,experiment,'rsi');
    await writeSnapshot(sql,child.sittingId,'{"current":"winner"}',1);
    await assert.rejects(writeSnapshot(sql,child.sittingId,'{"current":"stale"}',1),/concurrently/);
    const rows=await sql<any>`select payload from chorus_checkpoints where sitting_id=${child.sittingId}`;
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.payload.current!=='stale'));
  });
  it('pins a new child without deleting existing sittings or history',async()=>{
    const before=(await store.detail(vault,experiment)).checkpoints.length;
    const child=await store.child(vault,experiment,'data');
    assert.ok(child.sittingId);assert.equal((await store.detail(vault,experiment)).checkpoints.length,before+1);
  });
  it('protects pinned sittings from the actual retention query',async()=>{
    const child=await store.child(vault,experiment,'prompt');await sql`update chorus_mcp_sittings set updated_at=now()-interval '30 days' where id=${child.sittingId}`;
    await sql`delete from chorus_mcp_sittings where updated_at<now()-interval '14 days' and not exists(select 1 from chorus_saved_sittings where sitting_id=chorus_mcp_sittings.id)`;
    assert.equal((await sql`select id from chorus_mcp_sittings where id=${child.sittingId}`).length,1);
  });
  it('storage limits fail before a checkpoint write without removing existing data',async()=>{
    const [prior]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    await sql`update chorus_checkpoint_budget set bytes=268435456 where singleton`;
    await assert.rejects(store.saveClient(vault,experiment,{artifact:'over quota'}),/quota reached/);
    await sql`update chorus_checkpoint_budget set bytes=${prior.bytes} where singleton`;
    assert.ok((await store.detail(vault,experiment)).checkpoints.length>0);
  });
  it('explicit saved-experiment deletion releases only its own snapshot allocation',async()=>{
    const e=(await store.create(vault,{name:'temporary'})).id;await store.saveClient(vault,e,{artifact:'delete deliberately'});
    const [before]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    await store.remove(vault,e);const [after]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    assert.ok(Number(after.bytes)<Number(before.bytes));assert.ok((await store.detail(vault,experiment)).id);
  });
  it('keeps historical checkpoints even when the live sitting is explicitly removed',async()=>{
    const child=await store.child(vault,experiment,'eval');await sql`delete from chorus_mcp_sittings where id=${child.sittingId}`;
    assert.equal((await sql`select id from chorus_checkpoints where sitting_id=${child.sittingId}`).length,1);
  });
});
describe('controlled execution: reservation, receipts and interruption',()=>{
  it('permits only one concurrent claim across independent stores',async()=>{
    const id=await fresh(),p=(await store.comparison(vault,id)).plan;
    const claims=await Promise.all(Array.from({length:16},()=>experimentsStore(sql).claim(vault,id,0,requestFor(p,0),10000,5_000_000)));
    assert.equal(claims.filter(Boolean).length,1);assert.equal((await store.comparison(vault,id)).next_ordinal,1);
  });
  it('reserves budgets before a call and does not release uncertain costs',async()=>{
    const id=await fresh({maxUsd:0.001}),p=(await store.comparison(vault,id)).plan;
    assert.equal(await store.claim(vault,id,0,requestFor(p,0),2000,5_000_000),null);
    assert.equal((await store.comparison(vault,id)).status,'budget_exhausted');assert.equal((await store.results(vault,id)).trials.length,0);
  });
  it('honors the global daily cap as well as the comparison cap',async()=>{
    const id=await fresh(),p=(await store.comparison(vault,id)).plan;
    assert.equal(await store.claim(vault,id,0,requestFor(p,0),10000,1),null);assert.equal((await store.comparison(vault,id)).status,'budget_exhausted');
  });
  it('records full actual provider request/output and usage without API credentials',async()=>{
    const id=await fresh(),r=await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);
    assert.equal(r.trials[0].status,'completed');assert.equal(r.trials[0].usage.prompt_tokens,100);
    const receipt=await store.receipt(vault,r.trials[0].id);
    assert.ok(receipt.response_raw.includes('synthetic-receipt'));assert.equal(receipt.request.messages[0].content,args.baseline);
    assert.ok(!JSON.stringify(receipt).includes('api-key-secret'));assert.equal(r.report.complete,false);
  });
  it('replaying a client request cannot start a different or duplicate trial',async()=>{
    const id=await fresh();let calls=0;const transport:typeof fetch=async(...a)=>{calls++;return synthetic(...a);};
    await executeNext(sql,vault,id,policy,'api-key-secret',0,transport);await executeNext(sql,vault,id,policy,'api-key-secret',0,transport);assert.equal(calls,1);
  });
  it('halts if the provider changes its reported model between matched trials',async()=>{
    const id=await fresh();await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);
    const changed:typeof fetch=async(...a)=>{const res=await synthetic(...a);const data=await res.json();data.model='unexpected-revision';return new Response(JSON.stringify(data));};
    const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,changed);
    assert.equal(r.status,'needs_review');assert.equal(r.trials[1].status,'invalid');assert.match(r.trials[1].error,/model changed/);
  });
  it('does not overwrite a completed receipt',async()=>{
    const id=await fresh(),r=await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);
    await assert.rejects(store.finish(vault,r.trials[0].id,{status:'completed',output:'substitution'}),/terminal/);
  });
  it('stops on invalid outputs instead of manufacturing zero or retrying',async()=>{
    const id=await fresh();let calls=0;const invalid:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({id:'bad',model:policy.model,choices:[{finish_reason:'stop',message:{content:'not JSON'}}],usage:{prompt_tokens:1,completion_tokens:1}}));};
    const r=await executeNext(sql,vault,id,policy,'api-key-secret',0,invalid);assert.equal(r.status,'needs_review');assert.equal(r.trials[0].status,'invalid');
    await executeNext(sql,vault,id,policy,'api-key-secret',1,invalid);assert.equal(calls,1);
  });
  it('preserves provider failures and their reservations',async()=>{
    const id=await fresh();const r=await executeNext(sql,vault,id,policy,'api-key-secret',0,async()=>new Response('{"error":"no service"}',{status:503}));
    assert.equal(r.trials[0].status,'transport_error');assert.ok(Number(r.reserved_micro)>0);assert.equal(r.status,'needs_review');
  });
  it('turns an expired lease into unknown without executing it twice',async()=>{
    const id=await fresh(),p=(await store.comparison(vault,id)).plan;await store.claim(vault,id,0,requestFor(p,0),10000,5_000_000);
    await sql`update chorus_comparisons set lease_until=now()-interval '1 second' where id=${id}`;
    let calls=0;const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,async()=>{calls++;throw Error('must not call');});
    assert.equal(calls,0);assert.equal(r.status,'needs_review');assert.equal(r.trials[0].status,'unknown');
  });
  it('pause/resume preserves plan and history, not a fresh experiment',async()=>{
    const id=await fresh();await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);const hash=(await store.comparison(vault,id)).plan_hash;
    await store.pause(vault,id);await executeNext(sql,vault,id,policy,'api-key-secret',1,async()=>{throw Error('must not call');});
    assert.equal((await store.comparison(vault,id)).status,'paused');await store.resume(vault,id);
    const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,synthetic);assert.equal(r.trials.length,2);assert.equal(r.plan_hash,hash);
  });
  it('enforces elapsed wall time and frozen provider policy',async()=>{
    const id=await fresh();await sql`update chorus_comparisons set started_at=now()-interval '7 hours' where id=${id}`;
    const r=await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);assert.equal(r.status,'budget_exhausted');
    await assert.rejects(executeNext(sql,vault,await fresh(),{...policy,model:'other'},'api-key-secret',0,synthetic),/policy changed/);
  });
  it('completes the scheduled plan even when the model misses findings; completion is not improvement',async()=>{
    const id=await fresh();for(let i=0;i<16;i++)await executeNext(sql,vault,id,policy,'api-key-secret',i,synthetic);
    const r=await store.results(vault,id);assert.equal(r.status,'completed');assert.equal(r.trials.length,16);assert.equal(r.report.complete,true);
    assert.equal(r.report.cleanTrainingEligible,false);assert.ok(r.report.baseline.fn>0);
  });
});
describe('HTTP trust boundary',()=>{
  const req=(body:unknown,key='',origin='https://chorus.example')=>new Request('https://chorus.example/api/experiments',{method:'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(body)});
  it('rejects cross-origin, guessed-vault and unsupported result writes',async()=>{
    assert.equal((await experimentHttp(req({action:'create_vault'},'','https://evil.example'),sql,{})).status,403);
    assert.equal((await experimentHttp(req({action:'list'}),sql,{})).status,401);
    const v=await store.createVault();assert.equal((await experimentHttp(req({action:'finish_trial',output:'fake'},v.key),sql,{})).status,400);
  });
  it('save/read works without provider setup but paid execution stays closed',async()=>{
    const v=await store.createVault();const res=await experimentHttp(req({action:'create',name:'No provider'},v.key),sql,{});assert.equal(res.status,201);
    const {id}=await res.json();assert.equal((await experimentHttp(req({action:'create_comparison',experimentId:id,...args},v.key),sql,{})).status,503);
  });
  it('never accepts caller-supplied model output as a controlled receipt',async()=>{
    const v=await store.createVault();const response=await experimentHttp(req({action:'record_receipt',verified:true},v.key),sql,{});assert.equal(response.status,400);
  });
});

it('recovers a paused abandoned lease without issuing another provider call',async()=>{
  const id=await fresh(),p=(await store.comparison(vault,id)).plan;
  await store.claim(vault,id,0,requestFor(p,0),10000,5_000_000);await store.pause(vault,id);
  await sql`update chorus_comparisons set lease_until=now()-interval '1 second' where id=${id}`;
  await store.resume(vault,id);let calls=0;
  const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,async()=>{calls++;throw Error('must not execute');});
  assert.equal(calls,0);assert.equal(r.status,'needs_review');assert.equal(r.trials[0].status,'unknown');
});
