import { unscoredSynthesis } from "./evaluation-state.ts";
import type { SwarmRun } from "./types.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMcp } from "./mcp.ts";
import { examFor, gradeArtifact } from "./grade.ts";
import { validateFindings, FindingsValidationError } from "./findings.ts";
import { readMerge } from "./artifact-text.ts";
import { applyFill, seatPrompt, startOrchestraState, mergeDeliverable } from "./orchestra.ts";
import { evaluateArtifact, synthesizeSwarm } from "./engine.ts";
import { resolveFixture, maxFixtureLevel } from "./fixtures.ts";
import { comparableDiagnostics } from "./integrity.ts";
import { formatArtifact } from "./ledger.ts";
import { sittingFor } from "./mcp-sitting.ts";

// These fixtures test transport/state invariants, not model quality or independent execution.
const artifact = "Review this agent and require concrete, testable changes.";
const empty = JSON.stringify({ findings: [] });
const session = () => `repair-${crypto.randomUUID()}`;
async function rpc(id: string, name: string, args: Record<string, unknown> = {}) {
  const result = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { sessionId: id, protocol: "2025-03-26" }) as { result: { content: { text: string }[]; isError: boolean } };
  return { isError: result.result.isError, value: JSON.parse(result.result.content[0].text) };
}
function diagnosticFindings(level: number, limit?: number) {
  const f = resolveFixture("rsi", level);
  return JSON.stringify({ findings: f.planted.slice(0, limit).map(p => ({ issue: ({mut_out: "Revise the contract rule and test its changed behavior.", kill_out: "Reject if score < 0.85 or critical violations >=1.", numeric2: "Reject the rename with unchanged score 41.", test_out: "Require a failing regression test with the intended assertion.", halt_out: "Halt after two consecutive stalls."} as Record<string,string>)[p.id],
    quote: f.input.split("\n").find(line => p.quote?.some(q => line.includes(q)))!.trim() })) });
}
async function fillToExam(id: string, deliverable: string) {
  await rpc(id, "chorus_sitting", { labId: "rsi", conduct: true });
  for (;;) {
    const next = await rpc(id, "chorus_next");
    assert.equal(next.isError, false, JSON.stringify(next.value));
    if (next.value.seat === "exam") return next.value;
    const text = next.value.seat === "synthesizer" ? JSON.stringify({ title: "Full contract", deliverable }) :
      next.value.seat === "conductor" || next.value.seat === "improver" ? JSON.stringify({ contract: "Preserve the complete contract and every constraint.", specialists: [1, 2, 3].map(i => ({ id: `s${i}`, name: `Role ${i}`, mandate: `Preserve constraint ${i}.`, lens: "Evidence" })) }) :
      "Complete this role without inventing execution evidence.";
    const filled = await rpc(id, "chorus_fill", { seat: next.value.seat, text });
    assert.equal(filled.isError, false, JSON.stringify(filled.value));
  }
}

