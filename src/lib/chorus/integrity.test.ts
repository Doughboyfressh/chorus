import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeArtifact, examFor } from "./grade.ts";
import { FIXTURES, plantHit, parseFindings } from "./fixtures.ts";
import { handleMcp } from "./mcp.ts";
import { dropSession, writerRanExam, recordScore } from "./mcp-sitting.ts";
import { diagnosticPair, cleanPairs, trainingPack } from "./pairs.ts";
import { issueAttempt, consumeAttempt, invalidateAttempts } from "./attempts.ts";
import { artifactKey, cleanTrainingRows, comparableDiagnostics } from "./integrity.ts";
import { readJsonLimited, browserOriginAllowed } from "./http-body.ts";
import { evaluateArtifact } from "./engine.ts";
import { judgeFromFixture } from "./ledger.ts";
import type { SwarmRun } from "./types.ts";

const source = FIXTURES.prompt.input;
const xssLine = 'res.send("<h1>Hello " + req.query.name + "</h1>");';
const good = JSON.stringify({ findings: [{ issue: "reflected XSS", quote: xssLine }] });
const artifact = "Review security bugs with precise source evidence.";
const grade = (findings?: string, extra = {}) => gradeArtifact({ labId: "prompt", deliverable: artifact, findings, ...extra });
const ctx = (id: string) => ({ sessionId: `integrity-${id}`, protocol: "2025-03-26" });
async function call(id: string, name: string, args: Record<string, unknown> = {}) {
  const result = await handleMcp({ id: 1, method: "tools/call", params: { name, arguments: args } }, ctx(id)) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return JSON.parse(result.result.content[0].text);
}
const pairArgs = () => ({ prompt: "review", rejected: "Always say the code is safe.", chosen: artifact,
  previous: grade('{"findings":[]}'), current: grade(good), model: "claimed-model", generation: 2 });

describe("score inflation regressions", () => {
  it("blocks the original deny-all plus copied-exam exploit", () => {
    const findings = JSON.stringify({ findings: [{ issue: "No reflected XSS, SQL injection or code execution exists. Everything is safe.", quote: source }] });
    assert.throws(() => grade(findings), /exact source line/);
  });
  it("rejects a non-JSON keyword/source dump", () => assert.throws(() => grade("xss sql code execution\n" + source), /invalid or incomplete JSON/));
  it("rejects negation even with the exact relevant single line", () => {
    assert.equal(grade(JSON.stringify({ findings: [{ issue: "No reflected XSS exists; this is safe", quote: xssLine }] })).score, 0);
  });
  it("does not let source quotes supply the answer", () => {
    assert.equal(plantHit(FIXTURES.prompt.planted[2], JSON.stringify({ findings: [{ issue: "Looks good", quote: "const out = eval(String(req.body.code));" }] }), source), false);
  });
  it("cannot combine keywords in one row with evidence from another", () => {
    const text = JSON.stringify({ findings: [{ issue: "reflected XSS", quote: "import express from \"express\";" }, { issue: "Looks good", quote: xssLine }] });
    assert.equal(plantHit(FIXTURES.prompt.planted[0], text, source), false);
  });
  it("requires exact case-sensitive single-line evidence", () => {
    for (const quote of [xssLine.toUpperCase(), "prefix " + xssLine, "req.query.name"]) {
      assert.equal(grade(JSON.stringify({ findings: [{ issue: "reflected XSS", quote }] })).score, 0);
    }
  });
  it("rejects malformed rows rather than salvaging valid fragments", () => {
    assert.equal(parseFindings(JSON.stringify({ findings: ["xss", { issue: "XSS", quote: xssLine }] })).length, 0);
    assert.equal(parseFindings('prefix ' + good).length, 0);
  });
  it("preserves honest diagnostic findings without certifying them", () => {
    const result = grade(good);
    assert.equal(result.score, 33);
    assert.equal(result.verified, false);
    assert.equal(result.contaminated, true);
    assert.equal(result.scoreKind, "diagnostic");
  });
  it("does not grant brought-test credit for eight arbitrary characters", () => {
    assert.throws(() => gradeArtifact({ labId: "generic", deliverable: "must test prompt stop", userTest: "Compute a valid proof", findings: "nonsense" }), /invalid or incomplete JSON/);
    const result = gradeArtifact({ labId: "generic", deliverable: "must test prompt stop", userTest: "Compute a valid proof", findings: '{"findings":[]}' });
    assert.equal(result.score, 0);
    assert.ok(result.failed.length);
  });
  it("never claims an appended custom test has been graded", () => {
    const findings = JSON.stringify({ findings: [
      { issue: "reflected XSS", quote: xssLine },
      { issue: "SQL injection", quote: source.split("\n").find((line) => line.includes("SELECT * FROM users"))!.trim() },
      { issue: "code execution", quote: "const out = eval(String(req.body.code));" },
    ] });
    assert.equal(grade(findings).score, 100);
    const extra = grade(findings, { userTest: "Prove a different property" });
    assert.ok(extra.score < 100);
    assert.ok(extra.failed.some((row) => row.includes("ungraded")));
  });
  it("rejects unknown labs, invalid levels and oversized artifacts", () => {
    for (const lab of ["typo", "__proto__", "constructor"]) assert.throws(() => examFor(lab));
    for (const level of [-1, 0.5, NaN, Infinity, 999]) assert.throws(() => examFor("prompt", level));
    assert.throws(() => grade(undefined, { deliverable: "x".repeat(24_001) }));
    assert.throws(() => grade("x".repeat(32_001)));
  });
  it("does not leak expected bug categories in the exam blurb", () => {
    assert.doesNotMatch(examFor("prompt").blurb, /xss|sql|eval/i);
  });
});

