import { create } from "zustand";
import { HISTORY_LIMIT } from "./labs";
import { lastCompleteGeneration } from "./ledger";
import { loadMcpSit } from "./mcp-url";
import { saveSlot, EMPTY_SLOT, loadExecutor, saveExecutor, snapshotSlot, resolveExecutor, loadLane, saveLane, laneReady, type ModelSlot, type Lane } from "./slot";
import { upsertSitting } from "./sittings";
import type {
  Agent,
  ConductResult,
  CritiqueResult,
  EvalResult,
  FindingBlock,
  Generation,
  ImproveResult,
  JudgeResult,
  Phase,
  SpecialistBrief,
  SwarmRun,
  SynthesisResult,
} from "./types";

const HISTORY_KEY = "chorus.history.v1";
const SESSION_KEY = "chorus.session.v1";
const BASELINE_KEY = "chorus.baseline.v1";

export function ghostAgents(): Agent[] {
  return [
    {
      id: "conductor",
      role: "conductor",
      name: "Conductor",
      mandate: "Write the contract and staff non-overlapping specialists.",
      status: "pending",
    },
    {
      id: "s1",
      role: "specialist",
      name: "Specialist A",
      mandate: "Awaiting brief",
      status: "pending",
    },
    {
      id: "s2",
      role: "specialist",
      name: "Specialist B",
      mandate: "Awaiting brief",
      status: "pending",
    },
    {
      id: "s3",
      role: "specialist",
      name: "Specialist C",
      mandate: "Awaiting brief",
      status: "pending",
    },
    {
      id: "critic",
      role: "critic",
      name: "Critic",
      mandate: "Find holes, overlap, and confident-wrong claims.",
      status: "pending",
    },
    {
      id: "synthesizer",
      role: "synthesizer",
      name: "Synthesizer",
      mandate: "Merge survivors into one deliverable.",
      status: "pending",
    },
    {
      id: "improver",
      role: "improver",
      name: "Improver",
      mandate: "Close the judge's open holes. Freeze what already closed.",
      status: "pending",
    },
    {
      id: "judge",
      role: "judge",
      name: "Judge",
      mandate: "Score whether named holes actually closed. Slogans do not count.",
      status: "pending",
    },
  ];
}

export function hostAgents(): Agent[] {
  return [
    {
      id: "host",
      role: "conductor",
      name: "MCP host",
      mandate: "Host writes. Chorus grades.",
      status: "done",
      headline: "MCP host",
    },
  ];
}

function normalizeRun(run: SwarmRun): SwarmRun {
  return {
    ...run,
    generation: run.generation ?? 1,
    generations: Array.isArray(run.generations) ? run.generations : [],
    agents: Array.isArray(run.agents) && run.agents.length > 0 ? run.agents : ghostAgents(),
  };
}

export function loadBaseline(): {
  pasted: string;
  userTest: string;
  labId?: string;
  evaluation: EvalResult;
} | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      pasted?: string;
      userTest?: string;
      labId?: string;
      evaluation?: EvalResult;
    };
    if (!parsed.evaluation || typeof parsed.evaluation.score !== "number") return null;
    return {
      pasted: String(parsed.pasted ?? ""),
      userTest: String(parsed.userTest ?? ""),
      labId: parsed.labId,
      evaluation: parsed.evaluation,
    };
  } catch {
    return null;
  }
}

function saveBaseline(pasted: string, userTest: string, labId: string | undefined, evaluation: EvalResult) {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify({ pasted, userTest, labId, evaluation }));
  } catch {
    /* ignore */
  }
}

function clearBaseline() {
  try {
    localStorage.removeItem(BASELINE_KEY);
  } catch {
    /* ignore */
  }
}

