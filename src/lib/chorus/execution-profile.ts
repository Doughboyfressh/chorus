/** Declared configuration is for like-for-like PRACTICE comparisons, never attestation. */
export type ExecutionProfile = {
  model: string;
  provider?: string;
  revision?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
};
export const EXECUTION_PROFILE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["model"], properties: {
    model: { type: "string", minLength: 1, maxLength: 160 },
    provider: { type: "string", minLength: 1, maxLength: 160 },
    revision: { type: "string", minLength: 1, maxLength: 160 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    maxTokens: { type: "integer", minimum: 1, maximum: 200000 },
    seed: { type: "integer" },
  },
  description: "Declared model/settings, not a display label. Set before requesting an exam; changes invalidate pending attempts. Does not certify execution.",
} as const;

export function executionProfile(value: unknown): ExecutionProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("executionConfig must be a model/settings object.");
  const row = value as Record<string, unknown>;
  const allowed = Object.keys(EXECUTION_PROFILE_SCHEMA.properties);
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error("Unknown executionConfig field; no free-form label or secret is accepted.");
  if (typeof row.model !== "string" || !row.model.trim()) throw new Error("executionConfig.model is required.");
  for (const key of ["model", "provider", "revision"]) if (row[key] !== undefined &&
      (typeof row[key] !== "string" || !(row[key] as string).trim() || (row[key] as string).length > 160)) {
    throw new Error(`executionConfig.${key} must be nonblank text up to 160 characters.`);
  }
  if (row.temperature !== undefined && (typeof row.temperature !== "number" || !Number.isFinite(row.temperature) || row.temperature < 0 || row.temperature > 2)) throw new Error("Invalid executionConfig.temperature.");
  if (row.maxTokens !== undefined && (typeof row.maxTokens !== "number" || !Number.isSafeInteger(row.maxTokens) || row.maxTokens < 1 || row.maxTokens > 200000)) throw new Error("Invalid executionConfig.maxTokens.");
  if (row.seed !== undefined && !Number.isSafeInteger(row.seed)) throw new Error("Invalid executionConfig.seed.");
  return {
    model: (row.model as string).trim(),
    ...(row.provider !== undefined ? { provider: (row.provider as string).trim() } : {}),
    ...(row.revision !== undefined ? { revision: (row.revision as string).trim() } : {}),
    ...(row.temperature !== undefined ? { temperature: row.temperature as number } : {}),
    ...(row.maxTokens !== undefined ? { maxTokens: row.maxTokens as number } : {}),
    ...(row.seed !== undefined ? { seed: row.seed as number } : {}),
  };
}

export function profileKey(profile?: ExecutionProfile) {
  return JSON.stringify([profile?.model ?? "host-unspecified", profile?.provider ?? null,
    profile?.revision ?? null, profile?.temperature ?? null, profile?.maxTokens ?? null, profile?.seed ?? null]);
}
export function sessionExecutionContext(id: string, profile?: ExecutionProfile) {
  return JSON.stringify(["unverified-mcp-session-v2", id, profileKey(profile)]);
}
