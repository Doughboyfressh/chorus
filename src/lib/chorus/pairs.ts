import type { SwarmRun } from "./types";

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
};

export function preferencePairs(run: SwarmRun): PreferencePair[] {
  const rows: PreferencePair[] = [];
  const model = run.slotSnapshot?.model ?? "unknown";
  const labId = run.labId ?? "generic";
  const gens = [...run.generations].sort((a, b) => a.n - b.n);

  if (run.baseline && run.pastedArtifact && gens[0]?.synthesis) {
    const chosenScore = gens[0].evaluation?.score ?? 0;
    if (chosenScore > run.baseline.score) {
      rows.push({
        prompt: run.goal,
        rejected: run.pastedArtifact,
        chosen: gens[0].synthesis.deliverable,
        rejected_score: run.baseline.score,
        chosen_score: chosenScore,
        fixture: gens[0].evaluation?.fixture ?? run.baseline.fixture,
        model,
        labId,
        generation: gens[0].n,
        contaminated: Boolean(run.baseline?.contaminated || gens[0].evaluation?.contaminated),
      });
    }
  }

  for (let i = 1; i < gens.length; i++) {
    const prev = gens[i - 1];
    const cur = gens[i];
    const prevScore = prev.evaluation?.score;
    const curScore = cur.evaluation?.score;
    if (typeof prevScore !== "number" || typeof curScore !== "number") continue;
    if (curScore <= prevScore) continue;
    const rejected = prev.synthesis?.deliverable;
    const chosen = cur.synthesis?.deliverable;
    if (!rejected || !chosen) continue;
    rows.push({
      prompt: run.goal,
      rejected,
      chosen,
      rejected_score: prevScore,
      chosen_score: curScore,
      fixture: cur.evaluation?.fixture ?? prev.evaluation?.fixture ?? "",
      model,
      labId,
      generation: cur.n,
      contaminated: Boolean(cur.evaluation?.contaminated || prev.evaluation?.contaminated),
    });
  }
  return rows;
}

export function pairsJsonl(run: SwarmRun) {
  return preferencePairs(run)
    .map((row) => JSON.stringify(row))
    .join("\n");
}

export type TrainingPack = {
  v: 1;
  model: string;
  labId: string;
  note: string;
  dpo: PreferencePair[];
  sft: { messages: { role: "user" | "assistant"; content: string }[] }[];
};

export function trainingPack(run: SwarmRun): TrainingPack {
  const dpo = preferencePairs(run);
  return {
    v: 1,
    model: run.slotSnapshot?.model ?? "unknown",
    labId: run.labId ?? "generic",
    note: "Chorus does not train weights. Load dpo into your trainer. Drop rows where contaminated is true if the writer also ran the exam.",
    dpo,
    sft: dpo.map((row) => ({
      messages: [
        { role: "user" as const, content: row.prompt },
        { role: "assistant" as const, content: row.chosen },
      ],
    })),
  };
}

export function trainingJson(run: SwarmRun) {
  return JSON.stringify(trainingPack(run), null, 2);
}
