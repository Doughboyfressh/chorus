import { MAX_FINDINGS } from "./integrity.ts";

export type Finding = { issue: string; quote: string };
export const FINDINGS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["findings"],
  properties: { findings: { type: "array", maxItems: 64, items: {
    type: "object", additionalProperties: false, required: ["issue", "quote"],
    properties: {
      issue: { type: "string", minLength: 1, maxLength: 1200 },
      quote: { type: "string", minLength: 1, maxLength: 2000, pattern: "^[^\\r\\n]+$" },
    },
  } } },
} as const;
export const FINDINGS_INSTRUCTIONS =
  'Submit complete JSON only: {"findings":[{"issue":"the actual finding","quote":"one exact input line"}]}. ' +
  'An empty findings array is a valid no-findings result. String rows, prose, extra fields, and missing quotes are format errors, not zero scores. ' +
  'Native reviewer schemas (severity, source, sink, verify) are not this transport schema. Do not invent findings or evidence to adapt a response.';

export class FindingsValidationError extends Error {
  readonly code = "INVALID_FINDINGS";
  readonly field: string;
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}. ${FINDINGS_INSTRUCTIONS}`);
    this.name = "FindingsValidationError";
    this.field = field;
  }
  toResult() {
    return { error: this.message, code: this.code, field: this.field,
      submissionStatus: "invalid", scoreRecorded: false, attemptConsumed: false,
      expectedSchema: FINDINGS_SCHEMA,
      retry: "Correct only the submission format using the real output. Keep the exact artifact, test and unused attemptId; request a new attempt only if expired. No reset is needed." };
  }
}

/** Validate before consuming an exam, assigning a score or changing the ledger. Never salvage fragments. */
export function validateFindings(text: unknown): Finding[] {
  if (typeof text !== "string" || !text.trim()) throw new FindingsValidationError("findings", "a JSON string is required");
  if (text.length > MAX_FINDINGS) throw new FindingsValidationError("findings", `maximum ${MAX_FINDINGS} characters exceeded`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new FindingsValidationError("findings", "invalid or incomplete JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new FindingsValidationError("findings", "expected an object containing a findings array");
  const object = parsed as Record<string, unknown>;
  if (Object.keys(object).some(key => key !== "findings")) throw new FindingsValidationError("findings", "unexpected top-level fields");
  if (!Array.isArray(object.findings) || object.findings.length > 64) throw new FindingsValidationError("findings", "expected an array of at most 64 findings");
  return object.findings.map((row: unknown, index: number): Finding => {
    const field = `findings[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new FindingsValidationError(field, "expected an issue/quote object, not a string");
    const rec = row as Record<string, unknown>;
    if (Object.keys(rec).some(key => key !== "issue" && key !== "quote")) throw new FindingsValidationError(field, "unexpected fields; each row must contain only issue and quote");
    if (typeof rec.issue !== "string" || !rec.issue.trim() || rec.issue.trim().length > 1200) throw new FindingsValidationError(`${field}.issue`, "expected 1–1200 nonblank characters");
    if (typeof rec.quote !== "string" || !rec.quote.trim() || rec.quote.trim().length > 2000 || /[\r\n]/.test(rec.quote.trim())) throw new FindingsValidationError(`${field}.quote`, "expected one exact source line, not a whole input or a missing quote");
    return { issue: rec.issue.trim(), quote: rec.quote.trim() };
  });
}
