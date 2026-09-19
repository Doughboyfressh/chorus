import { extractJson } from "./parse.ts";
import { gradeArtifact } from "./grade.ts";
import { labBrief, resolveGoal } from "./labs.ts";
import type { Agent } from "./types.ts";

export type SeatId =
  | "conductor"
  | "s1"
  | "s2"
  | "s3"
  | "critic"
  | "synthesizer"
  | "improver"
  | "judge";

export type Orchestra = {
  labId?: string;
  goal: string;
  pasted?: string;
  mode: "gen1" | "recurse";
  filled: Partial<Record<SeatId, string>>;
};

const GEN1: SeatId[] = ["conductor", "s1", "s2", "s3", "critic", "synthesizer"];
const RECURSE: SeatId[] = ["improver", "s1", "s2", "s3", "critic", "synthesizer", "judge"];

function order(mode: Orchestra["mode"]) {
  return mode === "recurse" ? RECURSE : GEN1;
}

function clip(text: string, n: number) {
  return text.trim().slice(0, n);
}

export function startOrchestraState(args: {
  labId?: string;
  goal?: string;
  pasted?: string;
  recurse?: boolean;
}): Orchestra {
  const labId = args.labId || "rsi";
  return {
    labId,
    goal: resolveGoal(labId, args.goal),
    pasted: args.pasted ? clip(args.pasted, 8000) : undefined,
    mode: args.recurse ? "recurse" : "gen1",
    filled: {},
  };
}

function parseConductor(text: string) {
  try {
    const parsed = extractJson<{
      contract?: string;
      whyThisSplit?: string;
      specialists?: { id?: string; name?: string; mandate?: string; lens?: string }[];
    }>(text);
    const specialists = (Array.isArray(parsed.specialists) ? parsed.specialists : []).slice(0, 3);
    while (specialists.length < 3) {
      specialists.push({
        name: `Specialist ${specialists.length + 1}`,
        mandate: "Cover a remaining gap.",
        lens: "What the others missed.",
      });
    }
    return {
      contract: String(parsed.contract || "Deliver a testable artifact.").slice(0, 2000),
      whyThisSplit: String(parsed.whyThisSplit || "Non-overlapping mandates.").slice(0, 400),
      specialists: specialists.map((row, i) => ({
        id: `s${i + 1}`,
        name: String(row.name || `Specialist ${i + 1}`).slice(0, 80),
        mandate: String(row.mandate || "A distinct job.").slice(0, 400),
        lens: String(row.lens || "A unique failure mode.").slice(0, 200),
      })),
    };
  } catch {
    return {
      contract: clip(text, 2000) || "Deliver a testable artifact.",
      whyThisSplit: "Fallback split.",
      specialists: [1, 2, 3].map((i) => ({
        id: `s${i}`,
        name: `Specialist ${i}`,
        mandate: "Cover a remaining gap.",
        lens: "What the others missed.",
      })),
    };
  }
}

function parsePatch(text: string) {
  try {
    const parsed = extractJson<{ headline?: string; patch?: string; findings?: string[] }>(text);
    return {
      headline: String(parsed.headline || "").slice(0, 200),
      patch: String(parsed.patch || text).slice(0, 8000),
      findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).slice(0, 5) : [],
    };
  } catch {
    return { headline: "", patch: clip(text, 8000), findings: [] };
  }
}

function parseMerge(text: string) {
  try {
    const parsed = extractJson<{ title?: string; deliverable?: string }>(text);
    return {
      title: String(parsed.title || "Merge").slice(0, 120),
      deliverable: String(parsed.deliverable || text).slice(0, 24000),
    };
  } catch {
    return { title: "Merge", deliverable: clip(text, 24000) };
  }
}

function staffOf(orch: Orchestra) {
  return orch.filled.conductor ? parseConductor(orch.filled.conductor).specialists : [];
}

function contractOf(orch: Orchestra) {
  return orch.filled.conductor ? parseConductor(orch.filled.conductor).contract : "";
}

export function pendingSeat(orch: Orchestra): SeatId | null {
  for (const id of order(orch.mode)) {
    if (!orch.filled[id]?.trim()) return id;
  }
  return null;
}