describe("findings failures are not scores", () => {
  const invalid: [string, unknown][] = [
    ["missing", undefined], ["empty text", ""], ["raw prose", "everything is safe"],
    ["truncated JSON", '{"findings":['], ["string rows", '{"findings":["rule"]}'],
    ["extra metadata", '{"findings":[{"issue":"rule","quote":"source line","severity":"high"}]}'],
    ["missing quote", '{"findings":[{"issue":"rule"}]}'],
    ["wrong envelope", '{"clean":true,"coverage_receipt":[]}'],
    ["whole-input quote", JSON.stringify({ findings: [{ issue: "rule", quote: "first line\nsecond line" }] })],
    ["mixed valid and invalid rows", '{"findings":[{"issue":"rule","quote":"source line"},"bad"]}'],
  ];
  for (const [label, text] of invalid) it(`rejects ${label} with a field-specific format error`, () => {
    assert.throws(() => validateFindings(text), (err: unknown) =>
      err instanceof FindingsValidationError && err.code === "INVALID_FINDINGS" && err.field.startsWith("findings"));
  });
  it("keeps an explicit no-findings result as a real zero", () => {
    const result = gradeArtifact({ labId: "rsi", deliverable: artifact, findings: empty });
    assert.equal(result.score, 0); assert.equal(result.submissionStatus, "scored");
    assert.equal(result.verified, false); assert.equal(result.contaminated, true);
  });
  it("does not silently adapt a native reviewer report or invent its missing quote", () => {
    const report = JSON.stringify({ findings: [{ id: "CWE-89", severity: "high", file: "app.ts", line_start: 1,
      source: "query parameter", sink: "database", exploit_trigger: "a crafted query", verify: "test it" }] });
    assert.throws(() => gradeArtifact({ labId: "prompt", deliverable: artifact, findings: report }), /unexpected fields/);
  });
  it("returns an actionable MCP error and preserves attempt, artifact and generation", async () => {
    const id = session(); const exam = (await rpc(id, "chorus_exam", { labId: "rsi", artifact })).value;
    for (const [, findings] of invalid) {
      const failed = await rpc(id, "chorus_score", { artifact, attemptId: exam.attemptId, findings });
      assert.equal(failed.isError, true); assert.equal(failed.value.code, "INVALID_FINDINGS");
      assert.equal(failed.value.attemptConsumed, false); assert.equal(failed.value.score, undefined);
      assert.equal((await rpc(id, "chorus_sitting")).value.generations, 0);
      assert.equal((await sittingFor(id)).exam?.artifact, artifact);
    }
    const scored = await rpc(id, "chorus_score", { artifact, attemptId: exam.attemptId, findings: empty });
    assert.equal(scored.isError, false); assert.equal(scored.value.score, 0); assert.equal(scored.value.generation, 1);
    assert.equal((await rpc(id, "chorus_score", { artifact, attemptId: exam.attemptId, findings: empty })).isError, true);
  });
  it("API model failures and malformed output return an error without a score", async () => {
    for (const response of [{ ok: false as const, error: "provider unavailable" }, { ok: true as const, text: '{"findings":["bad"]}' }]) {
      const result = await evaluateArtifact({ labId: "rsi", title: "Test", deliverable: artifact, goal: "Review the agent" }, async () => response);
      assert.equal(result.ok, false); assert.equal("score" in result, false);
    }
  });
});

