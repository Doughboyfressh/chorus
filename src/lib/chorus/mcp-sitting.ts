import { validSitId } from "./mcp-url.ts";
import type { PreferencePair } from "./pairs.ts";
import type { Agent, EvalResult, Generation, SwarmRun } from "./types.ts";
import {
  applyFill,
  gradeMerge,
  mergeDeliverable,
  orchestraAgents,
  orchestraStaff,
  pendingSeat,
  seatPrompt,
  startOrchestraState,
  type Orchestra,
} from "./orchestra.ts";

export type McpSitting = {
  id: string;
  labId: string;
  lock?: string;
  level: number;
  artifact0?: string;
  current?: string;
  executor?: string;
  contract?: string;
  specialists?: { id: string; name: string; mandate: string }[];
  patches?: { specialist: string; patch: string }[];
  merge?: string;
  orchestra?: Orchestra;
  scores: {
    artifact: string;
    score: number;
    failed: string[];
    passed: string[];
    fixture: string;
    executor?: string;
    contaminated?: boolean;
  }[];
  pairs: PreferencePair[];
};

const MAX = 80;
const MAX_PAYLOAD = 400_000;
const MAX_ARTIFACT = 24_000;
const bySession = new Map<string, McpSitting>();

export { validSitId };

async function sqlClient() {
  if (typeof process !== "undefined" && process.env.NODE_TEST_CONTEXT) return null;
  try {
    const { getSql } = await import("../db.ts");
    return await getSql();
  } catch {
    return null;
  }
}

