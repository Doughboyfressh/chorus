import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "./chrome";

const PLANS = [
  {
    name: "MCP",
    price: "Your host",
    blurb: "Grok, Claude, ChatGPT — connect and run. No key in Chorus.",
    points: [
      "The model you already use writes the sitting",
      "Chorus grades the fixture and keeps the pairs",
      "Copy /api/mcp from the lab",
      "No second key for the same model",
    ],
    cta: "Open the lab",
    featured: true,
  },
  {
    name: "Your endpoint",
    price: "Your model",
    blurb: "A key, or a server on this machine.",
    points: [
      "OpenRouter, Anthropic, OpenAI, Gemini, Groq, and the rest",
      "llama.cpp, vLLM, Ollama, LM Studio, SGLang — no key",
      "The same fixture. The same pairs. Tagged with the model that wrote them",
      "Keys go through our proxy for the call. Not stored.",
    ],
    cta: "Plug in a slot",
    featured: false,
  },
];

export function PricingPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader active="pricing" />
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Pricing</p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-tight text-fg">
          The loop is Chorus. The model is yours.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          Connect MCP if you already use Grok, Claude, or ChatGPT. Or paste a key. Or point at a
          server on this machine. Chorus grades. It does not include a model.
        </p>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className="rounded-3xl bg-surface p-6 shadow-[var(--shadow-border)] sm:p-8"
            >
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">{plan.name}</p>
              <h2 className="mt-3 font-display text-4xl text-fg">{plan.price}</h2>
              <p className="mt-2 text-sm text-muted">{plan.blurb}</p>
              <ul className="mt-6 space-y-3">
                {plan.points.map((point) => (
                  <li key={point} className="border-l border-border pl-3 text-sm leading-relaxed text-fg">
                    {point}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8" variant={plan.featured ? "default" : "secondary"}>
                <Link to="/lab">
                  {plan.cta}
                  <ArrowUpRight />
                </Link>
              </Button>
            </article>
          ))}
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-muted">
          No seats. No annual contract. No training on your artifacts. When the fixture rises, the
          pairs are yours to keep.{" "}
          <Link to="/privacy" className="text-fg underline decoration-border underline-offset-4">
            What leaves this browser
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