describe("complete artifact preservation", () => {
  const tail = "END-CONTRACT: the test must fail for the intended reason.";
  const long = "A complete unchanged rule.\n".repeat(710) + tail;
  it("retains complete prior/current artifacts in browser recursion context", () => {
    const context = formatArtifact({ origin: long, current: long + " Updated contract." });
    assert.ok(context.includes(long)); assert.ok(context.includes(long + " Updated contract."));
  });
  it("preserves long seed text in conductor, specialist and improver prompts", () => {
    assert.ok(long.length > 8000 && long.length <= 24000);
    const orch = startOrchestraState({ labId: "rsi", pasted: long });
    assert.equal(orch.pasted, long);
    for (const seat of ["conductor", "s1", "improver"] as const) assert.ok(seatPrompt(orch, seat).user.includes(long));
  });
  it("preserves JSON-escaped completions larger than 24000 characters without shortening the artifact", () => {
    const escaped = '"\n'.repeat(6500) + tail;
    const text = JSON.stringify({ title: "Quoted contract", deliverable: escaped });
    assert.ok(text.length > 24000 && escaped.length < 24000);
    const orch = applyFill(startOrchestraState({ labId: "rsi" }), "synthesizer", text);
    assert.equal(orch.filled.synthesizer, text); assert.equal(mergeDeliverable(orch), escaped);
    assert.ok(seatPrompt(orch, "exam").user.includes(escaped));
  });
  it("bounds artifacts without repairing truncated synthesis JSON", () => {
    assert.throws(() => readMerge('{"deliverable":"unfinished'), /Incomplete or invalid/);
    assert.throws(() => readMerge(JSON.stringify({ deliverable: "x".repeat(24001) })), /artifact/);
    assert.throws(() => startOrchestraState({ pasted: "x".repeat(24001) }), /artifact/);
  });
  it("API execution receives the entire artifact including its final rule", async () => {
    let system = "";
    const result = await evaluateArtifact({ labId: "rsi", title: "Full", deliverable: long, goal: "Review the agent" }, async args => {
      system = args.system ?? ""; return { ok: true, text: empty };
    });
    assert.equal(result.ok, true); assert.ok(system.includes(long));
  });
  it("API synthesis does not pass a truncated draft off as the full deliverable", async () => {
    const result = await synthesizeSwarm({ goal: "Review the agent completely", contract: "Complete work", whyThisSplit: "Different lenses", specialists: [],
      critique: { verdict: "review", holes: [], keep: [], kill: [] } }, async () => ({ ok: true, text: '{"deliverable":"unfinished' }));
    assert.equal(result.ok, false); assert.equal("deliverable" in result, false);
  });
  it("accepts a heavily escaped full artifact through the actual MCP completion boundary", async () => {
    const escaped = '\"\n'.repeat(11000) + "FULL END";
    assert.ok(JSON.stringify({ deliverable: escaped }).length > 32000);
    const exam = await fillToExam(session(), escaped);
    assert.equal(exam.artifact, escaped);
  });
  it("returns isError on an out-of-order seat submission", async () => {
    const id = session(); await rpc(id, "chorus_sitting", { labId: "rsi", conduct: true });
    assert.equal((await rpc(id, "chorus_fill", { seat: "exam", text: empty })).isError, true);
    assert.equal((await rpc(id, "chorus_sitting")).value.orchestra.pending, "conductor");
  });
  it("full swarm exposes the exact frozen artifact; format retry does not wipe or advance it", async () => {
    const id = session(); const exam = await fillToExam(id, long);
    assert.equal(exam.artifact, long); assert.equal(exam.artifactCharacters, long.length);
    assert.ok(exam.user.includes(long)); assert.equal((await sittingFor(id)).exam?.artifact, long);
    const failed = await rpc(id, "chorus_fill", { seat: "exam", attemptId: exam.attemptId, text: '{"findings":["old format"]}' });
    assert.equal(failed.isError, true); assert.equal(failed.value.code, "INVALID_FINDINGS");
    const after = (await rpc(id, "chorus_sitting")).value;
    assert.equal(after.generations, 0); assert.equal(after.orchestra.pending, "exam");
    assert.equal((await rpc(id, "chorus_next")).value.attemptId, exam.attemptId);
    const scored = await rpc(id, "chorus_fill", { seat: "exam", attemptId: exam.attemptId, text: diagnosticFindings(0) });
    assert.equal(scored.isError, false); assert.equal(scored.value.graded.score, 100);
    assert.equal(scored.value.progression.currentLevel, 1); assert.equal(scored.value.generation, 1);
    assert.equal((await sittingFor(id)).scores[0].artifact, long);
    const next = await fillToExam(id, long + "\nRetain all frozen rules.");
    assert.equal(next.exam.level, 1); assert.ok(next.artifact.endsWith("Retain all frozen rules."));
  });
});

