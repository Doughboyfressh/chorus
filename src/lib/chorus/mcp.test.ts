import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMcp, negotiateProtocol } from "./mcp.ts";
import { gradeArtifact } from "./grade.ts";
import { dropSession } from "./mcp-sitting.ts";

const ctx = { sessionId: "test-session", protocol: "2025-03-26" };

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
      ["chorus_labs", "chorus_exam", "chorus_score", "chorus_sitting", "chorus_new_sitting", "chorus_pairs", "chorus_ledger"],
    );
  });

  it("records a pair when the score rises", async () => {
    await dropSession("pair-session");
    const sid = { sessionId: "pair-session", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "chorus_score", arguments: { labId: "prompt", artifact: "review this please" } },
      },
      sid,
    );
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
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "chorus_score", arguments: { labId: "rsi", artifact: "must fail threshold kill rewrite contract" } },
      },
      sid,
    );
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
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "chorus_score", arguments: { labId: "rsi", artifact: "must fail threshold kill rewrite contract" } },
      },
      sid,
    );
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

  it("marks a pair clean when executor is another model", async () => {
    await dropSession("exec-session");
    const sid = { sessionId: "exec-session", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "chorus_score", arguments: { labId: "prompt", artifact: "review this please" } },
      },
      sid,
    );
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
    assert.equal(payload.pair?.contaminated, false);
  });

  it("keeps grok-named executor contaminated", async () => {
    await dropSession("grok-exec");
    const sid = { sessionId: "grok-exec", protocol: "2025-03-26" };
    await handleMcp(
      {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "chorus_score", arguments: { labId: "prompt", artifact: "review this please" } },
      },
      sid,
    );
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
