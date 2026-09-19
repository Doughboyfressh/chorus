import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastCompleteGeneration, recurseTarget, sittingArtifact, formatArtifact, judgeFromFixture } from "./ledger.ts";
import type { SwarmRun } from "./types.ts";

function run(partial: Partial<SwarmRun>): SwarmRun {
  return {
    id: "t",
    goal: "goal text here",
    startedAt: 1,
    phase: "done",
    generation: 1,
    generations: [],
    agents: [],
    ...partial,
  };
}

describe("recurseTarget", () => {
  it("attacks fixture failures before critic prose", () => {
    const sitting = run({
      generation: 1,
      evaluation: {
        labId: "prompt",
        fixture: "v1",
        score: 40,
        passed: ["Prompt names security as the job"],
        failed: ["Caught XSS"],
        evidence: "",
        level: 0,
      },
      critique: { verdict: "thin", holes: ["essay hole"], keep: ["keep me"], kill: [] },
    });
    const target = recurseTarget(sitting);
    assert.deepEqual(target.attack, ["Caught XSS"]);
    assert.deepEqual(target.frozen, ["Prompt names security as the job"]);
  });

  it("does not recurse when the fixture is cleared", () => {
    const sitting = run({
      evaluation: {
        labId: "prompt",
        fixture: "v1",
        score: 100,
        passed: ["a"],
        failed: [],
        evidence: "",
        level: 0,
      },
      critique: { verdict: "still holes", holes: ["essay"], keep: [], kill: [] },
    });
    assert.deepEqual(recurseTarget(sitting).attack, []);
  });
});

describe("lastCompleteGeneration", () => {
  it("returns the newest merge", () => {
    const sitting = run({
      generation: 2,
      generations: [
        {
          n: 1,
          contract: "a",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "one",
            deliverable: "rewritten prompt",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
        },
        { n: 2, contract: "b", whyThisSplit: "", specialists: [] },
      ],
    });
    assert.equal(lastCompleteGeneration(sitting)?.n, 1);
  });
});

describe("sittingArtifact", () => {
  it("uses the paste as current on gen 1", () => {
    const sitting = run({ pastedArtifact: "the shipped prompt" });
    const art = sittingArtifact(sitting);
    assert.equal(art.current, "the shipped prompt");
    assert.equal(art.origin, "the shipped prompt");
    assert.match(formatArtifact(art), /Improve THIS/);
    assert.doesNotMatch(formatArtifact(art), /Origin \(gen 0\)/);
  });

  it("hands specialists the last deliverable after a merge", () => {
    const sitting = run({
      pastedArtifact: "the shipped prompt",
      generation: 2,
      generations: [
        {
          n: 1,
          contract: "a",
          whyThisSplit: "",
          specialists: [],
          synthesis: {
            title: "one",
            deliverable: "rewritten prompt",
            steps: [],
            watchouts: [],
            pattern: { contract: "", fanout: "", critique: "", merge: "" },
          },
        },
      ],
    });
    const text = formatArtifact(sittingArtifact(sitting));
    assert.match(text, /rewritten prompt/);
    assert.match(text, /Origin \(gen 0\)/);
    assert.match(text, /the shipped prompt/);
  });
});

describe("judgeFromFixture", () => {
  it("closes holes only when the fixture drops them", () => {
    const judged = judgeFromFixture(
      { score: 40, failed: ["Caught XSS", "Caught SQL"] },
      { score: 80, failed: ["Caught SQL"] },
    );
    assert.equal(judged.verdict, "improved");
    assert.equal(judged.holes.find((h) => h.hole === "Caught XSS")?.status, "closed");
    assert.equal(judged.holes.find((h) => h.hole === "Caught SQL")?.status, "open");
  });

  it("does not call a rise a stall", () => {
    const judged = judgeFromFixture({ score: 50, failed: ["a"] }, { score: 50, failed: ["a"] });
    assert.equal(judged.verdict, "stalled");
  });
});
