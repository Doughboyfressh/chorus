/** Public practice results are never attestations of execution or generalization. */
export const INTEGRITY_VERSION = 2;
export const INTEGRITY_NOTE =
  "Unverified practice result. Public fixtures and caller-selected executors cannot certify improvement or clean training data.";
export const MAX_ARTIFACT = 24_000;
export const MAX_FINDINGS = 32_000;
export const MAX_USER_TEST = 6_000;

export function boundedText(value: unknown, name: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new Error(`${name} must be text between ${min} and ${max} characters.`);
  }
  return value;
}

/** Conservative duplicate filter, NOT a claim that different text is semantically better. */
export function artifactKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").trim();
}

export type DiagnosticIdentity = {
  integrityVersion?: number;
  testKey?: string;
  labId?: string;
  level?: number;
  executionContext?: string;
  score?: number;
};

export function comparableDiagnostics(a?: DiagnosticIdentity, b?: DiagnosticIdentity): boolean {
  return Boolean(
    a && b && a.integrityVersion === INTEGRITY_VERSION && b.integrityVersion === INTEGRITY_VERSION &&
    a.testKey && a.testKey === b.testKey && a.labId === b.labId && a.level === b.level &&
    a.executionContext && a.executionContext === b.executionContext &&
    Number.isFinite(a.score) && Number.isFinite(b.score) &&
    a.score! >= 0 && a.score! <= 100 && b.score! >= 0 && b.score! <= 100
  );
}

/** Never trust a serialized `verified` or `contaminated` flag, even from an old ledger. */
export function quarantine<T extends object>(value: T) {
  return { ...value, verified: false as const, contaminated: true, scoreKind: "diagnostic" as const,
    integrityNote: INTEGRITY_NOTE };
}

// No trusted, private-holdout A/B evaluation service exists in this application.
// This deliberately has NO client-asserted flag, executor-name or environment-variable bypass.
export function cleanTrainingRows<T>(_rows: readonly T[]): T[] { return []; }