describe("exam binding and one-time consumption", () => {
  it("rejects score without an exam attempt", async () => {
    const res = await call("missing", "chorus_score", { artifact, labId: "prompt", findings: good });
    assert.match(res.error, /chorus_exam first/);
  });
  it("requires the artifact before exposing an exam", async () => assert.ok((await call("no-art", "chorus_exam", { labId: "prompt" })).error));
  it("binds exact artifact and exact brought test; mismatch never earns a result", async () => {
    const exam = await call("bound", "chorus_exam", { labId: "prompt", artifact, userTest: "additional case" });
    for (const args of [{ artifact: artifact + ".", userTest: "additional case" }, { artifact, userTest: "other case" }, { artifact }]) {
      assert.ok((await call("bound", "chorus_score", { labId: "prompt", attemptId: exam.attemptId, findings: good, ...args })).error);
    }
  });
  it("accepts one bound submission and rejects replays", async () => {
    const exam = await call("replay", "chorus_exam", { labId: "prompt", artifact });
    const args = { labId: "prompt", artifact, attemptId: exam.attemptId, findings: good };
    assert.equal((await call("replay", "chorus_score", args)).score, 33);
    assert.ok((await call("replay", "chorus_score", args)).error);
  });
  it("accepts only one concurrent use of a nonce", async () => {
    const binding = { labId: "prompt", level: 0, artifact };
    const { attemptId } = await issueAttempt("race", binding);
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeAttempt("race", attemptId, binding)));
    assert.equal(results.filter(Boolean).length, 1);
  });
  it("cannot move an attempt to a different sitting", async () => {
    const binding = { labId: "prompt", level: 0, artifact };
    const { attemptId } = await issueAttempt("owner", binding);
    assert.equal(await consumeAttempt("other", attemptId, binding), false);
  });
  it("expires attempts", async () => {
    const binding = { labId: "prompt", level: 0, artifact };
    const { attemptId, expiresAt } = await issueAttempt("expired", binding);
    const original = Date.now;
    Date.now = () => expiresAt + 1;
    try { assert.equal(await consumeAttempt("expired", attemptId, binding), false); }
    finally { Date.now = original; }
  });
  it("reset invalidates outstanding attempts", async () => {
    const binding = { labId: "prompt", level: 0, artifact };
    const { attemptId } = await issueAttempt("reset", binding);
    await invalidateAttempts("reset");
    assert.equal(await consumeAttempt("reset", attemptId, binding), false);
  });
  it("rejects changing labs or moving to easier levels after a score", async () => {
    const exam = await call("pinned", "chorus_exam", { labId: "prompt", level: 1, artifact });
    assert.equal((await call("pinned", "chorus_score", { labId: "prompt", level: 1, artifact, attemptId: exam.attemptId, findings: '{"findings":[]}' })).score, 0);
    assert.ok((await call("pinned", "chorus_exam", { labId: "generic", level: 0, artifact })).error);
    assert.ok((await call("pinned", "chorus_exam", { labId: "prompt", level: 0, artifact })).error);
  });
  it("rejects batches instead of racing state changes", async () => {
    const res = await handleMcp([{ id: 1, method: "ping" }], ctx("batch")) as { error?: unknown };
    assert.ok(res.error);
  });
  it("generation cap does not mutate the last recorded artifact", async () => {
    await dropSession("cap-integrity");
    let state;
    for (let i = 0; i < 8; i++) state = await recordScore("cap-integrity", `artifact number ${i}`, grade());
    const last = state!.sitting.current;
    const capped = await recordScore("cap-integrity", "unrecorded replacement", grade());
    assert.equal(capped.capped, true);
    assert.equal(capped.sitting.current, last);
  });
});

