import { workSignal } from "./abort";
import { proxyChat } from "./api";
import { postChat, type ChatArgs, type ChatResult } from "./completions";
import { inferKind, isLoopbackUrl, type ModelSlot } from "./slot";
import { useChorus } from "./store";

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Cancelled.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Cancelled.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function asChatErr(err: unknown): ChatResult {
  if (err instanceof Error && (err.name === "AbortError" || err.message === "Cancelled.")) {
    return { ok: false, error: "Cancelled." };
  }
  return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
}

export async function chatFromSlot(slot: ModelSlot, args: ChatArgs): Promise<ChatResult> {
  const withSignal = { ...args, signal: args.signal ?? workSignal() };
  const kind = slot.kind ?? inferKind(slot.baseUrl);
  const resolved: ModelSlot = { ...slot, kind, mode: "custom", baseUrl: slot.baseUrl, model: slot.model };
  try {
    if (!resolved.baseUrl.trim() || !resolved.model.trim()) {
      return { ok: false, error: "Set a model, or switch to MCP." };
    }
    if (isLoopbackUrl(resolved.baseUrl)) {
      return postChat({ ...resolved, kind }, withSignal);
    }
    if (!resolved.apiKey.trim()) {
      return { ok: false, error: "Paste an API key, or switch to MCP / a local server." };
    }
    return await withAbort(
      proxyChat({
        data: {
          user: withSignal.user,
          maxTokens: withSignal.maxTokens,
          temperature: withSignal.temperature,
          timeoutMs: withSignal.timeoutMs,
          system: withSignal.system,
          slot: {
            mode: "custom",
            kind,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            apiKey: resolved.apiKey,
          },
        },
      }),
      withSignal.signal,
    );
  } catch (err) {
    return asChatErr(err);
  }
}

export async function chatJson(args: ChatArgs): Promise<ChatResult> {
  return chatFromSlot(useChorus.getState().slot, args);
}
