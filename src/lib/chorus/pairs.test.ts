import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preferencePairs, trainingPack } from "./pairs.ts";
import type { SwarmRun } from "./types.ts";

function run(partial: Partial<SwarmRun>): SwarmRun {
  return {
    id: "t",
    goal: "g",
    labId: "prompt",
    startedAt: 1,
    phase: "done",
    generation: 2,
    generations: [],
    agents: [],
    ...partial,
  };
}

describe("preferencePairs", () => {
  it("emits a pair only when the score rises", () => {
    const sitting = run({
      generations: [
        {
          n: 1,
          contract: "a",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "one",
            deliverable: "weak",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
          evaluation: {
            labId: "prompt",
            fixture: "v1",
            score: 40,
            passed: [],
            failed: ["xss"],
            evidence: "",
            level: 0,
          },
        },
        {
          n: 2,
          contract: "b",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "two",
            deliverable: "strong",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
          evaluation: {
            labId: "prompt",
            fixture: "v1",
            score: 80,
            passed: ["xss"],
            failed: [],
            evidence: "",
            level: 0,
          },
        },
      ],
      slotSnapshot: { mode: "hosted", model: "grok-4.5", baseUrl: "https://api.x.ai/v1" },
    });
    const pairs = preferencePairs(sitting);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.chosen, "strong");
    assert.equal(pairs[0]?.rejected, "weak");
    assert.equal(pairs[0]?.model, "grok-4.5");
  });

  it("skips a stall", () => {
    const sitting = run({
      generations: [
        {
          n: 1,
          contract: "a",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "one",
            deliverable: "a",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
          evaluation: {
            labId: "prompt",
            fixture: "v1",
            score: 50,
            passed: [],
            failed: [],
            evidence: "",
            level: 0,
          },
        },
        {
          n: 2,
          contract: "b",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "two",
            deliverable: "b",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
          evaluation: {
            labId: "prompt",
            fixture: "v1",
            score: 50,
            passed: [],
            failed: [],
            evidence: "",
            level: 0,
          },
        },
      ],
    });
    assert.equal(preferencePairs(sitting).length, 0);
  });
});

describe("trainingPack", () => {
  it("says it does not train, and is empty without a rise", () => {
    const pack = trainingPack(run({ generations: [] }));
    assert.equal(pack.dpo.length, 0);
    assert.match(pack.note, /dpoClean/);
  });
});
