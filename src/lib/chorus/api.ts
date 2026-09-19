import { boundedText } from "./integrity.ts";
import { createServerFn } from "@tanstack/react-start";
import { assertSafeRemoteResolved, postChat, type ChatResult } from "./completions";
type ProxySlot =
  | { mode: "hosted" }
  | { mode: "custom"; kind?: "openai" | "anthropic"; baseUrl: string; model: string; apiKey: string };

type ProxyInput = {
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
  system?: string;
  slot: ProxySlot;
};

export const proxyChat = createServerFn({ method: "POST" })
  .validator((input: ProxyInput) => ({
    user: boundedText(input.user, "user", 20_000, 1),
    maxTokens: Math.min(2000, Math.max(64, Number(input.maxTokens) || 400)),
    temperature: Number(input.temperature) || 0.3,
    timeoutMs: Math.min(90_000, Math.max(5_000, Number(input.timeoutMs) || 55_000)),
    system: input.system === undefined ? undefined : boundedText(input.system, "system", 30_000),
    slot: {
      ...input.slot,
      ...(input.slot.mode === "custom"
        ? {
            baseUrl: String(input.slot.baseUrl ?? "").slice(0, 300),
            model: String(input.slot.model ?? "").slice(0, 120),
            apiKey: String(input.slot.apiKey ?? "").slice(0, 400),
          }
        : {}),
    },
  }))
  .handler(async ({ data }): Promise<ChatResult> => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const request = getRequest();
      const site = request?.headers.get("sec-fetch-site");
      if (site !== "same-origin") {
        return { ok: false, error: "This call has to come from the lab." };
      }
    } catch {
      return { ok: false, error: "This call has to come from the lab." };
    }
    if (data.slot.mode === "hosted") {
      return { ok: false, error: "Hosted Grok is not a Chorus slot. Connect MCP, or paste a provider key." };
    }
    try {
      await assertSafeRemoteResolved(data.slot.baseUrl);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unsafe model URL" };
    }
    if (!data.slot.model.trim()) return { ok: false, error: "Set a model name." };
    const kind = data.slot.kind ?? "openai";
    if (!data.slot.apiKey.trim()) {
      return { ok: false, error: "This provider needs an API key." };
    }
    return postChat(
      {
        kind,
        baseUrl: data.slot.baseUrl,
        model: data.slot.model,
        apiKey: data.slot.apiKey,
      },
      data,
    );
  });
