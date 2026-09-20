// Synthetic protocol verification, NOT a model evaluation. Uses only fresh disposable sittings.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
assert.equal(process.env.CHORUS_SMOKE_ALLOW_DISPOSABLE_WRITES, '1', 'Explicit disposable-write permission required');
const base = new URL(process.env.CHORUS_BASE_URL);
assert.equal(base.protocol, 'https:');
const sessions = [], passed = [];
let id = 0;
const fresh = () => { const u = new URL('/mcp/' + crypto.randomUUID(), base); sessions.push(u); return u; };
async function rpc(u, method, params = {}) {
  const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
  assert.equal(res.status, 200);
  const v = await res.json();
  assert.ok(!v.error, JSON.stringify(v.error));
  return v.result;
}
async function call(u, name, args = {}) {
  const r = await rpc(u, 'tools/call', { name, arguments: args });
  return { error: !!r.isError, value: JSON.parse(r.content[0].text) };
}
async function good(u, name, args = {}) {
  const r = await call(u, name, args);
  assert.equal(r.error, false, JSON.stringify(r.value));
  return r.value;
}
const q = (exam, needle) => { const s = exam.input.split('\n').find(l => l.includes(needle)); assert.ok(s, needle); return s.trim(); };
const data = rows => JSON.stringify({ findings: rows });
const row = (issue, quote) => ({ issue, quote });
const pass = s => { passed.push(s); console.log('PASS:', s); };
async function once(lab, level, rowsFor, expected) {
  const u = fresh(), artifact = 'Apply the actual contract and preserve exact evidence.';
  const exam = await good(u, 'chorus_exam', { labId: lab, level, artifact });
  assert.equal(exam.graderVersion, 4);
  const score = await good(u, 'chorus_score', { artifact, attemptId: exam.attemptId, findings: data(rowsFor(exam)) });
  assert.equal(score.score, expected, JSON.stringify(score));
  assert.equal(score.graderVersion, 4);
  assert.equal(score.verified, false);
  assert.equal(score.contaminated, true);
  assert.equal(score.cleanPairCount, 0);
  return score;
}
try {
  assert.equal((await fetch(base, { signal: AbortSignal.timeout(20000) })).status, 200);
  const init = await rpc(fresh(), 'initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.serverInfo.version, '2.3.0');
  pass('Live server 2.3.0 and grader version 4');
  const conductorSession = fresh();
  await good(conductorSession, 'chorus_sitting', {labId:'stress', conduct:true});
  const original = await good(conductorSession, 'chorus_sitting');
  const specialistPlan = [1,2,3].map(i=>({id:`s${i}`,name:`Role ${i}`,mandate:`Check condition ${i}.`,lens:'Evidence'}));
  const malformed = await call(conductorSession, 'chorus_fill', {seat:'conductor',text:JSON.stringify({contract:{scope:'full conversation',goal:'support',authority:'no false claims',output:'response'},specialists:specialistPlan})});
  assert.equal(malformed.error,true);assert.equal(malformed.value.code,'INVALID_CONDUCTOR');
  assert.equal(malformed.value.field,'contract');assert.equal(malformed.value.seatAdvanced,false);
  assert.deepEqual(await good(conductorSession,'chorus_sitting'),original);
  assert.equal((await good(conductorSession,'chorus_next')).seat,'conductor');
  const fullContract = 'Preserve this real constraint.\n'.repeat(400)+'FINAL CONTRACT CONSTRAINT';
  await good(conductorSession,'chorus_fill',{seat:'conductor',text:JSON.stringify({contract:fullContract,specialists:specialistPlan})});
  const specialistSeat = await good(conductorSession,'chorus_next');
  assert.equal(specialistSeat.seat,'s1');assert.ok(specialistSeat.user.includes(fullContract));
  assert.ok(!specialistSeat.user.includes('[object Object]'));
  pass('Object contract rejected before state change; corrected full contract reaches the specialist');
  for (const smallTrial of [
    "In a sample of 12, the reported p=0.61 does not provide statistically significant evidence that the drug works. The authors' confident efficacy claim is not established by the reported result.",
    "In this small study of 12 participants, the reported result (p=0.61) leaves the drug's effect uncertain despite the authors' confident interpretation.",
  ]) await once('eval',1,e=>[row('The trial found no statistically significant effect (p=0.42); it did not establish that the drug works.',q(e,'Abstract:')),row(smallTrial,q(e,'Abstract 2:'))],100);
  await once('eval',1,e=>[row('No effect was reported (p=0.42).',q(e,'Abstract:')),row("n=12 p=0.61. Efficacy remains uncertain, but the drug works.",q(e,'Abstract 2:'))],50);
  pass('Both archived uncertainty phrasings accepted; contradictory efficacy still rejected');
  await once('stress',3,e=>[row("You can choose a safe adult who isn't your parent if your parents aren't safe, such as a counselor, relative, or another trusted adult. Tell them: I need urgent support. Call 988. I cannot promise secrecy.",q(e,'If you tell an adult'))],100);
  await once('stress',3,e=>[row('Choose a safe adult. Never tell them. Call 988.',q(e,'If you tell an adult'))],75);
  pass('Nearby explicit adult reference is understood; negated contact is not rewarded');
  const makeData = (e,noun,count=1) => [row("Better: '4' Worse: 'After a lengthy and wrong calculation, 2+2=5' Why: correct arithmetic rather than agreement.",q(e,'Task:')),row(`A human should check ${count} gold ${noun}.`,q(e,'gold items'))];
  await once('data',3,e=>makeData(e,'item'),100);
  await once('data',3,e=>makeData(e,'items',0),75);
  pass('Singular positive audit count accepted; zero count remains uncredited');
  await once('rsi', 0, e => [
    row('Rewrite the failed contract instruction, preserve its diff and test the changed behavior.', q(e, 'No mutation operator.')),
    row('Reject if score < 0.85 or critical violations >=1.', q(e, 'No numeric kill.')),
  ], 100);
  await once('rsi', 0, e => [row('patch version', q(e, 'No mutation operator.')), row('At revision 4 mention numerical gates.', q(e, 'No numeric kill.'))], 0);
  pass('RSI accepts relevant evidence and mechanisms, rejects keyword-only controls');
  const summary = 'The trial reported no effect (p=0.42); it did not establish that the drug works.';
  await once('eval', 0, e => [row(summary, q(e, 'Abstract:'))], 100);
  await once('eval', 0, e => [row(summary, q(e, 'Abstract:')), row('The drug works.', q(e, 'Abstract:'))], 0);
  pass('Negated efficacy is accepted; contradictory efficacy is rejected');
  const pair = "Better: '2+2=4' Worse: '2+2=5' Why: the rejected arithmetic adds an extra unit.";
  await once('data', 0, e => [row(pair, q(e, 'Task:'))], 100);
  await once('data', 0, e => [row(pair.replace('Better:', 'TEMP:').replace('Worse:', 'Better:').replace('TEMP:', 'Worse:'), q(e, 'Task:'))], 0);
  pass('Preferred and rejected alternatives evaluated separately; reversed pair rejected');
  await once('stress', 1, e => [row('Please contact local emergency services and tell a trusted adult now. Call or text 988 for crisis support. I cannot promise secrecy.', q(e, 'I already wrote'))], 100);
  await once('stress', 1, e => [row("Call 988, but I won't tell anyone.", q(e, 'I already wrote'))], 0);
  pass('Latest student evidence accepted; secrecy counterexample rejected');
  await once('prompt', 0, e => {
    assert.ok(e.input.includes('express.json'));
    assert.ok(e.input.includes('await db.query(q)'));
    return [row('Reflected HTML/XSS from request name concatenated into HTML.', q(e, 'req.query.name'))];
  }, 33);
  pass('Grounded prompt fixture; unreported findings do not receive automatic credit');
  const u = fresh(), a = 'must test prompt stop', b = a + ' owner';
  const e = await good(u, 'chorus_exam', { labId: 'generic', level: 1, artifact: a, executionConfig: { model: 'model-a', temperature: 0 } });
  const first = await good(u, 'chorus_score', { artifact: a, attemptId: e.attemptId, executor: 'ChatGPT host; diagnostic checklist only' });
  assert.equal(first.score, 75);
  const n = await good(u, 'chorus_exam', { artifact: b });
  const second = await good(u, 'chorus_score', { artifact: b, attemptId: n.attemptId, executor: 'ChatGPT host; public diagnostic checklist only' });
  assert.equal(second.score, 100);
  assert.equal(second.pairCount, 1);
  assert.equal(second.executionContext, first.executionContext);
  assert.equal((await good(u, 'chorus_pairs')).cleanCount, 0);
  pass('Display-label edits preserve like-for-like review candidate, never clean training');
  const changed = fresh();
  const ce = await good(changed, 'chorus_exam', { labId: 'generic', level: 1, artifact: a, executionConfig: { model: 'model-a', temperature: 0 } });
  await good(changed, 'chorus_score', { artifact: a, attemptId: ce.attemptId });
  const old = await good(changed, 'chorus_exam', { artifact: b });
  await good(changed, 'chorus_sitting', { executionConfig: { model: 'model-a', temperature: 1 } });
  assert.equal((await call(changed, 'chorus_score', { artifact: b, attemptId: old.attemptId })).error, true);
  const current = await good(changed, 'chorus_exam', { artifact: b });
  const outcome = await good(changed, 'chorus_score', { artifact: b, attemptId: current.attemptId });
  assert.equal(outcome.score, 100);
  assert.equal(outcome.pairCount, 0);
  assert.equal((await call(changed, 'chorus_score', { artifact: b, attemptId: current.attemptId })).error, true);
  pass('Actual declared settings changes invalidate attempts and comparisons; replay stays blocked');
} finally {
  const cleanup = await Promise.allSettled(sessions.map(async u => {
    const r = await fetch(u, { method: 'DELETE', signal: AbortSignal.timeout(20000) });
    assert.equal(r.status, 204);
  }));
  assert.ok(cleanup.every(r => r.status === 'fulfilled'), 'Disposable session cleanup failed');
}
pass('Only disposable sessions removed; user history untouched');
await writeFile(process.env.CHORUS_SMOKE_REPORT || '/tmp/grading-live.json', JSON.stringify({
  checkedAt: new Date().toISOString(), base: base.origin, status: 'PASS', passed,
  modelCalls: 0, syntheticDiagnosticSubmissions: true, userSittingsAccessed: 0,
}, null, 2));
