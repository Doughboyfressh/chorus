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
            sends the artifact and findings so we can grade. Unsaved sittings are temporary and normally retained for 14 days,
            keyed by the secret in the MCP URL. Anyone with the URL can read and score it.
            Wipe clears the live ledger. New URL creates a different sitting; it does not revoke the previous URL. Saved checkpoints are separate and survive live-ledger resets.
          </p>
          <p>
            The pairs you export are yours. Chorus does not train on them. Public practice results are unverified; clean training exports remain disabled.
          </p>
          <p>
            Saved experiment vaults use private recovery keys, stored only as hashes on the server.
            This browser remembers its recovery key until you lock it. Saved artifacts, checkpoints
            and controlled-run receipts have no automatic expiry. You can export them or explicitly
            delete a saved leaf experiment. Possession of a recovery key grants access to that vault;
            it is capability-based access, not user-account authentication.
          </p>
          <p>
            Controlled Prompt comparisons send the two chosen artifacts and public calibration cases
            to the operator-configured OpenAI endpoint. Full bounded responses, usage and errors are
            stored as receipts. Provider credentials stay server-side; the separate operator execution
            key stays in this tab's memory and is not saved with records. No paid execution starts
            until you explicitly authorize a frozen plan. These small public tests do not certify
            generalization, security or model improvement.
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
