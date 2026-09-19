export type SlotMode = "hosted" | "custom";
export type SlotKind = "openai" | "anthropic";
export type Lane = "mcp" | "local" | "api";

export type ModelSlot = {
  mode: SlotMode;
  kind: SlotKind;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export const EMPTY_SLOT: ModelSlot = {
  mode: "custom",
  kind: "openai",
  baseUrl: "",
  model: "",
  apiKey: "",
};

export const XAI_SLOT: ModelSlot = {
  mode: "custom",
  kind: "openai",
  baseUrl: "https://api.x.ai/v1",
  model: "grok-4.5",
  apiKey: "",
};

/** @deprecated Chorus does not host Grok. Alias of XAI_SLOT (user key). */
export const HOSTED_SLOT = XAI_SLOT;

export type ProviderPreset = {
  id: string;
  label: string;
  hint: string;
  slot: ModelSlot;
};

export const SLOT_PRESETS: ProviderPreset[] = [
  {
    id: "xai",
    label: "xAI Grok",
    hint: "xAI HTTP API. Prefer MCP if you already use Grok.",
    slot: XAI_SLOT,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "One key, most frontier and open models.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKey: "",
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Native Messages API. Claude. Prefer MCP if you already pay Claude.",
    slot: {
      mode: "custom",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-5",
      apiKey: "",
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT and o-series. Prefer MCP if you already pay ChatGPT.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      apiKey: "",
    },
  },
  {
    id: "google",
    label: "Google",
    hint: "Gemini, OpenAI-compatible endpoint.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-pro",
      apiKey: "",
    },
  },
  {
    id: "groq",
    label: "Groq",
    hint: "Fast open-weight inference.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      apiKey: "",
    },
  },
  {
    id: "together",
    label: "Together",
    hint: "Open models, OpenAI-compatible.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.together.xyz/v1",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      apiKey: "",
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "DeepSeek chat and reasoner.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "",
    },
  },
  {
    id: "mistral",
    label: "Mistral",
    hint: "Mistral and Mixtral.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-large-latest",
      apiKey: "",
    },
  },
  {
    id: "fireworks",
    label: "Fireworks",
    hint: "OpenAI-compatible hosted open models.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      apiKey: "",
    },
  },
  {
    id: "ollama",
    label: "Ollama",
    hint: "A model on this machine.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      apiKey: "",
    },
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    hint: "Local server, OpenAI-compatible.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "",
      apiKey: "",
    },
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    hint: "llama-server, OpenAI-compatible.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "",
      apiKey: "",
    },
  },
  {
    id: "vllm",
    label: "vLLM",
    hint: "vLLM OpenAI-compatible server.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "",
      apiKey: "",
    },
  },
  {
    id: "sglang",
    label: "SGLang",
    hint: "SGLang runtime, OpenAI-compatible.",
    slot: {
      mode: "custom",
      kind: "openai",
      baseUrl: "http://127.0.0.1:30000/v1",
      model: "",
      apiKey: "",
    },
  },
  {
    id: "custom",
    label: "Custom endpoint",
    hint: "Any OpenAI-compatible URL: TGI, LocalAI, Aphrodite, a remote vLLM box.",
    slot: { mode: "custom", kind: "openai", baseUrl: "", model: "", apiKey: "" },
  },
];

export function isLocalPreset(id: string) {
  return id === "ollama" || id === "lmstudio" || id === "llamacpp" || id === "vllm" || id === "sglang";
}

export function slotIdentity(slot: ModelSlot) {
  return `${slot.baseUrl.replace(/\/$/, "")}::${slot.model}`;
}

export function sameWeights(a: ModelSlot, b: ModelSlot) {
  return slotIdentity(a) === slotIdentity(b);
}

export function snapshotSlot(slot: ModelSlot): {
  mode: "hosted" | "custom";
  kind?: "openai" | "anthropic";
  model: string;
  baseUrl: string;
} {
  return {
    mode: "custom",
    kind: slot.kind,
    model: slot.model,
    baseUrl: slot.baseUrl,
  };
}

export function resolveExecutor(
  writer: ModelSlot,
  executor: ModelSlot | null,
  hostedAvailable: boolean | null,
): { slot: ModelSlot; contaminated: boolean; label: string } {
  if (executor && slotReady(executor, hostedAvailable)) {
    return {
      slot: executor,
      contaminated: true, // Caller-selected endpoints and names are not execution attestation.
      label: snapshotSlot(executor).model,
    };
  }
  return {
    slot: writer,
    contaminated: true,
    label: snapshotSlot(writer).model,
  };
}

const EXEC_KEY = "chorus.executor.v1";
const EXEC_SECRET = "chorus.executor.secret.v1";