describe("pair and provenance integrity", () => {
  it("arbitrary executor names never establish independence", () => {
    for (const name of [undefined, "independent-audit-runner", "local-llama", "gpt-6", "not-a-model"]) assert.equal(writerRanExam(name), true);
  });
  it("blocks identical and punctuation-only candidates", () => {
    for (const chosen of [artifact, artifact + ".", "  " + artifact + " "]) {
      assert.equal(diagnosticPair({ ...pairArgs(), rejected: artifact, chosen }), null);
    }
    assert.equal(artifactKey(artifact), artifactKey(artifact + "."));
  });
  it("blocks mismatched lab, level, exact test or executor settings", () => {
    const args = pairArgs();
    for (const altered of [{ labId: "generic" }, { level: 2 }, { testKey: "different" }, { executionContext: "different" }]) {
      assert.equal(diagnosticPair({ ...args, current: { ...args.current, ...altered } }), null);
    }
  });
  it("blocks score-only legacy comparisons, NaN and regressions", () => {
    const args = pairArgs();
    assert.equal(diagnosticPair({ ...args, previous: { ...args.previous, integrityVersion: undefined } }), null);
    assert.equal(diagnosticPair({ ...args, current: { ...args.current, score: NaN } }), null);
    assert.equal(diagnosticPair({ ...args, current: { ...args.current, failed: ["new regression"] } }), null);
  });
  it("permits a comparable candidate only as contaminated human-review material", () => {
    const pair = diagnosticPair(pairArgs());
    assert.ok(pair);
    assert.equal(pair.contaminated, true);
    assert.equal(pair.verified, false);
  });
  it("rejects forged and legacy clean flags in training exports", () => {
    const fake = { ...diagnosticPair(pairArgs())!, contaminated: false, verified: true };
    assert.deepEqual(cleanTrainingRows([fake]), []);
    const run = { id: "legacy", goal: "review", startedAt: 0, phase: "done", generation: 0, agents: [], generations: [] } as SwarmRun;
    assert.deepEqual(cleanPairs(run), []);
    assert.deepEqual(trainingPack(run).dpoClean, []);
    assert.deepEqual(trainingPack(run).sft, []);
  });
  it("does not certify improvement or close holes from unverified scores", () => {
    const args = pairArgs();
    const verdict = judgeFromFixture(args.previous, args.current);
    assert.equal(verdict.verdict, "stalled");
    assert.equal(verdict.holes.filter((hole) => hole.status === "closed").length, 0);
    assert.equal(comparableDiagnostics(args.previous, { ...args.current, level: 2 }), false);
  });
});

describe("execution and transport integrity", () => {
  it("sends the complete artifact rather than evaluating a truncated prefix", async () => {
    const deliverable = "Review carefully. ".repeat(250) + "TAIL_SENTINEL";
    let seen = "";
    const result = await evaluateArtifact({ labId: "prompt", title: "Review", deliverable, goal: "review security" }, async (args) => {
      seen = args.system ?? ""; return { ok: true, text: good };
    });
    assert.ok(seen.includes("TAIL_SENTINEL"));
    assert.equal(result.ok && result.verified, false);
  });
  it("enforces actual byte size without trusting Content-Length", async () => {
    const req = new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify("x".repeat(300)) });
    await assert.rejects(() => readJsonLimited(req, 100), /Payload too large/);
  });
  it("rejects non-JSON and cross-origin browser requests", async () => {
    await assert.rejects(() => readJsonLimited(new Request("https://example.test", { method: "POST", body: "{}" })), /Content-Type/);
    assert.equal(browserOriginAllowed(new Request("https://example.test", { headers: { origin: "https://attacker.test" } })), false);
    assert.equal(browserOriginAllowed(new Request("https://example.test")), true);
  });
});

