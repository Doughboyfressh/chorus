import type { SwarmRun, SynthesisResult } from "./types.ts";

/** An old artifact's assessment never becomes the new artifact's assessment. */
export function unscoredSynthesis(run: SwarmRun, synthesis: SynthesisResult): SwarmRun {
  return { ...run, synthesis, evaluation: undefined, judge: undefined,
    evaluationError: undefined, evaluationErrorLevel: undefined };
}
