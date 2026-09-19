import { Link } from "@tanstack/react-router";
import { ARTIFACT_SHAPES, LEXICON, LOOP_LINE } from "@/lib/chorus/lexicon";
import { SiteFooter, SiteHeader } from "./chrome";

export function LexiconList({ ids }: { ids?: readonly string[] }) {
  const items = ids ? LEXICON.filter((entry) => ids.includes(entry.id)) : LEXICON;
  return (
    <dl className="grid gap-8">
      {items.map((entry) => (
        <div key={entry.id} id={entry.id}>
          <dt className="font-display text-2xl leading-tight text-fg">{entry.term}</dt>
          <dd className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{entry.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LexiconPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader active="glossary" />
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Lexicon</p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-tight text-fg">
          The words the lab actually uses.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">{LOOP_LINE}</p>
        <div className="mt-12">
          <LexiconList />
        </div>
        <p className="mt-12 max-w-xl text-sm leading-relaxed text-fg">{ARTIFACT_SHAPES}</p>
        <p className="mt-8">
          <Link to="/lab" className="text-sm text-fg underline decoration-border underline-offset-4">
            Open the lab
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
