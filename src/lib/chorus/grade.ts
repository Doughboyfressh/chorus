import {
  applyUserTest,
  combineFixtureScore,
  maxFixtureLevel,
  plantHit,
  resolveFixture,
  scoreChecks,
} from "./fixtures.ts";
import type { EvalResult } from "./types.ts";

export function examFor(labId?: string, level = 0, userTest?: string) {
  const fixture = applyUserTest(resolveFixture(labId, level), userTest);
  return {
    labId: fixture.labId,
    title: fixture.title,
    blurb: fixture.blurb,
    task: fixture.task,
    input: fixture.input,
    execute: fixture.execute,
    level,
    findingsSchema: '{ "findings": [{ "issue": "one line", "quote": "exact line copied from input" }] }',
    note: fixture.execute
      ? "Run exam.input under the artifact. Score with findings JSON. quote must be a verbatim line from input, not from your spec."
      : "Checklist only. Send the artifact to score.",
  };
}

export function gradeArtifact(args: {
  labId?: string;
  title?: string;
  deliverable: string;
  findings?: string;
  userTest?: string;
  level?: number;
}): EvalResult {
  const requested = Math.max(0, Number(args.level) || 0);
  const max = maxFixtureLevel(args.labId);
  const level = Math.min(requested, Math.max(max, 0));
  const fixture = applyUserTest(resolveFixture(args.labId, level), args.userTest);
  const artifact = `${args.title ?? ""}\n${args.deliverable}`;
  const structural = scoreChecks(artifact, fixture.checks);
  let plantedPassed: string[] = [];
  let plantedFailed: string[] = [];
  let evidence = "Scored against the held-out checklist only.";
  const shouldRun = fixture.execute && (fixture.planted.length > 0 || fixture.input.trim().length > 0);
  const findings = args.findings?.trim() ?? "";

  if (shouldRun && findings) {
    evidence = findings.slice(0, 500);
    if (fixture.planted.length > 0) {
      for (const plant of fixture.planted) {
        if (plantHit(plant, findings, fixture.input)) plantedPassed.push(plant.label);
        else plantedFailed.push(plant.label);
      }
    } else if (findings.length < 8) {
      plantedFailed = ["Produced output on the brought test"];
    } else {
      plantedPassed = ["Produced output on the brought test"];
    }
  } else if (shouldRun) {
    plantedFailed =
      fixture.planted.length > 0
        ? fixture.planted.map((p) => p.label)
        : ["Host must run the exam"];
    evidence = "No findings yet. Use exam.task + exam.input with your model, then score again.";
  }

  const score = combineFixtureScore({
    checkPassed: structural.passed.length,
    checkTotal: fixture.checks.length || 1,
    plantPassed: plantedPassed.length,
    plantTotal: plantedPassed.length + plantedFailed.length,
    execute: shouldRun,
  });

  const platePassed = shouldRun && (plantedPassed.length + plantedFailed.length) > 0 ? plantedPassed : structural.passed;
  const plateFailed = shouldRun && (plantedPassed.length + plantedFailed.length) > 0 ? plantedFailed : structural.failed;
  const plantsOpen = shouldRun && plantedFailed.length > 0;
  const quoteHint = plantsOpen
    ? "Findings need {issue, quote}. quote must copy a verbatim line from exam.input — not a line from your spec."
    : shouldRun && !findings
      ? "Host must run the exam, then chorus_score with findings that quote exam.input."
      : undefined;

  return {
    labId: fixture.labId,
    fixture: fixture.title,
    score,
    passed: platePassed,
    failed: plateFailed,
    evidence,
    level,
    exhausted: level >= max && score >= 100 && plateFailed.length === 0,
    quoteHint,
  };
}
