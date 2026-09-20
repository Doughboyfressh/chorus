import { boundedText, MAX_ARTIFACT, comparableDiagnostics, type DiagnosticIdentity } from "./integrity.ts";
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

export function formatArtifact(art: SittingArtifact): string {
  if (!art.current) return "";
  const score =
    typeof art.score === "number"
      ? `Fixture ${art.score}/100. Close: ${art.failed?.join("; ") || "none"}.`
      : "";
  const origin =
    art.origin && art.origin !== art.current
      ? `Origin (gen 0):\n---\n${boundedText(art.origin, "original artifact", MAX_ARTIFACT, 1)}\n---\n\n`
      : "";
  const title = art.currentTitle ? ` (${art.currentTitle})` : "";
  return `${origin}Current artifact${title}. Improve THIS. Do not start from a blank page.\n---\n${boundedText(art.current, "current artifact", MAX_ARTIFACT, 1)}\n---\n${score}`.trim();
}

export function recurseTarget(run: SwarmRun): RecurseTarget {
  const snap = run.generations.find((g) => g.n === run.generation);
  const judge = snap?.judge ?? run.judge;
  const evaluation = snap?.evaluation ?? run.evaluation;
  const criticHoles = snap?.critique?.holes ?? run.critique?.holes ?? [];
  const previousNames =
    run.generations.find((g) => g.n === (run.generation ?? 1) - 1)?.specialists?.map((s) => s.name) ??
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
  previous: (DiagnosticIdentity & { failed?: string[] }) | undefined,
  current: DiagnosticIdentity & { score: number; failed: string[] },
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
      status: "open" as const,
      note: currSet.has(hole) ? "Still fails this diagnostic." : "Not reproduced here; independent closure is unverified.",
    })),
    ...current.failed
      .filter((hole) => !prevSet.has(hole))
      .map((hole) => ({
        hole,
        status: "new" as const,
        note: "New fixture failure.",
      })),
  ].slice(0, 8);

  const comparable = comparableDiagnostics(previous, current);
  return {
    verdict: "stalled",
    score: comparable
      ? `Unverified practice scores ${previous!.score} → ${current.score}. No independently verified improvement.`
      : "Tests, execution settings, or provenance are not comparable. No improvement verdict.",
    holes,
  };
}
