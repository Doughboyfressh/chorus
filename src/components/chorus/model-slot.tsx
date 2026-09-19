import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chatJson } from "@/lib/chorus/chat";
import {
  SLOT_PRESETS,
  inferKind,
  isLocalPreset,
  isLoopbackUrl,
  presetFor,
  resolveExecutor,
  type Lane,
  type ModelSlot,
} from "@/lib/chorus/slot";
import { adoptMcpSit, loadMcpSit, publicMcpUrl, sitFromText } from "@/lib/chorus/mcp-url";
import { useChorus } from "@/lib/chorus/store";
import { cn } from "@/lib/utils";

const field =
  "min-h-11 w-full rounded-lg bg-surface-2 px-3 text-sm text-fg placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const LANES: { id: Lane; label: string }[] = [
  { id: "mcp", label: "MCP" },
  { id: "local", label: "This machine" },
  { id: "api", label: "API key" },
];

export function ModelSlotPanel() {
  const slot = useChorus((s) => s.slot);
  const setSlot = useChorus((s) => s.setSlot);
  const lane = useChorus((s) => s.lane);
  const setLane = useChorus((s) => s.setLane);
  const executor = useChorus((s) => s.executor);
  const setExecutor = useChorus((s) => s.setExecutor);
  const hostedAvailable = useChorus((s) => s.hostedAvailable);
  const [draft, setDraft] = useState<ModelSlot>(slot);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sitRev, setSitRev] = useState(0);
  const [mcpUrl, setMcpUrl] = useState("/mcp");
  const [previewHost, setPreviewHost] = useState(false);
  const [sitDraft, setSitDraft] = useState("");
  const [wiping, setWiping] = useState(false);
  const bumpMcpSit = useChorus((s) => s.bumpMcpSit);
  useEffect(() => {
    setMcpUrl(publicMcpUrl());
    setPreviewHost(/grok-sandbox|grok\.me|localhost|127\.0\.0\.1/.test(window.location.host));
  }, [sitRev]);
  const local = isLoopbackUrl(draft.baseUrl);
  const selected = presetFor(draft);
  const presets = SLOT_PRESETS.filter((p) => (lane === "local" ? isLocalPreset(p.id) : !isLocalPreset(p.id)));
  const hint = SLOT_PRESETS.find((p) => p.id === selected)?.hint;

  function apply(next: ModelSlot) {
    const resolved = {
      ...next,
      kind: next.kind ?? inferKind(next.baseUrl),
    };
    setDraft(resolved);
    setSlot(resolved);
    setNote(null);
  }

  function pick(id: string) {
    const preset = SLOT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    apply({ ...preset.slot, apiKey: lane === "local" ? "" : draft.apiKey });
  }

  function chooseLane(next: Lane) {
    setLane(next);
    setNote(null);
    if (next === "local" && !isLoopbackUrl(draft.baseUrl)) {
      const ollama = SLOT_PRESETS.find((p) => p.id === "ollama")!;
      apply({ ...ollama.slot, apiKey: "" });
    }
  }

  async function test() {
    setTesting(true);
    setNote(null);
    setSlot(draft);
    const result = await chatJson({
      user: 'Return JSON {"ok": true, "model": "pong"}',
      maxTokens: 80,
      temperature: 0,
      timeoutMs: 20_000,
    });
    setTesting(false);
    setNote(result.ok ? "Slot answered." : result.error);
  }

  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">How you run</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {LANES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => chooseLane(item.id)}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm font-medium",
              lane === item.id ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {lane === "mcp" ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-muted">
            No key in Chorus. The host writes. Chorus grades. The URL is this sitting — treat it
            like a secret.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm leading-relaxed text-muted">
            <li>Pick a lab. Paste the artifact you already use as gen 0.</li>
            <li>Score gen 0 here. A low number means the plants are still open. That is the start.</li>
            <li>Copy this URL into Grok → Connectors → Custom. Transport: Streamable HTTP. Auth: none.</li>
            <li>Tell the host: run the Chorus sitting. Score a weak gen 0 first.</li>
            <li>This tab polls the same sitting. When the score rises, export the pairs.</li>
            <li>New sitting wipes this URL in place. Grok stays connected.</li>
          </ol>
          {previewHost ? (
            <p className="mt-3 text-sm leading-relaxed text-warn">
              This preview is not a public MCP host. Grok’s connector cannot reach grok-sandbox
              URLs (it gets session terminated). Deploy Chorus, or run in this tab with a key /
              local server.
            </p>
          ) : null}
          <p className="mt-3 break-all font-mono text-xs text-fg">{mcpUrl}</p>
          <label className="mt-3 block">
            <span className="sr-only">Paste Grok connector URL</span>
            <input
              className={field}
              value={sitDraft}
              onChange={(e) => setSitDraft(e.target.value)}
              placeholder="Already connected? Paste that MCP URL"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const url = publicMcpUrl();
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? "Copied" : "Copy MCP URL"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!sitFromText(sitDraft)}
            onClick={() => {
              adoptMcpSit(sitDraft);
              setSitDraft("");
              setSitRev((n) => n + 1);
              bumpMcpSit();
            }}
          >
            Use this sitting
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={wiping}
            onClick={() => {
              const sit = loadMcpSit();
              setWiping(true);
              void fetch(`/api/sitting?sit=${encodeURIComponent(sit)}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ reset: true }),
              })
                .then(() => {
                  bumpMcpSit();
                  setSitRev((n) => n + 1);
                })
                .finally(() => setWiping(false));
            }}
          >
            {wiping ? "Wiping…" : "New sitting"}
          </Button>
          </div>
        </div>
      ) : (
        <>
          <label className="mt-3 block">
            <span className="sr-only">Provider</span>
            <Select value={presets.some((p) => p.id === selected) ? selected : presets[0]?.id} onValueChange={pick}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {hint ? <p className="mt-2 text-sm leading-relaxed text-muted">{hint}</p> : null}

          <div className="mt-3 flex flex-col gap-2">
            <label className="block">
              <span className="font-mono text-xs uppercase tracking-widest text-subtle">Base URL</span>
              <input
                className={cn(field, "mt-1")}
                value={draft.baseUrl}
                onChange={(e) =>
                  setDraft({ ...draft, baseUrl: e.target.value, kind: inferKind(e.target.value) })
                }
                onBlur={() => apply(draft)}
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs uppercase tracking-widest text-subtle">Model</span>
              <input
                className={cn(field, "mt-1")}
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                onBlur={() => apply(draft)}
                spellCheck={false}
                placeholder="Model id the provider expects"
              />
            </label>
            {lane === "api" ? (
              <label className="block">
                <span className="font-mono text-xs uppercase tracking-widest text-subtle">API key</span>
                <input
                  className={cn(field, "mt-1")}
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  placeholder="Provider API key"
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  onBlur={() => apply(draft)}
                />
              </label>
            ) : null}
            <p className="text-sm leading-relaxed text-muted">
              {local
                ? "This browser talks to the server on this machine. No key. CORS must allow this page."
                : "Keys stay in this tab. If the client speaks MCP, use that lane instead."}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void test()} disabled={testing}>
              {testing ? "Testing" : "Test slot"}
            </Button>
            {note ? <p className="text-sm text-muted">{note}</p> : null}
          </div>

          {lane === "api" ? (
            <ExecutorPicker writer={draft} executor={executor} hostedAvailable={hostedAvailable} onChange={setExecutor} />
          ) : null}
        </>
      )}
    </div>
  );
}

function ExecutorPicker({
  writer,
  executor,
  hostedAvailable,
  onChange,
}: {
  writer: ModelSlot;
  executor: ModelSlot | null;
  hostedAvailable: boolean | null;
  onChange: (slot: ModelSlot | null) => void;
}) {
  const resolved = resolveExecutor(writer, executor, hostedAvailable);
  const value = executor == null ? "auto" : presetFor(executor);
  const remotes = SLOT_PRESETS.filter((p) => !isLocalPreset(p.id));

  return (
    <div className="mt-6">
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Held-out executor</p>
      <label className="mt-3 block">
        <span className="sr-only">Executor</span>
        <Select
          value={value}
          onValueChange={(id) => {
            if (id === "auto") onChange(null);
            else if (id === "same") onChange(writer);
            else {
              const preset = SLOT_PRESETS.find((p) => p.id === id);
              if (preset) onChange({ ...preset.slot, apiKey: executor?.apiKey ?? writer.apiKey });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto — same as writer unless you pick another</SelectItem>
            <SelectItem value="same">Same as writer</SelectItem>
            {remotes.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {resolved.contaminated
          ? `The fixture will run on ${resolved.label} — the same weights that write.`
          : `The fixture runs on ${resolved.label}, not the writer.`}
      </p>
    </div>
  );
}
