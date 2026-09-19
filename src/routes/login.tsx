import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/chorus/chrome";

export const Route = createFileRoute("/login")({
  component: Login,
  head: () => ({ meta: [{ title: "Sign in · Chorus" }] }),
});

function Login() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Account</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-fg">Keep the ledger.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Sign in to sync sittings across browsers. The lab still runs without an account — this
          browser keeps a copy either way.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/lab" })}
              >
                Continue with {p.label}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled in this environment.</p>
          )}
        </div>
        <p className="mt-8">
          <Link to="/lab" className="text-sm text-fg underline decoration-border underline-offset-4">
            Use the lab without an account
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
