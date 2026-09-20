import { FindingsValidationError, FINDINGS_INSTRUCTIONS } from "./findings.ts";
import { completeObject } from "./artifact-text.ts";
import { boundedText, MAX_ARTIFACT, MAX_USER_TEST } from "./integrity.ts";
import type { ChatFn } from "./completions";
import { examFor, gradeArtifact } from "./grade.ts";
import { asString, asStringList, extractJson } from "./parse.ts";
import type {
  AiResult,
  ConductResult,
  CritiqueResult,
  EvalResult,
  FindingBlock,
  HoleLedgerItem,
  HoleStatus,
  ImproveResult,
  JudgeResult,
  JudgeVerdict,
  SpecialistBrief,
  SynthesisResult,
} from "./types.ts";

function clampGoal(goal: string) {
  const trimmed = goal.trim();
  if (trimmed.length < 12) throw new Error("Goal is too short");
  if (trimmed.length > 800) throw new Error("Goal is too long");
  return trimmed;
}

export async function conductSwarm(
  goal: string,
  chat: ChatFn,
  extra?: { pasted?: string; baseline?: { score: number; failed: string[] } },
): Promise<AiResult<ConductResult>> {
  const dataGoal = clampGoal(goal);
  const baselineBlock =
    extra?.pasted?.trim() && extra.baseline
      ? `\nThe user already has this artifact (fixture ${extra.baseline.score}/100, failing: ${extra.baseline.failed.join("; ") || "none"}). Improve THIS. Do not start from a blank page.\n---\n${boundedText(extra.pasted, "artifact", MAX_ARTIFACT, 1)}\n---`
      : extra?.pasted?.trim()
        ? `\nThe user already has this artifact. Improve THIS.\n---\n${boundedText(extra.pasted, "artifact", MAX_ARTIFACT, 1)}\n---`
        : "";
  const result = await chat({
    temperature: 0.4,
    maxTokens: 900,
    user: `You are the Conductor. Write a tight contract, then staff 3 specialists with zero overlapping mandates.

Goal:
${dataGoal}
${baselineBlock}

Return JSON:
{
  "contract": "what done looks like, constraints, and what not to do (1 short paragraph)",
  "whyThisSplit": "one sentence on why these specialists do not overlap",
  "specialists": [
    { "id": "s1", "name": "Two Word Role", "mandate": "one sentence unique job", "lens": "what they uniquely notice" }
  ]
}

Rules: exactly 3 specialists. Names are role-like (Eval Designer, Adversary, Historian), not cute.`,
  });
  if (!result.ok) return result;
  try {
    const parsed = extractJson<{
      contract?: unknown;
      whyThisSplit?: unknown;
      specialists?: unknown;
    }>(result.text);
    const specialistsRaw = Array.isArray(parsed.specialists) ? parsed.specialists : [];
    const specialists: SpecialistBrief[] = specialistsRaw.slice(0, 3).map((item, i) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        id: asString(row.id, `s${i + 1}`),
        name: asString(row.name, `Specialist ${i + 1}`),
        mandate: asString(row.mandate, "Contribute a distinct angle."),
        lens: asString(row.lens, "A unique failure mode."),
      };
    });
    while (specialists.length < 3) {
      const i = specialists.length;
      specialists.push({
        id: `s${i + 1}`,
        name: `Specialist ${i + 1}`,
        mandate: "Cover a remaining gap in the contract.",
        lens: "What the others missed.",
      });
    }
    return {
      ok: true,
      contract: asString(parsed.contract, "Deliver a concrete, testable answer to the goal."),
      whyThisSplit: asString(parsed.whyThisSplit, "Each specialist owns a non-overlapping surface."),
      specialists,
    };
  } catch (err) {
    const hint = err instanceof Error ? err.message : "unreadable JSON";
    return { ok: false, error: `Conductor ${hint}` };
  }
}

