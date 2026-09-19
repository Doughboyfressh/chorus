import { cn } from "@/lib/utils";
import { ghostAgents, hostAgents, specialistsOf, useChorus } from "@/lib/chorus/store";
import type { Agent, AgentStatus } from "@/lib/chorus/types";

function statusTone(status: AgentStatus) {
  if (status === "done") return "text-ok";
  if (status === "running") return "text-warn";
  if (status === "error") return "text-danger";
  return "text-muted";
}

function NodeCard({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "min-h-11 w-full rounded-lg bg-bg px-3 py-2 text-left shadow-[var(--shadow-border)] transition-[box-shadow,opacity] duration-200 ease-out",
        selected ? "shadow-[var(--shadow-border-hover)]" : "hover:shadow-[var(--shadow-border-hover)]",
        agent.status === "running" && "chorus-breathe",
      )}
    >
      <span className={cn("font-mono text-xs uppercase tracking-widest", statusTone(agent.status))}>
        {agent.status}
      </span>
      <div className="font-display text-base leading-tight text-fg">{agent.name}</div>
    </button>
  );
}

export function SwarmStage() {
  const run = useChorus((s) => s.run);
  const lane = useChorus((s) => s.lane);
  const selectedId = useChorus((s) => s.selectedId);
  const setSelected = useChorus((s) => s.setSelected);
  const agents = run?.agents ?? (lane === "mcp" ? hostAgents() : ghostAgents());
  const specialists = run ? specialistsOf(run) : agents.filter((a) => a.role === "specialist");
  const conductor = agents.find((a) => a.role === "conductor");
  const critic = agents.find((a) => a.role === "critic");
  const synthesizer = agents.find((a) => a.role === "synthesizer");
  const improver = agents.find((a) => a.role === "improver");
  const judge = agents.find((a) => a.role === "judge");
  const generation = run?.generation ?? 1;
  const hostOnly = specialists.length === 0 && !critic && !synthesizer && !improver && !judge;

  return (
    <div className="rounded-3xl bg-surface p-5">
      <div className="mb-4 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-subtle">
        <span>Plate 01 — topology</span>
        <span>generation {generation}</span>
      </div>
      {hostOnly ? (
        <div className="flex flex-col items-center gap-3">
          {conductor ? (
            <div className="w-full max-w-sm">
              <NodeCard
                agent={conductor}
                selected={selectedId === conductor.id}
                onSelect={() => setSelected(conductor.id)}
              />
            </div>
          ) : null}
          <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
            Host sitting. The connected model is the swarm. Chorus grades. Same weights wrote
            and sat the exam — pairs are marked contaminated.
          </p>
        </div>
      ) : (
      <div className="flex flex-col items-center gap-2">
        {conductor ? (
          <div className="w-48">
            <NodeCard
              agent={conductor}
              selected={selectedId === conductor.id}
              onSelect={() => setSelected(conductor.id)}
            />
          </div>
        ) : null}
        <div className="h-4 w-px bg-border" />
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {specialists.map((agent) => (
            <NodeCard
              key={agent.id}
              agent={agent}
              selected={selectedId === agent.id}
              onSelect={() => setSelected(agent.id)}
            />
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
          {critic ? (
            <NodeCard
              agent={critic}
              selected={selectedId === critic.id}
              onSelect={() => setSelected(critic.id)}
            />
          ) : null}
          {synthesizer ? (
            <NodeCard
              agent={synthesizer}
              selected={selectedId === synthesizer.id}
              onSelect={() => setSelected(synthesizer.id)}
            />
          ) : null}
        </div>
        {improver || judge ? (
          <>
            <div className="h-4 w-px bg-border" />
            <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
              {improver ? (
                <NodeCard
                  agent={improver}
                  selected={selectedId === improver.id}
                  onSelect={() => setSelected(improver.id)}
                />
              ) : null}
              {judge ? (
                <NodeCard
                  agent={judge}
                  selected={selectedId === judge.id}
                  onSelect={() => setSelected(judge.id)}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      )}
    </div>
  );
}
