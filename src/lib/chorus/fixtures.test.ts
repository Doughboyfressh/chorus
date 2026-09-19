import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIXTURES,
  applyUserTest,
  citesSourceLine,
  combineFixtureScore,
  matchCheck,
  parseFindings,
  plantHit,
  resolveFixture,
} from "./fixtures.ts";

describe("fixture tasks do not leak planted needles", () => {
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    it(`${id} task does not contain planted anyOf`, () => {
      const task = fixture.task.toLowerCase();
      for (const plant of fixture.planted) {
        for (const needle of plant.anyOf) {
          assert.equal(
            task.includes(needle.toLowerCase()),
            false,
            `${id} task leaks "${needle}"`,
          );
        }
      }
    });
  }
});

describe("applyUserTest", () => {
  it("appends instead of replacing lab input", () => {
    const base = resolveFixture("prompt", 1);
    const merged = applyUserTest(base, "extra case from the user");
    assert.match(merged.input, /req\.query\.name/);
    assert.match(merged.input, /Brought test/);
    assert.match(merged.input, /extra case from the user/);
    assert.equal(merged.execute, true);
  });
});

describe("matchCheck noneOf", () => {
  it("fails when a forbidden phrase is present", () => {
    const check = {
      id: "x",
      label: "faithful",
      anyOf: ["no effect"],
      noneOf: ["proved"],
    };
    assert.equal(matchCheck("no effect was found", check), true);
    assert.equal(matchCheck("no effect, the trial proved it", check), false);
  });
});

describe("matchCheck quote", () => {
  it("rejects a class word that does not cite the source", () => {
    const check = {
      id: "xss",
      label: "Caught XSS",
      anyOf: ["xss"],
      quote: ["req.query.name"],
    };
    const source = 'res.send("<h1>Hello " + req.query.name + "</h1>");';
    assert.equal(matchCheck("possible XSS in the handler", check, source), false);
    assert.equal(matchCheck("XSS via req.query.name concatenation", check, source), true);
  });
});

describe("combineFixtureScore", () => {
  it("cannot look cleared if a planted bug is missed", () => {
    const score = combineFixtureScore({
      checkPassed: 3,
      checkTotal: 3,
      plantPassed: 0,
      plantTotal: 3,
      execute: true,
    });
    assert.equal(score <= 79, true);
  });

  it("reaches 100 when every plant is caught", () => {
    assert.equal(
      combineFixtureScore({
        checkPassed: 0,
        checkTotal: 3,
        plantPassed: 3,
        plantTotal: 3,
        execute: true,
      }),
      100,
    );
  });

  it("the plate is plants, not the essay", () => {
    const missedBugs = combineFixtureScore({
      checkPassed: 3,
      checkTotal: 3,
      plantPassed: 0,
      plantTotal: 3,
      execute: true,
    });
    const caughtBugsThinEssay = combineFixtureScore({
      checkPassed: 0,
      checkTotal: 3,
      plantPassed: 3,
      plantTotal: 3,
      execute: true,
    });
    assert.equal(caughtBugsThinEssay > missedBugs, true);
    assert.equal(caughtBugsThinEssay, 100);
    assert.equal(missedBugs, 0);
  });
});

describe("plantHit", () => {
  const source = FIXTURES.prompt.input;
  const xss = FIXTURES.prompt.planted[0]!;

  it("rejects a class word that does not quote a source line", () => {
    assert.equal(plantHit(xss, "possible XSS in the handler", source), false);
    assert.equal(plantHit(xss, '{"findings":["XSS via req.query.name"]}', source), false);
  });

  it("passes when the finding quotes the planted line", () => {
    const body = JSON.stringify({
      findings: [
        {
          issue: "reflected XSS",
          quote: 'res.send("<h1>Hello " + req.query.name + "</h1>");',
        },
      ],
    });
    assert.equal(plantHit(xss, body, source), true);
  });
});

describe("parseFindings", () => {
  it("requires structured issue/quote objects", () => {
    assert.equal(parseFindings('{"findings":["a", {"issue":"b","quote":"c"}]}').length, 0);
    const rows = parseFindings('{"findings":[{"issue":"b","quote":"c"}]}');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.quote, "c");
  });
});

describe("citesSourceLine", () => {
  it("requires a real line from the source", () => {
    const source = FIXTURES.prompt.input;
    assert.equal(citesSourceLine("req.query.name", source, ["req.query.name"]), false);
    assert.equal(
      citesSourceLine('res.send("<h1>Hello " + req.query.name + "</h1>");', source, ["req.query.name"]),
      true,
    );
  });
});