describe("RSI progression with quarantine intact", () => {
  it("climbs every actual RSI level without resetting or discarding history", async () => {
    const id = session(); const max = maxFixtureLevel("rsi"); assert.equal(max, 3);
    for (let level = 0; level <= max; level++) {
      const exam = (await rpc(id, "chorus_exam", { labId: "rsi", artifact: artifact + ` Version ${level}` })).value;
      assert.equal(exam.level, level); assert.equal(exam.maxLevel, max);
      const scored = (await rpc(id, "chorus_score", { artifact: artifact + ` Version ${level}`, attemptId: exam.attemptId,
        findings: diagnosticFindings(level), executor: "claimed-independent-evaluator" })).value;
      assert.equal(scored.score, 100); assert.equal(scored.verified, false); assert.equal(scored.contaminated, true);
      assert.equal(scored.generation, level + 1); assert.equal(scored.cleanPairCount, 0);
      assert.equal(scored.pair, null); // Different test identities must never form a preference pair.
      assert.equal(scored.progression.currentLevel, Math.min(level + 1, max));
    }
    const snap = (await rpc(id, "chorus_sitting")).value;
    assert.equal(snap.generations, 4); assert.equal(snap.progression.exhausted, true);
    assert.equal((await rpc(id, "chorus_pairs")).value.cleanCount, 0);
  });
  it("never treats an unrun baseline as a comparable observed zero", () => {
    const baseline = gradeArtifact({ labId: "rsi", deliverable: artifact });
    const actual = gradeArtifact({ labId: "rsi", deliverable: artifact, findings: empty });
    assert.equal(baseline.submissionStatus, "not_run");
    assert.equal(actual.submissionStatus, "scored");
    assert.equal(comparableDiagnostics(baseline, actual), false);
  });
  it("supports same-test diagnostic review candidates but not clean training pairs", async () => {
    const id = session();
    for (let i = 0; i < 2; i++) {
      const candidate = i ? artifact + " Include a numeric rejection threshold." : artifact;
      const exam = (await rpc(id, "chorus_exam", { labId: "rsi", artifact: candidate })).value;
      const result = (await rpc(id, "chorus_score", { artifact: candidate, attemptId: exam.attemptId,
        findings: diagnosticFindings(0, i ? undefined : 1) })).value;
      assert.equal(result.score, i ? 100 : 50); assert.equal(result.pairCount, i);
      assert.equal(result.cleanPairCount, 0);
    }
    const pairs = (await rpc(id, "chorus_pairs")).value;
    assert.equal(pairs.count, 1); assert.equal(pairs.cleanCount, 0); assert.equal(pairs.jsonlClean, "");
    assert.equal(pairs.pairs[0].contaminated, true);
  });
  it("generation cap errors do not change the ledger or consume another exam", async () => {
    const id = session();
    for (let i = 0; i < 8; i++) {
      const exam = (await rpc(id, "chorus_exam", { labId: "rsi", artifact })).value;
      assert.equal((await rpc(id, "chorus_score", { artifact, attemptId: exam.attemptId, findings: empty })).value.generation, i + 1);
    }
    assert.equal((await rpc(id, "chorus_exam", { artifact })).isError, true);
    assert.equal((await rpc(id, "chorus_sitting")).value.generations, 8);
  });
});


describe("new artifact assessment isolation", () => {
  it("clears stale current scores and errors without modifying historical generations", () => {
    const synthesis = { title: "Previous", deliverable: artifact, steps: [], watchouts: [], pattern: { contract: "", fanout: "", critique: "", merge: "" } };
    const evaluation = gradeArtifact({ labId: "rsi", deliverable: artifact, findings: empty });
    const previous: SwarmRun = { id: "state-test", goal: "Review the agent", labId: "rsi", startedAt: 0,
      generation: 2, phase: "merge", agents: [], synthesis, evaluation, evaluationError: "previous error",
      evaluationErrorLevel: 0, generations: [{ n: 1, contract: "", whyThisSplit: "", specialists: [], synthesis, evaluation }] };
    const updated = unscoredSynthesis(previous, { ...synthesis, title: "New", deliverable: artifact + " Apply an additional rule." });
    assert.equal(updated.evaluation, undefined); assert.equal(updated.evaluationError, undefined);
    assert.equal(updated.judge, undefined); assert.equal(updated.generations, previous.generations);
    assert.equal(updated.generations[0].evaluation, evaluation);
    assert.equal(previous.evaluation, evaluation); assert.equal(previous.synthesis?.title, "Previous");
    assert.equal(updated.synthesis?.title, "New");
  });
});
