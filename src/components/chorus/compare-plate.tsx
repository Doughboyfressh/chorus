import { baselineAsGeneration, viewedGeneration, useChorus } from "@/lib/chorus/store";
import type { Generation, HoleStatus, JudgeResult } from "@/lib/chorus/types";
import { cn } from "@/lib/utils";

function statusTone(status: HoleStatus) {
  if (status === "closed") return "text-ok";
  if (status === "open") return "text-warn";
  return "text-danger";
}

function verdictTone(verdict: JudgeResult["verdict"]) {
  if (verdict === "improved") return "text-ok";
  if (verdict === "stalled") return "text-warn";
  return "text-danger";
}

function excerpt(text: string, n = 280) {
  const clean = text.trim();
  if (clean.length <= n) return clean;
  return `${clean.slice(0, n).trimEnd()}…`;
}

function GenColumn({ gen }: { gen: Generation }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Gen {gen.n}</p>
      <h3 className="mt-2 font-display text-xl leading-snug text-fg">
        {gen.synthesis?.title ?? "No merge yet"}
      </h3>
      {typeof gen.evaluation?.score === "number" ? (
        <p className="mt-2 font-mono text-xs tabular-nums tracking-widest text-subtle">
          Fixture {gen.evaluation.score}/100
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted">{excerpt(gen.contract || "No contract.")}</p>
      <p className="mt-3 font-mono text-xs uppercase tracking-widest text-subtle">Staff</p>
      <p className="mt-1 text-sm text-fg">{gen.specialists.map((s) => s.name).join(" · ") || "—"}</p>
      <p className="mt-3 font-mono text-xs uppercase tracking-widest text-subtle">Holes</p>
      {gen.critique?.holes?.length ? (
        <ul className="mt-1 space-y-1">
          {gen.critique.holes.map((hole) => (
            <li key={hole} className="text-sm leading-relaxed text-muted">
              {hole}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">None named.</p>
      )}
      {gen.synthesis?.deliverable ? (
        <p className="mt-3 text-sm leading-relaxed text-fg/90">{excerpt(gen.synthesis.deliverable, 360)}</p>
      ) : null}
    </div>
  );
}

export function ComparePlate() {
  const run = useChorus((s) => s.run);
  const viewingN = useChorus((s) => s.viewingN);
  if (!run || viewingN < 1) return null;
  const right = viewedGeneration(run, viewingN);
  const left =
    viewingN === 1 ? baselineAsGeneration(run) : viewedGeneration(run, viewingN - 1);
  if (!right || !left || left.n === right.n) return null;
  const judge = right.judge ?? run.judge;
  const leftScore = left.evaluation?.score;
  const rightScore = right.evaluation?.score;
  const delta =
    typeof leftScore === "number" && typeof rightScore === "number" ? rightScore - leftScore : null;

  return (
    <div className="mb-8">
      {typeof rightScore === "number" ? (
        <div className="mb-4 rounded-xl bg-surface-2 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">Fixture delta</p>
          <p className="mt-2 font-display text-2xl leading-tight text-fg">
            {leftScore ?? "—"} → {rightScore}
            {delta !== null ? (
              <span className={cn("ml-3 text-xl", delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-warn")}>
                {delta > 0 ? `+${delta}` : String(delta)}
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {right.evaluation?.fixture ?? "Held-out test"}
            {right.evaluation?.failed?.length
              ? ` · still failing: ${right.evaluation.failed.join(" · ")}`
              : ""}
          </p>
        </div>
      ) : null}
      {judge ? (
        <div className="mb-4 rounded-xl bg-surface-2 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">Judge</p>
          <p className={cn("mt-2 font-display text-2xl leading-tight", verdictTone(judge.verdict))}>
            {judge.verdict}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg">{judge.score}</p>
          {judge.holes.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {judge.holes.map((item) => (
                <li key={`${item.status}-${item.hole}`} className="grid gap-1 sm:grid-cols-[88px_1fr]">
                  <span
                    className={cn(
                      "font-mono text-xs uppercase tracking-widest",
                      statusTone(item.status),
                    )}
                  >
                    {item.status}
                  </span>
                  <span>
                    <span className="block text-sm leading-relaxed text-fg">{item.hole}</span>
                    {item.note ? (
                      <span className="mt-0.5 block text-sm leading-relaxed text-muted">{item.note}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : run.phase === "judge" ? (
        <p className="mb-4 font-display text-lg text-muted">The judge is scoring named holes.</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <GenColumn gen={left} />
        <GenColumn gen={right} />
      </div>
    </div>
  );
}
