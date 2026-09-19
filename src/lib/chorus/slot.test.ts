import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anthropicMessagesUrl, assertSafeRemoteUrl, completionsUrl } from "./completions.ts";
import { inferKind, resolveExecutor, sameWeights } from "./slot.ts";

describe("provider routing", () => {
  it("detects Anthropic from the host", () => {
    assert.equal(inferKind("https://api.anthropic.com/v1"), "anthropic");
    assert.equal(inferKind("https://api.openai.com/v1"), "openai");
    assert.equal(inferKind("https://openrouter.ai/api/v1"), "openai");
  });

  it("builds OpenAI-compatible completion URLs", () => {
    assert.equal(
      completionsUrl("https://api.openai.com/v1"),
      "https://api.openai.com/v1/chat/completions",
    );
    assert.equal(
      completionsUrl("https://generativelanguage.googleapis.com/v1beta/openai"),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    assert.equal(
      completionsUrl("http://127.0.0.1:8080/v1"),
      "http://127.0.0.1:8080/v1/chat/completions",
    );
    assert.equal(
      completionsUrl("http://127.0.0.1:8000/v1"),
      "http://127.0.0.1:8000/v1/chat/completions",
    );
  });

  it("builds Anthropic message URLs", () => {
    assert.equal(
      anthropicMessagesUrl("https://api.anthropic.com/v1"),
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("rejects private and loopback remotes", () => {
    assert.throws(() => assertSafeRemoteUrl("http://api.openai.com/v1"));
    assert.throws(() => assertSafeRemoteUrl("https://127.0.0.1/v1"));
    assert.throws(() => assertSafeRemoteUrl("https://[::1]/v1"));
    assert.throws(() => assertSafeRemoteUrl("https://169.254.169.254/latest"));
    assert.throws(() => assertSafeRemoteUrl("https://2130706433/v1"));
    assert.throws(() => assertSafeRemoteUrl("https://[::ffff:127.0.0.1]/v1"));
    assertSafeRemoteUrl("https://api.x.ai/v1");
  });
});

describe("resolveExecutor", () => {
  const openai = {
    mode: "custom" as const,
    kind: "openai" as const,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    apiKey: "sk-test",
  };

  it("does not fall back to a Chorus-paid Grok", () => {
    const resolved = resolveExecutor(openai, null, true);
    assert.equal(resolved.contaminated, true);
    assert.equal(resolved.slot.model, "gpt-4.1");
  });

  it("marks same weights as contaminated", () => {
    const xai = {
      mode: "custom" as const,
      kind: "openai" as const,
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.5",
      apiKey: "xai-test",
    };
    const resolved = resolveExecutor(xai, xai, false);
    assert.equal(resolved.contaminated, true);
    assert.equal(sameWeights(xai, { ...openai, baseUrl: "https://api.x.ai/v1", model: "grok-4.5" }), true);
  });
});
