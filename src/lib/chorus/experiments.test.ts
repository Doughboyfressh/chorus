import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { makePlan,requestFor,reservationMicro,canonical,safeSnapshot,WORKSPACE_KEY } from './experiments/contracts.ts';
import { PILOT_CASES,assessPilot,comparisonReport } from './experiments/pilot.ts';
import { authorizeRunner,runnerConfiguration } from './experiments/runner.ts';
const policy={model:'operator-pinned-model',outputTokens:1200,inputUsdPerMillion:1,outputUsdPerMillion:2,dailyUsd:5,timeoutMs:40000};
const args={baseline:'Inspect this code carefully.',candidate:'Inspect every source-to-sink path and acknowledge missing context.',hypothesis:'Reduce false-positive labels without missing the demonstrated cases.',repeats:2,maxUsd:2};
const answer=(c:typeof PILOT_CASES[number])=>JSON.stringify({findings:c.expected.map(e=>({...e,reason:'The visible untrusted input reaches this unprotected sink.'})),limitations:c.contextLimited?['The renderUserHtml implementation is not present.']:[]});
describe('frozen comparison plan and private credentials',()=>{
  it('uses fixed public data, equal repetitions and balanced side ordering',()=>{
    const p=makePlan(args,policy);assert.equal(p.maxCalls,32);assert.equal(p.exposure,'public');
    for(let i=0;i<8;i++)for(let r=1;r<=2;r++)assert.deepEqual(new Set(p.schedule.filter(t=>t.caseIndex===i&&t.repetition===r).map(t=>t.side)),new Set(['baseline','candidate']));
    assert.notEqual(p.schedule[0].side,p.schedule[2].side);
  });
  it('never gives the candidate the baseline output or grader expectations',()=>{
    const p=makePlan(args,policy),req=requestFor(p,1);assert.equal(req.messages.length,2);assert.equal(req.messages[0].content,args.candidate);
    assert.ok(!JSON.stringify(req).includes('expected'));assert.equal(req.max_completion_tokens,1200);assert.equal(req.store,false);
  });
  it('rejects duplicates, invalid budgets and excessive repeats',()=>{
    assert.throws(()=>makePlan({...args,candidate:args.baseline},policy),/different/);
    for(const maxUsd of [0,-1,Infinity,26,'nonsense'])assert.throws(()=>makePlan({...args,maxUsd},policy));
    for(const repeats of [0,4,1.5,'1'])assert.throws(()=>makePlan({...args,repeats},policy));
  });
  it('canonical hashes survive JSONB key ordering',()=>assert.equal(canonical({a:1,b:{x:2,y:3}}),canonical({b:{y:3,x:2},a:1})));
  it('never serializes provider keys from a client snapshot',()=>{
    const s=safeSnapshot({artifact:'keep',slot:{apiKey:'secret',model:'declared'},lock:'secret',x:[{token:'secret',output:'keep'}]});
    assert.ok(!s.includes('secret'));assert.ok(s.includes('declared'));assert.ok(s.includes('keep'));
  });
  it('does not call itself configured without explicit keys/model/budget',()=>assert.equal(runnerConfiguration({}).ready,false));
  it('rejects missing and wrong operator keys, including multibyte inputs',()=>{
    const env={CHORUS_RUNNER_ENABLED:'true',CHORUS_RUNNER_API_KEY:'a'.repeat(32),CHORUS_RUNNER_ACCESS_KEY:'b'.repeat(32),CHORUS_RUNNER_MODEL:policy.model,CHORUS_RUNNER_INPUT_USD_PER_MILLION:'1',CHORUS_RUNNER_OUTPUT_USD_PER_MILLION:'2',CHORUS_RUNNER_DAILY_USD:'5'};
    assert.equal(authorizeRunner(env,'b'.repeat(32)).model,policy.model);
    for(const key of [null,'wrong','é'.repeat(32)])assert.throws(()=>authorizeRunner(env,key),/execution key/);
  });
  it('uses byte-aware conservative reservations and fixed output limits',()=>{
    const p=makePlan(args,policy);assert.ok(reservationMicro(requestFor(p,0),policy)>2400);
    assert.ok(reservationMicro({text:'😀'},policy)>reservationMicro({text:'a'},policy));
    assert.equal(WORKSPACE_KEY.test('cv_'+'f'.repeat(64)),true);
  });
});
describe('public pilot grader positive and negative calibration',()=>{
  for(const c of PILOT_CASES)it(`${c.id}: explicit reference meets the category/evidence contract`,()=>{
    const a=assessPilot(c,answer(c));assert.equal(a.status,'scored');assert.equal(a.exact,true);
  });
  it('records absent findings on vulnerable code as missed labels, not a passing empty answer',()=>{
    const a=assessPilot(PILOT_CASES[0],'{"findings":[],"limitations":[]}');assert.equal(a.fn,1);assert.equal(a.exact,false);
  });
  it('counts invented evidence and findings on safe code as false positives',()=>{
    const out=JSON.stringify({findings:[{category:'xss',quote:'invented',reason:'An explanation with enough text.'}],limitations:[]});
    assert.equal(assessPilot(PILOT_CASES[1],out).fp,1);assert.equal(assessPilot(PILOT_CASES[0],out).tp,0);
  });
  it('does not give a numeric score to malformed or duplicated output',()=>{
    assert.equal(assessPilot(PILOT_CASES[0],'bad').status,'invalid');
    const v=JSON.parse(answer(PILOT_CASES[0]));v.findings.push(v.findings[0]);assert.equal(assessPilot(PILOT_CASES[0],JSON.stringify(v)).status,'invalid');
  });
  it('missing-context case requires an explicit limitation, not a fabricated vulnerability',()=>assert.equal(assessPilot(PILOT_CASES[7],'{"findings":[],"limitations":[]}').exact,false));
  it('incomplete reports never announce a completed independent improvement',()=>{
    const r=comparisonReport([],16);assert.equal(r.complete,false);assert.equal(r.cleanTrainingEligible,false);assert.equal(r.baseline.recall,null);
  });
  it('compares only matched case/repetition pairs and preserves errors separately',()=>{
    const good=assessPilot(PILOT_CASES[0],answer(PILOT_CASES[0])),bad=assessPilot(PILOT_CASES[0],'{"findings":[],"limitations":[]}');
    const r=comparisonReport([{ordinal:0,side:'baseline',case_id:'x',repetition:1,status:'completed',assessment:bad},{ordinal:1,side:'candidate',case_id:'x',repetition:1,status:'completed',assessment:good},{ordinal:2,side:'candidate',case_id:'other',repetition:2,status:'invalid'}],4);
    assert.deepEqual(r.paired,{wins:1,losses:0,ties:0});assert.equal(r.invalidOrFailed,1);assert.equal(r.complete,false);
  });
});

import { checkpointArtifact } from './experiments/contracts.ts';
it('checkpoint extraction chooses the full new synthesis, not the old scored artifact',()=>{
 const full='Complete new rule '.repeat(600);
 assert.equal(checkpointArtifact({current:'old artifact',orchestra:{filled:{synthesizer:JSON.stringify({deliverable:full})}}}),full);
 assert.equal(checkpointArtifact({current:'old artifact',orchestra:{filled:{synthesizer:'{"deliverable":"incomplete'}}}), '');
 assert.equal(checkpointArtifact({merge:full}),full);
 assert.equal(checkpointArtifact({synthesis:{deliverable:full}}),full);
});
