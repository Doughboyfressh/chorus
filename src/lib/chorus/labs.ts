import type { Phase } from "./types";

export type Lab = {
  id: string;
  title: string;
  blurb: string;
  goal: string;
  trap?: string;
};

export const LABS: Lab[] = [
  {
    id: "rsi",
    title: "Recursive self-improvement",
    blurb: "The swarm improves its own contract. That is the loop. Not the trading indicator.",
    trap: "Not Relative Strength Index. Not tickers, backtests, RSI-14, or a trading desk. The artifact is an AI coding-agent loop: what it rewrites, the numeric kill, diversity, stop.",
    goal: "Design a recursive self-improvement loop for an AI coding agent that currently plateaus after one pass of self-critique. Specify: the artifact it rewrites each generation, the critic's kill-criteria, a diversity constraint so it does not collapse to one style, and the stop condition. Then write the first improved contract the loop should give itself.",
  },
  {
    id: "prompt",
    title: "Recurse a prompt",
    blurb: "Forge a spec, then forge the spec that grades the spec.",
    goal: "Forge a production prompt for a code-review agent that must catch security bugs in TypeScript PRs. The current prompt is: \"Review this code and suggest improvements.\" Make the new prompt strict, testable, and hard to game with vague praise. Then specify how the prompt should rewrite itself after it misses a bug.",
  },
  {
    id: "eval",
    title: "Self-improving eval",
    blurb: "Tests that spawn harder tests when they are beaten.",
    goal: "Design a 5-item eval for summarization faithfulness on scientific abstracts, plus a mutation rule: when the model scores above 80%, how the eval rewrites itself to stay ahead. Each item needs a source snippet, a tempting unfaithful summary, a faithful summary, and the scoring rule.",
  },
  {
    id: "stress",
    title: "Stress-test the loop",
    blurb: "Find how a self-modifying system harms people.",
    goal: "An AI tutor for teenagers that rewrites its own lesson plans after each session and always sounds confident. Map failure modes of recursive self-modification, who is harmed, and the smallest product changes that would cap drift without killing usefulness.",
  },
  {
    id: "data",
    title: "Compound the signal",
    blurb: "A swarm that grows training data, then grows the swarm.",
    goal: "Design a swarm topology that generates high-quality preference pairs for reasoning tasks at 10× current human-only throughput, without collapsing diversity or reinforcing sycophancy. Then specify how the topology rewrites its own roles after each batch using critic holes as the gradient.",
  },
  {
    id: "generic",
    title: "Freeform",
    blurb: "Your problem. Checklist only unless you bring a test.",
    goal: "Name the artifact, the kill-criteria, and the test that would fail today. Then write the first version of that artifact.",
  },
];

export const PHASES: { id: Exclude<Phase, "idle" | "error">; label: string }[] = [
  { id: "conduct", label: "Contract" },
  { id: "fanout", label: "Fan-out" },
  { id: "critique", label: "Critique" },
  { id: "merge", label: "Merge" },
  { id: "eval", label: "Fixture" },
  { id: "improve", label: "Recurse" },
  { id: "judge", label: "Judge" },
  { id: "done", label: "Done" },
];

export const HISTORY_LIMIT = 8;
export const MIN_GOAL = 12;
export const MAX_GOAL = 800;
export const MAX_GENERATIONS = 8;

export function labById(id?: string) {
  return LABS.find((lab) => lab.id === id) ?? LABS.find((lab) => lab.id === "generic")!;
}

export function resolveGoal(labId: string | undefined, goal?: string) {
  const lab = labById(labId);
  const g = (goal ?? "").trim();
  if (!g || g.toLowerCase() === lab.id || g.length < MIN_GOAL) return lab.goal;
  return g.slice(0, MAX_GOAL);
}

export function labBrief(labId?: string) {
  const lab = labById(labId);
  return [`Lab: ${lab.title} (${lab.id}). ${lab.blurb}`, lab.trap, `Goal:\n${lab.goal}`]
    .filter(Boolean)
    .join("\n");
}