async function loadFromDb(id: string): Promise<McpSitting | null> {
  const sql = await sqlClient();
  if (!sql) return null;
  try {
    const rows = await sql<{ payload: string }>`
      select payload from chorus_mcp_sittings
      where id = ${id} and updated_at > now() - interval '14 days'
      limit 1
    `;
    const raw = rows[0]?.payload;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as McpSitting;
    if (!parsed?.id) return null;
    bySession.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function saveToDb(sitting: McpSitting) {
  const payload = JSON.stringify(sitting);
  if (payload.length > MAX_PAYLOAD) return;
  const sql = await sqlClient();
  if (!sql) return;
  try {
    await sql`
      insert into chorus_mcp_sittings (id, payload, updated_at)
      values (${sitting.id}, ${payload}, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now()
    `;
    await sql`delete from chorus_mcp_sittings where updated_at < now() - interval '14 days'`;
    await sql`
      delete from chorus_mcp_sittings
      where id in (
        select id from chorus_mcp_sittings
        order by updated_at desc
        offset 500
      )
    `;
  } catch {
    /* table missing in a fresh test process */
  }
}

function evict() {
  while (bySession.size > MAX) {
    const first = bySession.keys().next().value;
    if (!first) break;
    bySession.delete(first);
  }
}

export async function bindWriter(sessionId: string, writeKey?: string) {
  const sitting = await sittingFor(sessionId);
  if (!sitting.lock) {
    sitting.lock = writeKey && validSitId(writeKey) ? writeKey : crypto.randomUUID();
    await saveToDb(sitting);
    return { ok: true as const, lock: sitting.lock, sitting };
  }
  if (writeKey && writeKey === sitting.lock) {
    return { ok: true as const, lock: sitting.lock, sitting };
  }
  return {
    ok: false as const,
    error: "This sitting is bound to another host. Rotate it in the lab.",
    lock: sitting.lock,
    sitting,
  };
}

export async function assertWriter(sessionId: string, writeKey?: string) {
  const sitting = await sittingFor(sessionId);
  if (!sitting.lock) return { ok: true as const, sitting };
  if (writeKey && writeKey === sitting.lock) return { ok: true as const, sitting };
  return {
    ok: false as const,
    error: "This sitting is bound to another host. Rotate it in the lab.",
    sitting,
  };
}

export async function sittingFor(sessionId: string, labId = "prompt"): Promise<McpSitting> {
  const existing = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (existing) return existing;
  const sitting: McpSitting = { id: sessionId, labId, level: 0, scores: [], pairs: [] };
  bySession.set(sessionId, sitting);
  evict();
  await saveToDb(sitting);
  return sitting;
}

export function writerRanExam(executor?: string) {
  const e = (executor ?? "").trim().toLowerCase();
  if (!e || e.length < 6) return true;
  if (
    /^(self|host|same|this|writer|chorus|mcp[- ]?host|grok|claude|sonnet|opus|gemini|chatgpt|openai|anthropic|xai)([-_.].*)?$/.test(
      e,
    )
  ) {
    return true;
  }
  if (/\b(grok|claude|chatgpt|gpt-?[45]|gemini|sonnet|opus)\b/.test(e)) return true;
  return false;
}

export async function recordScore(sessionId: string, artifact: string, graded: EvalResult, goal = "", executor?: string) {
  const clipped = artifact.slice(0, MAX_ARTIFACT);
  const sitting = await sittingFor(sessionId, graded.labId);
  if (executor?.trim()) sitting.executor = executor.trim().slice(0, 80);
  const contaminated = writerRanExam(sitting.executor);
  sitting.labId = graded.labId;
  sitting.level = graded.level;
  sitting.current = clipped;
  if (!sitting.artifact0) sitting.artifact0 = clipped;
  const prev = sitting.scores.at(-1);
  if (sitting.scores.length >= 8) {
    await saveToDb(sitting);
    return { sitting, pair: null, graded, capped: true as const };
  }
  sitting.scores.push({
    artifact: clipped,
    score: graded.score,
    failed: graded.failed,
    passed: graded.passed,
    fixture: graded.fixture,
    executor: sitting.executor,
    contaminated,
  });
  let pair: PreferencePair | null = null;
  if (prev && graded.score > prev.score) {
    pair = {
      prompt: (goal || sitting.labId).slice(0, 800),
      rejected: prev.artifact,
      chosen: clipped,
      rejected_score: prev.score,
      chosen_score: graded.score,
      fixture: graded.fixture,
      model: sitting.executor || "mcp-host",
      labId: sitting.labId,
      generation: sitting.scores.length,
      contaminated,
    };
    sitting.pairs.push(pair);
  }
  evict();
  await saveToDb(sitting);
  return { sitting, pair, graded, capped: false as const };
}

function asEval(row: McpSitting["scores"][number], labId: string, level: number): EvalResult {
  const executor = row.executor || "MCP host";
  return {
    labId,
    fixture: row.fixture,
    score: row.score,
    passed: row.passed,
    failed: row.failed,
    evidence: executor,
    level,
    executor,
    contaminated: row.contaminated ?? writerRanExam(row.executor),
  };
}

function agentsFromSitting(sitting: McpSitting): Agent[] {
  if (sitting.orchestra) return orchestraAgents(sitting.orchestra);
  const staff = (sitting.specialists ?? []).slice(0, 3);
  const patchOf = (name: string) =>
    [...(sitting.patches ?? [])].reverse().find((row) => row.specialist.toLowerCase() === name.toLowerCase())?.patch;
  const agents: Agent[] = [
    {
      id: "host",
      role: "conductor",
      name: sitting.contract ? "Conductor" : "MCP host",
      mandate: (sitting.contract || "Host writes. Chorus grades.").slice(0, 400),
      status: sitting.scores.length ? "done" : sitting.contract ? "done" : "pending",
      headline: sitting.contract ? "Contract" : "MCP host",
      body: sitting.contract,
    },
    ...staff.map((row, i) => ({
      id: row.id || `s${i + 1}`,
      role: "specialist" as const,
      name: row.name,
      mandate: row.mandate,
      status: (patchOf(row.name) ? "done" : "pending") as Agent["status"],
      headline: patchOf(row.name) ? "Patch" : "Awaiting patch",
      body: patchOf(row.name),
    })),
  ];
  if (sitting.merge) {
    agents.push({
      id: "synthesizer",
      role: "synthesizer",
      name: "Synthesizer",
      mandate: "Merge specialist patches.",
      status: "done",
      headline: "Merged",
      body: sitting.merge,
    });
  }
  return agents;
}

export async function sittingToRun(sessionId: string): Promise<SwarmRun | null> {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (!sitting) return null;
  const agents = agentsFromSitting(sitting);
  if (sitting.scores.length === 0) {
    return {
      id: sitting.id,
      goal: sitting.labId,
      labId: sitting.labId,
      startedAt: Date.now(),
      phase: "idle",
      generation: 0,
      generations: [],
      agents,
      slotSnapshot: { mode: "custom", model: sitting.executor || "mcp-host", baseUrl: "mcp" },
    };
  }
  const first = sitting.scores[0]!;
  const last = sitting.scores.at(-1)!;
  const generations: Generation[] = sitting.scores.map((row, i) => ({
    n: i + 1,
    contract: sitting.contract || "MCP host sitting",
    whyThisSplit: "The host is the swarm. Chorus grades.",
    specialists: (sitting.specialists ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      mandate: s.mandate,
      lens: "",
    })),
    synthesis: {
      title: `Generation ${i + 1}`,
      deliverable: row.artifact,
      steps: [],
      watchouts: row.failed,
      pattern: { contract: sitting.contract ?? "", fanout: "", critique: "", merge: sitting.merge ?? "" },
    },
    evaluation: asEval(row, sitting.labId, sitting.level),
  }));
  return {
    id: sitting.id,
    goal: sitting.pairs[0]?.prompt || sitting.labId,
    labId: sitting.labId,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    phase: "done",
    generation: sitting.scores.length,
    generations,
    agents,
    synthesis: generations.at(-1)?.synthesis,
    evaluation: asEval(last, sitting.labId, sitting.level),
    fixtureLevel: sitting.level,
    pastedArtifact: sitting.artifact0,
    baseline: asEval(first, sitting.labId, sitting.level),
    slotSnapshot: { mode: "custom", model: sitting.executor || "mcp-host", baseUrl: "mcp" },
  };
}

