import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ChorusMark } from "./mark";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/experiments" as const, label: "Experiments", id: "experiments" as const },
  { to: "/lab" as const, label: "Lab", id: "lab" as const },
  { to: "/glossary" as const, label: "Lexicon", id: "glossary" as const },
  { to: "/pricing" as const, label: "Pricing", id: "pricing" as const },
];

function AuthSlot() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <span className="inline-block size-11 rounded-md bg-surface-2" aria-hidden="true" />;
  }
  if (user) return <UserButton />;
  return (
    <Link
      to="/login"
      className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted hover:text-fg"
    >
      Sign in
    </Link>
  );
}

export function SiteHeader({
  active,
  aside,
}: {
  active?: "lab" | "pricing" | "home" | "glossary" | "experiments";
  aside?: ReactNode;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 text-fg">
            <ChorusMark className="size-8 text-accent" />
            <span>
              <span className="block font-display text-2xl leading-none tracking-tight">Chorus</span>
              <span className="mt-1 block font-mono text-xs uppercase tracking-widest text-subtle">
                Recursive improvement
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium",
                  active === item.id ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            ))}
            <AuthSlot />
          </nav>
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <p className="font-display text-xl text-fg">Chorus</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
            A lab that only believes a rising fixture. Bring a model. Keep the pairs.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <nav className="flex gap-3">
            <Link to="/lab" className="text-sm text-muted hover:text-fg">
              Lab
            </Link>
            <Link to="/glossary" className="text-sm text-muted hover:text-fg">
              Lexicon
            </Link>
            <Link to="/pricing" className="text-sm text-muted hover:text-fg">
              Pricing
            </Link>
            <Link to="/privacy" className="text-sm text-muted hover:text-fg">
              Privacy
            </Link>
            <Link to="/login" className="text-sm text-muted hover:text-fg">
              Sign in
            </Link>
          </nav>
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">
            This browser, or your account
          </p>
        </div>
      </div>
    </footer>
  );
}
