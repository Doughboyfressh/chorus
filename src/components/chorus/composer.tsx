import { ArrowUpRight, RotateCcw, Square } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LABS, MAX_GOAL, MIN_GOAL } from "@/lib/chorus/labs";
import { fixtureFor } from "@/lib/chorus/fixtures";
import { LOOP_LINE } from "@/lib/chorus/lexicon";
import { cancelSwarm, executeSwarm, scoreBaseline } from "@/lib/chorus/run";
import { isLoopbackUrl } from "@/lib/chorus/slot";
import { useChorus } from "@/lib/chorus/store";
import { cn } from "@/lib/utils";

function isBusy(phase: string | undefined) {
  return (
    phase === "conduct" ||
    phase === "fanout" ||
    phase === "critique" ||
    phase === "merge" ||
    phase === "eval" ||
    phase === "improve" ||
    phase === "judge"
  );
}

export function Composer() {
  const goal = useChorus((s) => s.goal);
  const labId = useChorus((s) => s.labId);
  const setGoal = useChorus((s) => s.setGoal);
  const slot = useChorus((s) => s.slot);
  const lane = useChorus((s) => s.lane);
  const aiAvailable = useChorus((s) => s.aiAvailable);
  const pasted = useChorus((s) => s.pasted);
  const userTest = useChorus((s) => s.userTest);
  const baseline = useChorus((s) => s.baseline);
  const setPasted = useChorus((s) => s.setPasted);
  const setUserTest = useChorus((s) => s.setUserTest);
  const run = useChorus((s) => s.run);
  const reset = useChorus((s) => s.reset);
  const busy = isBusy(run?.phase);
  const sittingDone = run?.phase === "done";
  const errored = run?.phase === "error";
  const blocked = lane !== "mcp" && aiAvailable === false;
  const tooShort =
    lane === "mcp" ? pasted.trim().length < 20 && goal.trim().length < MIN_GOAL : goal.trim().length < MIN_GOAL;
  const generation = run?.generation ?? 0;
  const fixture = fixtureFor(labId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Labs</p>
        <div className="mt-3 flex flex-col gap-1">
          {LABS.map((lab) => {
            const active = labId === lab.id;
            return (
              <button
                key={lab.id}
                type="button"
                disabled={busy}
                onClick={() => setGoal(lab.goal, lab.id)}
                className={cn(
                  "min-h-11 rounded-md px-3 py-2 text-left transition-[background-color,color] duration-150",
                  active ? "bg-accent text-accent-fg" : "text-fg hover:bg-bg",
                )}
              >
                <span className="block text-sm font-medium">{lab.title}</span>
                <span className={cn("mt-0.5 block text-xs", active ? "text-accent-fg/70" : "text-muted")}>
                  {lab.blurb}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Fixture: {fixture.title}. {fixture.blurb}
        {fixture.execute ? " The swarm does not write this test." : " Checklist only until you bring a test."}
      </p>

      <label className="block">
        <span className="font-mono text-xs uppercase tracking-widest text-subtle">Problem</span>
        <Textarea
          className="mt-3 min-h-36"
          value={goal}
          maxLength={MAX_GOAL}
          disabled={busy}
          placeholder="A hard, specific problem. Vague goals waste a swarm."
          onChange={(event) => setGoal(event.target.value, labId)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void executeSwarm();
            }
          }}
        />
        <span className="mt-2 flex justify-between font-mono text-xs tabular-nums text-subtle">
          <span>
            {goal.trim().length}/{MAX_GOAL}
          </span>
          <span>
            {lane === "mcp" ? "MCP · no key" : isLoopbackUrl(slot.baseUrl) ? "This machine · no key" : "Your key · your bill"}
            {generation ? ` · gen ${generation}` : ""}
          </span>
        </span>
      </label>

      <details open>
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-subtle">
          Your artifact · gen 0
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Textarea
            className="min-h-28"
            value={pasted}
            disabled={busy}
            placeholder="Paste the prompt, eval, or spec you already use. Chorus scores this first."
            onChange={(event) => setPasted(event.target.value)}
          />
          <Textarea
            className="min-h-20"
            value={userTest}
            disabled={busy}
            placeholder="Optional: your held-out test. Stacks on the lab fixture."
            onChange={(event) => setUserTest(event.target.value)}
          />
          {baseline ? (
            <p className="text-sm text-muted">
              Gen 0 scored {baseline.score}/100
              {baseline.failed.length ? ` · failing ${baseline.failed.join(" · ")}` : ""}.
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={busy || blocked || pasted.trim().length < 20}
            onClick={() => void scoreBaseline()}
          >
            Score this
            {lane === "mcp" ? " in MCP" : ""}
          </Button>
          <p className="text-sm leading-relaxed text-muted">
            {LOOP_LINE}{" "}
            <Link to="/glossary" className="text-fg underline decoration-border underline-offset-4">
              Lexicon
            </Link>
          </p>
        </div>
      </details>

      {lane === "mcp" ? (
        <p className="text-sm text-muted">
          Score gen 0 here, then follow How you run. No key on this page.
        </p>
      ) : aiAvailable === false ? (
        <p className="text-sm text-danger">
          {lane === "local"
            ? "Point at a server on this machine and paste the model id."
            : "This provider needs an API key, or switch to MCP."}
        </p>
      ) : null}

      {run?.error && (sittingDone || errored) ? (
        <p className="text-sm text-warn">
          {run.error}
          {sittingDone ? " Last complete generation is kept." : ""}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {busy ? (
          <Button className="flex-1" variant="secondary" onClick={() => cancelSwarm()}>
            Cancel
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            className="flex-1"
            disabled={blocked || tooShort || (sittingDone && lane !== "mcp")}
            onClick={() => void executeSwarm()}
          >
            {lane === "mcp"
              ? sittingDone
                ? "Copy MCP URL"
                : "Score gen 0 · copy URL"
              : sittingDone
                ? "Recurse below, or reset"
                : errored
                  ? "Retry"
                  : "Run generation 1"}
            <ArrowUpRight />
          </Button>
        )}
        {run ? (
          <Button variant="secondary" size="icon" aria-label="Reset lab" onClick={reset} disabled={busy}>
            <RotateCcw />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
