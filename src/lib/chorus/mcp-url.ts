const SIT_KEY = "chorus.mcp.sit.v1";

function newSit() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else throw new Error("A secure context with cryptographic randomness is required.");
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function validSitId(id: string) {
  return /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(id);
}

export function sitFromText(raw: string) {
  const t = raw.trim();
  const path = t.match(/\/mcp\/([a-zA-Z0-9_-]{8,80})/);
  if (path?.[1] && validSitId(path[1])) return path[1];
  const query = t.match(/[?&]sit=([a-zA-Z0-9_-]{8,80})/);
  if (query?.[1] && validSitId(query[1])) return query[1];
  if (validSitId(t)) return t;
  return "";
}

export function loadMcpSit(): string {
  if (typeof sessionStorage === "undefined") return newSit();
  try {
    const existing = sessionStorage.getItem(SIT_KEY);
    if (existing && validSitId(existing)) return existing;
    const id = newSit();
    sessionStorage.setItem(SIT_KEY, id);
    return id;
  } catch {
    return newSit();
  }
}

export function adoptMcpSit(id: string) {
  const sit = sitFromText(id);
  if (!sit) return loadMcpSit();
  try {
    sessionStorage.setItem(SIT_KEY, sit);
  } catch {
    /* private mode */
  }
  return sit;
}

export function rotateMcpSit() {
  const id = newSit();
  try {
    sessionStorage.setItem(SIT_KEY, id);
  } catch {
    /* private mode */
  }
  return id;
}

export function publicMcpUrl() {
  const sit = loadMcpSit();
  if (typeof window === "undefined") return `/mcp/${sit}`;
  return `${window.location.origin}/mcp/${sit}`;
}
