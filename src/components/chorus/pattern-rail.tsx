import { PHASES } from "@/lib/chorus/labs";
import { useChorus } from "@/lib/chorus/store";
import type { Phase } from "@/lib/chorus/types";
import { cn } from "@/lib/utils";

const ORDER: Phase[] = [
  "idle",
  "conduct",
  "fanout",
  "critique",
  "merge",
  "eval",
  "improve",
  "judge",
  "done",
  "error",
];

function displayPhase(phase: Phase, generation: number): Phase {
  if (phase === "done" && generation <= 1) return "eval";
  if (phase === "done" && generation > 1) return "judge";
  return phase;
}

function reached(current: Phase, target: Phase, generation: number) {
  if (current === "error") return false;
  if (target === "improve" && generation > 1) return true;
  if (target === "eval") {
    return (
      current === "eval" ||
      current === "judge" ||
      current === "done" ||
      (generation > 1 && ORDER.indexOf(current) >= ORDER.indexOf("eval"))
    );
  }
  if (target === "judge") {
    return current === "judge" || (current === "done" && generation > 1);
  }
  return ORDER.indexOf(current) >= ORDER.indexOf(target);
}

export function PatternRail() {
  const phase = useChorus((s) => s.run?.phase ?? "idle");
  const generation = useChorus((s) => s.run?.generation ?? 1);
  const shown = displayPhase(phase, generation);

  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {PHASES.filter((item) => item.id !== "done").map((item, index) => {
        const active = shown === item.id || (item.id === "conduct" && phase === "idle");
        const lit = reached(shown, item.id, generation) && phase !== "idle";
        return (
          <li key={item.id} className="flex items-center gap-4">
            {index > 0 ? <span className="hidden h-px w-6 bg-border sm:block" /> : null}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  lit ? "bg-accent" : "bg-border",
                  active && phase !== "idle" && "chorus-breathe bg-warn",
                )}
              />
              <span
                className={cn(
                  "font-mono text-xs uppercase tracking-widest",
                  lit || active ? "text-fg" : "text-subtle",
                )}
              >
                {item.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