export function baselineAsGeneration(run: SwarmRun): Generation | undefined {
  if (!run.baseline) return undefined;
  return {
    n: 0,
    contract: "Pasted artifact",
    whyThisSplit: "",
    specialists: [],
    synthesis: {
      title: "Gen 0 · pasted",
      deliverable: run.pastedArtifact ?? "",
      steps: [],
      watchouts: run.baseline.failed,
      pattern: { contract: "", fanout: "", critique: "", merge: "" },
    },
    evaluation: run.baseline,
  };
}

export function loadHistory(): SwarmRun[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SwarmRun[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT).map(normalizeRun) : [];
  } catch {
    return [];
  }
}

export function loadSession(): SwarmRun | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwarmRun;
    if (!parsed?.id) return null;
    const busy =
      parsed.phase === "conduct" ||
      parsed.phase === "fanout" ||
      parsed.phase === "critique" ||
      parsed.phase === "merge" ||
      parsed.phase === "eval" ||
      parsed.phase === "improve" ||
      parsed.phase === "judge";
    if (busy) {
      parsed.phase = parsed.synthesis ? "done" : "error";
      parsed.error = parsed.error ?? "Interrupted. Resume from the last merge.";
    }
    return normalizeRun(parsed);
  } catch {
    return null;
  }
}

function saveHistory(runs: SwarmRun[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, HISTORY_LIMIT)));
  } catch {
    /* ignore quota */
  }
}

function persistNow(run: SwarmRun) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(run));
  } catch {
    /* ignore quota */
  }
}

function persistFinished(run: SwarmRun, history: SwarmRun[]) {
  saveHistory(history);
  persistNow(run);
  void upsertSitting({ data: { sitting: run } }).catch(() => {
    /* signed out or sync failed — local ledger still holds */
  });
}

export type LedgerFile = {
  v: 1;
  exportedAt: number;
  history: SwarmRun[];
  session: SwarmRun | null;
  baseline: ReturnType<typeof loadBaseline>;
};

export function exportLedgerFile(): LedgerFile {
  return {
    v: 1,
    exportedAt: Date.now(),
    history: loadHistory(),
    session: loadSession(),
    baseline: loadBaseline(),
  };
}

export function applyLedgerFile(file: LedgerFile) {
  saveHistory(file.history.map(normalizeRun).slice(0, HISTORY_LIMIT));
  if (file.session) persistNow(normalizeRun(file.session));
  if (file.baseline?.evaluation) {
    saveBaseline(
      file.baseline.pasted,
      file.baseline.userTest,
      file.baseline.labId,
      file.baseline.evaluation,
    );
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function patchAgent(agents: Agent[], id: string, patch: Partial<Agent>): Agent[] {
  return agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent));
}

function snapshotGeneration(run: SwarmRun): Generation {
  return {
    n: run.generation ?? 1,
    contract: run.contract ?? "",
    whyThisSplit: run.whyThisSplit ?? "",
    specialists: run.agents
      .filter((a) => a.role === "specialist")
      .map((a) => ({
        id: a.id,
        name: a.name,
        mandate: a.mandate,
        lens: a.lens ?? "",
      })),
    critique: run.critique,
    synthesis: run.synthesis,
    delta: run.delta,
    judge: run.judge,
    evaluation: run.evaluation,
  };
}

type SpecialistRow = SpecialistBrief & FindingBlock & { error?: string };