export function seatPrompt(orch: Orchestra, seat: SeatId) {
  const labCtx = labBrief(orch.labId);
  const goal = orch.goal;
  const stay = `Stay on this lab. ${labCtx}`;
  const pasted = orch.pasted?.trim()
    ? `\nRewrite THIS artifact. Do not start a new essay.\n---\n${orch.pasted.slice(0, 1800)}\n---`
    : "";
  const staff = staffOf(orch);
  const contract = contractOf(orch) || "Deliver a testable artifact.";
  const seatBrief = staff[["s1", "s2", "s3"].indexOf(seat)];
  const patches = (["s1", "s2", "s3"] as const)
    .map((id) => {
      const row = staff[["s1", "s2", "s3"].indexOf(id)];
      const fill = orch.filled[id];
      if (!row || !fill) return "";
      const parsed = parsePatch(fill);
      return `${row.name}: ${parsed.headline}\n${parsed.patch}`;
    })
    .filter(Boolean)
    .join("\n\n");

  if (seat === "conductor") {
    return {
      seat,
      role: "Conductor",
      user: `You are the Conductor. Write a tight contract, then staff 3 specialists with zero overlapping mandates.

${stay}

User goal (if it conflicts with the lab, the lab wins):
${goal}
${pasted}

Return JSON:
{"contract":"what done looks like","whyThisSplit":"one sentence","specialists":[{"id":"s1","name":"Two Word Role","mandate":"one sentence unique job","lens":"what they uniquely notice"}]}

Exactly 3 specialists. Names are roles, not cute. Do not staff a trading desk, a tutor, or any other product than this lab.`,
    };
  }
  if (seatBrief && (seat === "s1" || seat === "s2" || seat === "s3")) {
    return {
      seat,
      role: seatBrief.name,
      user: `You are ${seatBrief.name}.
Mandate: ${seatBrief.mandate}
Lens: ${seatBrief.lens}

${stay}

Contract:
${contract}

Goal:
${goal}
${pasted}

Do the work from your lens only. Return JSON:
{"headline":"one-line result","findings":["concrete findings"],"risks":["risks"],"handoff":"what merge must not lose","patch":"rewritten excerpt or full artifact"}`,
    };
  }
  if (seat === "critic") {
    return {
      seat,
      role: "Critic",
      user: `You are the Critic. Find holes, overlap, and confident-wrong claims.

${stay}

Contract:
${contract}

Goal:
${goal}

Dossier:
${patches || "No patches yet."}

Return JSON:
{"verdict":"2 sentences","holes":["gaps"],"keep":["must survive"],"kill":["drop these"]}`,
    };
  }
  if (seat === "synthesizer") {
    return {
      seat,
      role: "Synthesizer",
      user: `You are the Synthesizer. Merge surviving work into one deliverable.

${stay}

Goal:
${goal}

Contract:
${contract}

Patches:
${patches || "No patches."}

Critic:
${orch.filled.critic ?? ""}
${pasted}

Return JSON:
{"title":"short title","deliverable":"the actual artifact","steps":["next actions"],"watchouts":["what still fails"]}`,
    };
  }
  if (seat === "improver") {
    return {
      seat,
      role: "Improver",
      user: `You are the Improver. Open holes are the next contract. Rewrite so the next staff closes them.

${stay}

Goal:
${goal}

Current contract:
${contract}
${pasted}

Return JSON:
{"contract":"next contract","whyThisSplit":"one sentence","specialists":[{"id":"s1","name":"Role","mandate":"job","lens":"lens"}]}`,
    };
  }
  return {
    seat,
    role: "Judge",
    user: `You are the Judge. Did named holes actually close? Slogans do not count.

Goal:
${goal}

Contract:
${contract}

Merge:
${orch.filled.synthesizer ?? ""}

Return JSON:
{"verdict":"improved|stalled|worse","score":"one sentence","holes":[{"hole":"name","status":"closed|open"}]}`,
  };
}

export function applyFill(orch: Orchestra, seat: SeatId, text: string): Orchestra {
  return { ...orch, filled: { ...orch.filled, [seat]: clip(text, 24_000) } };
}

export function mergeDeliverable(orch: Orchestra) {
  const raw = orch.filled.synthesizer;
  if (!raw) return "";
  return parseMerge(raw).deliverable;
}

export function orchestraStaff(orch: Orchestra) {
  if (orch.filled.improver && orch.mode === "recurse") {
    const next = parseConductor(orch.filled.improver);
    if (next.specialists.length) return next;
  }
  return orch.filled.conductor ? parseConductor(orch.filled.conductor) : null;
}

export function orchestraAgents(orch: Orchestra): Agent[] {
  const staff = orchestraStaff(orch);
  const pending = pendingSeat(orch);
  const names: { id: SeatId; role: Agent["role"]; name: string; mandate: string }[] = [
    { id: "conductor", role: "conductor", name: "Conductor", mandate: staff?.contract || "Write the contract." },
    {
      id: "s1",
      role: "specialist",
      name: staff?.specialists[0]?.name || "Specialist A",
      mandate: staff?.specialists[0]?.mandate || "Awaiting brief",
    },
    {
      id: "s2",
      role: "specialist",
      name: staff?.specialists[1]?.name || "Specialist B",
      mandate: staff?.specialists[1]?.mandate || "Awaiting brief",
    },
    {
      id: "s3",
      role: "specialist",
      name: staff?.specialists[2]?.name || "Specialist C",
      mandate: staff?.specialists[2]?.mandate || "Awaiting brief",
    },
    { id: "critic", role: "critic", name: "Critic", mandate: "Find holes." },
    { id: "synthesizer", role: "synthesizer", name: "Synthesizer", mandate: "Merge survivors." },
    { id: "improver", role: "improver", name: "Improver", mandate: "Close open holes." },
    { id: "judge", role: "judge", name: "Judge", mandate: "Did holes close." },
  ];
  return names.map((row) => {
    const filled = Boolean(orch.filled[row.id]?.trim());
    const status: Agent["status"] = filled ? "done" : pending === row.id ? "running" : "pending";
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      mandate: row.mandate,
      status,
      headline: filled ? "Filled" : pending === row.id ? "This host" : "Waiting",
      body: orch.filled[row.id],
    };
  });
}

export function gradeMerge(orch: Orchestra, labId: string, level: number) {
  const deliverable = mergeDeliverable(orch);
  if (!deliverable.trim()) return null;
  return gradeArtifact({ labId, deliverable, level });
}
