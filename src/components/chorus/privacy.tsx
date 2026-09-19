import { Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "./chrome";

export function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Privacy</p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-tight text-fg">
          What leaves this browser.
        </h1>
        <div className="mt-10 max-w-xl space-y-6 text-sm leading-relaxed text-muted">
          <p>
            The artifact, the goal, and the fixture input go to the model you chose — a local
            server from this browser, an MCP host, or a remote URL. Remote keys are sent with
            the request through our proxy so the provider accepts the call; they are not stored
            in the database. Chorus has no training pipeline.
          </p>
          <p>
            Remote API keys stay in this tab (session storage) and are sent through our proxy
            on each remote call so the provider accepts it. They are not stored in the
            database. A local ledger stays in this browser. If you sign in, lab sittings also
            sync to your account. Sign-in is optional; the lab runs without it.
          </p>
          <p>
            A local server (llama.cpp, vLLM, Ollama) never sends the artifact through us. MCP
            sends the artifact and findings so we can grade. That sitting is stored for 14 days,
            keyed by the secret in the MCP URL. Anyone with the URL can read and score it.
            Wipe clears the ledger. New URL rotates the secret and revokes the old one.
          </p>
          <p>
            The pairs you export are yours. Chorus does not train on them. The Train download is a
            pack for your trainer, not a weight update inside this product.
          </p>
        </div>
        <p className="mt-10">
          <Link to="/lab" className="text-sm text-fg underline decoration-border underline-offset-4">
            Open the lab
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