type Store = {
  goal: string;
  labId?: string;
  selectedId: string | null;
  aiAvailable: boolean | null;
  hostedAvailable: boolean | null;
  slot: ModelSlot;
  lane: Lane;
  executor: ModelSlot | null;
  history: SwarmRun[];
  run: SwarmRun | null;
  viewingN: number;
  pasted: string;
  userTest: string;
  baseline: EvalResult | null;
  mcpSitEpoch: number;
  setGoal: (goal: string, labId?: string) => void;
  setSelected: (id: string | null) => void;
  setAiAvailable: (v: boolean) => void;
  setHostedAvailable: (v: boolean) => void;
  setSlot: (slot: ModelSlot) => void;
  setLane: (lane: Lane) => void;
  setExecutor: (slot: ModelSlot | null) => void;
  setHistory: (runs: SwarmRun[]) => void;
  mergeRemoteSittings: (runs: SwarmRun[]) => void;
  setViewingN: (n: number) => void;
  setPasted: (text: string) => void;
  setUserTest: (text: string) => void;
  setBaseline: (evaluation: EvalResult | null) => void;
  hydrateBaseline: (payload: {
    pasted: string;
    userTest: string;
    labId?: string;
    evaluation: EvalResult;
  }) => void;
  begin: (goal: string, labId?: string) => string;
  setPhase: (phase: Phase) => void;
  applyConductor: (result: ConductResult) => void;
  markSpecialistsRunning: () => void;
  applySpecialist: (row: SpecialistRow) => void;
  beginCritique: () => void;
  applyCritique: (critique: CritiqueResult) => void;
  applySynthesis: (synthesis: SynthesisResult) => void;
  applyEval: (evaluation: EvalResult) => void;
  beginImprove: () => void;
  applyImprover: (result: ImproveResult) => void;
  beginJudge: () => void;
  applyJudge: (judge: JudgeResult) => void;
  skipJudge: (error: string) => void;
  sealGeneration: () => void;
  fail: (error: string) => void;
  restore: (run: SwarmRun) => void;
  ingestMcpRun: (run: SwarmRun) => void;
  bumpMcpSit: () => void;
  openFixtureSitting: (evaluation: EvalResult) => void;
  seedFrom: (source: SwarmRun) => void;
  reset: () => void;
};