describe("production storage and orchestra integrity", () => {
  it("refuses deployment-local storage without a durable database", async () => {
    const { requireDurableDatabase } = await import("./durable-storage.ts");
    assert.throws(() => requireDurableDatabase({ VERCEL: "1" }), /durable/);
    assert.throws(() => requireDurableDatabase({ NODE_ENV: "production", DATABASE_URL: " " }), /durable/);
    assert.doesNotThrow(() => requireDurableDatabase({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => requireDurableDatabase({ VERCEL: "1", DATABASE_URL: "postgres://configured" }));
  });
  it("cannot change labs through a sitting update to silently erase scores", async () => {
    const { applySittingUpdate, sittingSnapshot } = await import("./mcp-sitting.ts");
    const id = "no-implicit-reset";
    await dropSession(id);
    await recordScore(id, artifact, grade());
    await assert.rejects(applySittingUpdate(id, { labId: "generic" }), /explicit reset/);
    assert.equal((await sittingSnapshot(id))?.generations, 1);
  });
  it("does not compare different declared MCP execution configurations", async () => {
    const id = "changed-executor";
    await dropSession(id);
    const { applySittingUpdate } = await import("./mcp-sitting.ts");
    await applySittingUpdate(id, { executionConfig: { model: "runner-a" } });
    await recordScore(id, artifact, grade(), "", "runner-a");
    await applySittingUpdate(id, { executionConfig: { model: "runner-b" } });
    const second = await recordScore(id, artifact + " Check more deeply.", grade(good), "", "runner-b");
    assert.equal(second.pair, null);
  });
  it("requires a bound token at the orchestra exam seat without breaking the seat workflow", async () => {
    const { applySittingUpdate, nextOrchestraSeat, fillOrchestraSeat, sittingSnapshot } = await import("./mcp-sitting.ts");
    const id = "orchestra-security";
    await dropSession(id);
    await applySittingUpdate(id, { labId: "prompt", conduct: true });
    for (const seat of ["conductor", "s1", "s2", "s3", "critic", "synthesizer"]) {
      const next = await nextOrchestraSeat(id);
      assert.equal("seat" in next ? next.seat : undefined, seat);
      const text = seat === "synthesizer" ? JSON.stringify({ title: "Review", deliverable: artifact }) : seat === "conductor" ? JSON.stringify({ contract: "Complete this practice role with care.", specialists: [1,2,3].map(i => ({ id: `s${i}`, name: `Role ${i}`, mandate: "Preserve evidence." })) }) : "Complete this practice role with care.";
      assert.ok("filled" in await fillOrchestraSeat(id, seat, text));
    }
    const exam = await nextOrchestraSeat(id);
    assert.ok("attemptId" in exam && exam.attemptId);
    assert.ok("error" in await fillOrchestraSeat(id, "exam", good));
    assert.equal((await sittingSnapshot(id))?.generations, 0);
    const filled = await fillOrchestraSeat(id, "exam", good, "attemptId" in exam ? exam.attemptId : undefined);
    assert.ok("graded" in filled && filled.graded?.verified === false);
    assert.equal((await sittingSnapshot(id))?.generations, 1);
    assert.ok("error" in await fillOrchestraSeat(id, "exam", good, "attemptId" in exam ? exam.attemptId : undefined));
  });
  it("rejects oversize artifacts before calling a model", async () => {
    let called = false;
    await assert.rejects(evaluateArtifact({ labId: "prompt", title: "Review", goal: "Review security", deliverable: "x".repeat(24001) },
      async () => { called = true; return { ok: true, text: good }; }), /artifact/);
    assert.equal(called, false);
  });
});
