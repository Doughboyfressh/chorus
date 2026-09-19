import { INTEGRITY_NOTE, quarantine } from "./integrity";
import { toast } from "sonner";
import { beginWork, cancelWork, isCancelled } from "./abort";
import { chatFromSlot, chatJson } from "./chat";
import {
  conductSwarm,
  critiqueSwarm,
  evaluateArtifact,
  improveSwarm,
  runSpecialist,
  synthesizeSwarm,
} from "./engine";
import { MAX_GENERATIONS, MIN_GOAL } from "./labs";
import { maxFixtureLevel } from "./fixtures";
import { gradeArtifact } from "./grade";
import { loadMcpSit, publicMcpUrl } from "./mcp-url";
import { pairsJsonl } from "./pairs";
import { recurseTarget, unique, formatArtifact, sittingArtifact, judgeFromFixture } from "./ledger";
import { resolveExecutor } from "./slot";
import { useChorus } from "./store";
import type { SpecialistBrief, SwarmRun } from "./types";

function isBusyPhase(phase: string | undefined) {
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

function assertLive() {
  if (isCancelled()) throw new Error("Cancelled.");
}

async function evalChat(args: Parameters<typeof chatFromSlot>[1]) {
  const state = useChorus.getState();
  const resolved = resolveExecutor(state.slot, state.executor, state.hostedAvailable);
  return chatFromSlot(resolved.slot, args);
}

function stampEval<T extends { score: number; failed: string[] }>(result: T): T & { contaminated: boolean; executor: string } {
  const state = useChorus.getState();
  const resolved = resolveExecutor(state.slot, state.executor, state.hostedAvailable);
  return quarantine({ ...result, executor: resolved.label,
    executionContext: JSON.stringify(["unverified-client", resolved.slot.kind, resolved.slot.baseUrl, resolved.slot.model, 0.1, 700]) });
}

async function runFanoutAndMerge(
  goal: string,
  contract: string,
  whyThisSplit: string,
  specialists: SpecialistBrief[],
) {
  assertLive();
  useChorus.getState().markSpecialistsRunning();
  const artifact = formatArtifact(sittingArtifact(useChorus.getState().run));
  const specialistRows = await Promise.all(
    specialists.map(async (brief) => {
      const result = await runSpecialist({ goal, contract, brief, artifact }, chatJson);
      if (!result.ok) {
        const row = {
          ...brief,
          headline: "",
          findings: [] as string[],
          risks: [] as string[],
          handoff: "",
          patch: "",
          error: result.error,
        };
        useChorus.getState().applySpecialist(row);
        return row;
      }
      useChorus.getState().applySpecialist(result);
      return result;
    }),
  );
  const alive = specialistRows.filter(
    (row) => !row.error && (row.findings.length > 0 || row.patch.trim().length > 0),
  );
  if (alive.length === 0) {
    throw new Error("Every specialist failed. Try the run again.");
  }
  assertLive();
  useChorus.getState().beginCritique();

  const run = useChorus.getState().run;
  const lastEval = run?.evaluation ?? run?.baseline;
  const critique = await critiqueSwarm(
    {
      goal,
      contract,
      specialists: specialistRows.map((agent) => ({
        name: agent.name,
        headline: agent.headline,
        findings: agent.findings,
        risks: agent.risks,
      })),
      fixtureFailed: lastEval?.failed,
      fixtureScore: lastEval?.score,
      artifact,
    },
    chatJson,
  );
  if (!critique.ok) throw new Error(critique.error);
  useChorus.getState().applyCritique(critique);

  const merged = await synthesizeSwarm(
    {
      goal,
      contract,
      whyThisSplit,
      specialists: specialistRows.map((agent) => ({
        name: agent.name,
        headline: agent.headline,
        findings: agent.findings,
        risks: agent.risks,
        handoff: agent.handoff,
        patch: agent.patch,
      })),
      critique,
      fixtureFailed: lastEval?.failed,
      fixtureScore: lastEval?.score,
      artifact,
    },
    chatJson,
  );
  if (!merged.ok) throw new Error(merged.error);
  useChorus.getState().applySynthesis(merged);
  await runEval();
  const after = useChorus.getState().run;
  const gen = after?.generation ?? 1;
  if (gen > 1) {
    await runJudge();
    return;
  }
  useChorus.getState().sealGeneration();
  toast.success("Generation 1 scored. If the fixture mutated, recurse on the new failures.");
}

async function runEval() {
  const run = useChorus.getState().run;
  if (!run?.synthesis) return;
  let scored = await scoreAtLevel(run, run.fixtureLevel ?? 0);
  if (!scored) return;
  let hops = 0;
  while (scored.score >= 100 && scored.failed.length === 0 && hops < 3) {
    const current = useChorus.getState().run;
    const nextLevel = (current?.fixtureLevel ?? scored.level) + 1;
    if (nextLevel > maxFixtureLevel(run.labId)) {
      useChorus.getState().applyEval({ ...scored, exhausted: true });
      toast.success("Public practice ladder completed. Independent validation is still required.");
      return;
    }
    toast.message("Fixture cleared. Mutating the test.");
    const mutated = await scoreAtLevel(run, nextLevel, true);
    if (!mutated) return;
    scored = mutated;
    hops += 1;
  }
  if (scored.score >= 100 && scored.failed.length === 0 && scored.level >= maxFixtureLevel(run.labId)) {
    useChorus.getState().applyEval({ ...scored, exhausted: true });
    toast.success("Public practice ladder completed. Independent validation is still required.");
    return;
  }
  toast.message(`Fixture v${scored.level + 1}: ${scored.score}/100.`);
}

async function scoreAtLevel(run: SwarmRun, level: number, mutated = false) {
  const result = await evaluateArtifact(
    {
      labId: run.labId,
      title: run.synthesis?.title ?? "",
      deliverable: run.synthesis?.deliverable ?? "",
      goal: run.goal,
      level,
      userTest: run.userTest,
    },
    evalChat,
  );
  if (!result.ok) {
    useChorus.getState().applyEval({
      labId: run.labId ?? "generic",
      fixture: "unscored",
      score: 0,
      passed: [],
      failed: ["Fixture scorer failed"],
      evidence: result.error,
      level,
    });
    toast.message("Merge stands. The fixture could not be scored.");
    return null;
  }
  const stamped = stampEval({ ...result, mutated, level });
  useChorus.getState().applyEval(stamped);
  return stamped;
}

async function runJudge() {
  const run = useChorus.getState().run;
  if (!run) return;
  const current = run.generations.find((g) => g.n === run.generation);
  const previous = run.generations.find((g) => g.n === run.generation - 1);
  if (!current || !previous) {
    useChorus.getState().skipJudge("No previous generation to audit.");
    toast.message("Merged, but the judge had nothing to score.");
    return;
  }
  useChorus.getState().beginJudge();
  const currEval = current.evaluation ?? run.evaluation;
  if (!currEval) {
    useChorus.getState().skipJudge("No fixture score to judge.");
    return;
  }
  const judged = judgeFromFixture(previous.evaluation ?? run.baseline, currEval);
  useChorus.getState().applyJudge(judged);
  const closed = judged.holes.filter((h) => h.status === "closed").length;
  if (judged.verdict === "improved") {
    toast.success(`Generation ${run.generation} closed ${closed} hole${closed === 1 ? "" : "s"}.`);
  } else if (judged.verdict === "worse") {
    toast.error("Worse. Recurse opened more holes than it closed.");
  } else {
    toast.message("Stalled. The fixture did not rise.");
  }
}

export { recurseTarget } from "./ledger";

export async function executeSwarm() {
  const state = useChorus.getState();
  if (state.lane === "mcp") {
    const pasted = state.pasted.trim();
    if (pasted.length >= 20) {
      const graded = gradeArtifact({
        labId: state.labId,
        title: "Pasted artifact",
        deliverable: pasted,
        userTest: state.userTest,
        level: 0,
      });
      useChorus.getState().openFixtureSitting({ ...graded, contaminated: true, executor: "MCP host" });
      toast.message(
        graded.failed.length
          ? `Gen 0: ${graded.score}/100 on the fixture. Connect the host to clear plants.`
          : `Gen 0: ${graded.score}/100 on the fixture.`,
      );
    }
    try {
      const sit = loadMcpSit();
      const response = await fetch(`/api/sitting?sit=${encodeURIComponent(sit)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conduct: true,
          labId: state.labId,
          goal: state.goal,
          pasted: state.pasted,
        }),
      });
      if (!response.ok) throw new Error("Sitting update was rejected. Check the current lab and reset explicitly if changing labs.");
      useChorus.getState().bumpMcpSit();
      await navigator.clipboard.writeText(publicMcpUrl());
      toast.message("Chorus is conducting. MCP host: chorus_next, then chorus_fill, until done.");
    } catch {
      toast.message(`Connect ${publicMcpUrl()} then chorus_next.`);
    }
    return;
  }
  const goal = state.goal.trim();
  if (goal.length < MIN_GOAL) {
    toast.error("Give the swarm a sharper problem.");
    return;
  }
  if (state.aiAvailable === false) {
    toast.error("AI is not available in this environment.");
    return;
  }
  if (state.run?.phase === "done") {
    toast.error("Recurse this sitting, or reset the lab first.");
    return;
  }
  if (isBusyPhase(state.run?.phase)) return;
  beginWork();
  useChorus.getState().begin(goal, state.labId);

  try {
    const conducted = await conductSwarm(goal, chatJson, {
      pasted: state.pasted,
      baseline: state.baseline
        ? { score: state.baseline.score, failed: state.baseline.failed }
        : undefined,
    });
    if (!conducted.ok) throw new Error(conducted.error);
    useChorus.getState().applyConductor(conducted);
    await runFanoutAndMerge(goal, conducted.contract, conducted.whyThisSplit, conducted.specialists);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The swarm stalled.";
    useChorus.getState().fail(message);
    if (message === "Cancelled.") toast.message("Cancelled.");
    else toast.error(message);
  }
}

export async function scoreBaseline() {
  const state = useChorus.getState();
  const pasted = state.pasted.trim();
  if (pasted.length < 20) {
    toast.error("Paste the artifact you already use.");
    return;
  }
  if (isBusyPhase(state.run?.phase)) return;

  if (state.lane === "mcp") {
    const graded = gradeArtifact({
      labId: state.labId,
      title: "Pasted artifact",
      deliverable: pasted,
      userTest: state.userTest,
      level: 0,
    });
    useChorus.getState().setBaseline({ ...graded, contaminated: true, executor: "MCP host" });
    useChorus.getState().openFixtureSitting({ ...graded, contaminated: true, executor: "MCP host" });
    toast.message(
      graded.failed.length
        ? `Gen 0: ${graded.score}/100. Run the exam in the MCP host to clear plants.`
        : `Gen 0: ${graded.score}/100 on the fixture.`,
    );
    return;
  }

  if (state.aiAvailable === false) {
    toast.error("No model is ready.");
    return;
  }
  beginWork();
  try {
    const result = await evaluateArtifact(
      {
        labId: state.labId,
        title: "Pasted artifact",
        deliverable: pasted,
        goal: state.goal.trim().length >= MIN_GOAL ? state.goal : `${pasted.slice(0, 80)} baseline`,
        level: 0,
        userTest: state.userTest,
      },
      evalChat,
    );
    if (!result.ok) throw new Error(result.error);
    useChorus.getState().setBaseline(stampEval(result));
    toast.message(`Gen 0: ${result.score}/100 on the fixture.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not score the paste.";
    toast.error(message === "Cancelled." ? "Cancelled." : message);
  }
}

export function cancelSwarm() {
  cancelWork();
}

export async function recurseSwarm() {
  const state = useChorus.getState();
  if (state.lane === "mcp") {
    try {
      const response = await fetch(`/api/sitting?sit=${encodeURIComponent(loadMcpSit())}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conduct: true,
          labId: state.labId,
          goal: state.goal,
          pasted: state.pasted,
        }),
      });
      if (!response.ok) throw new Error("Sitting update was rejected. Check the current lab and reset explicitly if changing labs.");
      useChorus.getState().bumpMcpSit();
      await navigator.clipboard.writeText(publicMcpUrl());
      toast.message("Recurse queued. Host: chorus_next until done.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sitting update failed; no successful update was confirmed.");
    }
    return;
  }
  const run = state.run;
  if (!run || run.phase !== "done" || !run.synthesis || !run.critique || !run.contract) {
    toast.error("Merge a generation before recursing.");
    return;
  }
  if (state.aiAvailable === false) {
    toast.error("AI is not available in this environment.");
    return;
  }
  if ((run.generation ?? 1) >= MAX_GENERATIONS) {
    toast.error("Eight generations is the cap. Export the pairs.");
    return;
  }
  if (isBusyPhase(run.phase)) return;

  if (run.evaluation?.exhausted) {
    toast.message("The fixture ladder is exhausted. The artifact survived.");
    return;
  }

  const target = recurseTarget(run);
  let attack = target.attack;
  if (attack.length === 0 && (run.evaluation?.score ?? 0) >= 100) {
    toast.message("The fixture is cleared. Recurse would be theater.");
    return;
  }
  if (attack.length === 0) {
    attack = unique(run.synthesis.watchouts);
  }
  if (attack.length === 0 && target.verdict === "improved") {
    toast.message("Every named hole closed. The loop has nothing to rewrite.");
    return;
  }
  if (attack.length === 0) {
    toast.error("No open holes to recurse on.");
    return;
  }
  beginWork();

  const goal = run.goal;
  useChorus.getState().beginImprove();

  try {
    const improved = await improveSwarm(
      {
        goal,
        contract: run.contract,
        whyThisSplit: run.whyThisSplit ?? "",
        generation: run.generation ?? 1,
        critique: run.critique,
        synthesis: {
          title: run.synthesis.title,
          watchouts: run.synthesis.watchouts,
          deliverable: run.synthesis.deliverable,
        },
        specialists: run.agents
          .filter((a) => a.role === "specialist")
          .map((a) => ({
            name: a.name,
            mandate: a.mandate,
            headline: a.headline ?? "",
          })),
        ledger: {
          attack,
          frozen: target.frozen,
          verdict: target.verdict,
          previousNames: target.previousNames,
        },
      },
      chatJson,
    );
    if (!improved.ok) throw new Error(improved.error);
    useChorus.getState().applyImprover(improved);
    await runFanoutAndMerge(goal, improved.contract, improved.whyThisSplit, improved.specialists);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The swarm stalled.";
    useChorus.getState().fail(message);
    if (message === "Cancelled.") toast.message("Cancelled.");
    else toast.error(message);
  }
}

export function playbookMarkdown() {
  const { run, viewingN } = useChorus.getState();
  if (!run) return "";
  const snap = run.generations.find((g) => g.n === viewingN) ?? run.generations.at(-1);
  const synth = snap?.synthesis ?? run.synthesis;
  const target = recurseTarget(run);
  const lines = [
    `# ${synth?.title ?? "Chorus run"}`,
    "",
    `Goal: ${run.goal}`,
    `Generation: ${snap?.n ?? run.generation ?? 1}`,
    `Model: ${run.slotSnapshot?.model ?? "unspecified"}`,
    run.baseline ? `Gen 0 fixture: ${run.baseline.score}/100` : "",
    "",
    "## Contract",
    snap?.contract ?? run.contract ?? "",
    "",
    "## Specialists",
    ...(snap?.specialists ?? []).map((s) => `### ${s.name}\n${s.mandate}`),
    "",
    "## Critic",
    snap?.critique?.verdict ?? run.critique?.verdict ?? "",
    "",
    "## Deliverable",
    synth?.deliverable ?? "",
    "",
    "## Next steps",
    ...(synth?.steps ?? []).map((s) => `- ${s}`),
    "",
    "## The pattern",
    synth
      ? [
          `- Contract: ${synth.pattern.contract}`,
          `- Fan-out: ${synth.pattern.fanout}`,
          `- Critique: ${synth.pattern.critique}`,
          `- Merge: ${synth.pattern.merge}`,
        ].join("\n")
      : "",
    "",
    snap?.delta
      ? [
          "## Recursive delta",
          `- Why it plateaued: ${snap.delta.reason}`,
          `- Better because: ${snap.delta.betterBecause}`,
          ...(snap.delta.targets ?? []).map((t) => `- Attack: ${t}`),
          ...snap.delta.changed.map((c) => `- ${c}`),
        ].join("\n")
      : "",
    "",
    snap?.judge
      ? [
          "## Judge",
          `Unverified model opinion (not a validated verdict): ${snap.judge.verdict}`,
          snap.judge.score,
          ...snap.judge.holes.map((h) => `- [${h.status}] ${h.hole} — ${h.note}`),
        ].join("\n")
      : "",
    "",
    snap?.evaluation
      ? [
          "## Fixture",
          `${snap.evaluation.fixture}: ${snap.evaluation.score}/100 (v${(snap.evaluation.level ?? 0) + 1}${snap.evaluation.mutated ? ", mutated" : ""})`,
          ...snap.evaluation.passed.map((p) => `- pass: ${p}`),
          ...snap.evaluation.failed.map((p) => `- fail: ${p}`),
        ].join("\n")
      : "",
    "",
    "## Next contract",
    target.attack.length
      ? target.attack.map((h) => `- OPEN: ${h}`).join("\n")
      : "- No open holes",
    target.frozen.length ? target.frozen.map((h) => `- FROZEN: ${h}`).join("\n") : "",
    "",
    "## Unverified diagnostic candidates — not training data",
    pairsJsonl(run) || "(none — the score never rose)",
  ];
  return lines.join("\n");
}

export function downloadPairs() {
  const run = useChorus.getState().run;
  if (!run) return;
  const body = pairsJsonl(run);
  if (!body) { toast.message("No comparable diagnostic candidates to review."); return; }
  const blob = new Blob([body + "\n"], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chorus-UNVERIFIED-review-${run.id.slice(0, 8)}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
  toast.message("Downloaded unverified review candidates. Do not use them as clean training data.");
}

export function downloadTraining() {
  toast.error("Training export is locked. " + INTEGRITY_NOTE);
}