export async function runSpecialist(
  data: { goal: string; contract: string; brief: SpecialistBrief; artifact?: string },
  chat: ChatFn,
): Promise<AiResult<SpecialistBrief & FindingBlock & { error?: string }>> {
  const brief = data.brief;
  if (!brief?.id) return { ok: false, error: "Missing specialist brief" };
  const artifact = data.artifact?.trim()
    ? `\n${data.artifact.trim()}\n\nPropose concrete patches to that artifact. Quote the line you change. Do not start a new essay.\n`
    : "\nNo prior artifact. Write the first draft from the goal and contract.\n";
  const result = await chat({
    temperature: 0.65,
    maxTokens: 1400,
    user: `You are ${brief.name}.
Mandate: ${brief.mandate}
Lens: ${brief.lens}

Contract:
${data.contract}

Goal:
${clampGoal(data.goal)}
${artifact}
Do the work from your lens only. Do not recap the swarm.
Findings stay short. The patch is the work: rewritten lines of the artifact, not a comment about it.

Return JSON:
{
  "headline": "one-line result",
  "findings": ["3 concrete findings, under 140 characters each"],
  "risks": ["1 to 3 risks"],
  "handoff": "what the synthesizer must not lose",
  "patch": "the rewritten excerpt or full artifact from your lens"
}`,
  });
  if (!result.ok) {
    return { ok: true, ...brief, headline: "", findings: [], risks: [], handoff: "", patch: "", error: result.error };
  }
  try {
    const parsed = extractJson<Record<string, unknown>>(result.text);
    return {
      ok: true,
      ...brief,
      headline: asString(parsed.headline, brief.mandate),
      findings: asStringList(parsed.findings).slice(0, 5),
      risks: asStringList(parsed.risks).slice(0, 3),
      handoff: asString(parsed.handoff),
      patch: asString(parsed.patch),
    };
  } catch {
    return {
      ok: true,
      ...brief,
      headline: asString(result.text.slice(0, 180), brief.mandate),
      findings: [result.text.slice(0, 800)],
      risks: [],
      handoff: "",
      patch: "",
    };
  }
}

export async function critiqueSwarm(
  data: {
    goal: string;
    contract: string;
    specialists: { name: string; headline: string; findings: string[]; risks: string[] }[];
    fixtureFailed?: string[];
    fixtureScore?: number;
    artifact?: string;
  },
  chat: ChatFn,
): Promise<AiResult<CritiqueResult>> {
  const dossier = data.specialists
    .map(
      (s, i) =>
        `#${i + 1} ${s.name}\nHeadline: ${s.headline}\nFindings:\n- ${s.findings.join("\n- ")}\nRisks:\n- ${s.risks.join("\n- ")}`,
    )
    .join("\n\n");
  const result = await chat({
    temperature: 0.3,
    maxTokens: 700,
    user: `You are the Critic. Find holes, overlap, and confident-wrong claims. Kill weak work.
The public fixture supplies development feedback, not independent ground truth. Investigate its failures as candidate holes.

Contract:
${data.contract}

Goal:
${clampGoal(data.goal)}

${typeof data.fixtureScore === "number" ? `Fixture score: ${data.fixtureScore}/100. Still failing: ${data.fixtureFailed?.join("; ") || "none"}` : "No fixture score yet. Guess less."}
${data.artifact?.trim() ? `\nThe artifact they were supposed to patch:\n${data.artifact.trim()}\nKill work that ignores it.\n` : ""}

Dossier:
${dossier}

Return JSON:
{
  "verdict": "2 sentences: what is strong, what is missing",
  "holes": ["gaps a merge would paper over"],
  "keep": ["findings that must survive"],
  "kill": ["claims or ideas to drop"]
}`,
  });
  if (!result.ok) return result;
  try {
    const parsed = extractJson<Record<string, unknown>>(result.text);
    return {
      ok: true,
      verdict: asString(parsed.verdict, "The dossier is uneven; merge with caution."),
      holes: asStringList(parsed.holes).slice(0, 4),
      keep: asStringList(parsed.keep).slice(0, 5),
      kill: asStringList(parsed.kill).slice(0, 4),
    };
  } catch {
    return { ok: false, error: "Critic returned unreadable JSON" };
  }
}

