const SIT_KEY = "chorus.mcp.sit.v1";

function newSit() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function loadMcpSit(): string {
  if (typeof sessionStorage === "undefined") return newSit();
  try {
    const existing = sessionStorage.getItem(SIT_KEY);
    if (existing) return existing;
    const id = newSit();
    sessionStorage.setItem(SIT_KEY, id);
    return id;
  } catch {
    return newSit();
  }
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
