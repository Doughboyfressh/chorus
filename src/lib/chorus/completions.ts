export type ChatArgs = {
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
  system?: string;
  signal?: AbortSignal;
};

export type ChatOk = { ok: true; text: string };
export type ChatErr = { ok: false; error: string };
export type ChatResult = ChatOk | ChatErr;
export type ChatFn = (args: ChatArgs) => Promise<ChatResult>;

export type ChatSlot = {
  kind?: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  apiKey: string;
};

export const CHORUS_SYSTEM =
  "You are a specialist inside Chorus, a recursive self-improvement lab. Be concrete and terse. No fluff, no emoji, no marketing. Prefer mechanisms, tests, and kill-criteria over slogans. Return JSON only.";

function isAbort(err: unknown) {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function combinedSignal(args: ChatArgs) {
  const timeout = AbortSignal.timeout(args.timeoutMs ?? 55_000);
  if (args.signal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, args.signal]);
  }
  return timeout;
}

export function completionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (
    /\/v\d+[a-z]*$/i.test(trimmed) ||
    trimmed.endsWith("/openai") ||
    trimmed.endsWith("/inference/v1")
  ) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

export function anthropicMessagesUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function openaiHeaders(slot: ChatSlot) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (slot.apiKey.trim()) headers.Authorization = `Bearer ${slot.apiKey.trim()}`;
  try {
    const host = new URL(slot.baseUrl).hostname.toLowerCase();
    if (host.includes("openrouter.ai")) {
      headers["HTTP-Referer"] =
        typeof window !== "undefined" ? window.location.origin : "https://x.ai";
      headers["X-Title"] = "Chorus";
    }
  } catch {
    /* ignore */
  }
  return headers;
}

export async function postCompletions(slot: ChatSlot, args: ChatArgs): Promise<ChatResult> {
  const url = completionsUrl(slot.baseUrl);
  const headers = openaiHeaders(slot);
  const messages = [
    { role: "system", content: args.system ?? CHORUS_SYSTEM },
    { role: "user", content: args.user },
  ];

  const attempt = async (withJson = true): Promise<ChatResult> => {
    try {
      const body: Record<string, unknown> = {
        model: slot.model,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
        messages,
      };
      if (withJson) body.response_format = { type: "json_object" };
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal(args),
        redirect: "error",
      });
      if (res.status === 400 && withJson) return attempt(false);
      if (res.status === 429) return { ok: false, error: "The lab is busy. Wait a moment and run again." };
      if (!res.ok) {
        return { ok: false, error: `Model API error ${res.status}` };
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text) return { ok: false, error: "Empty model response" };
      return { ok: true, text };
    } catch (err) {
      if (isAbort(err)) {
        if (args.signal?.aborted) return { ok: false, error: "Cancelled." };
        return { ok: false, error: "This agent ran out of time" };
      }
      return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
    }
  };

  const first = await attempt(true);
  if (first.ok) return first;
  if (first.error.includes("error 5") || first.error.includes("429") || first.error.includes("busy")) {
    return attempt(true);
  }
  return first;
}

export async function postAnthropic(slot: ChatSlot, args: ChatArgs): Promise<ChatResult> {
  const url = anthropicMessagesUrl(slot.baseUrl);
  const attempt = async (): Promise<ChatResult> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": slot.apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: slot.model,
          temperature: args.temperature,
          max_tokens: args.maxTokens,
          system: args.system ?? CHORUS_SYSTEM,
          messages: [{ role: "user", content: args.user }],
        }),
        signal: combinedSignal(args),
        redirect: "error",
      });
      if (res.status === 429) return { ok: false, error: "The lab is busy. Wait a moment and run again." };
      if (!res.ok) {
        return { ok: false, error: `Anthropic error ${res.status}` };
      }
      const json = (await res.json()) as { content?: { type?: string; text?: string }[] };
      const text = json.content?.find((block) => block.type === "text")?.text ?? json.content?.[0]?.text ?? "";
      if (!text) return { ok: false, error: "Empty model response" };
      return { ok: true, text };
    } catch (err) {
      if (isAbort(err)) {
        if (args.signal?.aborted) return { ok: false, error: "Cancelled." };
        return { ok: false, error: "This agent ran out of time" };
      }
      return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
    }
  };
  const first = await attempt();
  if (first.ok) return first;
  if (first.error.includes("error 5") || first.error.includes("429") || first.error.includes("busy")) {
    return attempt();
  }
  return first;
}

export function postChat(slot: ChatSlot, args: ChatArgs): Promise<ChatResult> {
  if (slot.kind === "anthropic") return postAnthropic(slot, args);
  return postCompletions(slot, args);
}

const PRIVATE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|221\.|222\.|223\.|224\.|240\.|255\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

function ipv4Private(ip: string) {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateAddress(ip: string) {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return ipv4Private(mapped[1]);
    const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return ipv4Private(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return false;
  }
  return ipv4Private(host);
}

export function assertSafeRemoteUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Model URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Remote models must use HTTPS. Local models are called from this browser.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Model URL cannot include credentials.");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d+$/.test(host) || host.includes("%")) {
    throw new Error("That host cannot be reached from Chorus servers.");
  }
  if (host === "localhost" || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw new Error("That host cannot be reached from Chorus servers.");
  }
  if (isPrivateAddress(host) || PRIVATE.test(host)) {
    throw new Error("Private network URLs must run in this browser.");
  }
}

export async function assertSafeRemoteResolved(url: string) {
  assertSafeRemoteUrl(url);
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) throw new Error("empty");
    for (const row of addrs) {
      if (isPrivateAddress(row.address)) {
        throw new Error("Private network URLs must run in this browser.");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Private network")) throw err;
    throw new Error("That host cannot be reached from Chorus servers.");
  }
}
