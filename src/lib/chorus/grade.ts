import { boundedText, INTEGRITY_VERSION, GRADER_VERSION, MAX_ARTIFACT, MAX_USER_TEST, quarantine } from "./integrity.ts";
import {
  applyUserTest,
  combineFixtureScore,
  maxFixtureLevel,
  assessPlant,
  type CheckAssessment,
  resolveFixture,
  scoreChecks,
} from "./fixtures.ts";
import { FINDINGS_SCHEMA, FINDINGS_INSTRUCTIONS, validateFindings } from "./findings.ts";
import type { EvalResult } from "./types.ts";

export function examFor(labId?: string, level = 0, userTest?: string) {
  if (userTest !== undefined) boundedText(userTest, "userTest", MAX_USER_TEST);
  const fixture = applyUserTest(resolveFixture(labId, level), userTest);
  return {
    labId: fixture.labId,
    title: fixture.title,
    blurb: "Public practice exercise, not a private holdout.",
    verification: "unverified",
    graderVersion: GRADER_VERSION,
    task: fixture.task,
    input: fixture.input,
    execute: fixture.execute,
    level,
    maxLevel: maxFixtureLevel(labId),
    outputSchema: FINDINGS_SCHEMA,
    outputInstructions: FINDINGS_INSTRUCTIONS,
    findingsSchema: '{ "findings": [{ "issue": "one line", "quote": "exact line copied from input" }] }',
    note: fixture.execute
      ? "Run exam.input under the artifact. Score with findings JSON. quote must be a verbatim line from input, not from your spec."
      : "Diagnostic checklist only. This is not an execution score.",
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
  boundedText(args.deliverable, "artifact", MAX_ARTIFACT, 1);
  if (args.title !== undefined) boundedText(args.title, "title", 2000);
  if (args.findings !== undefined) validateFindings(args.findings);
  if (args.userTest !== undefined) boundedText(args.userTest, "userTest", MAX_USER_TEST);
  const max = maxFixtureLevel(args.labId);
  const level = args.level ?? 0;
  const fixture = applyUserTest(resolveFixture(args.labId, level), args.userTest);
  const artifact = `${args.title ?? ""}\n${args.deliverable}`;
  const structural = scoreChecks(artifact, fixture.checks);
  let plantedPassed: string[] = [];
  const checkResults: CheckAssessment[] = [];
  let plantedFailed: string[] = [];
  let evidence = "Diagnostic checklist only; no execution was verified.";
  const shouldRun = fixture.execute && (fixture.planted.length > 0 || fixture.input.trim().length > 0);
  const findings = args.findings?.trim() ?? "";

  if (shouldRun && findings) {
    evidence = findings; // Preserve the complete submitted output; this remains host-supplied evidence.
    if (fixture.planted.length > 0) {
      for (const plant of fixture.planted) {
        const check = assessPlant(plant, findings, fixture.input);
        checkResults.push(check);
        if (check.passed) plantedPassed.push(plant.label);
        else plantedFailed.push(plant.label);
      }
    } else {
      plantedFailed = ["No evaluator is configured for this brought test"];
    }
  } else if (shouldRun) {
    plantedFailed =
      fixture.planted.length > 0
        ? fixture.planted.map((p) => p.label)
        : ["Host must run the exam"];
    evidence = "No findings yet. Use exam.task + exam.input with your model, then score again.";
  }

  let score = combineFixtureScore({
    checkPassed: structural.passed.length,
    checkTotal: fixture.checks.length || 1,
    plantPassed: plantedPassed.length,
    plantTotal: plantedPassed.length + plantedFailed.length,
    execute: shouldRun,
  });

  // Appending arbitrary text never proves the additional test passed.
  if (args.userTest?.trim()) {
    plantedFailed.push("Brought test is ungraded; an independent evaluator is required");
    score = fixture.planted.length ? Math.min(score, 79) : 0;
  }

  const platePassed = shouldRun && (plantedPassed.length + plantedFailed.length) > 0 ? plantedPassed : structural.passed;
  const plateFailed = shouldRun && (plantedPassed.length + plantedFailed.length) > 0 ? plantedFailed : structural.failed;
  const plantsOpen = shouldRun && plantedFailed.length > 0;
  const quoteHint = plantsOpen
    ? checkResults.filter(check => !check.passed).map(check => `${check.label}: ${check.detail}`).join(" ") || "Submit real findings with an exact relevant input line; missing evidence is not a format error."
    : shouldRun && !findings
      ? "Host must run the exam, then chorus_score with findings that quote exam.input."
      : undefined;

  return quarantine({
    integrityVersion: INTEGRITY_VERSION,
    graderVersion: GRADER_VERSION,
    checkResults,
    // Exact, public test identity for diagnostic comparisons; this is NOT a signature.
    testKey: JSON.stringify([INTEGRITY_VERSION, GRADER_VERSION, fixture.labId, level, fixture.task, fixture.input]),
    executionContext: "unverified-submission",
    labId: fixture.labId,
    fixture: fixture.title,
    submissionStatus: shouldRun && args.findings === undefined ? "not_run" as const : "scored" as const,
    score,
    passed: platePassed,
    failed: plateFailed,
    evidence,
    level,
    exhausted: level >= max && score >= 100 && plateFailed.length === 0,
    quoteHint,
  });
}
