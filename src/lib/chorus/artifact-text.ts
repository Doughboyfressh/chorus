import { boundedText, MAX_ARTIFACT, MAX_FINDINGS } from "./integrity.ts";

// JSON escaping can make a complete 24k artifact much larger than its text.
export const MAX_SEAT_TEXT = 160_000;
export function completeObject(text: string): Record<string, unknown> {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1] : text); }
  catch { throw new Error("Incomplete or invalid artifact JSON. Resubmit the complete output; nothing was truncated or repaired."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Artifact response must be a JSON object.");
  return value as Record<string, unknown>;
}
export function readMerge(text: string) {
  boundedText(text, "synthesizer completion", MAX_SEAT_TEXT, 8);
  // Retain compatibility with a plain-text artifact, but never salvage broken structured output.
  if (!/^(?:[\[{]|```)/.test(text.trim())) return { title: "Merge", deliverable: boundedText(text, "artifact", MAX_ARTIFACT, 8) };
  const value = completeObject(text);
  return { title: boundedText(value.title ?? "Merge", "title", 2000, 1),
    deliverable: boundedText(value.deliverable, "artifact", MAX_ARTIFACT, 8) };
}
export function fullSeatText(seat: string, text: string) {
  return boundedText(text, `${seat} completion`, seat === "exam" ? MAX_FINDINGS : MAX_SEAT_TEXT, 8);
}