export async function synthesizeSwarm(
  data: {
    goal: string;
    contract: string;
    whyThisSplit: string;
    specialists: { name: string; headline: string; findings: string[]; risks: string[]; handoff: string; patch?: string }[];
    critique: CritiqueResult;
    fixtureFailed?: string[];
    fixtureScore?: number;
    artifact?: string;
  },
  chat: ChatFn,
): Promise<AiResult<SynthesisResult>> {
  const dossier = data.specialists
    .map(
      (s) =>
        `${s.name}: ${s.headline}\nFindings: ${s.findings.join("; ")}\nRisks: ${s.risks.join("; ")}\nHandoff: ${s.handoff}\nPatch:\n${s.patch ?? ""}`,
    )
    .join("\n\n");
  const result = await chat({
    temperature: 0.35,
    maxTokens: 1200,
    user: `You are the Synthesizer. Merge surviving work into one usable deliverable for the user. Honor the critic. Do not mention agents by process unless needed.

Goal:
${clampGoal(data.goal)}

Contract:
${data.contract}

Why the split:
${data.whyThisSplit}

Specialists:
${dossier}

Critic verdict: ${data.critique.verdict}
Keep: ${data.critique.keep.join("; ")}
Kill: ${data.critique.kill.join("; ")}
Holes: ${data.critique.holes.join("; ")}
${typeof data.fixtureScore === "number" ? `Fixture ${data.fixtureScore}/100. The merge must close: ${data.fixtureFailed?.join("; ") || "none"}.` : ""}
${data.artifact?.trim() ? `\nRewrite THIS artifact. Do not start a new essay.\n${data.artifact.trim()}\n` : ""}

Also teach the pattern in four short sentences (contract, fan-out, critique, merge) using THIS run as the example.

Return JSON:
{
  "title": "short title for the deliverable",
  "deliverable": "the actual answer, 3-6 short paragraphs, markdown-ish plain text with line breaks",
  "steps": ["3 to 6 concrete next actions"],
  "watchouts": ["2 to 4 things that still could go wrong"],
  "pattern": {
    "contract": "one sentence",
    "fanout": "one sentence",
    "critique": "one sentence",
    "merge": "one sentence"
  }
}`,
  });
  if (!result.ok) return result;
  try {
    const parsed = completeObject(result.text);
    const pattern = (parsed.pattern ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      title: asString(parsed.title, "Swarm deliverable"),
      deliverable: boundedText(parsed.deliverable, "artifact", MAX_ARTIFACT, 8),
      steps: asStringList(parsed.steps).slice(0, 6),
      watchouts: asStringList(parsed.watchouts).slice(0, 4),
      pattern: {
        contract: asString(pattern.contract, data.contract),
        fanout: asString(pattern.fanout, data.whyThisSplit),
        critique: asString(pattern.critique, data.critique.verdict),
        merge: asString(pattern.merge, "One owner writes the final artifact."),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Synthesizer did not return a complete artifact." };
  }
}

export async function improveSwarm(
  data: {
    goal: string;
    contract: string;
    whyThisSplit: string;
    generation: number;
    critique: CritiqueResult;
    synthesis: { title: string; watchouts: string[]; deliverable: string };
    specialists: { name: string; mandate: string; headline: string }[];
    ledger?: { attack: string[]; frozen: string[]; verdict: string; previousNames: string[] };
  },
  chat: ChatFn,
): Promise<AiResult<ImproveResult>> {
  const attack = (data.ledger?.attack ?? []).length
    ? (data.ledger?.attack ?? []).slice(0, 6)
    : data.critique.holes.slice(0, 4);
  const frozen = (data.ledger?.frozen ?? []).slice(0, 6);
  const stalled = data.ledger?.verdict === "stalled" || data.ledger?.verdict === "worse";
  const result = await chat({
    temperature: 0.4,
    maxTokens: 900,
    user: `You are the Improver. Open holes are the next contract. Closed work is frozen. Do not write a new essay about the goal — rewrite the swarm so generation ${data.generation + 1} closes the attack list.

Goal:
${clampGoal(data.goal)}

Current contract:
${data.contract}

Current staff:
${data.specialists.map((s) => `${s.name} — ${s.mandate}`).join("\n")}

Judge / critic:
Verdict: ${data.ledger?.verdict ?? "none"}
ATTACK (must close):
- ${attack.join("\n- ") || "none named"}
FROZEN (must remain true, do not reopen):
- ${frozen.join("\n- ") || "none"}

${stalled ? "The last generation stalled. ZERO specialist names may match the previous staff. Do not rename the same jobs." : "At least two specialist names must be new."}

Return JSON:
{
  "contract": "1 short paragraph that names the attack holes and forbids reopening frozen work",
  "whyThisSplit": "one sentence: which specialist owns which attack hole",
  "specialists": [
    { "id": "s1", "name": "Two Word Role", "mandate": "Close: <attack hole>. How.", "lens": "how they will know it closed" }
  ],
  "delta": {
    "changed": ["2 to 4 topology changes"],
    "reason": "which open hole caused the rewrite",
    "betterBecause": "the test that proves an attack hole closed",
    "targets": ["the attack holes assigned to this generation"]
  }
}

Rules: exactly 3 specialists. Each mandate maps to one attack hole. Compact JSON. Strings under 160 characters.`,
  });
  if (!result.ok) return result;
  try {
    const parsed = extractJson<{
      contract?: unknown;
      whyThisSplit?: unknown;
      specialists?: unknown;
      delta?: Record<string, unknown>;
    }>(result.text);
    const specialistsRaw = Array.isArray(parsed.specialists) ? parsed.specialists : [];
    const fallbackNames = ["Hole Binder", "Kill Author", "Drift Warden"];
    const previous = new Set((data.ledger?.previousNames ?? []).map((n) => n.toLowerCase()));
    const specialists: SpecialistBrief[] = specialistsRaw.slice(0, 3).map((item, i) => {
      const row = (item ?? {}) as Record<string, unknown>;
      let name = asString(row.name, fallbackNames[i] ?? `Closer ${i + 1}`);
      if (stalled && previous.has(name.toLowerCase())) name = fallbackNames[i] ?? `Closer ${i + 1}`;
      const hole = attack[i] ?? attack[0] ?? "the remaining open hole";
      return {
        id: asString(row.id, `s${i + 1}`),
        name,
        mandate: asString(row.mandate, `Close: ${hole}`),
        lens: asString(row.lens, "A test that the hole is actually gone."),
      };
    });
    while (specialists.length < 3) {
      const i = specialists.length;
      const hole = attack[i] ?? attack[0] ?? "the remaining open hole";
      specialists.push({
        id: `s${i + 1}`,
        name: fallbackNames[i] ?? `Closer ${i + 1}`,
        mandate: `Close: ${hole}`,
        lens: "What the last generation left open.",
      });
    }
    const delta = parsed.delta ?? {};
    return {
      ok: true,
      contract: asString(parsed.contract, `Close these holes and do not reopen frozen work: ${attack.join("; ")}`),
      whyThisSplit: asString(
        parsed.whyThisSplit,
        "Each specialist owns one attack hole and none of the frozen claims.",
      ),
      specialists,
      delta: {
        changed: asStringList(delta.changed).slice(0, 4),
        reason: asString(delta.reason, attack[0] ?? "Open holes remain."),
        betterBecause: asString(
          delta.betterBecause,
          "The next judge should mark at least one attack hole closed.",
        ),
        targets: asStringList(delta.targets).slice(0, 6).length
          ? asStringList(delta.targets).slice(0, 6)
          : attack.slice(0, 6),
      },
    };
  } catch {
    return { ok: false, error: "Improver returned unreadable JSON" };
  }
}

function asVerdict(value: unknown): JudgeVerdict {
  const text = asString(value).toLowerCase();
  if (text === "worse") return "worse";
  if (text === "improved") return "improved";
  return "stalled";
}

function asHoleStatus(value: unknown): HoleStatus {
  const text = asString(value).toLowerCase();
  if (text === "closed") return "closed";
  if (text === "new") return "new";
  return "open";
}

export async function judgeSwarm(
  data: {
    goal: string;
    previous: {
      n: number;
      holes: string[];
      title: string;
      watchouts: string[];
      staff: string[];
      fixtureScore?: number;
    };
    current: {
      n: number;
      holes: string[];
      title: string;
      watchouts: string[];
      deliverable: string;
      staff: string[];
      fixtureScore?: number;
      fixtureFailed?: string[];
    };
  },
  chat: ChatFn,
): Promise<AiResult<JudgeResult>> {
  const result = await chat({
    temperature: 0.15,
    maxTokens: 550,
    timeoutMs: 70_000,
    user: `You are the Judge. Recursive self-improvement is only real if the fixture score rises and named holes close. Do not be polite. A prettier essay with the same score is stalled.

Goal:
${clampGoal(data.goal)}

PUBLIC PRACTICE SCORES (unverified; not private holdout evidence):
Generation ${data.previous.n}: ${Number.isFinite(data.previous.fixtureScore) ? data.previous.fixtureScore : "n/a"} / 100
Generation ${data.current.n}: ${Number.isFinite(data.current.fixtureScore) ? data.current.fixtureScore : "n/a"} / 100
Still failing: ${(data.current.fixtureFailed ?? []).join("; ") || "none listed"}

Generation ${data.previous.n}
Staff: ${data.previous.staff.join(", ") || "unknown"}
Title: ${data.previous.title}
Holes:
- ${data.previous.holes.join("\n- ") || "none named"}

Generation ${data.current.n}
Staff: ${data.current.staff.join(", ") || "unknown"}
Title: ${data.current.title}
Holes:
- ${data.current.holes.join("\n- ") || "none named"}
Deliverable:
${data.current.deliverable}

Rules:
- If the fixture score did not rise, verdict cannot be improved.
- If the fixture score fell, verdict is worse.
- For EACH previous hole, status is closed or open. Closed requires a mechanism, not a slogan.
- Add status new for current holes that are not restatements.
- Compact JSON. Notes under 140 characters.

Return JSON:
{
  "verdict": "improved" | "stalled" | "worse",
  "score": "one sentence: score delta and what still fails the fixture",
  "holes": [
    { "hole": "hole text", "status": "closed" | "open" | "new", "note": "why" }
  ]
}`,
  });
  if (!result.ok) return result;
  try {
    const parsed = extractJson<Record<string, unknown>>(result.text);
    const rawHoles = Array.isArray(parsed.holes) ? parsed.holes : [];
    const holes: HoleLedgerItem[] = rawHoles.slice(0, 8).map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        hole: asString(row.hole, "Unnamed hole"),
        status: asHoleStatus(row.status),
        note: asString(row.note),
      };
    });
    let verdict = asVerdict(parsed.verdict);
    const closed = holes.filter((h) => h.status === "closed").length;
    const created = holes.filter((h) => h.status === "new").length;
    if (closed === 0 && holes.some((h) => h.status === "open")) verdict = "stalled";
    if (created > closed && closed > 0) verdict = "worse";
    const prevScore = data.previous.fixtureScore;
    const nextScore = data.current.fixtureScore;
    if (Number.isFinite(prevScore) && Number.isFinite(nextScore)) {
      if ((nextScore as number) < (prevScore as number)) verdict = "worse";
      else if (nextScore === prevScore && verdict === "improved") verdict = "stalled";
    }
    return {
      ok: true,
      verdict: "stalled",
      score: "Unverified model opinion, not independent evidence: " + asString(parsed.score, "No verified comparison."),
      holes,
    };
  } catch {
    return { ok: false, error: "Judge returned unreadable JSON" };
  }
}

