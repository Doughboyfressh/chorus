import type { PreferencePair } from "./pairs.ts";
import type { Agent, EvalResult, Generation, SwarmRun } from "./types.ts";

export type McpSitting = {
  id: string;
  labId: string;
  lock?: string;
  level: number;
  artifact0?: string;
  current?: string;
  scores: { artifact: string; score: number; failed: string[]; passed: string[]; fixture: string }[];
  pairs: PreferencePair[];
};

const MAX = 80;
const MAX_PAYLOAD = 400_000;
const MAX_ARTIFACT = 24_000;
const bySession = new Map<string, McpSitting>();

export function validSitId(id: string) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id);
}

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

export async function recordScore(sessionId: string, artifact: string, graded: EvalResult, goal = "") {
  const clipped = artifact.slice(0, MAX_ARTIFACT);
  const sitting = await sittingFor(sessionId, graded.labId);
  sitting.labId = graded.labId;
  sitting.level = graded.level;
  sitting.current = clipped;
  if (!sitting.artifact0) sitting.artifact0 = clipped;
  const prev = sitting.scores.at(-1);
  if (sitting.scores.length >= 8) {
    await saveToDb(sitting);
    return { sitting, pair: null, graded };
  }
  sitting.scores.push({
    artifact: clipped,
    score: graded.score,
    failed: graded.failed,
    passed: graded.passed,
    fixture: graded.fixture,
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
      model: "mcp-host",
      labId: sitting.labId,
      generation: sitting.scores.length,
    };
    sitting.pairs.push(pair);
  }
  evict();
  await saveToDb(sitting);
  return { sitting, pair, graded };
}

function asEval(
  row: McpSitting["scores"][number],
  labId: string,
  level: number,
): EvalResult {
  return {
    labId,
    fixture: row.fixture,
    score: row.score,
    passed: row.passed,
    failed: row.failed,
    evidence: "MCP host",
    level,
    executor: "MCP host",
    contaminated: true,
  };
}

export async function sittingToRun(sessionId: string): Promise<SwarmRun | null> {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  if (!sitting || sitting.scores.length === 0) return null;
  const first = sitting.scores[0]!;
  const last = sitting.scores.at(-1)!;
  const generations: Generation[] = sitting.scores.map((row, i) => ({
    n: i + 1,
    contract: "MCP host sitting",
    whyThisSplit: "The host is the swarm. Chorus grades.",
    specialists: [],
    synthesis: {
      title: `Generation ${i + 1}`,
      deliverable: row.artifact,
      steps: [],
      watchouts: row.failed,
      pattern: { contract: "", fanout: "", critique: "", merge: "" },
    },
    evaluation: asEval(row, sitting.labId, sitting.level),
  }));
  const done = (id: Agent["id"], role: Agent["role"], name: string): Agent => ({
    id,
    role,
    name,
    mandate: "MCP host",
    status: "done",
    headline: "Host sitting",
  });
  return {
    id: sitting.id,
    goal: sitting.pairs[0]?.prompt || sitting.labId,
    labId: sitting.labId,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    phase: "done",
    generation: sitting.scores.length,
    generations,
    agents: [
      done("conductor", "conductor", "Conductor"),
      done("s1", "specialist", "Specialist 1"),
      done("s2", "specialist", "Specialist 2"),
      done("s3", "specialist", "Specialist 3"),
      done("critic", "critic", "Critic"),
      done("synthesizer", "synthesizer", "Synthesizer"),
      done("improver", "improver", "Improver"),
      done("judge", "judge", "Judge"),
    ],
    synthesis: generations.at(-1)?.synthesis,
    evaluation: asEval(last, sitting.labId, sitting.level),
    fixtureLevel: sitting.level,
    pastedArtifact: sitting.artifact0,
    baseline: asEval(first, sitting.labId, sitting.level),
    slotSnapshot: { mode: "custom", model: "mcp-host", baseUrl: "mcp" },
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
  };
}

export async function sittingPairs(sessionId: string) {
  const sitting = bySession.get(sessionId) ?? (await loadFromDb(sessionId));
  return sitting?.pairs ?? [];
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
