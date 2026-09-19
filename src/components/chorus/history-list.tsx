import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MAX_GENERATIONS } from "@/lib/chorus/labs";
import { recurseTarget } from "@/lib/chorus/run";
import {
  applyLedgerFile,
  exportLedgerFile,
  loadHistory,
  loadSession,
  useChorus,
  type LedgerFile,
} from "@/lib/chorus/store";
import type { SwarmRun } from "@/lib/chorus/types";

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

function sittingLabel(run: SwarmRun) {
  const target = recurseTarget(run);
  const gen = run.generation ?? 1;
  const open = target.attack.length;
  const verdict = "independent improvement unverified";
  const score = run.evaluation?.score;
  const model = run.slotSnapshot?.model;
  const bits = [
    `Gen ${gen}`,
    typeof score === "number" ? `${score}/100 · unverified` : null,
    model ?? null,
    `${open} open`,
    verdict,
  ].filter(Boolean);
  return bits.join(" · ");
}

export function MemoryCard() {
  const history = useChorus((s) => s.history);
  const restore = useChorus((s) => s.restore);
  const seedFrom = useChorus((s) => s.seedFrom);
  const busy = isBusy(useChorus((s) => s.run?.phase));
  const latest = history.find((item) => item.phase === "done" && item.synthesis);
  if (!latest) return null;
  const target = recurseTarget(latest);
  const capped = (latest.generation ?? 1) >= MAX_GENERATIONS;

  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Memory</p>
      <p className="mt-2 font-display text-xl leading-snug text-fg">{sittingLabel(latest)}</p>
      {target.attack.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {target.attack.slice(0, 4).map((hole) => (
            <li key={hole} className="border-l border-accent pl-3 text-sm leading-relaxed text-fg">
              {hole}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No open holes in the last sitting.</p>
      )}
      {target.frozen.length > 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">Frozen: {target.frozen.join(" · ")}</p>
      ) : null}
      <Button
        className="mt-4 w-full"
        disabled={busy}
        onClick={() => (capped ? seedFrom(latest) : restore(latest))}
      >
        {capped ? "Continue loop" : "Resume this loop"}
      </Button>
    </div>
  );
}

function LedgerPort() {
  const setHistory = useChorus((s) => s.setHistory);
  const restore = useChorus((s) => s.restore);
  const hydrateBaseline = useChorus((s) => s.hydrateBaseline);
  const busy = isBusy(useChorus((s) => s.run?.phase));

  function download() {
    const body = JSON.stringify(exportLedgerFile(), null, 2);
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chorus-ledger.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(file: File) {
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as LedgerFile;
        if (parsed.v !== 1 || !Array.isArray(parsed.history)) return;
        applyLedgerFile(parsed);
        setHistory(loadHistory());
        const session = loadSession();
        if (session) restore(session);
        if (parsed.baseline?.evaluation) hydrateBaseline(parsed.baseline);
      } catch {
        /* ignore junk files */
      }
    });
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
        Export ledger
      </Button>
      <label className="inline-flex h-9 cursor-pointer items-center rounded-sm bg-surface-2 px-3 text-xs font-medium text-fg shadow-[var(--shadow-border)]">
        Import ledger
        <input
          type="file"
          accept="application/json"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export function HistoryList() {
  const history = useChorus((s) => s.history);
  const restore = useChorus((s) => s.restore);
  const seedFrom = useChorus((s) => s.seedFrom);
  const busy = isBusy(useChorus((s) => s.run?.phase));

  if (history.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted">No ledger in this browser yet.</p>
        <LedgerPort />
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <ul className="space-y-2">
        {history.map((item) => {
          const capped = (item.generation ?? 1) >= MAX_GENERATIONS && item.phase === "done";
          return (
            <li key={item.id}>
              <Button
                variant="secondary"
                className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
                disabled={busy}
                onClick={() => (capped ? seedFrom(item) : restore(item))}
              >
                <span className="block">
                  <span className="block font-mono text-xs uppercase tracking-widest text-muted">
                    {sittingLabel(item)}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm text-fg">{item.goal}</span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      <LedgerPort />
    </ScrollArea>
  );
}