export async function sittingSnapshot(sessionId: string) {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (!sitting) return null;
  return {
    id: sitting.id,
    labId: sitting.labId,
    level: sitting.level,
    generations: sitting.scores.length,
    currentScore: sitting.scores.at(-1)?.score ?? null,
    failed: sitting.scores.at(-1)?.failed ?? [],
    pairCount: sitting.pairs.length,
    executor: sitting.executor ?? null,
    specialists: (sitting.specialists ?? []).map((row) => row.name),
    contract: Boolean(sitting.contract),
    patches: sitting.patches?.length ?? 0,
    orchestra: sitting.orchestra
      ? { mode: sitting.orchestra.mode, pending: pendingSeat(sitting.orchestra), filled: Object.keys(sitting.orchestra.filled) }
      : null,
  };
}

export async function applySittingUpdate(
  sessionId: string,
  args: {
    labId?: string;
    reset?: boolean;
    contract?: string;
    specialists?: { name?: string; mandate?: string }[];
    specialist?: string;
    patch?: string;
    merge?: string;
    executor?: string;
    conduct?: boolean;
    goal?: string;
    pasted?: string;
  },
) {
  const existing = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (args.reset) {
    await resetSitting(sessionId, args.labId || existing?.labId);
  } else if (args.labId && existing && existing.labId !== args.labId && existing.scores.length > 0) {
    await resetSitting(sessionId, args.labId);
  }
  const sitting = await sittingFor(sessionId, args.labId || existing?.labId || "prompt");
  if (args.labId) sitting.labId = args.labId;
  if (args.executor?.trim()) sitting.executor = args.executor.trim().slice(0, 80);
  if (args.contract?.trim()) sitting.contract = args.contract.trim().slice(0, 8000);
  if (Array.isArray(args.specialists) && args.specialists.length) {
    sitting.specialists = args.specialists.slice(0, 3).map((row, i) => ({
      id: `s${i + 1}`,
      name: String(row.name || `Specialist ${i + 1}`).slice(0, 80),
      mandate: String(row.mandate || "").slice(0, 800),
    }));
  }
  if (args.specialist?.trim() && args.patch?.trim()) {
    sitting.patches = [
      ...(sitting.patches ?? []),
      { specialist: args.specialist.trim().slice(0, 80), patch: args.patch.trim().slice(0, 8000) },
    ].slice(-12);
  }
  if (args.merge?.trim()) sitting.merge = args.merge.trim().slice(0, 24_000);
  if (args.conduct) {
    sitting.orchestra = startOrchestraState({
      labId: sitting.labId,
      goal: args.goal,
      pasted: args.pasted || sitting.current || sitting.artifact0,
      recurse: sitting.scores.length > 0,
    });
  }
  await saveToDb(sitting);
  return sitting;
}

