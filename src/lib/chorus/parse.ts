function closeTruncated(slice: string): string {
  let s = slice.trim();
  const quotes = (s.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) s += '"';
  const openSq = (s.match(/\[/g) ?? []).length - (s.match(/\]/g) ?? []).length;
  const openCu = (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length;
  if (s.endsWith(",")) s = s.slice(0, -1);
  s += "]".repeat(Math.max(0, openSq));
  s += "}".repeat(Math.max(0, openCu));
  return s;
}

export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1]?.trim() ?? trimmed).replace(/^\uFEFF/, "");
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("Model returned no JSON object");
  const end = raw.lastIndexOf("}");
  const slice = end > start ? raw.slice(start, end + 1) : raw.slice(start);
  const candidates = [slice, slice.replace(/,\s*([}\]])/g, "$1"), closeTruncated(slice)];
  let last: Error | undefined;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      last = err instanceof Error ? err : new Error("Unreadable JSON");
    }
  }
  throw last ?? new Error("Unreadable JSON");
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item).trim()).filter(Boolean);
}