export const useChorus = create<Store>((set, get) => ({
  goal: "",
  labId: undefined,
  selectedId: "conductor",
  aiAvailable: true,
  hostedAvailable: null,
  slot: EMPTY_SLOT,
  lane: loadLane(),
  executor: loadExecutor(),
  history: [],
  run: null,
  viewingN: 1,
  pasted: "",
  userTest: "",
  baseline: null,
  mcpSitEpoch: 0,
  setGoal: (goal, labId) => set({ goal, labId }),
  setSelected: (id) => set({ selectedId: id }),
  setAiAvailable: (v) => set({ aiAvailable: v }),
  setHostedAvailable: (v) =>
    set((state) => ({
      hostedAvailable: v,
      aiAvailable: laneReady(state.lane, state.slot),
    })),
  setSlot: (next) => {
    saveSlot(next);
    set((state) => ({
      slot: next,
      aiAvailable: laneReady(state.lane, next),
    }));
  },
  setLane: (lane) => {
    saveLane(lane);
    set((state) => ({
      lane,
      aiAvailable: laneReady(lane, state.slot),
    }));
  },
  setExecutor: (next) => {
    saveExecutor(next);
    set({ executor: next });
  },
  setHistory: (runs) => set({ history: runs }),
  mergeRemoteSittings: (runs) => {
    if (!Array.isArray(runs) || runs.length === 0) return;
    const incoming = runs.map(normalizeRun);
    const local = get().history;
    const byId = new Map<string, SwarmRun>();
    for (const item of [...local, ...incoming]) byId.set(item.id, item);
    const history = [...byId.values()]
      .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
      .slice(0, HISTORY_LIMIT);
    saveHistory(history);
    set({ history });
  },
  setViewingN: (n) => set({ viewingN: n }),
  setPasted: (text) => {
    clearBaseline();
    set({ pasted: text, baseline: null });
  },
  setUserTest: (text) => {
    clearBaseline();
    set({ userTest: text, baseline: null });
  },
  setBaseline: (evaluation) => {
    const state = get();
    if (evaluation) saveBaseline(state.pasted, state.userTest, state.labId, evaluation);
    else clearBaseline();
    set({ baseline: evaluation });
  },
  hydrateBaseline: (payload) => {
    set({
      pasted: payload.pasted,
      userTest: payload.userTest,
      baseline: payload.evaluation,
      labId: payload.labId ?? get().labId,
    });
  },
  begin: (goal, labId) => {
    const id =
      get().lane === "mcp"
        ? loadMcpSit()
        : typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `run-${Date.now()}`;
    const slot = get().slot;
    const resolved = resolveExecutor(slot, get().executor, get().hostedAvailable);
    const snapshot = snapshotSlot(slot);
    const executorSnapshot = snapshotSlot(resolved.slot);
    const run: SwarmRun = {
      id,
      goal,
      labId,
      startedAt: Date.now(),
      phase: "conduct",
      generation: 1,
      generations: [],
      fixtureLevel: 0,
      pastedArtifact: get().pasted.trim() || undefined,
      userTest: get().userTest.trim() || undefined,
      baseline: get().baseline ?? undefined,
      slotSnapshot: snapshot,
      executorSnapshot,
      agents: ghostAgents().map((agent) =>
        agent.id === "conductor" ? { ...agent, status: "running" } : agent,
      ),
    };
    persistNow(run);
    set({ run, goal, labId, selectedId: "conductor", viewingN: 1 });
    return id;
  },
  setPhase: (phase) => {
    const run = get().run;
    if (!run) return;
    set({ run: { ...run, phase } });
  },
  applyConductor: (result) => {
    const run = get().run;
    if (!run) return;
    const specialists: Agent[] = result.specialists.map((brief) => ({
      id: brief.id,
      role: "specialist",
      name: brief.name,
      mandate: brief.mandate,
      lens: brief.lens,
      status: "pending",
    }));
    const others = run.agents.filter((a) => a.role !== "specialist");
    const agents = [
      ...patchAgent(others, "conductor", {
        status: "done",
        headline: "Contract set",
        body: result.contract,
        findings: [result.whyThisSplit],
        handoff: result.whyThisSplit,
      }),
      ...specialists,
    ];
    const next: SwarmRun = {
      ...run,
      phase: "fanout",
      contract: result.contract,
      whyThisSplit: result.whyThisSplit,
      agents,
    };
    persistNow(next);
    set({
      run: next,
      selectedId: specialists[0]?.id ?? "conductor",
    });
  },
  markSpecialistsRunning: () => {
    const run = get().run;
    if (!run) return;
    set({
      run: {
        ...run,
        agents: run.agents.map((a) =>
          a.role === "specialist" ? { ...a, status: "running" } : a,
        ),
      },
    });
  },
  applySpecialist: (row) => {
    const run = get().run;
    if (!run) return;
    const patch: Partial<Agent> = row.error
      ? { status: "error", error: row.error, headline: row.headline }
      : {
          status: "done",
          headline: row.headline,
          findings: row.findings,
          risks: row.risks,
          handoff: row.handoff,
          body: row.patch || undefined,
          error: undefined,
        };
    set({ run: { ...run, agents: patchAgent(run.agents, row.id, patch) } });
  },
  beginCritique: () => {
    const run = get().run;
    if (!run) return;
    set({
      run: {
        ...run,
        phase: "critique",
        agents: patchAgent(run.agents, "critic", { status: "running" }),
      },
      selectedId: "critic",
    });
  },
  applyCritique: (critique) => {
    const run = get().run;
    if (!run) return;
    const next: SwarmRun = {
      ...run,
      phase: "merge",
      critique,
      agents: patchAgent(
        patchAgent(run.agents, "critic", {
          status: "done",
          headline: critique.verdict,
          findings: critique.keep,
          risks: critique.holes,
          body: critique.kill.join("\n"),
        }),
        "synthesizer",
        { status: "running" },
      ),
    };
    persistNow(next);
    set({
      run: next,
      selectedId: "synthesizer",
    });
  },
  applySynthesis: (synthesis) => {
    const run = get().run;
    if (!run) return;
    const generation = run.generation ?? 1;
    const snap = snapshotGeneration({ ...run, synthesis });
    const generations = [
      ...run.generations.filter((g) => g.n !== generation),
      snap,
    ].sort((a, b) => a.n - b.n);
    const next: SwarmRun = {
      ...run,
      phase: "eval",
      generation,
      generations,
      synthesis,
      agents: patchAgent(run.agents, "synthesizer", {
        status: "done",
        headline: synthesis.title,
        findings: synthesis.steps,
        risks: synthesis.watchouts,
        body: synthesis.deliverable,
      }),
    };
    persistNow(next);
    set({
      run: next,
      selectedId: "synthesizer",
      viewingN: generation,
    });
  },
  applyEval: (evaluation) => {
    const run = get().run;
    if (!run) return;
    const generation = run.generation ?? 1;
    const generations = run.generations.map((g) =>
      g.n === generation ? { ...g, evaluation } : g,
    );
    const next: SwarmRun = {
      ...run,
      evaluation,
      fixtureLevel: evaluation.level,
      generations,
      phase: "eval",
    };
    persistNow(next);
    set({ run: next, viewingN: generation });
  },
  beginImprove: () => {
    const run = get().run;
    if (!run) return;
    set({
      run: {
        ...run,
        phase: "improve",
        agents: patchAgent(run.agents, "improver", { status: "running", error: undefined }),
      },
      selectedId: "improver",
    });
  },
  applyImprover: (result) => {
    const run = get().run;
    if (!run) return;
    const nextGen = (run.generation ?? 1) + 1;
    const specialists: Agent[] = result.specialists.map((brief) => ({
      id: brief.id,
      role: "specialist",
      name: brief.name,
      mandate: brief.mandate,
      lens: brief.lens,
      status: "pending",
    }));
    const keep = run.agents.filter((a) => a.role !== "specialist");
    const resetKeep = keep.map((agent) => {
      if (agent.role === "improver") {
        return {
          ...agent,
          status: "done" as const,
          headline: result.delta.reason,
          findings: (result.delta.targets?.length ? result.delta.targets : result.delta.changed),
          body: result.delta.betterBecause,
        };
      }
      if (agent.role === "conductor") {
        return {
          ...agent,
          status: "done" as const,
          headline: `Generation ${nextGen} contract`,
          body: result.contract,
          findings: [result.whyThisSplit],
        };
      }
      if (agent.role === "critic" || agent.role === "synthesizer" || agent.role === "judge") {
        return {
          ...agent,
          status: "pending" as const,
          headline: undefined,
          findings: undefined,
          risks: undefined,
          body: undefined,
          error: undefined,
        };
      }
      return agent;
    });
    const next: SwarmRun = {
      ...run,
      phase: "fanout",
      generation: nextGen,
      contract: result.contract,
      whyThisSplit: result.whyThisSplit,
      delta: result.delta,
      agents: [...resetKeep, ...specialists],
    };
    persistNow(next);
    set({
      run: next,
      selectedId: specialists[0]?.id ?? "improver",
    });
  },
  beginJudge: () => {
    const run = get().run;
    if (!run) return;
    set({
      run: {
        ...run,
        phase: "judge",
        agents: patchAgent(run.agents, "judge", { status: "running", error: undefined }),
      },
      selectedId: "judge",
    });
  },
  applyJudge: (judge) => {
    const run = get().run;
    if (!run) return;
    const generation = run.generation ?? 1;
    const generations = run.generations.map((g) => (g.n === generation ? { ...g, judge } : g));
    const closed = judge.holes.filter((h) => h.status === "closed").map((h) => h.hole);
    const open = judge.holes.filter((h) => h.status !== "closed").map((h) => `${h.status}: ${h.hole}`);
    const finished: SwarmRun = {
      ...run,
      phase: "done",
      finishedAt: Date.now(),
      generations,
      judge,
      agents: patchAgent(run.agents, "judge", {
        status: "done",
        headline: `${judge.verdict}: ${judge.score}`,
        findings: closed,
        risks: open,
        body: judge.score,
      }),
    };
    const history = [finished, ...get().history.filter((item) => item.id !== finished.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    saveHistory(history);
    persistFinished(finished, history);
    set({ run: finished, history, selectedId: "judge", viewingN: generation });
  },
  skipJudge: (error) => {
    const run = get().run;
    if (!run) return;
    const finished: SwarmRun = {
      ...run,
      phase: "done",
      finishedAt: Date.now(),
      agents: patchAgent(run.agents, "judge", { status: "error", error }),
    };
    const history = [finished, ...get().history.filter((item) => item.id !== finished.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    saveHistory(history);
    persistFinished(finished, history);
    set({ run: finished, history, selectedId: "judge" });
  },
  sealGeneration: () => {
    const run = get().run;
    if (!run) return;
    const finished: SwarmRun = {
      ...run,
      phase: "done",
      finishedAt: Date.now(),
    };
    const history = [finished, ...get().history.filter((item) => item.id !== finished.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    saveHistory(history);
    persistFinished(finished, history);
    set({ run: finished, history, viewingN: run.generation ?? 1 });
  },
  fail: (error) => {
    const run = get().run;
    if (!run) {
      set({
        run: {
          id: "err",
          goal: get().goal,
          startedAt: Date.now(),
          phase: "error",
          generation: 1,
          generations: [],
          agents: ghostAgents(),
          error,
        },
      });
      return;
    }
    const agents = run.agents.map((agent) =>
      agent.status === "running" ? { ...agent, status: "error" as const, error } : agent,
    );
    const complete = lastCompleteGeneration(run);
    if (complete && (run.generation ?? 1) > complete.n) {
      const rolled: SwarmRun = {
        ...run,
        phase: "done",
        generation: complete.n,
        contract: complete.contract,
        whyThisSplit: complete.whyThisSplit,
        critique: complete.critique,
        synthesis: complete.synthesis,
        delta: complete.delta,
        judge: complete.judge,
        evaluation: complete.evaluation,
        finishedAt: Date.now(),
        error,
        agents,
      };
      persistNow(rolled);
      set({ run: rolled, viewingN: complete.n, selectedId: "synthesizer" });
      return;
    }
    const next = { ...run, phase: "error" as const, error, agents };
    persistNow(next);
    set({ run: next });
  },
  restore: (source) => {
    const run = normalizeRun(source);
    try {
      if (run.phase === "done") localStorage.setItem(SESSION_KEY, JSON.stringify(run));
    } catch {
      /* ignore */
    }
    set({
      run,
      goal: run.goal,
      labId: run.labId,
      pasted: run.pastedArtifact ?? get().pasted,
      userTest: run.userTest ?? get().userTest,
      baseline: run.baseline ?? get().baseline,
      selectedId: run.judge ? "judge" : "synthesizer",
      viewingN: run.generation ?? 1,
    });
  },
  ingestMcpRun: (incoming) => {
    const next = normalizeRun(incoming);
    const current = get().run;
    if (
      current?.id === next.id &&
      current.generation === next.generation &&
      current.evaluation?.score === next.evaluation?.score &&
      (current.evaluation?.failed ?? []).join() === (next.evaluation?.failed ?? []).join()
    ) {
      return;
    }
    const history = [next, ...get().history.filter((item) => item.id !== next.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    persistFinished(next, history);
    set({
      run: next,
      history,
      goal: next.goal || get().goal,
      labId: next.labId ?? get().labId,
      pasted: next.pastedArtifact ?? get().pasted,
      baseline: next.baseline ?? get().baseline,
      viewingN: next.generation ?? 1,
      selectedId: next.agents[0]?.id ?? "host",
    });
  },
  bumpMcpSit: () => set({ mcpSitEpoch: get().mcpSitEpoch + 1 }),
  openFixtureSitting: (evaluation) => {
    const state = get();
    const id = loadMcpSit();
    const pasted = state.pasted.trim();
    const run: SwarmRun = {
      id,
      goal: state.goal.trim() || evaluation.fixture,
      labId: state.labId,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      phase: "done",
      generation: 0,
      generations: [],
      pastedArtifact: pasted || undefined,
      userTest: state.userTest.trim() || undefined,
      baseline: evaluation,
      evaluation,
      agents: get().lane === "mcp" ? hostAgents() : ghostAgents().map((agent) => ({ ...agent, status: "done" })),
      slotSnapshot: { mode: "custom", model: "mcp-host", baseUrl: "mcp" },
    };
    const history = [run, ...state.history.filter((item) => item.id !== id)].slice(0, HISTORY_LIMIT);
    persistFinished(run, history);
    set({
      run,
      history,
      baseline: evaluation,
      viewingN: 0,
      selectedId: get().lane === "mcp" ? "host" : "synthesizer",
    });
  },
  seedFrom: (source) => {
    const origin = normalizeRun(source);
    const last =
      origin.generations.find((g) => g.n === origin.generation) ?? origin.generations.at(-1);
    if (!last?.synthesis) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `run-${Date.now()}`;
    const ancestor: Generation = { ...last, n: 1 };
    const specialists: Agent[] = last.specialists.map((brief) => ({
      id: brief.id,
      role: "specialist",
      name: brief.name,
      mandate: brief.mandate,
      lens: brief.lens,
      status: "done",
      headline: brief.mandate,
    }));
    const keep = ghostAgents()
      .filter((a) => a.role !== "specialist")
      .map((agent) => {
        if (agent.role === "conductor") {
          return {
            ...agent,
            status: "done" as const,
            headline: "Carried contract",
            body: last.contract,
          };
        }
        if (agent.role === "critic") {
          return {
            ...agent,
            status: "done" as const,
            headline: last.critique?.verdict,
            findings: last.critique?.keep,
            risks: last.critique?.holes,
          };
        }
        if (agent.role === "synthesizer") {
          return {
            ...agent,
            status: "done" as const,
            headline: last.synthesis?.title,
            body: last.synthesis?.deliverable,
            findings: last.synthesis?.steps,
          };
        }
        if (agent.role === "judge") {
          return {
            ...agent,
            status: last.judge ? ("done" as const) : ("pending" as const),
            headline: last.judge?.verdict,
            body: last.judge?.score,
            findings: last.judge?.holes.filter((h) => h.status === "closed").map((h) => h.hole),
            risks: last.judge?.holes.filter((h) => h.status !== "closed").map((h) => h.hole),
          };
        }
        return { ...agent, status: "pending" as const };
      });
    const run: SwarmRun = {
      id,
      goal: origin.goal,
      labId: origin.labId,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      phase: "done",
      generation: 1,
      generations: [ancestor],
      contract: last.contract,
      whyThisSplit: last.whyThisSplit,
      agents: [...keep, ...specialists],
      critique: last.critique,
      synthesis: last.synthesis,
      judge: last.judge,
      delta: last.delta,
      evaluation: last.evaluation,
      fixtureLevel: origin.fixtureLevel ?? last.evaluation?.level ?? 0,
      pastedArtifact: origin.pastedArtifact,
      userTest: origin.userTest,
      baseline: origin.baseline,
      slotSnapshot: origin.slotSnapshot,
    };
    const history = [run, ...get().history.filter((item) => item.id !== run.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    persistFinished(run, history);
    set({
      run,
      history,
      goal: origin.goal,
      labId: origin.labId,
      selectedId: last.judge ? "judge" : "synthesizer",
      viewingN: 1,
    });
  },
  reset: () => {
    clearSession();
    set({ run: null, selectedId: "conductor", viewingN: 1 });
  },
}));

export function specialistsOf(run: SwarmRun | null): Agent[] {
  return run?.agents.filter((a) => a.role === "specialist") ?? [];
}

export function agentById(run: SwarmRun | null, id: string | null): Agent | undefined {
  if (!run || !id) return undefined;
  return run.agents.find((a) => a.id === id);
}

export function viewedGeneration(run: SwarmRun | null, n: number): Generation | undefined {
  return run?.generations.find((g) => g.n === n);
}
