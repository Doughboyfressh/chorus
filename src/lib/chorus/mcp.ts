import { FindingsValidationError, validateFindings, FINDINGS_INSTRUCTIONS } from "./findings.ts";
import { MAX_SEAT_TEXT } from "./artifact-text.ts";
import { maxFixtureLevel } from "./fixtures.ts";
import { boundedText, cleanTrainingRows, MAX_ARTIFACT } from "./integrity.ts";
import { LABS } from "./labs.ts";
import { examFor, gradeArtifact } from "./grade.ts";
import { applySittingUpdate, dropSession, consumeExam, examReady, fillOrchestraSeat, markExam, nextOrchestraSeat, recordScore, resetSitting, sittingFor, sittingPairs, sittingSnapshot, sittingToRun, progressionFor } from "./mcp-sitting.ts";

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

const SITTING_PROMPT = `You are an MCP host for Chorus. Chorus conducts. You play the seats. Chorus reports unverified practice diagnostics.

If chorus_next returns a seat: YOU are that role. Produce the JSON it asked for. chorus_fill with that text. Repeat until done is true. The exam seat: you ARE the artifact. Run exam.input. Do not invent findings to match the plate.

Otherwise a host sitting:
1. chorus_labs — pick ONE lab. Stay on it.
2. chorus_exam with the exact artifact first; preserve its attemptId for chorus_score. You are the artifact; exam.input is the user message. Then chorus_score with the findings that run produced. Scoring without exam is rejected.
3. A later diagnostic can produce a contaminated review candidate only on the same test and changed text. It is not evidence of independent improvement. Clean training exports are unavailable.
4. A 100/100 pass with no failed checks automatically advances to the next available level WITHOUT wiping history. Omit level to use the current level; never invent levels beyond maxLevel.
5. Diagnostic 0–100 scores and unverified review candidates are allowed. Only clean training exports are locked. A format error is not a zero; correct the format, do not change the findings to match the checker.
6. At the generation cap, preserve the artifact and ledger. Reset only with the user's explicit permission, never to manufacture progress.

${FINDINGS_INSTRUCTIONS}

Do not ask for an API key. You are the model.`;

