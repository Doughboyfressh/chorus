import { LABS } from "./labs.ts";
import { examFor, gradeArtifact } from "./grade.ts";
import { applySittingUpdate, dropSession, examReady, fillOrchestraSeat, markExam, nextOrchestraSeat, recordScore, resetSitting, sittingFor, sittingPairs, sittingSnapshot, sittingToRun } from "./mcp-sitting.ts";

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

const SITTING_PROMPT = `You are an MCP host for Chorus. Chorus conducts. You play the seats. Chorus grades.

If chorus_next returns a seat: YOU are that role. Produce the JSON it asked for. chorus_fill with that text. Repeat until done is true. The exam seat: you ARE the artifact. Run exam.input. Do not invent findings to match the plate.

Otherwise a host sitting:
1. chorus_labs — pick ONE lab. Stay on it.
2. chorus_exam first. You are the artifact; exam.input is the user message. Then chorus_score with the findings that run produced. Scoring without exam is rejected.
3. A later score beating an earlier one writes a pair only if the artifact text changed. Same spec, new JSON is not a pair.
4. Generation 8: chorus_sitting with reset:true. Same MCP URL.

Do not ask for an API key. You are the model.`;

const TOOLS = [
  {
    name: "chorus_labs",
    description: "List Chorus labs. You are the model. Chorus grades.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_exam",
    description:
      "Held-out fixture. You are the artifact; run task+input. Required before chorus_score on execute labs.",
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
        executor: { type: "string", description: "Model that sat the exam. Omit if this host ran it (pair is contaminated)." },
        reset: { type: "boolean", description: "Wipe this sitting first (same MCP URL). Use when generation is 8." },
      },
      required: ["artifact"],
    },
  },
  {
    name: "chorus_sitting",
    description:
      "Sitting status, or mutate it. conduct:true starts the eight-seat swarm (Chorus issues prompts, you fill). reset:true wipes in place.",
    inputSchema: {
      type: "object",
      properties: {
        reset: { type: "boolean" },
        labId: { type: "string" },
        contract: { type: "string" },
        specialists: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, mandate: { type: "string" } },
          },
        },
        specialist: { type: "string" },
        patch: { type: "string" },
        merge: { type: "string" },
        executor: { type: "string" },
        conduct: { type: "boolean", description: "Start the eight-seat swarm. Chorus issues each seat via chorus_next." },
        goal: { type: "string" },
        pasted: { type: "string" },
      },
    },
  },
  {
    name: "chorus_next",
    description:
      "Next seat Chorus wants you to play (conductor, specialist, critic, synthesizer, improver, judge). Fill it with chorus_fill. Repeat until done.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_fill",
    description: "Submit this host's completion for the current seat. Then call chorus_next.",
    inputSchema: {
      type: "object",
      properties: {
        seat: { type: "string" },
        text: { type: "string" },
      },
      required: ["text"],
    },
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
    const sitting = await sittingFor(sessionId);
    const labId = args.labId ? String(args.labId) : sitting.labId || "prompt";
    const level = Number.isFinite(Number(args.level)) ? Number(args.level) : sitting.level;
    await markExam(sessionId, labId, level);
    return textResult(examFor(labId, level, args.userTest ? String(args.userTest) : undefined));
  }
  if (name === "chorus_score") {
    const artifact = String(args.artifact ?? "");
    if (artifact.trim().length < 8) return textResult({ error: "Paste an artifact." }, true);
    const sitting = await sittingFor(sessionId);
    if (args.reset === true) {
      await resetSitting(sessionId, args.labId ? String(args.labId) : sitting.labId);
    }
    const current = await sittingFor(sessionId);
    const labId = args.labId ? String(args.labId) : current.labId;
    const level = Number.isFinite(Number(args.level)) ? Number(args.level) : current.level;
    const exam = examFor(labId, level, args.userTest ? String(args.userTest) : undefined);
    if (exam.execute && !examReady(current, labId, level)) {
      return textResult({ error: "chorus_exam first. Run exam.input under the artifact, then score those findings." }, true);
    }
    const graded = gradeArtifact({
      labId,
      deliverable: artifact,
      findings: args.findings ? String(args.findings) : undefined,
      userTest: args.userTest ? String(args.userTest) : undefined,
      level,
    });
    const recorded = await recordScore(
      sessionId,
      artifact,
      graded,
      args.goal ? String(args.goal) : "",
      args.executor ? String(args.executor) : undefined,
    );
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
    const sitting = await resetSitting(sessionId, args.labId ? String(args.labId) : undefined);
    return textResult({
      id: sitting.id,
      labId: sitting.labId,
      generations: 0,
      pairCount: 0,
      note: "Same MCP URL. Ledger wiped. Score a weak gen 0 first if you want pairs.",
    });
  }
  if (name === "chorus_sitting") {
    const mutated =
      args.reset === true ||
      args.contract ||
      args.specialists ||
      args.patch ||
      args.merge ||
      args.executor ||
      args.labId ||
      args.conduct;
    if (mutated) {
      await applySittingUpdate(sessionId, {
        reset: args.reset === true,
        labId: args.labId ? String(args.labId) : undefined,
        contract: args.contract ? String(args.contract) : undefined,
        specialists: Array.isArray(args.specialists)
          ? (args.specialists as { name?: string; mandate?: string }[])
          : undefined,
        specialist: args.specialist ? String(args.specialist) : undefined,
        patch: args.patch ? String(args.patch) : undefined,
        merge: args.merge ? String(args.merge) : undefined,
        executor: args.executor ? String(args.executor) : undefined,
        conduct: args.conduct === true,
        goal: args.goal ? String(args.goal) : undefined,
        pasted: args.pasted ? String(args.pasted) : undefined,
      });
    }
    const snap = await sittingSnapshot(sessionId);
    return textResult(snap ?? { error: "No sitting yet. Call chorus_score." }, !snap);
  }
  if (name === "chorus_pairs") {
    const pairs = await sittingPairs(sessionId);
    const clean = pairs.filter((row) => !row.contaminated);
    return textResult({
      count: pairs.length,
      cleanCount: clean.length,
      jsonl: pairs.map((row) => JSON.stringify(row)).join("\n"),
      jsonlClean: clean.map((row) => JSON.stringify(row)).join("\n"),
      pairs,
      clean,
    });
  }
  if (name === "chorus_ledger") {
    const run = await sittingToRun(sessionId);
    return textResult(run ?? { error: "No sitting yet. Call chorus_score." }, !run);
  }
  if (name === "chorus_next") {
    return textResult(await nextOrchestraSeat(sessionId));
  }
  if (name === "chorus_fill") {
    const text = String(args.text ?? "");
    if (text.trim().length < 8) return textResult({ error: "Paste the seat's completion." }, true);
    return textResult(await fillOrchestraSeat(sessionId, String(args.seat ?? ""), text));
  }
  return textResult({ error: `Unknown tool ${name}` }, true);
}
