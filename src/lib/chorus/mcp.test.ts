import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMcp as rawHandleMcp, negotiateProtocol } from "./mcp.ts";
import { gradeArtifact } from "./grade.ts";
import { dropSession } from "./mcp-sitting.ts";

// Legacy happy-path cases use a valid client handshake. Security cases below
// and integrity.test.ts invoke rawHandleMcp directly and never auto-create an exam.
async function handleMcp(body: Parameters<typeof rawHandleMcp>[0], ctx: Parameters<typeof rawHandleMcp>[1]) {
  const msg = body as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  if (msg.method === "tools/call" && msg.params?.name === "chorus_score" && msg.params.arguments) {
    const args = msg.params.arguments;
    const res = await rawHandleMcp({ id: 999, method: "tools/call", params: { name: "chorus_exam", arguments: {
      artifact: args.artifact, labId: args.labId, level: args.level, userTest: args.userTest,
    } } }, ctx) as { result: { content: { text: string }[] } };
    const exam = JSON.parse(res.result.content[0].text);
    return rawHandleMcp({ ...msg, params: { ...msg.params, arguments: { ...args, findings: args.findings ?? JSON.stringify({ findings: [] }), attemptId: exam.attemptId } } }, ctx);
  }
  return rawHandleMcp(body, ctx);
}

const ctx = { sessionId: "test-session", protocol: "2025-03-26" };

async function tool(
  sid: { sessionId: string; protocol: string },
  id: number,
  name: string,
  args: Record<string, unknown> = {},
) {
  return handleMcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, sid);
}

