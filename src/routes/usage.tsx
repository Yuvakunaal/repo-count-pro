import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDistanceStrict } from "date-fns";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";

import { useGitHubAuth } from "@/lib/auth-store";
import {
  formatNumber,
  getLastSeenRateLimit,
  type RateLimitHeaderSnapshot,
} from "@/lib/github-logic";

export const Route = createFileRoute("/usage")({
  component: UsagePage,
});

function UsagePage() {
  const auth = useGitHubAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <main className="flex-1 w-full max-w-xl mx-auto px-5 sm:px-8 py-10 sm:py-16">
        {auth.loading ? (
          <div className="grid place-items-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !auth.token ? (
          <div className="max-w-md">
            <h1 className="text-2xl font-semibold tracking-tight">API usage</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in first to see your GitHub API usage.
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <UsageContent />
        )}
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-10 bg-background border-b border-border/70">
      <div className="max-w-xl mx-auto px-5 sm:px-8 h-14 flex items-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> back
        </Link>
      </div>
    </header>
  );
}

function UsageContent() {
  // Purely passive: never makes a request of its own. It only ever reflects
  // headers captured incidentally from real app usage (e.g. analyzing a
  // repo), so viewing or repeatedly refreshing this page is always free —
  // there's no number here to "farm" by reloading.
  const [snapshot, setSnapshot] = useState<RateLimitHeaderSnapshot | null>(null);

  useEffect(() => {
    setSnapshot(getLastSeenRateLimit());
  }, []);

  const usedPct = snapshot ? Math.min(100, (snapshot.used / snapshot.limit) * 100) : 0;
  const resetDate = snapshot ? new Date(snapshot.reset * 1000) : null;
  // GitHub's reset timestamp is in GitHub's time, not the device's — if the
  // local clock is off, comparing straight against it inflates or shrinks
  // "resets in X" by however wrong that clock is. clockSkewMs (captured
  // alongside the rate-limit headers, from GitHub's own Date response
  // header) corrects for that, so this reads accurately even on a device
  // with a wrong system clock.
  const correctedNow =
    snapshot?.clockSkewMs != null ? new Date(Date.now() - snapshot.clockSkewMs) : new Date();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">API usage</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Read straight from the headers on your last real GitHub API request. Viewing or refreshing
          this page never uses a request — analyze a repository to update the numbers.
        </p>
      </section>

      {snapshot && snapshot.limit <= 60 ? (
        <div className="rounded-lg border border-[color:var(--color-terminal-amber)]/40 bg-[color:var(--color-terminal-amber)]/10 px-4 py-3 text-xs font-mono text-[color:var(--color-terminal-amber)] flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            A limit of {formatNumber(snapshot.limit)}/hour is GitHub's rate for unauthenticated
            requests, not the 5,000/hour a signed-in token gets — this request likely wasn't
            carrying your token.
          </span>
        </div>
      ) : null}

      {!snapshot ? (
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No usage recorded yet in this browser. Analyze a repository to see it here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--color-terminal-green)]" />
            <span className="text-[11px] font-mono text-muted-foreground">rate limit</span>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <StatItem label="Used so far" value={formatNumber(snapshot.used)} accent="amber" />
              <StatItem
                label="Left to use"
                value={formatNumber(snapshot.remaining)}
                accent="green"
              />
              <StatItem label="Total per hour" value={formatNumber(snapshot.limit)} />
            </div>

            <div>
              <div className="h-2 rounded-full bg-accent overflow-hidden">
                <div
                  className="h-full bg-[color:var(--color-terminal-amber)] transition-[width]"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>
                  {formatNumber(snapshot.used)} of {formatNumber(snapshot.limit)} used
                </span>
                {resetDate ? (
                  <span title={resetDate.toLocaleString()}>
                    resets in {formatDistanceStrict(resetDate, correctedNow)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  const accentClass =
    accent === "green"
      ? "text-[color:var(--color-terminal-green)]"
      : accent === "amber"
        ? "text-[color:var(--color-terminal-amber)]"
        : "text-foreground";
  return (
    <div>
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={"mt-1 text-xl font-semibold tracking-tight " + accentClass}>{value}</div>
    </div>
  );
}
