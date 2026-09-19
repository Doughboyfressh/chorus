/** Process-local PGLite is development-only, not a deployment replay ledger. */
export function requireDurableDatabase(env: Record<string, string | undefined>) {
  if ((env.VERCEL === "1" || env.NODE_ENV === "production") && !env.DATABASE_URL?.trim()) {
    throw new Error("A durable DATABASE_URL is required for deployed exam attempts and sitting history.");
  }
}
