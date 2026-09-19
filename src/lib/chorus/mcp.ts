import { LABS } from "./labs.ts";
import { examFor, gradeArtifact } from "./grade.ts";
import { dropSession, recordScore, resetSitting, sittingFor, sittingPairs, sittingSnapshot, sittingToRun } from "./mcp-sitting.ts";

export const MCP_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"] as const;

export function negotiateProtocol(requested?: string) {
  if (requested && (MCP_PROTOCOLS as readonly string[]).includes(requested)) return requested;
  return "2025-03-26";
}

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpCtx = { sessionId: string; protocol: string; writeKey?: string };

function ok(id: Rpc["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function fail(id: Rpc["id"], message: string, code = -32600) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

const SITTING_PROMPT = `You are running a Chorus sitting. You (the host model) are the swarm. Chorus grades and keeps the pairs.

1. chorus_labs — pick ONE lab. Stay on it.
2. chorus_score the user's paste as gen 0. Weak is correct. If the lab executes, chorus_exam first, run that input under the artifact, then chorus_score with findings JSON {findings:[{issue, quote}]}. quote must be a verbatim line from exam.input, not from your spec.
3. Recurse only on failed plants. A later score beating an earlier one writes a pair.
4. Stop when exhausted is true, or at 8 generations. Then chorus_pairs.
5. If generation is 8 or you need a clean ledger, chorus_new_sitting or chorus_score with reset:true. Same MCP URL.

Do not ask the user for an API key. You are the model.`;

const TOOLS = [
  {
    name: "chorus_labs",
    description: "List Chorus labs. You are the model. Chorus grades.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_exam",
    description:
      "Held-out fixture for a lab. Run task+input with this host as the artifact's system prompt. Return JSON findings, then call chorus_score.",
    inputSchema: {
      type: "object",
      properties: {
        labId: { type: "string", description: "rsi | prompt | eval | stress | data | generic" },
        level: { type: "number" },
        userTest: { type: "string" },
      },
    },
  },
  {
    name: "chorus_score",
    description:
      "Grade an artifact and record it on this sitting. A higher score than last time emits a preference pair.",
    inputSchema: {
      type: "object",
      properties: {
        labId: { type: "string" },
        artifact: { type: "string" },
        findings: { type: "string" },
        level: { type: "number" },
        userTest: { type: "string" },
        goal: { type: "string" },
        reset: { type: "boolean", description: "Wipe this sitting first (same MCP URL). Use when generation is 8." },
      },
      required: ["artifact"],
    },
  },
  {
    name: "chorus_sitting",
    description: "Current sitting on this MCP session: scores, failures, pair count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_new_sitting",
    description:
      "Wipe this sitting in place. Same MCP URL, empty ledger, pairCount 0. Pass labId to pin the next lab (rsi | prompt | eval | stress | data | generic).",
    inputSchema: {
      type: "object",
      properties: { labId: { type: "string" } },
    },
  },
  {
    name: "chorus_pairs",
    description: "Preference pairs from this sitting (JSONL). Empty unless a later score beat an earlier one.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_ledger",
    description: "This sitting as a Chorus ledger run. Import it in the lab, or keep it with the pairs.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function handleMcp(body: unknown, ctx: McpCtx): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const out = await Promise.all(body.map((item) => handleMcp(item, ctx)));
    return out.filter((item) => item != null);
  }
  const msg = (body ?? {}) as Rpc;
  if (!msg.method) return fail(msg.id, "Missing method");
  if (msg.id === undefined && msg.method.startsWith("notifications/")) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = String((msg.params?.protocolVersion as string | undefined) ?? ctx.protocol);
      const protocol = negotiateProtocol(requested);
      await sittingFor(ctx.sessionId);
      return ok(msg.id, {
        protocolVersion: protocol,
        capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} },
        serverInfo: { name: "chorus", version: "1.0.0" },
        instructions: SITTING_PROMPT,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "prompts/list":
      return ok(msg.id, {
        prompts: [{ name: "sitting", description: "Run a Chorus sitting on this host's model." }],
      });
    case "prompts/get":
      return ok(msg.id, {
        description: "Chorus sitting",
        messages: [{ role: "user", content: { type: "text", text: SITTING_PROMPT } }],
      });
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "resources/templates/list":
      return ok(msg.id, { resourceTemplates: [] });
    case "logging/setLevel":
      return ok(msg.id, {});
    case "tools/call":
      return ok(msg.id, await callTool(msg.params ?? {}, ctx));
    case "session/end":
      await dropSession(ctx.sessionId);
      return ok(msg.id, {});
    default:
      return fail(msg.id, `Unknown method ${msg.method}`, -32601);
  }
}

async function callTool(params: Record<string, unknown>, ctx: McpCtx) {
  const name = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const sessionId = ctx.sessionId;
  if (name === "chorus_labs") {
    return textResult(LABS.map((lab) => ({ id: lab.id, title: lab.title, blurb: lab.blurb, goal: lab.goal })));
  }
  if (name === "chorus_exam") {
    return textResult(
      examFor(String(args.labId ?? "prompt"), Number(args.level) || 0, args.userTest ? String(args.userTest) : undefined),
    );
  }
  if (name === "chorus_score") {
    const artifact = String(args.artifact ?? "");
    if (artifact.trim().length < 8) return textResult({ error: "Paste an artifact." }, true);
    if (args.reset === true) {
      await resetSitting(sessionId, args.labId ? String(args.labId) : "rsi");
    }
    const graded = gradeArtifact({
      labId: args.labId ? String(args.labId) : undefined,
      deliverable: artifact,
      findings: args.findings ? String(args.findings) : undefined,
      userTest: args.userTest ? String(args.userTest) : undefined,
      level: Number(args.level) || 0,
    });
    const recorded = await recordScore(sessionId, artifact, graded, args.goal ? String(args.goal) : "");
    const exhausted = Boolean(graded.exhausted);
    return textResult({
      ...graded,
      sittingId: recorded.sitting.id,
      pair: recorded.pair,
      pairCount: recorded.sitting.pairs.length,
      generation: recorded.sitting.scores.length,
      capped: recorded.capped ?? false,
      exhausted,
      nextLevel: exhausted ? null : graded.level + 1,
      hint: recorded.capped
        ? "Generation cap 8. chorus_new_sitting or chorus_score with reset:true. Same URL."
        : exhausted
          ? "Fixture exhausted. chorus_pairs for the JSONL. chorus_new_sitting to start another lab."
          : graded.quoteHint,
    });
  }
  if (name === "chorus_new_sitting") {
    const labId = args.labId ? String(args.labId) : "rsi";
    const sitting = await resetSitting(sessionId, labId);
    return textResult({
      id: sitting.id,
      labId: sitting.labId,
      generations: 0,
      pairCount: 0,
      note: "Same MCP URL. Ledger wiped. Score a weak gen 0 first if you want pairs.",
    });
  }
  if (name === "chorus_sitting") {
    const snap = await sittingSnapshot(sessionId);
    return textResult(snap ?? { error: "No sitting yet. Call chorus_score." }, !snap);
  }
  if (name === "chorus_pairs") {
    const pairs = await sittingPairs(sessionId);
    return textResult({
      count: pairs.length,
      jsonl: pairs.map((row) => JSON.stringify(row)).join("\n"),
      pairs,
    });
  }
  if (name === "chorus_ledger") {
    const run = await sittingToRun(sessionId);
    return textResult(run ?? { error: "No sitting yet. Call chorus_score." }, !run);
  }
  return textResult({ error: `Unknown tool ${name}` }, true);
}
