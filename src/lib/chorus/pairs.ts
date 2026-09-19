import type { EvalResult, SwarmRun } from "./types.ts";
import { artifactKey, cleanTrainingRows, comparableDiagnostics, INTEGRITY_NOTE } from "./integrity.ts";

export type PreferencePair = {
  prompt: string;
  chosen: string;
  rejected: string;
  chosen_score: number;
  rejected_score: number;
  fixture: string;
  model: string;
  labId: string;
  generation: number;
  contaminated?: boolean;
  verified?: false;
  integrityNote?: string;
};

/** Candidate for HUMAN REVIEW only; never a certified preference or training row. */
export function diagnosticPair(args: {
  prompt: string; rejected: string; chosen: string; previous?: EvalResult; current?: EvalResult;
  model: string; generation: number;
}): PreferencePair | null {
  const { previous, current } = args;
  if (!previous || !current || !comparableDiagnostics(previous, current)) return null;
  if (current.score <= previous.score) return null;
  const a = artifactKey(args.rejected), b = artifactKey(args.chosen);
  if (!a || !b || a === b) return null;
  if (current.failed.some((failure) => !previous.failed.includes(failure))) return null;
  return {
    prompt: args.prompt, chosen: args.chosen, rejected: args.rejected,
    chosen_score: current.score, rejected_score: previous.score, fixture: current.fixture,
    model: args.model, labId: current.labId, generation: args.generation,
    // Both sides, public test exposure, and execution provenance remain unverified.
    contaminated: true, verified: false, integrityNote: INTEGRITY_NOTE,
  };
}

export function preferencePairs(run: SwarmRun): PreferencePair[] {
  const rows: PreferencePair[] = [];
  const model = run.executorSnapshot?.model ?? run.slotSnapshot?.model ?? "unknown";
  const gens = [...run.generations].sort((a, b) => a.n - b.n);
  const candidates = [
    ...(run.baseline && run.pastedArtifact && gens[0]?.synthesis ? [{
      rejected: run.pastedArtifact, chosen: gens[0].synthesis.deliverable,
      previous: run.baseline, current: gens[0].evaluation, generation: gens[0].n,
    }] : []),
    ...gens.slice(1).map((cur, i) => ({
      rejected: gens[i].synthesis?.deliverable ?? "", chosen: cur.synthesis?.deliverable ?? "",
      previous: gens[i].evaluation, current: cur.evaluation, generation: cur.n,
    })),
  ];
  for (const candidate of candidates) {
    const pair = diagnosticPair({ ...candidate, prompt: run.goal, model });
    if (pair) rows.push(pair);
  }
  return rows;
}

export function pairsJsonl(run: SwarmRun) {
  return preferencePairs(run).map((row) => JSON.stringify(row)).join("\n");
}
export function cleanPairs(run: SwarmRun) { return cleanTrainingRows(preferencePairs(run)); }
export function pairsJsonlClean(run: SwarmRun) { return cleanPairs(run).map((row) => JSON.stringify(row)).join("\n"); }

export type TrainingPack = {
  v: 1; model: string; labId: string; note: string;
  dpo: PreferencePair[]; dpoClean: PreferencePair[];
  sft: { messages: { role: "user" | "assistant"; content: string }[] }[];
};
export function trainingPack(run: SwarmRun): TrainingPack {
  return {
    v: 1, model: run.slotSnapshot?.model ?? "unknown", labId: run.labId ?? "generic",
    note: "dpo contains unverified diagnostic candidates for human review ONLY. dpoClean and sft are disabled until a trusted private-holdout A/B evaluator is implemented. " + INTEGRITY_NOTE,
    dpo: preferencePairs(run), dpoClean: [], sft: [],
  };
}
export function trainingJson(run: SwarmRun) { return JSON.stringify(trainingPack(run), null, 2); }
