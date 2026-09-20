import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {makePlan} from '../src/lib/chorus/experiments/contracts.ts';
import {comparisonReport} from '../src/lib/chorus/experiments/pilot.ts';
const base=process.env.CHORUS_BROWSER_BASE||'http://127.0.0.1:8080';
assert.ok(new URL(base).hostname==='127.0.0.1','Browser mutation tests are local only.');
const out=process.env.CHORUS_BROWSER_EVIDENCE||'evidence';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const passed=[];const pass=s=>{passed.push(s);console.log('PASS:',s);};
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept());
 await page.goto(base+'/experiments');await page.getByRole('button',{name:'Create private vault',exact:true}).click();
 await page.getByText('Vault unlocked on this browser',{exact:true}).waitFor();
 const recovery=await page.evaluate(()=>localStorage.getItem('chorus.experiment.vault.v1'));assert.match(recovery,/^cv_[a-f0-9]{64}$/);
 await page.getByLabel('Name',{exact:true}).fill('Browser persistence check');
 await page.getByRole('button',{name:'New saved experiment',exact:true}).click();
 await page.getByRole('heading',{name:'Browser persistence check',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Freeze comparison plan/}).isDisabled(),true);
 assert.ok((await page.textContent('body')).includes('Paid execution is disabled'));
 pass('Vault creation and real persisted experiment work without a provider key');
 await page.getByRole('button',{name:'Create without wiping',exact:true}).click();await page.waitForURL('**/lab');
 const sit=await page.evaluate(()=>sessionStorage.getItem('chorus.mcp.sit.v1'));assert.ok(sit);
 const full='Preserve the full source-to-sink review contract.\n'.repeat(230)+'FINAL_RULE_PRESERVED';
 const response=await page.evaluate(async({sit,full})=>{
  const r=await fetch(`/mcp/${sit}`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'chorus_sitting',arguments:{contract:full,merge:full}}})});return r.json();
 },{sit,full});assert.ok(!response.error&&!response.result?.isError);
 await page.goto(base+'/experiments');await page.getByRole('button',{name:/Browser persistence check/}).click();
 await page.getByText(/Recorded checkpoints/).click();await page.getByRole('button',{name:/Host checkpoint/}).last().click();
 await page.getByRole('button',{name:'Use artifact as baseline',exact:true}).click();assert.equal(await page.getByLabel('Original artifact').inputValue(),full);
 const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export complete experiment',exact:true}).click();
 const stream=await (await exported).createReadStream();let contents='';for await(const chunk of stream)contents+=chunk;const backup=JSON.parse(contents);
 assert.ok(backup.checkpoints.some(c=>c.payload.merge===full));assert.ok(backup.checkpoints.every(c=>!c.payload.lock));
 pass('New child sitting and full checkpoint export preserve data beyond character 8000');
 await page.getByLabel('Original artifact').fill('x'.repeat(24001));assert.equal((await page.getByLabel('Original artifact').inputValue()).length,24001);
 assert.equal(await page.getByRole('button',{name:/Freeze comparison plan/}).isDisabled(),true);await page.getByLabel('Original artifact').fill(full);
 pass('Over-limit prompts are not silently truncated by the browser');
 await page.screenshot({path:out+'/experiments-desktop.png',fullPage:true});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true}),second=await mobile.newPage();
 second.on('pageerror',e=>errors.push(e.message));await second.goto(base+'/experiments');
 await second.getByLabel('Restore with recovery key').fill(recovery);await second.getByRole('button',{name:'Unlock saved experiments',exact:true}).click();
 await second.getByRole('button',{name:/Browser persistence check/}).click();await second.getByText(/Recorded checkpoints/).click();
 await second.getByRole('button',{name:/Host checkpoint/}).last().click();assert.ok((await second.textContent('body')).includes('FINAL_RULE_PRESERVED'));
 assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await second.screenshot({path:out+'/experiments-mobile.png',fullPage:true});
 pass('A separate mobile browser restores the vault and complete saved checkpoint without overflow');
 // Client orchestration checks use a mocked API only. Real SQL/runner execution is tested separately.
 const policy={model:'synthetic-ui-model',outputTokens:1200,inputUsdPerMillion:1,outputUsdPerMillion:2,dailyUsd:5,timeoutMs:40000};
 let comparison;let seen=[];let release;let paused=false;
 await context.route('**/api/experiments',async route=>{
  const request=route.request();if(request.method()==='GET')return route.fulfill({json:{runner:{ready:true,policy},publicPilot:true}});
  const a=request.postDataJSON();
  if(a.action==='create_comparison') {comparison={id:crypto.randomUUID(),plan:makePlan(a,policy),status:'ready',next_ordinal:0,trials:[],plan_hash:'synthetic',baseline_hash:'synthetic',candidate_hash:'synthetic'};return route.fulfill({json:{id:comparison.id}});}
  if(!comparison||a.comparisonId!==comparison.id)return route.continue();
  if(a.action==='resume'){paused=false;comparison.status='ready';return route.fulfill({json:{resumed:true}});}
  if(a.action==='pause'){paused=true;comparison.status='paused';return route.fulfill({json:{paused:true}});}
  if(a.action==='next_trial'){
   assert.equal(a.expectedOrdinal,comparison.next_ordinal);seen.push(a.expectedOrdinal);
   if(seen.length===1)await new Promise(r=>{release=r;});
   const ordinal=comparison.next_ordinal++;
   comparison.trials.push({id:crypto.randomUUID(),ordinal,case_id:'web-01',repetition:1,side:ordinal?'candidate':'baseline',status:ordinal?'invalid':'completed',assessment:ordinal?null:{status:'scored',tp:0,fp:0,fn:1,exact:false}});
   comparison.status=ordinal?'needs_review':paused?'paused':'ready';
  } else if(a.action!=='results')return route.continue();
  return route.fulfill({json:{...comparison,report:comparisonReport(comparison.trials,comparison.plan.maxCalls)}});
 });
 await page.reload();await page.getByRole('button',{name:/Browser persistence check/}).click();
 await page.getByLabel('Original artifact').fill('Review the supplied source.');await page.getByLabel('Revised artifact').fill('Trace visible source-to-sink paths and acknowledge missing context.');
 await page.getByLabel('What should this change improve?').fill('Reduce unsupported findings without increasing missed vulnerabilities.');
 await page.getByLabel('Operator execution key').fill('synthetic-operator-not-a-provider-secret');
 await page.getByRole('button',{name:/Freeze comparison plan/}).click();await page.getByRole('button',{name:'Start / resume paid evaluation',exact:true}).waitFor();
 assert.equal(seen.length,0);pass('Freezing a plan does not execute a model call');
 await page.getByRole('button',{name:'Start / resume paid evaluation',exact:true}).click();
 for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,50));assert.ok(release);
 assert.equal(await page.getByRole('button',{name:'Start / resume paid evaluation',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Pause after active call',exact:true}).click();
 for(let i=0;i<100&&!paused;i++)await new Promise(r=>setTimeout(r,20));assert.ok(paused);release();
 await page.waitForFunction(()=>document.body.textContent.includes('State: paused'));
 assert.deepEqual(seen,[0]);
 await page.getByRole('button',{name:'Start / resume paid evaluation',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('State: needs_review'));
 assert.deepEqual(seen,[0,1]);assert.equal(await page.getByRole('button',{name:'Start / resume paid evaluation',exact:true}).isDisabled(),true);
 pass('Mocked client run prevents duplicate starts, pauses after the active call and stops on invalid output');
 assert.deepEqual(errors,[]);pass('No browser runtime errors were observed');
 await writeFile(out+'/browser-summary.json',JSON.stringify({status:'PASS',passed,realModelCalls:0,storageApi:'real isolated development database',clientRunnerApi:'mocked explicitly'},null,2));
} finally {await browser.close();}
