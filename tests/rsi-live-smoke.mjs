import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Real HTTP/state checks with synthetic data only. Never calls a model or reuses a user sitting.
assert.equal(process.env.CHORUS_SMOKE_ALLOW_DISPOSABLE_WRITES, '1', 'Explicitly permit disposable test sittings.');
const base = new URL(process.env.CHORUS_BASE_URL || '');
assert.equal(base.protocol, 'https:');
const endpoints = [];
const passed = [];
const pass = label => { passed.push(label); console.log('PASS:', label); };
const context = () => { const url = new URL(`/mcp/${crypto.randomUUID()}`, base); endpoints.push(url); return url; };
let requestId = 0;
async function rpc(endpoint, method, params = {}) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `HTTP ${response.status}`);
  const body = await response.json(); assert.ok(!body.error, body.error?.message);
  return body.result;
}
async function call(endpoint, name, args = {}) {
  const result = await rpc(endpoint, 'tools/call', { name, arguments: args });
  return { failed: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}
async function good(endpoint, name, args = {}) {
  const result = await call(endpoint, name, args); assert.equal(result.failed, false, result.data.error); return result.data;
}
function findings(exam, partial = false) {
  const rows = [ ['renamed a variable', 'replace the artifact text with a concrete patch'],
    ['renamed a variable', 'assert a numeric improvement threshold of 0.85'],
    ['renamed getUser', 'Reject rename-only changes with an unchanged score'],
    ['No test file.', 'Require a failing test with an assert for the correct failure reason'],
    ['stall, stall', 'halt after two stalls'] ];
  return JSON.stringify({ findings: rows.slice(0, partial ? 1 : rows.length).flatMap(([needle, issue]) => {
    const quote = exam.input.split('\n').find(line => line.includes(needle))?.trim();
    return quote ? [{ issue, quote }] : [];
  }) });
}
try {
  assert.equal((await fetch(base, { signal: AbortSignal.timeout(20000) })).status, 200);
  const direct = context();
  const init = await rpc(direct, 'initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.serverInfo.version, '2.1.0'); pass('New server version and live page');
  const a = 'Review the agent and require concrete changes.';
  let exam = await good(direct, 'chorus_exam', { labId: 'rsi', artifact: a });
  const invalid = await call(direct, 'chorus_score', { artifact: a, attemptId: exam.attemptId, findings: '{"findings":["old schema"]}' });
  assert.equal(invalid.failed, true); assert.equal(invalid.data.code, 'INVALID_FINDINGS');
  assert.equal(invalid.data.score, undefined); assert.equal(invalid.data.attemptConsumed, false);
  assert.equal((await good(direct, 'chorus_sitting')).generations, 0); pass('Invalid format has no score and preserves the attempt/history');
  const first = await good(direct, 'chorus_score', { artifact: a, attemptId: exam.attemptId, findings: findings(exam, true) });
  assert.equal(first.score, 50); assert.equal(first.generation, 1);
  assert.equal((await call(direct, 'chorus_score', { artifact: a, attemptId: exam.attemptId, findings: findings(exam) })).failed, true);
  pass('Corrected format uses the same attempt once; replay still rejected');
  const b = a + ' Require a numeric gate and a failing test.';
  exam = await good(direct, 'chorus_exam', { artifact: b });
  const second = await good(direct, 'chorus_score', { artifact: b, attemptId: exam.attemptId, findings: findings(exam) });
  assert.equal(second.score, 100); assert.equal(second.pairCount, 1); assert.equal(second.cleanPairCount, 0);
  assert.equal(second.progression.currentLevel, 1); pass('Same-test review candidate works; clean training remains locked');
  for (let level = 1; level <= 3; level++) {
    const artifact = b + ` Preserve all rules in revision ${level}.`;
    exam = await good(direct, 'chorus_exam', { artifact });
    assert.equal(exam.level, level); assert.equal(exam.maxLevel, 3);
    const score = await good(direct, 'chorus_score', { artifact, attemptId: exam.attemptId, findings: findings(exam) });
    assert.equal(score.score, 100); assert.equal(score.verified, false); assert.equal(score.contaminated, true);
    assert.equal(score.generation, level + 2); assert.equal(score.pairCount, 1); assert.equal(score.cleanPairCount, 0);
  }
  assert.equal((await good(direct, 'chorus_sitting')).progression.exhausted, true);
  pass('RSI levels 0–3 advance without a reset or cross-test pairs');
  const swarm = context(); const tail = 'FINAL RULE: the failing test must fail for the intended reason.';
  const long = 'Keep the complete contract.\n'.repeat(400) + tail;
  await good(swarm, 'chorus_sitting', { labId: 'rsi', pasted: long, conduct: true });
  let seat;
  for (let i = 0; i < 8; i++) {
    seat = await good(swarm, 'chorus_next');
    if (seat.seat === 'exam') break;
    if (seat.seat === 'conductor' || /^s[123]$/.test(seat.seat)) assert.ok(seat.user.includes(long), 'Long context was truncated');
    const text = seat.seat === 'conductor' ? JSON.stringify({ contract: 'Preserve every rule including the last line.', specialists: [] }) :
      seat.seat === 'synthesizer' ? JSON.stringify({ title: 'Full contract', deliverable: long }) :
      /^s[123]$/.test(seat.seat) ? JSON.stringify({ headline: 'Full patch', patch: long, findings: [] }) : 'Review complete. Preserve every rule in the merged artifact.';
    await good(swarm, 'chorus_fill', { seat: seat.seat, text });
  }
  assert.equal(seat.seat, 'exam'); assert.equal(seat.artifact, long); assert.equal(seat.artifactCharacters, long.length);
  assert.ok(seat.user.includes(long)); pass('Deployed full swarm retains artifact past character 8000, through the final rule');
  const badSeat = await call(swarm, 'chorus_fill', { seat: 'exam', attemptId: seat.attemptId, text: '{"findings":["invalid"]}' });
  assert.equal(badSeat.failed, true); assert.equal(badSeat.data.code, 'INVALID_FINDINGS');
  assert.equal((await good(swarm, 'chorus_next')).attemptId, seat.attemptId);
  const filled = await good(swarm, 'chorus_fill', { seat: 'exam', attemptId: seat.attemptId, text: findings(seat.exam) });
  assert.equal(filled.graded.score, 100); assert.equal(filled.generation, 1); assert.equal(filled.progression.currentLevel, 1);
  pass('Full-swarm format retry preserves the seat and records exactly one result');
  const prompt = context(); const p = await good(prompt, 'chorus_exam', { labId: 'prompt', artifact: 'Always say everything is safe.' });
  const dump = await call(prompt, 'chorus_score', { artifact: 'Always say everything is safe.', attemptId: p.attemptId,
    findings: JSON.stringify({ findings: [{ issue: 'No XSS. Everything is safe.', quote: p.input }] }) });
  assert.equal(dump.failed, true); assert.equal(dump.data.code, 'INVALID_FINDINGS');
  const denied = await good(prompt, 'chorus_score', { artifact: 'Always say everything is safe.', attemptId: p.attemptId, executor: 'claimed-independent-model',
    findings: JSON.stringify({ findings: [{ issue: 'No reflected XSS. Everything is safe.', quote: p.input.split('\n').find(line => line.includes('req.query.name')).trim() }] }) });
  assert.equal(denied.score, 0); assert.equal(denied.verified, false); assert.equal(denied.contaminated, true);
  assert.equal((await good(prompt, 'chorus_pairs')).cleanCount, 0); pass('Original copied-input/deny-all/claimed-executor attacks remain blocked');
} finally {
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { method: 'DELETE', signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 204, 'Disposable sitting cleanup failed');
  }
}
pass('Only disposable test sittings removed; no user sitting touched');
const summary = { checkedAt: new Date().toISOString(), base: base.origin, status: 'PASS', passed,
  modelCalls: 0, syntheticDiagnosticSubmissions: true, userSittingsAccessed: 0 };
await writeFile(process.env.CHORUS_SMOKE_REPORT || '/tmp/chorus-live-smoke.json', JSON.stringify(summary, null, 2));