describe("handleMcp", () => {
  it("initializes without hosting a model", async () => {
    const res = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ctx)) as {
      result: { serverInfo: { name: string }; instructions: string; protocolVersion: string };
    };
    assert.equal(res.result.serverInfo.name, "chorus");
    assert.match(res.result.instructions, /You are the model/);
    assert.equal(res.result.protocolVersion, "2025-03-26");
  });

  it("negotiates a newer protocol", () => {
    assert.equal(negotiateProtocol("2025-11-25"), "2025-11-25");
    assert.equal(negotiateProtocol("nope"), "2025-03-26");
  });

  it("lists tools", async () => {
    const res = (await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx)) as {
      result: { tools: { name: string }[] };
    };
    assert.deepEqual(
      res.result.tools.map((t) => t.name),
      ["chorus_labs", "chorus_exam", "chorus_score", "chorus_sitting", "chorus_next", "chorus_fill", "chorus_new_sitting", "chorus_pairs", "chorus_ledger"],
    );
  });

  it("records a pair when the score rises", async () => {
    await dropSession("pair-session");
    const sid = { sessionId: "pair-session", protocol: "2025-03-26" };
    await tool(sid, 2, "chorus_exam", { labId: "prompt", level: 0 });
    await tool(sid, 3, "chorus_score", { labId: "prompt", artifact: "review this please" });
    const second = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "chorus_score",
          arguments: {
            labId: "prompt",
            artifact: "You must catch XSS, SQL injection, and code execution. Fail if you praise. Required. Security.",
            findings: JSON.stringify({
              findings: [
                { issue: "reflected XSS", quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");' },
                { issue: "sql", quote: "SELECT * FROM users WHERE id = " },
                { issue: "eval", quote: "eval(String(req.body.code))" },
              ],
            }),
          },
        },
      },
      sid,
    )) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(second.result.content[0]!.text) as { pairCount: number; pair: unknown };
    assert.equal(payload.pairCount >= 1, true);
    assert.equal(Boolean(payload.pair), true);
  });

  it("returns empty resources", async () => {
    const res = (await handleMcp({ jsonrpc: "2.0", id: 5, method: "resources/list" }, ctx)) as {
      result: { resources: unknown[] };
    };
    assert.deepEqual(res.result.resources, []);
  });

  it("wipes the sitting in place", async () => {
    await dropSession("reset-session");
    const sid = { sessionId: "reset-session", protocol: "2025-03-26" };
    await tool(sid, 7, "chorus_exam", { labId: "rsi", level: 0 });
    await tool(sid, 8, "chorus_score", { labId: "rsi", artifact: "must fail threshold kill rewrite contract" });
    const wiped = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "chorus_new_sitting", arguments: { labId: "rsi" } },
      },
      sid,
    )) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(wiped.result.content[0]!.text) as {
      generations: number;
      pairCount: number;
      labId: string;
    };
    assert.equal(payload.generations, 0);
    assert.equal(payload.pairCount, 0);
    assert.equal(payload.labId, "rsi");
  });

  it("chorus_sitting reset wipes without a new tool", async () => {
    await dropSession("sit-reset");
    const sid = { sessionId: "sit-reset", protocol: "2025-03-26" };
    await tool(sid, 9, "chorus_exam", { labId: "rsi", level: 0 });
    await tool(sid, 10, "chorus_score", { labId: "rsi", artifact: "must fail threshold kill rewrite contract" });
    const wiped = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "chorus_sitting", arguments: { reset: true, labId: "rsi" } },
      },
      sid,
    )) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(wiped.result.content[0]!.text) as { generations: number; pairCount: number };
    assert.equal(payload.generations, 0);
    assert.equal(payload.pairCount, 0);
  });

  it("keeps a claimed independent executor unverified", async () => {
    await dropSession("exec-session");
    const sid = { sessionId: "exec-session", protocol: "2025-03-26" };
    await tool(sid, 11, "chorus_exam", { labId: "prompt", level: 0 });
    await tool(sid, 12, "chorus_score", { labId: "prompt", artifact: "review this please", executor: "local-llama" });
    const second = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "chorus_score",
          arguments: {
            labId: "prompt",
            executor: "local-llama",
            artifact: "You must catch XSS, SQL injection, and code execution. Fail if you praise. Required. Security.",
            findings: JSON.stringify({
              findings: [
                { issue: "reflected XSS", quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");' },
                { issue: "sql", quote: "SELECT * FROM users WHERE id = " },
                { issue: "eval", quote: "eval(String(req.body.code))" },
              ],
            }),
          },
        },
      },
      sid,
    )) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(second.result.content[0]!.text) as { pair: { contaminated: boolean } | null };
    assert.equal(payload.pair?.contaminated, true);
  });

  it("keeps grok-named executor contaminated", async () => {
    await dropSession("grok-exec");
    const sid = { sessionId: "grok-exec", protocol: "2025-03-26" };
    await tool(sid, 13, "chorus_exam", { labId: "prompt", level: 0 });
    await tool(sid, 14, "chorus_score", { labId: "prompt", artifact: "review this please", executor: "grok" });
    const second = (await handleMcp(
      {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "chorus_score",
          arguments: {
            labId: "prompt",
            executor: "grok",
            artifact: "You must catch XSS, SQL injection, and code execution. Fail if you praise. Required. Security.",
            findings: JSON.stringify({
              findings: [
                { issue: "reflected XSS", quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");' },
                { issue: "sql", quote: "SELECT * FROM users WHERE id = " },
                { issue: "eval", quote: "eval(String(req.body.code))" },
              ],
            }),
          },
        },
      },
      sid,
    )) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(second.result.content[0]!.text) as { pair: { contaminated: boolean } | null };
    assert.equal(payload.pair?.contaminated, true);
  });

  it("conducts seats over chorus_next and chorus_fill", async () => {
    await dropSession("orch-session");
    const sid = { sessionId: "orch-session", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "chorus_sitting", arguments: { conduct: true, goal: "Harden the review prompt", labId: "prompt" } },
      },
      sid,
    );
    const next = (await handleMcp(
      { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "chorus_next", arguments: {} } },
      sid,
    )) as { result: { content: { text: string }[] } };
    const seat = JSON.parse(next.result.content[0]!.text) as { seat: string };
    assert.equal(seat.seat, "conductor");
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "chorus_fill",
          arguments: {
            seat: "conductor",
            text: JSON.stringify({
              contract: "Catch XSS and SQL.",
              whyThisSplit: "Three surfaces.",
              specialists: [
                { id: "s1", name: "Sink Hunter", mandate: "Find sinks", lens: "code" },
                { id: "s2", name: "Query Adversary", mandate: "SQL", lens: "query" },
                { id: "s3", name: "Eval Warden", mandate: "eval", lens: "runtime" },
              ],
            }),
          },
        },
      },
      sid,
    );
    const second = (await handleMcp(
      { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "chorus_next", arguments: {} } },
      sid,
    )) as { result: { content: { text: string }[] } };
    const s1 = JSON.parse(second.result.content[0]!.text) as { seat: string };
    assert.equal(s1.seat, "s1");
  });

  it("does not treat rsi as a trading ticker", async () => {
    await dropSession("rsi-trap");
    const sid = { sessionId: "rsi-trap", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "chorus_sitting", arguments: { conduct: true, labId: "rsi" } },
      },
      sid,
    );
    const next = (await handleMcp(
      { jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "chorus_next", arguments: {} } },
      sid,
    )) as { result: { content: { text: string }[] } };
    const seat = JSON.parse(next.result.content[0]!.text) as { user: string };
    assert.match(seat.user, /Not Relative Strength/);
    assert.match(seat.user, /coding agent/);
    assert.doesNotMatch(seat.user, /^rsi$/m);
  });

  it("recurse specialists are not the judge", async () => {
    await dropSession("recurse-judge");
    const sid = { sessionId: "recurse-judge", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: {
          name: "chorus_sitting",
          arguments: { conduct: true, labId: "rsi", goal: "Design a recursive self-improvement loop" },
        },
      },
      sid,
    );
    await tool(sid, 40, "chorus_exam", { labId: "rsi", level: 0 });
    await tool(sid, 41, "chorus_score", { labId: "rsi", artifact: "must fail threshold kill rewrite contract" });
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "chorus_sitting", arguments: { conduct: true, labId: "rsi" } },
      },
      sid,
    );
    const first = (await handleMcp(
      { jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "chorus_next", arguments: {} } },
      sid,
    )) as { result: { content: { text: string }[] } };
    const improver = JSON.parse(first.result.content[0]!.text) as { seat: string };
    assert.equal(improver.seat, "improver");
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 44,
        method: "tools/call",
        params: { name: "chorus_fill", arguments: { seat: "improver", text: JSON.stringify({ contract: "Close remaining holes without altering frozen work.", specialists: [1,2,3].map(i => ({ id: `s${i}`, name: `Closer ${i}`, mandate: "Test the remaining gap." })) }) } },
      },
      sid,
    );
    const s1 = (await handleMcp(
      { jsonrpc: "2.0", id: 45, method: "tools/call", params: { name: "chorus_next", arguments: {} } },
      sid,
    )) as { result: { content: { text: string }[] } };
    const seat = JSON.parse(s1.result.content[0]!.text) as { seat: string; role: string };
    assert.equal(seat.seat, "s1");
    assert.notEqual(seat.role.toLowerCase(), "judge");
  });

  it("rejects score before exam on execute labs", async () => {
    await dropSession("need-exam");
    const sid = { sessionId: "need-exam", protocol: "2025-03-26" };
    const res = (await rawHandleMcp({ id: 50, method: "tools/call", params: { name: "chorus_score", arguments: { labId: "prompt", artifact: "review this please" } } }, sid)) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    const payload = JSON.parse(res.result.content[0]!.text) as { error?: string };
    assert.match(payload.error ?? "", /chorus_exam first/);
  });

  it("does not mint a pair when only findings change", async () => {
    await dropSession("same-art");
    const sid = { sessionId: "same-art", protocol: "2025-03-26" };
    const artifact = "You must catch XSS, SQL injection, and code execution. Fail if you praise. Required. Security.";
    await tool(sid, 51, "chorus_exam", { labId: "prompt", level: 0 });
    await tool(sid, 52, "chorus_score", { labId: "prompt", artifact });
    const second = (await tool(sid, 53, "chorus_score", {
      labId: "prompt",
      artifact,
      findings: JSON.stringify({
        findings: [
          { issue: "reflected XSS", quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");' },
          { issue: "sql", quote: "SELECT * FROM users WHERE id = " },
          { issue: "eval", quote: "eval(String(req.body.code))" },
        ],
      }),
    })) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(second.result.content[0]!.text) as { pair: unknown };
    assert.equal(payload.pair, null);
  });

  it("initialize is idempotent", async () => {
    await dropSession("bound-session");
    const host = { sessionId: "bound-session", protocol: "2025-03-26" };
    const first = (await handleMcp(
      { jsonrpc: "2.0", id: 6, method: "initialize", params: {} },
      host,
    )) as { result?: unknown; error?: unknown };
    const second = (await handleMcp(
      { jsonrpc: "2.0", id: 7, method: "initialize", params: {} },
      host,
    )) as { result?: unknown; error?: unknown };
    assert.equal(Boolean(first.result), true);
    assert.equal(Boolean(second.result), true);
  });
});

