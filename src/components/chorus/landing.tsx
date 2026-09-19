import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOOP_LINE } from "@/lib/chorus/lexicon";
import { SiteFooter, SiteHeader } from "./chrome";
import { LexiconList } from "./lexicon";

const USES = [
  {
    title: "A prompt you already ship",
    body: "Paste it as gen 0. The swarm has to beat that score, not a blank page.",
  },
  {
    title: "An eval that got easy",
    body: "When the artifact clears the fixture, the test mutates. The loop does not get to declare victory.",
  },
  {
    title: "Candidates for human review",
    body: "Comparable practice improvements can be exported for review, not training. Verified training export is locked.",
  },
];

const STEPS = [
  { n: "01", title: "Paste", body: "The artifact you already use. Optional: your additional practice test." },
  { n: "02", title: "Score", body: "Gen 0 against a fixture the swarm does not write. A low number is the start." },
  { n: "03", title: "Connect", body: "MCP: copy the lab URL into Grok, Claude, or Cursor. Or paste a key. Or point at this machine." },
  { n: "04", title: "Recurse", body: "The host writes. Chorus grades. Open fixture failures become the next contract." },
  { n: "05", title: "Export", body: "Unverified review candidates and a playbook. Practice scores do not certify improvement." },
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader active="home" />
      <main>
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">Chorus</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight text-fg sm:text-7xl">
            Recursive self-improvement, as a company.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Chat with extra steps is not a product. A swarm that rewrites its own contract, scored
            by public practice fixtures, is a starting point—not proof of improvement. Plug in Grok, Claude, GPT, Gemini, or a model on this
            machine. Independent validation is still required.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-fg">{LOOP_LINE}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/lab">
                Open the lab
                <ArrowUpRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/pricing">Pricing</Link>
            </Button>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid max-w-7xl gap-px bg-border sm:grid-cols-3">
            {USES.map((item) => (
              <article key={item.title} className="bg-bg px-4 py-10 sm:px-8">
                <h2 className="font-display text-2xl leading-snug text-fg">{item.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">The loop</p>
          <h2 className="mt-3 font-display text-4xl leading-tight text-fg">How a sitting works</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step) => (
              <li key={step.n}>
                <p className="font-mono text-xs tabular-nums tracking-widest text-subtle">{step.n}</p>
                <h3 className="mt-2 font-display text-2xl text-fg">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Lexicon</p>
            <h2 className="mt-3 font-display text-4xl leading-tight text-fg">
              Artifact. Fixture. Pairs.
            </h2>
            <div className="mt-10">
              <LexiconList ids={["artifact", "fixture", "pairs"]} />
            </div>
            <Link
              to="/glossary"
              className="mt-8 inline-block text-sm text-fg underline decoration-border underline-offset-4"
            >
              Full lexicon — prompt, eval, spec, contract
            </Link>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">The offer</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-fg">
              We run the loop. You bring the model.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
              Connect MCP, paste a key, or run a model on this machine. The lab ledger lives in
              this browser; sign in to keep it. An MCP sitting lives on the URL you copy, for 14
              days. That URL is a secret.
            </p>
            <div className="mt-8">
              <Button asChild>
                <Link to="/lab">
                  Start a sitting
                  <ArrowUpRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