export async function evaluateArtifact(
  data: {
    labId?: string;
    title: string;
    deliverable: string;
    goal: string;
    level?: number;
    userTest?: string;
  },
  chat: ChatFn,
): Promise<AiResult<EvalResult>> {
  boundedText(data.deliverable, "artifact", MAX_ARTIFACT, 1);
  boundedText(data.title, "title", 2000);
  boundedText(data.userTest ?? "", "userTest", MAX_USER_TEST);
  const level = data.level ?? 0;
  const exam = examFor(data.labId, level, data.userTest);
  let findings: string | undefined;
  if (exam.execute) {
    const executed = await chat({
      temperature: 0.1,
      maxTokens: 700,
      timeoutMs: 45_000,
      system: `${data.title}\n${data.deliverable}` +
        `\n\n${FINDINGS_INSTRUCTIONS}`,
      user: `${exam.task}\n\nEach finding must quote an exact line from the source. Do not paraphrase the line.\n\n${exam.input}`,
    });
    findings = executed.ok ? executed.text : undefined;
    if (!executed.ok) return { ok: false, error: `Practice execution failed: ${executed.error}. No score was recorded.` };
  }
  try {
  return {
    ok: true,
    ...gradeArtifact({
      labId: data.labId,
      title: data.title,
      deliverable: data.deliverable,
      findings,
      userTest: data.userTest,
      level,
    }),
  };
  } catch (err) {
    if (err instanceof FindingsValidationError) return { ok: false, error: err.message };
    throw err;
  }
}
