import { completeObject, MAX_SEAT_TEXT } from "./artifact-text.ts";
import { MAX_ARTIFACT } from "./integrity.ts";

export const CONDUCTOR_SCHEMA = {
  type: "object", required: ["contract", "specialists"],
  properties: {
    contract: { type: "string", minLength: 1, maxLength: MAX_ARTIFACT },
    whyThisSplit: { type: "string", maxLength: 400 },
    specialists: { type: "array", minItems: 3, maxItems: 3, items: {
      type: "object", required: ["name", "mandate"],
      properties: { id: { type: "string", enum: ["s1", "s2", "s3"] },
        name: { type: "string", minLength: 1, maxLength: 80 },
        mandate: { type: "string", minLength: 1, maxLength: 400 },
        lens: { type: "string", maxLength: 200 } }, additionalProperties: false,
    } },
    delta: { type: "object", additionalProperties: false, properties: {
      changed: { type: "array", maxItems: 4, items: { type: "string", maxLength: 2000 } },
      targets: { type: "array", maxItems: 6, items: { type: "string", maxLength: 2000 } },
      reason: { type: "string", maxLength: 2000 }, betterBecause: { type: "string", maxLength: 2000 },
    } },
  }, additionalProperties: false,
} as const;

export class ConductorValidationError extends Error {
  readonly code = "INVALID_CONDUCTOR";
  readonly field: string;
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}. Return complete JSON with a text contract and exactly three named specialist mandates. No field was coerced or truncated.`);
    this.name = "ConductorValidationError";
    this.field = field;
  }
  toResult() {
    return { error: this.message, code: this.code, field: this.field,
      submissionStatus: "invalid", seatAdvanced: false, scoreRecorded: false, attemptConsumed: false,
      expectedSchema: CONDUCTOR_SCHEMA,
      retry: "For a rejected new fill, correct the real output and retry the same pending seat; no reset is needed. Existing historical fills are not rewritten. Start a separate child sitting if a legacy invalid fill already has downstream work." };
  }
}
function fieldText(value: unknown, field: string, max: number, optional = false): string {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) {
    throw new ConductorValidationError(field, `expected ${optional ? "0" : "1"}–${max} characters of text, not an object, array, or other type`);
  }
  return value; // Preserve the exact text, not an inferred default or a clipped prefix.
}
function onlyKeys(value: Record<string, unknown>, allowed: string[], field: string) {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new ConductorValidationError(`${field}.${unexpected}`, "unexpected field");
}

/** Shared by MCP and browser conductor/improver submissions. Validate BEFORE any state change. */
export function readConductor(text: string) {
  fieldText(text, "completion", MAX_SEAT_TEXT);
  let value: Record<string, unknown>;
  try { value = completeObject(text); }
  catch { throw new ConductorValidationError("completion", "invalid or incomplete JSON object"); }
  onlyKeys(value, ["contract", "whyThisSplit", "specialists", "delta"], "conductor");
  const contract = fieldText(value.contract, "contract", MAX_ARTIFACT);
  if (contract.trim() === "[object Object]") throw new ConductorValidationError("contract", "an object-coercion placeholder is not a contract");
  const whyThisSplit = fieldText(value.whyThisSplit, "whyThisSplit", 400, true);
  if (!Array.isArray(value.specialists) || value.specialists.length !== 3) {
    throw new ConductorValidationError("specialists", "expected exactly three specialists; none will be invented or dropped");
  }
  const specialists = value.specialists.map((item: unknown, index: number) => {
    const field = `specialists[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ConductorValidationError(field, "expected a specialist object");
    const row = item as Record<string, unknown>;
    onlyKeys(row, ["id", "name", "mandate", "lens"], field);
    const id = `s${index + 1}`;
    if (row.id !== undefined && row.id !== id) throw new ConductorValidationError(`${field}.id`, `expected ${id} in this position`);
    const name = fieldText(row.name, `${field}.name`, 80);
    if (/^judge$/i.test(name.trim())) throw new ConductorValidationError(`${field}.name`, "Judge is a separate seat, not a specialist");
    return { id, name, mandate: fieldText(row.mandate, `${field}.mandate`, 400), lens: fieldText(row.lens, `${field}.lens`, 200, true) };
  });
  if (new Set(specialists.map(row => row.name.trim().toLowerCase())).size !== 3) throw new ConductorValidationError("specialists", "specialist names must be distinct");
  let delta: { changed: string[]; targets: string[]; reason: string; betterBecause: string } | undefined;
  if (value.delta !== undefined) {
    if (!value.delta || typeof value.delta !== "object" || Array.isArray(value.delta)) throw new ConductorValidationError("delta", "expected an object");
    const d = value.delta as Record<string, unknown>;
    onlyKeys(d, ["changed", "targets", "reason", "betterBecause"], "delta");
    const list = (key: string, max: number) => {
      if (d[key] === undefined) return [];
      if (!Array.isArray(d[key]) || d[key].length > max) throw new ConductorValidationError(`delta.${key}`, `expected at most ${max} text entries`);
      return d[key].map((item: unknown, i: number) => fieldText(item, `delta.${key}[${i}]`, 2000));
    };
    delta = { changed: list("changed", 4), targets: list("targets", 6), reason: fieldText(d.reason, "delta.reason", 2000, true), betterBecause: fieldText(d.betterBecause, "delta.betterBecause", 2000, true) };
  }
  return { contract, whyThisSplit, specialists, delta };
}
