import type { JudgeVerdict, SwarmRun } from "./types";

export function unique(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

export type RecurseTarget = {
  attack: string[];
  frozen: string[];
  verdict: JudgeVerdict | "none";
  previousNames: string[];
};

export function lastCompleteGeneration(run: SwarmRun) {
  return [...run.generations]
    .filter((g) => g.synthesis)
    .sort((a, b) => b.n - a.n)[0];
}

export type SittingArtifact = {
  origin?: string;
  current?: string;
  currentTitle?: string;
  score?: number;
  failed?: string[];
};

export function sittingArtifact(run: SwarmRun | null | undefined): SittingArtifact {
  if (!run) return {};
  const origin = run.pastedArtifact?.trim() || undefined;
  const complete = lastCompleteGeneration(run);
  const current = complete?.synthesis?.deliverable?.trim() || origin;
  const evaluation = complete?.evaluation ?? run.evaluation ?? run.baseline;
  return {
    origin,
    current,
    currentTitle: complete?.synthesis?.title,
    score: evaluation?.score,
    failed: evaluation?.failed,
  };
}

export function formatArtifact(art: SittingArtifact, limit = 2400): string {
  if (!art.current) return "";
  const score =
    typeof art.score === "number"
      ? `Fixture ${art.score}/100. Close: ${art.failed?.join("; ") || "none"}.`
      : "";
  const origin =
    art.origin && art.origin !== art.current
      ? `Origin (gen 0):\n---\n${art.origin.slice(0, 1200)}\n---\n\n`
      : "";
  const title = art.currentTitle ? ` (${art.currentTitle})` : "";
  return `${origin}Current artifact${title}. Improve THIS. Do not start from a blank page.\n---\n${art.current.slice(0, limit)}\n---\n${score}`.trim();
}

export function recurseTarget(run: SwarmRun): RecurseTarget {
  const snap = run.generations.find((g) => g.n === run.generation);
  const judge = snap?.judge ?? run.judge;
  const evaluation = snap?.evaluation ?? run.evaluation;
  const criticHoles = snap?.critique?.holes ?? run.critique?.holes ?? [];
  const previousNames =
    run.generations.find((g) => g.n === (run.generation ?? 1) - 1)?.specialists.map((s) => s.name) ??
    [];

  if (evaluation) {
    return {
      attack: unique(evaluation.failed),
      frozen: unique(evaluation.passed),
      verdict: judge?.verdict ?? "none",
      previousNames,
    };
  }

  const open = (judge?.holes ?? []).filter((h) => h.status !== "closed").map((h) => h.hole);
  const frozen = (judge?.holes ?? []).filter((h) => h.status === "closed").map((h) => h.hole);
  return {
    attack: unique(open.length ? open : criticHoles),
    frozen: unique(frozen),
    verdict: judge?.verdict ?? "none",
    previousNames,
  };
}

export function judgeFromFixture(
  previous: { score?: number; failed?: string[] } | undefined,
  current: { score: number; failed: string[] },
): {
  verdict: "improved" | "stalled" | "worse";
  score: string;
  holes: { hole: string; status: "closed" | "open" | "new"; note: string }[];
} {
  const prevFailed = previous?.failed ?? [];
  const prevSet = new Set(prevFailed);
  const currSet = new Set(current.failed);
  const holes = [
    ...prevFailed.map((hole) => ({
      hole,
      status: (currSet.has(hole) ? "open" : "closed") as "open" | "closed",
      note: currSet.has(hole) ? "Still fails the fixture." : "Cleared on the fixture.",
    })),
    ...current.failed
      .filter((hole) => !prevSet.has(hole))
      .map((hole) => ({
        hole,
        status: "new" as const,
        note: "New fixture failure.",
      })),
  ].slice(0, 8);

  const prevScore = previous?.score;
  let verdict: "improved" | "stalled" | "worse" = "stalled";
  if (typeof prevScore === "number") {
    if (current.score > prevScore) verdict = "improved";
    else if (current.score < prevScore) verdict = "worse";
  }

  return {
    verdict,
    score: `Fixture ${typeof prevScore === "number" ? prevScore : "n/a"} → ${current.score}.`,
    holes,
  };
}