const TOOLS = [
  {
    name: "chorus_labs",
    description: "List Chorus labs. You are the model. Chorus reports unverified practice diagnostics.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chorus_exam",
    description:
      "Public practice fixture. Supply the exact artifact before seeing the input. Returns a single-use attemptId required by chorus_score.",
    inputSchema: {
      type: "object",
      properties: {
        artifact: { type: "string", description: "Exact artifact to freeze for this attempt." },
        labId: { type: "string", description: "rsi | prompt | eval | stress | data | generic" },
        level: { type: "integer", minimum: 0, description: "Omit to use the current level. Full passes advance automatically; no reset required." },
        userTest: { type: "string" },
      },
      required: ["artifact"],
    },
  },
  {
    name: "chorus_score",
    description:
      "Record unverified diagnostics for the exact artifact and test bound to a single-use attemptId. Cannot certify clean training data.",
    inputSchema: {
      type: "object",
      properties: {
        labId: { type: "string" },
        artifact: { type: "string" },
        attemptId: { type: "string", description: "Unused attemptId returned by chorus_exam for this exact artifact and test." },
        findings: { type: "string", description: FINDINGS_INSTRUCTIONS },
        level: { type: "integer", minimum: 0, description: "Omit to use the current level. Full passes advance automatically; no reset required." },
        userTest: { type: "string" },
        goal: { type: "string" },
        executor: { type: "string", description: "Claimed executor for display only. Never establishes independent execution." },
        reset: { type: "boolean", description: "Deprecated here: score never resets. Use chorus_sitting reset only with explicit permission." },
      },
      required: ["artifact", "attemptId"],
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
        attemptId: { type: "string", description: "Required for the exam seat; returned by chorus_next." },
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
    return fail(null, "Submit one request at a time; batches are not accepted.");
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
        serverInfo: { name: "chorus", version: "2.1.0" },
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
      try {
        return ok(msg.id, await callTool(msg.params ?? {}, ctx));
      } catch (err) {
        return ok(msg.id, textResult(err instanceof FindingsValidationError ? err.toResult() : { error: err instanceof Error ? err.message : "Request rejected" }, true));
      }
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
    return textResult(LABS.map((lab) => ({ id: lab.id, title: lab.title, blurb: lab.blurb, goal: lab.goal, maxLevel: maxFixtureLevel(lab.id) })));
  }
  if (name === "chorus_exam") {
    const sitting = await sittingFor(sessionId);
    const labId = args.labId === undefined ? sitting.labId : String(args.labId);
    const level = args.level === undefined ? sitting.level : args.level as number;
    const artifact = boundedText(args.artifact, "artifact", MAX_ARTIFACT, 8);
    const userTest = args.userTest === undefined ? undefined : String(args.userTest);
    const exam = examFor(labId, level, userTest);
    const attempt = await markExam(sessionId, labId, level, artifact, userTest);
    return textResult({ ...exam, ...attempt, progression: progressionFor(await sittingFor(sessionId)) });
  }
  if (name === "chorus_score") {
    if (args.reset === true) return textResult({ error: "Reset explicitly with chorus_sitting, then request a new chorus_exam." }, true);
    const artifact = boundedText(args.artifact, "artifact", MAX_ARTIFACT, 8);
    const current = await sittingFor(sessionId);
    const labId = args.labId === undefined ? current.labId : String(args.labId);
    const level = args.level === undefined ? current.level : args.level as number;
    const userTest = args.userTest === undefined ? undefined : String(args.userTest);
    const exam = examFor(labId, level, userTest);
    if (current.scores.length >= 8) return textResult({ error: "Generation cap reached. Preserve the ledger; reset only with explicit permission.", capped: true }, true);
    if (typeof args.attemptId !== "string" || !examReady(current, labId, level, artifact, args.attemptId, userTest)) {
      return textResult({ error: "chorus_exam first with this exact artifact and test. Supply its unused, unexpired attemptId." }, true);
    }
    // Validate and grade without side effects, then atomically consume exactly once.
    if (exam.execute || args.findings !== undefined) validateFindings(args.findings);
    const findings = args.findings as string | undefined;
    const graded = gradeArtifact({ labId, deliverable: artifact, findings, userTest, level });
    if (typeof args.attemptId !== "string" || !await consumeExam(sessionId,
      { labId, level, artifact, userTest }, args.attemptId)) {
      return textResult({ error: "chorus_exam first with this exact artifact and test. Supply its unused, unexpired attemptId." }, true);
    }
    const recorded = await recordScore(sessionId, artifact, graded,
      args.goal ? String(args.goal) : "", args.executor ? String(args.executor) : undefined);
    return textResult({
      ...recorded.graded, sittingId: recorded.sitting.id, pair: recorded.pair,
      pairCount: recorded.sitting.pairs.length, cleanPairCount: 0,
      generation: recorded.sitting.scores.length, capped: recorded.capped,
      progression: progressionFor(recorded.sitting),
      exhausted: Boolean(graded.exhausted),
      nextLevel: graded.exhausted ? null : recorded.sitting.level,
      hint: recorded.capped ? "Generation cap 8. Reset explicitly to start a new sitting." :
        graded.exhausted ? "Public practice ladder completed. This is not independent validation; clean training export is disabled." : graded.quoteHint,
    });
  }
  if (name === "chorus_new_sitting") {
    const sitting = await resetSitting(sessionId, args.labId ? String(args.labId) : undefined);
    return textResult({
      id: sitting.id,
      labId: sitting.labId,
      generations: 0,
      pairCount: 0,
      note: "Same MCP URL. Explicit reset completed. Run real evaluations; never fabricate a weak baseline to obtain pairs.",
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
    const clean = cleanTrainingRows(pairs);
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
    const result = await nextOrchestraSeat(sessionId);
    return textResult(result, "error" in result);
  }
  if (name === "chorus_fill") {
    const text = String(args.text ?? "");
    if (text.trim().length < 8) return textResult({ error: "Paste the seat's completion." }, true);
    boundedText(text, "completion", MAX_SEAT_TEXT, 8);
    const result = await fillOrchestraSeat(sessionId, String(args.seat ?? ""), text, typeof args.attemptId === "string" ? args.attemptId : undefined);
    return textResult(result, "error" in result);
  }
  return textResult({ error: `Unknown tool ${name}` }, true);
}
