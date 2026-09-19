const buckets = new Map<string, { n: number; t: number }>();

export function rateLimit(key: string, max = 40, windowMs = 60_000) {
  const now = Date.now();
  const row = buckets.get(key);
  if (!row || now - row.t > windowMs) {
    buckets.set(key, { n: 1, t: now });
    if (buckets.size > 4000) {
      const first = buckets.keys().next().value;
      if (first) buckets.delete(first);
    }
    return true;
  }
  row.n += 1;
  return row.n <= max;
}

export function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || "local";
}
