import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { agentById, useChorus } from "@/lib/chorus/store";
import type { Agent, AgentStatus } from "@/lib/chorus/types";
import { cn } from "@/lib/utils";

function statusVariant(status: AgentStatus): "default" | "ok" | "warn" | "danger" {
  if (status === "done") return "ok";
  if (status === "running") return "warn";
  if (status === "error") return "danger";
  return "default";
}

function AgentBody({ agent }: { agent: Agent }) {
  if (agent.status === "pending") {
    return <p className="text-sm text-muted">Waiting on the previous phase.</p>;
  }
  if (agent.status === "running") {
    return (
      <div className="space-y-2">
        <p className="chorus-shimmer font-display text-lg text-muted">Thinking from this lens.</p>
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }
  if (agent.status === "error") {
    return <p className="text-sm text-danger">{agent.error ?? "This agent failed."}</p>;
  }

  return (
    <div className="space-y-4">
      {agent.headline ? (
        <p className="font-display text-xl leading-snug text-fg">{agent.headline}</p>
      ) : null}
      {agent.body ? (
        <div>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-subtle">
            {agent.role === "specialist" ? "Patch" : "Body"}
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{agent.body}</p>
        </div>
      ) : null}
      {agent.findings && agent.findings.length > 0 ? (
        <div>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-subtle">
            {agent.role === "critic"
              ? "Keep"
              : agent.role === "judge"
                ? "Closed"
                : agent.role === "improver"
                  ? "Attack"
                  : "Findings"}
          </h3>
          <ul className="space-y-2">
            {agent.findings.map((item) => (
              <li key={item} className="border-l border-border pl-3 text-sm leading-relaxed text-fg">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {agent.risks && agent.risks.length > 0 ? (
        <div>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-subtle">
            {agent.role === "critic" ? "Holes" : agent.role === "judge" ? "Still open" : "Risks"}
          </h3>
          <ul className="space-y-2">
            {agent.risks.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {agent.handoff ? (
        <p className="text-sm leading-relaxed text-muted">
          <span className="font-medium text-fg">Handoff. </span>
          {agent.handoff}
        </p>
      ) : null}
    </div>
  );
}

export function AgentLog() {
  const run = useChorus((s) => s.run);
  const selectedId = useChorus((s) => s.selectedId);
  const setSelected = useChorus((s) => s.setSelected);
  const agent = agentById(run, selectedId);

  if (!run) {
    return (
      <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Idle</p>
        <h2 className="mt-3 font-display text-2xl leading-tight text-fg">The swarm is dark.</h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">
          Paste the artifact you already use. Score it. Generation 1 has to beat gen 0.
          Recurse while the fixture still fails. Export the pairs when the score rises.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-3">
        {run.agents.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelected(item.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-md px-3 py-2 text-left transition-colors duration-150",
              selectedId === item.id ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            <span className="block font-mono text-xs uppercase tracking-widest">{item.role}</span>
            <span className="block text-sm">{item.name}</span>
          </button>
        ))}
      </div>
      {agent ? (
        <ScrollArea className="h-72 pr-3 md:h-80">
          <div className="flex items-center gap-2 pb-3">
            <h2 className="font-display text-2xl text-fg">{agent.name}</h2>
            <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
          </div>
          {agent.lens ? <p className="mb-4 text-sm text-muted">{agent.lens}</p> : null}
          <AgentBody agent={agent} />
        </ScrollArea>
      ) : null}
    </section>
  );
}