describe("gradeArtifact", () => {
  it("does not score the essay keywords", () => {
    const graded = gradeArtifact({
      labId: "prompt",
      deliverable: "You must catch XSS. Fail if you praise. Required. Security. Test.",
    });
    assert.equal(graded.passed.includes("Prompt forbids vague praise"), false);
    assert.equal(graded.score, 0);
  });

  it("does not clear plants without host findings", () => {
    const graded = gradeArtifact({
      labId: "prompt",
      deliverable: "You must catch XSS and SQL injection. Fail if you praise.",
    });
    assert.equal(graded.failed.includes("Caught reflected HTML/XSS"), true);
    assert.equal(graded.score <= 79, true);
  });

  it("clears XSS when the host quotes the planted line", () => {
    const findings = JSON.stringify({
      findings: [{ issue: "reflected XSS", quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");' }],
    });
    const graded = gradeArtifact({
      labId: "prompt",
      deliverable: "You must catch XSS, SQL injection, and code execution. Fail if you praise. Required. Security.",
      findings,
    });
    assert.equal(graded.passed.includes("Caught reflected HTML/XSS"), true);
  });

  it("hints to quote exam.input when plants miss", () => {
    const graded = gradeArtifact({
      labId: "rsi",
      deliverable: "must fail threshold kill rewrite contract diversity stop",
      findings: JSON.stringify({
        findings: [{ issue: "looks fine", quote: "not a source line" }],
      }),
    });
    assert.equal(graded.failed.length > 0, true);
    assert.match(graded.quoteHint ?? "", /verbatim line from exam.input/);
  });
});