export async function nextOrchestraSeat(sessionId: string) {
  const sitting = await sittingFor(sessionId);
  if (!sitting.orchestra) {
    return { error: "No conducted sitting. chorus_sitting with conduct:true, or Run in the lab." };
  }
  const seat = pendingSeat(sitting.orchestra);
  if (!seat) {
    return { done: true, pairCount: sitting.pairs.length, generations: sitting.scores.length };
  }
  return { done: false, ...seatPrompt(sitting.orchestra, seat) };
}

export async function fillOrchestraSeat(sessionId: string, seat: string, text: string) {
  const sitting = await sittingFor(sessionId);
  if (!sitting.orchestra) {
    return { error: "No conducted sitting." };
  }
  const pending = pendingSeat(sitting.orchestra);
  if (!pending) return { error: "Every seat is filled.", done: true };
  if (seat && seat !== pending) {
    return { error: `Fill ${pending} next.`, pending };
  }
  sitting.orchestra = applyFill(sitting.orchestra, pending, text);
  const staff = orchestraStaff(sitting.orchestra);
  if (staff) {
    sitting.contract = staff.contract;
    sitting.specialists = staff.specialists.map((row) => ({
      id: row.id,
      name: row.name,
      mandate: row.mandate,
    }));
  }
  if (pending === "synthesizer") {
    sitting.merge = sitting.orchestra.filled.synthesizer;
    const graded = gradeMerge(sitting.orchestra, sitting.labId, sitting.level);
    if (graded) {
      const recorded = await recordScore(
        sessionId,
        mergeDeliverable(sitting.orchestra) || text,
        graded,
        sitting.orchestra.goal,
        sitting.executor,
      );
      recorded.sitting.orchestra = sitting.orchestra;
      await saveToDb(recorded.sitting);
      const next = pendingSeat(recorded.sitting.orchestra!);
      return {
        filled: pending,
        pending: next,
        done: !next,
        graded,
        pair: recorded.pair,
        generation: recorded.sitting.scores.length,
      };
    }
  }
  await saveToDb(sitting);
  const next = pendingSeat(sitting.orchestra);
  return { filled: pending, pending: next, done: !next };
}

export async function sittingPairs(sessionId: string) {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  return sitting?.pairs ?? [];
}

export async function resetSitting(sessionId: string, labId?: string) {
  const existing = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  const sitting: McpSitting = {
    id: sessionId,
    labId: labId || existing?.labId || "rsi",
    level: 0,
    scores: [],
    pairs: [],
    lock: existing?.lock,
  };
  bySession.set(sessionId, sitting);
  await saveToDb(sitting);
  return sitting;
}

export async function dropSession(sessionId: string) {
  bySession.delete(sessionId);
  const sql = await sqlClient();
  if (!sql) return;
  try {
    await sql`delete from chorus_mcp_sittings where id = ${sessionId}`;
  } catch {
    /* ignore */
  }
}
