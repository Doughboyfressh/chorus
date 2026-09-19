import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LOOP_LINE } from "@/lib/chorus/lexicon";
import { loadMcpSit } from "@/lib/chorus/mcp-url";
import { loadSlot, loadLane } from "@/lib/chorus/slot";
import { listSittings } from "@/lib/chorus/sittings";
import { loadBaseline, loadHistory, loadSession, useChorus } from "@/lib/chorus/store";
import { AgentLog } from "./agent-log";
import { Composer } from "./composer";
import { HistoryList, MemoryCard } from "./history-list";
import { ModelSlotPanel } from "./model-slot";
import { PatternRail } from "./pattern-rail";
import { SwarmStage } from "./swarm-stage";
import { Synthesis } from "./synthesis";
import { SiteFooter, SiteHeader } from "./chrome";

export function ChorusApp() {
  const setHistory = useChorus((s) => s.setHistory);
  const setHostedAvailable = useChorus((s) => s.setHostedAvailable);
  const setSlot = useChorus((s) => s.setSlot);
  const setLane = useChorus((s) => s.setLane);
  const hydrateBaseline = useChorus((s) => s.hydrateBaseline);
  const restore = useChorus((s) => s.restore);
  const ingestMcpRun = useChorus((s) => s.ingestMcpRun);
  const mergeRemoteSittings = useChorus((s) => s.mergeRemoteSittings);
  const phase = useChorus((s) => s.run?.phase ?? "idle");
  const lane = useChorus((s) => s.lane);
  const historyLength = useChorus((s) => s.history.length);

  useEffect(() => {
    setHistory(loadHistory());
    setSlot(loadSlot());
    setLane(loadLane());
    setHostedAvailable(false);
    const session = loadSession();
    if (session) restore(session);
    else {
      const baseline = loadBaseline();
      if (baseline) hydrateBaseline(baseline);
    }
    void listSittings()
      .then((rows) => {
        const runs = rows
          .map((row) => {
            try {
              return JSON.parse(row.payload) as Parameters<typeof mergeRemoteSittings>[0][number];
            } catch {
              return null;
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (runs.length) mergeRemoteSittings(runs);
      })
      .catch(() => {
        /* signed out */
      });
  }, [setHostedAvailable, setHistory, setSlot, setLane, restore, hydrateBaseline, mergeRemoteSittings]);

  useEffect(() => {
    if (lane !== "mcp") return;
    const sit = loadMcpSit();
    let cancelled = false;
    const pull = () => {
      void fetch(`/api/sitting?sit=${encodeURIComponent(sit)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { run?: Parameters<typeof ingestMcpRun>[0] | null } | null) => {
          if (!cancelled && data?.run) ingestMcpRun(data.run);
        })
        .catch(() => {
          /* host not scored yet */
        });
    };
    pull();
    const timer = window.setInterval(pull, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [lane, ingestMcpRun]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh bg-bg text-fg">
        <SiteHeader active="lab" aside={<PatternRail />} />

        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:py-8">
          <aside className="flex flex-col gap-6">
            {phase === "idle" ? (
              <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
                <p className="font-mono text-xs uppercase tracking-widest text-subtle">Lab</p>
                <h1 className="mt-3 font-display text-3xl leading-snug text-fg">
                  Recursive self-improvement is the goal.
                </h1>
                <p className="mt-4 text-sm leading-relaxed text-muted">{LOOP_LINE}</p>
                <Link
                  to="/glossary"
                  className="mt-4 inline-block text-sm text-fg underline decoration-border underline-offset-4"
                >
                  Lexicon
                </Link>
              </section>
            ) : null}
            <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <Composer />
            </section>
            <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <ModelSlotPanel />
            </section>
            {phase === "idle" && historyLength > 0 ? (
              <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
                <MemoryCard />
              </section>
            ) : null}
            <section className="rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <details open={phase === "idle"}>
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-subtle">
                  Earlier runs
                </summary>
                <div className="mt-3">
                  <HistoryList />
                </div>
              </details>
            </section>
          </aside>

          <section className="flex min-w-0 flex-col gap-6">
            <SwarmStage />
            <AgentLog />
            <Synthesis />
          </section>
        </main>
        <SiteFooter />
        <Toaster theme="dark" position="bottom-center" richColors={false} />
      </div>
    </TooltipProvider>
  );
}
