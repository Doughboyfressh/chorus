import { executionProfile, profileKey, sessionExecutionContext, type ExecutionProfile } from "./execution-profile.ts";
import { validateFindings } from "./findings.ts";
import { maxFixtureLevel } from "./fixtures.ts";
import { requireDurableDatabase } from "./durable-storage.ts";
import { writeSnapshot } from "./snapshot-store.ts";
import { validSitId } from "./mcp-url.ts";
import { gradeArtifact } from "./grade.ts";
import { diagnosticPair, type PreferencePair } from "./pairs.ts";
import { boundedText, GRADER_VERSION, INTEGRITY_NOTE, MAX_ARTIFACT, quarantine } from "./integrity.ts";
import { issueAttempt, consumeAttempt, invalidateAttempts, type ExamBinding } from "./attempts.ts";
import { examFor } from "./grade.ts";
import type { Agent, EvalResult, Generation, SwarmRun } from "./types.ts";
import {
  applyFill,
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
  revision?: number;
  labId: string;
  lock?: string;
  level: number;
  artifact0?: string;
  current?: string;
  executor?: string;
  executionId?: string;
  executionConfig?: ExecutionProfile;
  contract?: string;
  specialists?: { id: string; name: string; mandate: string }[];
  patches?: { specialist: string; patch: string }[];
  merge?: string;
  orchestra?: Orchestra;
  exam?: ExamBinding & { attemptId: string; expiresAt: number };
  scores: {
    artifact: string;
    evaluation?: EvalResult;
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
const bySession = new Map<string, McpSitting>();

export { validSitId };

async function sqlClient() {
  if (typeof process !== "undefined" && process.env.NODE_TEST_CONTEXT) return null;
  try {
    requireDurableDatabase(process.env);
    const { getSql } = await import("../db.ts");
    return await getSql();
  } catch {
    throw new Error("Sitting storage is unavailable; no unverified fallback is permitted.");
  }
}

async function loadFromDb(id: string): Promise<McpSitting | null> {
  const sql = await sqlClient();
  if (!sql) return null;
  try {
    const rows = await sql<{ payload: string; revision: number }>`
      select payload, revision from chorus_mcp_sittings
      where id = ${id} and updated_at > now() - interval '14 days'
      limit 1
    `;
    const raw = rows[0]?.payload;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as McpSitting;
    if (parsed?.id !== id || !Array.isArray(parsed.scores) || !Array.isArray(parsed.pairs)) throw new Error("Invalid stored sitting");
    parsed.revision = Number(rows[0].revision);
    bySession.set(id, parsed);
    return parsed;
  } catch {
    throw new Error("Stored sitting could not be read safely.");
  }
}

async function saveToDb(sitting: McpSitting) {
  const payload = JSON.stringify(sitting);
  if (payload.length > MAX_PAYLOAD) throw new Error("Sitting is too large to record safely.");
  const sql = await sqlClient();
  if (!sql) return;
  try {
    sitting.revision = await writeSnapshot(sql, sitting.id, payload, sitting.revision ?? 0);
    await sql`delete from chorus_mcp_sittings where updated_at < now() - interval '14 days'`;
    await sql`
      delete from chorus_mcp_sittings
      where id in (
        select id from chorus_mcp_sittings
        order by updated_at desc
        offset 500
      )
    `;
  } catch (err) {
    bySession.delete(sitting.id);
    throw err;
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

function contextFor(sitting: McpSitting) {
  sitting.executionId ??= crypto.randomUUID();
  return sessionExecutionContext(sitting.executionId, sitting.executionConfig);
}

async function configureExecution(sitting: McpSitting, value: unknown) {
  const profile = executionProfile(value);
  if (profileKey(sitting.executionConfig) !== profileKey(profile)) {
    await invalidateAttempts(sitting.id);
    delete sitting.exam;
    sitting.executionConfig = profile;
  }
}

export async function markExam(sessionId: string, labId: string, level: number, artifact: string, userTest?: string, executionConfig?: unknown) {
  const sitting = await sittingFor(sessionId, labId);
  examFor(labId, level, userTest); // Reject unknown labs and invalid levels before changing state.
  boundedText(artifact, "artifact", MAX_ARTIFACT, 8);
  if (sitting.scores.length >= 8) throw new Error("Generation cap reached. Preserve the ledger; reset only with explicit permission.");
  if (sitting.scores.length && (sitting.labId !== labId || sitting.level !== level)) {
    throw new Error(`Lab is pinned to ${sitting.labId}; current level is ${sitting.level}. Omit level to use it. A full pass advances automatically without reset. Explicit reset is required only to change labs or restart at another level.`);
  }
  if (executionConfig !== undefined) await configureExecution(sitting, executionConfig);
  const binding = { labId, level, artifact, userTest, graderVersion: GRADER_VERSION, executionContext: contextFor(sitting) };
  const attempt = await issueAttempt(sessionId, binding);
  sitting.labId = labId;
  sitting.level = level;
  sitting.exam = { ...binding, ...attempt };
  await saveToDb(sitting);
  return { ...attempt, graderVersion: GRADER_VERSION, executionContext: binding.executionContext };
}

export function examReady(sitting: Pick<McpSitting, "exam" | "executionId" | "executionConfig">, labId: string, level: number,
  artifact: string, attemptId: string, userTest?: string) {
  const exam = sitting.exam;
  return Boolean(exam && exam.graderVersion === GRADER_VERSION && sitting.executionId &&
    exam.executionContext === sessionExecutionContext(sitting.executionId, sitting.executionConfig) && exam.attemptId === attemptId && exam.expiresAt > Date.now() &&
    exam.labId === labId && exam.level === level && exam.artifact === artifact &&
    (exam.userTest ?? "") === (userTest ?? ""));
}

export async function consumeExam(sessionId: string, binding: ExamBinding, attemptId: string) {
  const current = await sittingFor(sessionId);
  if (!examReady(current, binding.labId, binding.level, binding.artifact, attemptId, binding.userTest)) return false;
  if (!await consumeAttempt(sessionId, attemptId, { ...binding, graderVersion: GRADER_VERSION, executionContext: current.exam!.executionContext })) return false;
  delete current.exam;
  await saveToDb(current);
  return true;
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

export function writerRanExam(_executor?: string) {
  // A user-supplied name cannot establish that a different model ran anything.
  return true;
}

export async function recordScore(sessionId: string, artifact: string, graded: EvalResult, goal = "", executor?: string, expectedContext?: string) {
  boundedText(artifact, "artifact", MAX_ARTIFACT, 8);
  const sitting = await sittingFor(sessionId, graded.labId);
  if (sitting.scores.length >= 8) return { sitting, pair: null, graded, capped: true as const };
  if (sitting.scores.length && (sitting.labId !== graded.labId || sitting.level !== graded.level)) {
    throw new Error(`Lab is pinned to ${sitting.labId}; current level is ${sitting.level}. Omit level to use it. A full pass advances automatically without reset. Explicit reset is required only to change labs or restart at another level.`);
  }
  if (expectedContext !== undefined && expectedContext !== contextFor(sitting)) throw new Error("Execution configuration changed; no score was recorded. Request a new exam.");
  if (executor?.trim()) sitting.executor = executor.trim().slice(0, 80);
  const evaluation = quarantine({ ...graded, executionContext: contextFor(sitting), executor: sitting.executor || "mcp-host" });
  const prev = sitting.scores.at(-1);
  const pair = prev ? diagnosticPair({
    prompt: (goal || sitting.labId).slice(0, 800), rejected: prev.artifact, chosen: artifact,
    previous: prev.evaluation, current: evaluation, model: sitting.executor || "mcp-host",
    generation: sitting.scores.length + 1,
  }) : null;
  sitting.labId = graded.labId;
  sitting.level = graded.score >= 100 && graded.failed.length === 0 && !graded.exhausted ? graded.level + 1 : graded.level;
  sitting.current = artifact;
  if (!sitting.artifact0) sitting.artifact0 = artifact;
  sitting.scores.push({ artifact, evaluation, score: graded.score, failed: graded.failed,
    passed: graded.passed, fixture: graded.fixture, executor: sitting.executor, contaminated: true });
  if (pair) sitting.pairs.push(pair);
  evict();
  await saveToDb(sitting);
  return { sitting, pair, graded: evaluation, capped: false as const };
}

function asEval(row: McpSitting["scores"][number], labId: string, level: number): EvalResult {
  const executor = row.executor || "MCP host";
  return quarantine(row.evaluation ?? {
    labId, fixture: row.fixture, score: row.score, passed: row.passed, failed: row.failed,
    evidence: "Legacy result; original test identity and execution were not verified.", level, executor,
  });
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

export function progressionFor(sitting: McpSitting) {
  const last = sitting.scores.at(-1)?.evaluation;
  return { currentLevel: sitting.level, lastScoredLevel: last?.level ?? null,
    maxLevel: maxFixtureLevel(sitting.labId), capped: sitting.scores.length >= 8,
    exhausted: Boolean(last?.exhausted),
    policy: "A full diagnostic pass automatically advances one level without reset. Omit level on the next exam. Comparisons are within the same test only; clean training stays locked." };
}

export async function sittingSnapshot(sessionId: string) {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (!sitting) return null;
  return {
    id: sitting.id,
    labId: sitting.labId,
    level: sitting.level,
    progression: progressionFor(sitting),
    generations: sitting.scores.length,
    currentScore: sitting.scores.at(-1)?.score ?? null,
    verified: false,
    integrityNote: INTEGRITY_NOTE,
    cleanPairCount: 0,
    failed: sitting.scores.at(-1)?.failed ?? [],
    pairCount: sitting.pairs.length,
    executor: sitting.executor ?? null,
    executionConfig: sitting.executionConfig ?? null,
    executionContext: sitting.executionId ? contextFor(sitting) : null,
    graderVersion: GRADER_VERSION,
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
    executionConfig?: unknown;
    conduct?: boolean;
    goal?: string;
    pasted?: string;
  },
) {
  if (args.labId !== undefined) examFor(args.labId, 0);
  const existing = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (args.reset) {
    await resetSitting(sessionId, args.labId || existing?.labId);
  } else if (args.labId && existing && existing.labId !== args.labId && existing.scores.length > 0) {
    throw new Error("Lab is pinned. Use an explicit reset to change labs; existing history was not erased.");
  }
  const sitting = await sittingFor(sessionId, args.labId || existing?.labId || "prompt");
  if (args.labId) sitting.labId = args.labId;
  if (args.executionConfig !== undefined) await configureExecution(sitting, args.executionConfig);
  if (args.executor?.trim()) sitting.executor = args.executor.trim().slice(0, 80);
  if (args.contract?.trim()) sitting.contract = boundedText(args.contract, "contract", MAX_ARTIFACT, 1);
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
      { specialist: args.specialist.trim().slice(0, 80), patch: boundedText(args.patch, "patch", MAX_ARTIFACT, 1) },
    ].slice(-12);
  }
  if (args.merge?.trim()) sitting.merge = boundedText(args.merge, "artifact", MAX_ARTIFACT, 8);
  if (args.conduct) {
    sitting.orchestra = startOrchestraState({
      labId: sitting.labId,
      goal: args.goal,
      pasted: args.pasted || sitting.current || sitting.artifact0,
      recurse: sitting.scores.length > 0,
      level: sitting.level,
      priorStaff:
        sitting.orchestra?.filled.conductor ||
        (sitting.contract
          ? JSON.stringify({
              contract: sitting.contract,
              specialists: sitting.specialists ?? [],
            })
          : undefined),
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
    return { done: true, pairCount: sitting.pairs.length, cleanPairCount: 0, generations: sitting.scores.length, progression: progressionFor(sitting) };
  }
  if (seat === "exam") {
    if (sitting.scores.length >= 8) return { error: "Generation cap reached. Existing artifact and ledger are preserved.", capped: true };
    const artifact = mergeDeliverable(sitting.orchestra) || sitting.current || "";
    let attempt = sitting.exam;
    if (!attempt || !examReady(sitting, sitting.labId, sitting.level, artifact, attempt.attemptId)) {
      await markExam(sessionId, sitting.labId, sitting.level, artifact);
      attempt = sitting.exam;
    }
    return { done: false, ...seatPrompt({ ...sitting.orchestra, labId: sitting.labId, level: sitting.level }, seat), attemptId: attempt?.attemptId,
      note: "Return this attemptId with chorus_fill. This is unverified practice, not an independent exam." };
  }
  return { done: false, ...seatPrompt(sitting.orchestra, seat) };
}

export async function fillOrchestraSeat(sessionId: string, seat: string, text: string, attemptId?: string) {
  const sitting = await sittingFor(sessionId);
  if (!sitting.orchestra) {
    return { error: "No conducted sitting." };
  }
  const pending = pendingSeat(sitting.orchestra);
  if (!pending) return { error: "Every seat is filled.", done: true };
  if (seat && seat !== pending) {
    return { error: `Fill ${pending} next.`, pending };
  }
  let examGrade: EvalResult | undefined;
  let boundExecutionContext: string | undefined;
  if (pending === "exam") {
    if (sitting.scores.length >= 8) return { error: "Generation cap reached. Existing artifact and ledger are preserved.", capped: true };
    validateFindings(text); // BEFORE consuming the attempt or filling the seat.
    const artifact = mergeDeliverable(sitting.orchestra) || sitting.current || "";
    boundExecutionContext = sitting.exam?.executionContext;
    examGrade = gradeArtifact({ labId: sitting.labId, deliverable: artifact, findings: text, level: sitting.level });
    if (!attemptId || !await consumeExam(sessionId, { labId: sitting.labId, level: sitting.level, artifact }, attemptId)) {
      return { error: "Request chorus_next and submit its unused attemptId for this exact artifact." };
    }
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
  }
  if (pending === "exam") {
    const deliverable = mergeDeliverable(sitting.orchestra) || sitting.current || "";
    const graded = examGrade!;
    const recorded = await recordScore(
      sessionId,
      deliverable || text,
      graded,
      sitting.orchestra.goal,
      sitting.executor,
      boundExecutionContext,
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
      pairCount: recorded.sitting.pairs.length, cleanPairCount: 0,
      progression: progressionFor(recorded.sitting),
    };
  }
  await saveToDb(sitting);
  const next = pendingSeat(sitting.orchestra);
  return { filled: pending, pending: next, done: !next };
}

export async function sittingPairs(sessionId: string) {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  return (sitting?.pairs ?? []).map((row) => ({ ...row, contaminated: true, verified: false as const, integrityNote: INTEGRITY_NOTE }));
}

export async function resetSitting(sessionId: string, labId?: string) {
  if (labId !== undefined) examFor(labId, 0);
  await invalidateAttempts(sessionId);
  const existing = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  const sitting: McpSitting = {
    id: sessionId,
    labId: labId || existing?.labId || "rsi",
    level: 0,
    scores: [],
    pairs: [],
    lock: existing?.lock,
    revision: existing?.revision,
  };
  bySession.set(sessionId, sitting);
  await saveToDb(sitting);
  return sitting;
}

export async function dropSession(sessionId: string) {
  await invalidateAttempts(sessionId);
  bySession.delete(sessionId);
  const sql = await sqlClient();
  if (!sql) return;
  try {
    await sql`delete from chorus_mcp_sittings where id = ${sessionId}`;
  } catch {
    /* ignore */
  }
}