export function loadExecutor(): ModelSlot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXEC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { auto?: boolean } & Partial<ModelSlot>;
    if (parsed.auto !== false && !parsed.mode) return null;
    if (parsed.mode === "hosted") {
      let apiKey = "";
      try {
        apiKey = sessionStorage.getItem(EXEC_SECRET) ?? "";
      } catch {
        apiKey = "";
      }
      return { ...XAI_SLOT, apiKey };
    }
    if (parsed.mode !== "custom") return null;
    let apiKey = "";
    try {
      apiKey = sessionStorage.getItem(EXEC_SECRET) ?? "";
    } catch {
      apiKey = "";
    }
    return {
      mode: "custom",
      kind: parsed.kind === "anthropic" ? "anthropic" : inferKind(String(parsed.baseUrl ?? "")),
      baseUrl: String(parsed.baseUrl ?? "").trim(),
      model: String(parsed.model ?? "").trim(),
      apiKey,
    };
  } catch {
    return null;
  }
}

export function saveExecutor(slot: ModelSlot | null) {
  if (typeof localStorage === "undefined") return;
  if (!slot) {
    localStorage.setItem(EXEC_KEY, JSON.stringify({ auto: true }));
    try {
      sessionStorage.removeItem(EXEC_SECRET);
    } catch {
      /* ignore */
    }
    return;
  }
  const next =
    slot.mode === "hosted" ? { ...XAI_SLOT, apiKey: slot.apiKey } : slot;
  localStorage.setItem(
    EXEC_KEY,
    JSON.stringify({
      auto: false,
      mode: "custom",
      kind: next.kind,
      baseUrl: next.baseUrl,
      model: next.model,
    }),
  );
  try {
    if (next.apiKey) sessionStorage.setItem(EXEC_SECRET, next.apiKey);
    else sessionStorage.removeItem(EXEC_SECRET);
  } catch {
    /* ignore */
  }
}

export function inferKind(baseUrl: string): SlotKind {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes("anthropic.com")) return "anthropic";
  } catch {
    /* ignore */
  }
  return "openai";
}

export function presetFor(slot: ModelSlot): string {
  const match = SLOT_PRESETS.find((p) => p.slot.baseUrl && p.slot.baseUrl === slot.baseUrl);
  return match?.id ?? "custom";
}

const KEY = "chorus.slot.v1";
const SECRET = "chorus.slot.secret.v1";
const LANE_KEY = "chorus.lane.v1";

export function loadLane(): Lane {
  if (typeof localStorage === "undefined") return "mcp";
  try {
    const raw = localStorage.getItem(LANE_KEY);
    if (raw === "local" || raw === "api") return raw;
  } catch {
    /* ignore */
  }
  return "mcp";
}

export function saveLane(lane: Lane) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LANE_KEY, lane);
}

export function loadSlot(): ModelSlot {
  if (typeof localStorage === "undefined") return { ...EMPTY_SLOT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_SLOT };
    const parsed = JSON.parse(raw) as Partial<ModelSlot>;
    let apiKey = "";
    try {
      apiKey = sessionStorage.getItem(SECRET) ?? "";
    } catch {
      apiKey = "";
    }
    if (parsed.mode === "hosted") return { ...EMPTY_SLOT, apiKey };
    const baseUrl = String(parsed.baseUrl ?? "").trim();
    const kind: SlotKind = parsed.kind === "anthropic" ? "anthropic" : inferKind(baseUrl);
    return {
      mode: "custom",
      kind,
      baseUrl,
      model: String(parsed.model ?? "").trim(),
      apiKey,
    };
  } catch {
    return { ...EMPTY_SLOT };
  }
}

export function saveSlot(slot: ModelSlot) {
  if (typeof localStorage === "undefined") return;
  const next = {
    ...slot,
    mode: "custom" as const,
    kind: slot.kind ?? inferKind(slot.baseUrl),
    baseUrl: slot.mode === "hosted" ? XAI_SLOT.baseUrl : slot.baseUrl,
    model: slot.mode === "hosted" ? XAI_SLOT.model : slot.model,
  };
  localStorage.setItem(
    KEY,
    JSON.stringify({
      mode: "custom",
      kind: next.kind,
      baseUrl: next.baseUrl,
      model: next.model,
    }),
  );
  try {
    if (next.apiKey) sessionStorage.setItem(SECRET, next.apiKey);
    else sessionStorage.removeItem(SECRET);
  } catch {
    /* private mode */
  }
}

export function isLoopbackUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function slotReady(slot: ModelSlot, _hostedAvailable?: boolean | null) {
  if (!slot.baseUrl.trim() || !slot.model.trim()) return false;
  if (isLoopbackUrl(slot.baseUrl)) return true;
  return slot.apiKey.trim().length > 0;
}

export function laneReady(lane: Lane, slot: ModelSlot) {
  if (lane === "mcp") return true;
  return slotReady(slot);
}

export function slotLabel(slot: ModelSlot) {
  return slot.model || "Custom model";
}
