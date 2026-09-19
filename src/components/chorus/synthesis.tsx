import { Check, Copy, Repeat } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_GENERATIONS } from "@/lib/chorus/labs";
import { preferencePairs } from "@/lib/chorus/pairs";
import { playbookMarkdown, downloadPairs, downloadTraining, recurseSwarm, recurseTarget } from "@/lib/chorus/run";
import { useChorus, viewedGeneration, baselineAsGeneration } from "@/lib/chorus/store";
import { cn } from "@/lib/utils";
import { ComparePlate } from "./compare-plate";

export function Synthesis() {
  const run = useChorus((s) => s.run);
  const viewingN = useChorus((s) => s.viewingN);
  const setViewingN = useChorus((s) => s.setViewingN);
  const seedFrom = useChorus((s) => s.seedFrom);
  const [copied, setCopied] = useState(false);

  if (run?.phase === "error") {
    return (
      <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">Stalled</p>
        <h2 className="mt-2 font-display text-2xl text-fg">The loop did not complete.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{run.error}</p>
      </section>
    );
  }

  const snap =
    viewingN === 0 && run ? baselineAsGeneration(run) : viewedGeneration(run, viewingN);
  const synthesis = snap?.synthesis ?? run?.synthesis;
  const delta = snap?.delta ?? run?.delta;
  const evaluation = snap?.evaluation ?? run?.evaluation;
  if (!synthesis && !delta && run?.phase !== "judge" && run?.phase !== "eval") return null;

  const generation = run?.generation ?? 1;
  const lastJudge = run?.generations.find((g) => g.n === generation)?.judge ?? run?.judge;
  const target = run ? recurseTarget(run) : null;
  const attack = target?.attack ?? [];
  const stalled = lastJudge?.verdict === "stalled" || lastJudge?.verdict === "worse";
  const canRecurse =
    run?.phase === "done" &&
    Boolean(run.synthesis) &&
    !run.evaluation?.exhausted &&
    (run.generation ?? 1) < 8;
  const hasPairs = run ? preferencePairs(run).length > 0 : false;
  const gens = run?.generations ?? [];

  async function copyPlaybook() {
    try {
      await navigator.clipboard.writeText(playbookMarkdown());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="chorus-rise rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
      {run?.baseline || gens.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {run?.baseline ? (
            <button
              type="button"
              onClick={() => setViewingN(0)}
              className={cn(
                "min-h-11 rounded-md px-3 text-xs font-medium uppercase tracking-widest",
                viewingN === 0 ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
              )}
            >
              Gen 0
            </button>
          ) : null}
          {gens.map((gen) => (
            <button
              key={gen.n}
              type="button"
              onClick={() => setViewingN(gen.n)}
              className={cn(
                "min-h-11 rounded-md px-3 text-xs font-medium uppercase tracking-widest",
                viewingN === gen.n ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
              )}
            >
              Gen {gen.n}
            </button>
          ))}
        </div>
      ) : null}

      <ComparePlate />
      <p role="status" className="mb-4 rounded-xl bg-surface-2 p-4 text-sm text-warn">
        Practice mode: public fixtures are diagnostic, not independent validation.
        All results, including legacy runs, are unverified. Clean training export is locked.
      </p>

      {evaluation ? (
        <div className="mb-6 rounded-xl bg-surface-2 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">
            Public practice v{(evaluation.level ?? 0) + 1}
            {evaluation.mutated ? " · mutated" : ""} · gen {viewingN}
          </p>
          <p className="mt-2 font-display text-2xl leading-tight text-fg">{evaluation.score}/100 · unverified</p>
          <p className="mt-1 text-sm text-muted">{evaluation.fixture}</p>
          {evaluation.executor ? (
            <p className="mt-1 text-sm text-muted">
              Executor: {evaluation.executor}
              {" · claimed executor; independence is not verified"}
            </p>
          ) : null}
          {evaluation.quoteHint ? (
            <p className="mt-2 text-sm leading-relaxed text-warn">{evaluation.quoteHint}</p>
          ) : null}
          {evaluation.exhausted ? (
            <p className="mt-2 text-sm leading-relaxed text-ok">Public practice ladder completed. Independent validation is still required.</p>
          ) : null}
          {evaluation.evidence ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{evaluation.evidence}</p>
          ) : null}
          {evaluation.passed?.length ? (
            <ul className="mt-3 space-y-1">
              {evaluation.passed.map((item) => (
                <li key={item} className="text-sm leading-relaxed text-ok">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          {evaluation.failed?.length ? (
            <ul className="mt-2 space-y-1">
              {evaluation.failed.map((item) => (
                <li key={item} className="text-sm leading-relaxed text-danger">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : run?.phase === "eval" ? (
        <p className="mb-6 font-display text-lg text-muted">Running the public practice fixture.</p>
      ) : null}

      {delta && viewingN > 1 ? (
        <div className="mb-6 rounded-xl bg-surface-2 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">What the improver changed</p>
          <p className="mt-2 font-display text-xl leading-snug text-fg">{delta.reason}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{delta.betterBecause}</p>
          {delta.changed.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {delta.changed.map((item) => (
                <li key={item} className="border-l border-border pl-3 text-sm leading-relaxed text-fg">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {synthesis ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">
                Deliverable · gen {viewingN}
              </p>
              <h2 className="mt-2 font-display text-3xl leading-tight text-fg">{synthesis.title}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {canRecurse ? (
                <Button onClick={() => void recurseSwarm()}>
                  {stalled
                    ? "Recurse anyway"
                    : attack.length
                      ? `Recurse on ${attack.length} hole${attack.length === 1 ? "" : "s"}`
                      : "Recurse"}
                  <Repeat />
                </Button>
              ) : null}
              {run?.phase === "done" && generation >= MAX_GENERATIONS && !(run.evaluation?.failed?.length) ? (
                <Button onClick={() => seedFrom(run)}>Continue loop</Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => downloadPairs()} disabled={!hasPairs}>
                Review candidates
              </Button>
              <Button variant="secondary" size="sm" onClick={() => downloadTraining()} disabled title="Requires independently verified private-holdout comparison">
                Training locked
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void copyPlaybook()}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Playbook"}
              </Button>
            </div>
          </div>
          {canRecurse && attack.length > 0 ? (
            <div className="mt-4 rounded-xl bg-surface-2 p-4">
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">
                Next contract · open holes
              </p>
              <ul className="mt-3 space-y-2">
                {attack.map((hole) => (
                  <li key={hole} className="border-l border-accent pl-3 text-sm leading-relaxed text-fg">
                    {hole}
                  </li>
                ))}
              </ul>
              {target?.frozen.length ? (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Frozen: {target.frozen.join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {run?.phase === "done" && generation >= MAX_GENERATIONS ? (
            <p className="mt-3 text-sm text-muted">
              Sitting budget is {MAX_GENERATIONS} generations; hard cap is 8. Continue loop carries
              open holes into a new sitting.
            </p>
          ) : null}
          {stalled && canRecurse ? (
            <p className="mt-3 text-sm text-warn">
              The judge did not see a closed hole. The next staff cannot be a rename of this one.
            </p>
          ) : null}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-fg/90">
            {synthesis.deliverable}
          </p>
          {synthesis.steps.length > 0 ? (
            <div className="mt-6">
              <h3 className="font-mono text-xs uppercase tracking-widest text-subtle">Next actions</h3>
              <ol className="mt-3 space-y-2">
                {synthesis.steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm leading-relaxed">
                    <span className="font-mono text-xs tabular-nums text-subtle">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {synthesis.watchouts.length > 0 ? (
            <div className="mt-6">
              <h3 className="font-mono text-xs uppercase tracking-widest text-subtle">Watchouts</h3>
              <ul className="mt-3 space-y-2">
                {synthesis.watchouts.map((item) => (
                  <li key={item} className="text-sm leading-relaxed text-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Contract", synthesis.pattern?.contract],
                ["Fan-out", synthesis.pattern?.fanout],
                ["Critique", synthesis.pattern?.critique],
                ["Merge", synthesis.pattern?.merge],
              ] as const
            ).map(([label, text]) => (
              <div key={label} className="rounded-xl bg-surface-2 p-4">
                <p className="font-mono text-xs uppercase tracking-widest text-subtle">{label}</p>
                <p className="mt-2 text-sm leading-relaxed text-fg">{text}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
