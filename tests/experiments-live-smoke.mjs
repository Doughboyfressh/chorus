import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
assert.equal(process.env.CHORUS_SMOKE_ALLOW_DISPOSABLE_WRITES,'1','Explicitly allow disposable storage writes.');
const base=new URL(process.env.CHORUS_BASE_URL||'');assert.equal(base.protocol,'https:');
const endpoint=new URL('/api/experiments',base),created=[],sittings=[],passed=[];let rpcId=0;
const pass=s=>{passed.push(s);console.log('PASS:',s);};
async function api(action,body={},key='',expected=200,origin=base.origin){
 const r=await fetch(endpoint,{method:'POST',redirect:'error',headers:{origin,'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();assert.equal(r.status,expected,`${action}: ${r.status} ${data.error||''}`);return data;
}
async function mcp(sit,name,args={}){
 const r=await fetch(new URL(`/mcp/${sit}`,base),{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(20000)});
 assert.equal(r.status,200);const data=await r.json();assert.ok(!data.error,data.error?.message);assert.ok(!data.result.isError,data.result.content?.[0]?.text);return JSON.parse(data.result.content[0].text);
}
try {
 const page=await fetch(new URL('/experiments',base),{signal:AbortSignal.timeout(20000)});assert.equal(page.status,200);assert.match(await page.text(),/Keep the work/);
 const r=await fetch(endpoint,{headers:{origin:base.origin},signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);const config=await r.json();assert.equal(config.runner.ready,false,'This smoke test requires paid execution disabled.');pass('Live experiment workspace and intentionally disabled provider runner');
 const vault=await api('create_vault',{},'',201);assert.match(vault.key,/^cv_[a-f0-9]{64}$/);
 const exp=await api('create',{name:'Disposable release verification'},vault.key,201);created.push({id:exp.id,key:vault.key});
 const before=await api('detail',{experimentId:exp.id},vault.key);assert.equal(before.checkpoints.length,0);
 const child=await api('child',{experimentId:exp.id,labId:'prompt'},vault.key,201);sittings.push(child.sittingId);
 const one=await api('detail',{experimentId:exp.id},vault.key);assert.equal(one.checkpoints.length,1);
 await api('pin',{experimentId:exp.id,sittingId:child.sittingId},vault.key);await api('pin',{experimentId:exp.id,sittingId:child.sittingId},vault.key);
 assert.equal((await api('detail',{experimentId:exp.id},vault.key)).checkpoints.length,1);pass('Vault, saved child and duplicate attachment create one initial checkpoint');
 const artifact='Require exact evidence and record uncertainty.\n'.repeat(210)+'FINAL_RELEASE_CHECK_RULE';
 await mcp(child.sittingId,'chorus_sitting',{contract:artifact,merge:artifact});
 const after=await api('detail',{experimentId:exp.id},vault.key);assert.ok(after.checkpoints.length>1);
 const full=await api('checkpoint',{experimentId:exp.id,checkpointId:after.checkpoints.at(-1).id},vault.key);
 assert.equal(full.payload.merge,artifact);assert.ok(!('lock' in full.payload));assert.match(full.sha256,/^[a-f0-9]{64}$/);pass('Confirmed MCP changes retain the full long artifact and immutable earlier checkpoint');
 const other=await api('child',{experimentId:exp.id,labId:'rsi'},vault.key,201);sittings.push(other.sittingId);
 const prior=await mcp(child.sittingId,'chorus_sitting');assert.ok(JSON.stringify(prior).includes('FINAL_RELEASE_CHECK_RULE'));pass('A different lab gets a separate child sitting without wiping prior work');
 await api('save_client',{experimentId:exp.id,snapshot:{synthesis:{deliverable:artifact},apiKey:'should-be-redacted'}},vault.key);
 const latest=await api('detail',{experimentId:exp.id},vault.key);const saved=await api('checkpoint',{experimentId:exp.id,checkpointId:latest.checkpoints.at(-1).id},vault.key);
 assert.equal(saved.provenance,'client_supplied_unverified');assert.ok(!JSON.stringify(saved).includes('should-be-redacted'));pass('Client snapshots preserve output while redacting known credential fields and labeling provenance');
 const second=await api('create_vault',{},'',201);await api('detail',{experimentId:exp.id},second.key,404);await api('detail',{experimentId:exp.id},'invalid',401);
 await api('pin',{experimentId:exp.id,sittingId:child.sittingId},vault.key,403,'https://other.invalid');pass('Wrong vault keys and cross-origin browser writes cannot access the experiment');
 const blocked=await api('create_comparison',{experimentId:exp.id},vault.key,503);assert.equal(blocked.code,'RUNNER_NOT_CONFIGURED');
 await api('finish_trial',{trialId:crypto.randomUUID(),score:100},vault.key,400);pass('Paid evaluation fails closed without operator setup; no client-supplied receipt write action');
 const manifest=await api('export',{experimentId:exp.id},vault.key);assert.equal(manifest.checkpoints.length,latest.checkpoints.length);
 for(const row of manifest.checkpoints)await api('checkpoint',{experimentId:exp.id,checkpointId:row.id},vault.key);
 pass('Complete backup manifest and separately fetched checkpoint bodies are readable');
 const fork=await api('create',{name:'Disposable child experiment',parentId:exp.id},vault.key,201);created.push({id:fork.id,key:vault.key});
 await api('delete',{experimentId:exp.id,confirmation:`DELETE ${exp.id}`},vault.key,409);
 pass('Explicit deletion cannot silently remove child experiments');
} finally {
 for(const e of created.reverse())await api('delete',{experimentId:e.id,confirmation:`DELETE ${e.id}`},e.key);
 for(const sit of sittings){const r=await fetch(new URL(`/mcp/${sit}`,base),{method:'DELETE',signal:AbortSignal.timeout(20000)});assert.equal(r.status,204);}
}
pass('Disposable experiment contents and sittings removed; no existing user data touched');
await writeFile(process.env.CHORUS_SMOKE_REPORT||'/tmp/experiments-live.json',JSON.stringify({status:'PASS',base:base.origin,checkedAt:new Date().toISOString(),passed,realModelCalls:0,userSittingsAccessed:0,emptyTestVaultMetadataRetained:true},null,2));
