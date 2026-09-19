export type AgentStatus = "pending" | "running" | "done" | "error";

export type AgentRole =
  | "conductor"
  | "specialist"
  | "critic"
  | "synthesizer"
  | "improver"
  | "judge";

export type Phase =
  | "idle"
  | "conduct"
  | "fanout"
  | "critique"
  | "merge"
  | "eval"
  | "improve"
  | "judge"
  | "done"
  | "error";

export type SpecialistBrief = {
  id: string;
  name: string;
  mandate: string;
  lens: string;
};

export type FindingBlock = {
  headline: string;
  findings: string[];
  risks: string[];
  handoff: string;
  patch: string;
};

export type Agent = {
  id: string;
  role: AgentRole;
  name: string;
  mandate: string;
  lens?: string;
  status: AgentStatus;
  headline?: string;
  findings?: string[];
  risks?: string[];
  handoff?: string;
  body?: string;
  error?: string;
};

export type CritiqueResult = {
  verdict: string;
  holes: string[];
  keep: string[];
  kill: string[];
};

export type SynthesisResult = {
  title: string;
  deliverable: string;
  steps: string[];
  watchouts: string[];
  pattern: {
    contract: string;
    fanout: string;
    critique: string;
    merge: string;
  };
};

export type ConductResult = {
  contract: string;
  whyThisSplit: string;
  specialists: SpecialistBrief[];
};

export type ImproveDelta = {
  changed: string[];
  reason: string;
  betterBecause: string;
  targets: string[];
};

export type ImproveResult = ConductResult & { delta: ImproveDelta };

export type HoleStatus = "closed" | "open" | "new";

export type HoleLedgerItem = {
  hole: string;
  status: HoleStatus;
  note: string;
};

export type JudgeVerdict = "improved" | "stalled" | "worse";

export type JudgeResult = {
  verdict: JudgeVerdict;
  score: string;
  holes: HoleLedgerItem[];
};

export type EvalResult = {
  labId: string;
  fixture: string;
  score: number;
  passed: string[];
  failed: string[];
  evidence: string;
  level: number;
  mutated?: boolean;
  exhausted?: boolean;
  contaminated?: boolean;
  executor?: string;
};

export type Generation = {
  n: number;
  contract: string;
  whyThisSplit: string;
  specialists: SpecialistBrief[];
  critique?: CritiqueResult;
  synthesis?: SynthesisResult;
  delta?: ImproveDelta;
  judge?: JudgeResult;
  evaluation?: EvalResult;
};

export type SlotSnapshot = {
  mode: "hosted" | "custom";
  kind?: "openai" | "anthropic";
  model: string;
  baseUrl: string;
};

export type SwarmRun = {
  id: string;
  goal: string;
  labId?: string;
  startedAt: number;
  finishedAt?: number;
  phase: Phase;
  generation: number;
  generations: Generation[];
  contract?: string;
  whyThisSplit?: string;
  agents: Agent[];
  critique?: CritiqueResult;
  synthesis?: SynthesisResult;
  delta?: ImproveDelta;
  judge?: JudgeResult;
  evaluation?: EvalResult;
  fixtureLevel?: number;
  pastedArtifact?: string;
  userTest?: string;
  baseline?: EvalResult;
  slotSnapshot?: SlotSnapshot;
  executorSnapshot?: SlotSnapshot;
  error?: string;
};

export type AiOk<T> = { ok: true } & T;
export type AiErr = { ok: false; error: string };
export type AiResult<T> = AiOk<T> | AiErr;
