export const LOOP_LINE =
  "Paste an artifact. The fixture grades it. Recurse until the score rises. Keep the pairs.";

export const ARTIFACT_SHAPES =
  "Prompt, eval, and spec are artifacts you bring. Contract is the artifact the swarm gives itself.";

export const LEXICON = [
  {
    id: "artifact",
    term: "Artifact",
    body: "The thing being improved. A prompt, an eval, a spec, a contract. What you paste as gen 0, and what the swarm rewrites each generation. The deliverable, not the chat around it.",
  },
  {
    id: "fixture",
    term: "Fixture",
    body: "A test the swarm does not write. Held-out cases (planted bugs, a faithfulness trap, a crisis reply) scored against the artifact. When the artifact clears it, the fixture mutates and gets harder. The number on the plate is this, not the critic’s opinion.",
  },
  {
    id: "pairs",
    term: "Pairs",
    body: "Training data. When a later generation scores higher, Chorus exports JSONL: the worse artifact as rejected, the better as chosen, plus scores, fixture, and model. Those are preference pairs — what you’d use to train or rank a model. No rise in score, no pair.",
  },
  {
    id: "prompt",
    term: "Prompt",
    body: "The instructions you give a model. “Review this PR” is a prompt. Recurse a prompt means: make that text stricter, testable, harder to game, then try it on public practice code. Independent improvement requires separate private validation.",
  },
  {
    id: "eval",
    term: "Eval",
    body: "A test suite for a model. Items, foils, a scoring rule. “Did the summary stay faithful?” is an eval. Chorus’s own fixture is an eval. The eval lab is about designing one that mutates when it gets beaten.",
  },
  {
    id: "spec",
    term: "Spec",
    body: "What done looks like before anyone writes. Constraints, kill-criteria, stop conditions. A prompt is a spec aimed at a model; an eval is a spec aimed at grading.",
  },
  {
    id: "contract",
    term: "Contract",
    body: "Chorus’s word for the spec the conductor writes for this generation. Who the specialists are, what they must not overlap, what “done” means. Recurse rewrites the contract so the next staff is aimed at fixture failures, not a new essay.",
  },
] as const;
