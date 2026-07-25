import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useGitHubAuth } from "@/lib/auth-store";
import {
  fetchUser,
  fetchRateLimit,
  formatNumber,
  getLastSeenRateLimit,
  GitHubError,
  type RateLimitInfo,
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
          <UsageContent token={auth.token} />
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

function UsageContent({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<RateLimitHeaderSnapshot | null>(() =>
    getLastSeenRateLimit(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // GitHub's dedicated /rate_limit endpoint can lag behind real activity by
  // several minutes (confirmed: a real request reported used=12 in its own
  // headers while /rate_limit said 0 seconds later). So this fetches a cheap
  // real endpoint instead and reads the fresh headers off that response.
  // Runs automatically on mount — a browser refresh or opening this page from
  // the header icon both remount this component, no manual button needed.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchUser(token);
      setSnapshot(getLastSeenRateLimit());
    } catch (err) {
      setError(err instanceof GitHubError ? err.message : "Failed to load usage.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const usedPct = snapshot ? Math.min(100, (snapshot.used / snapshot.limit) * 100) : 0;
  const resetDate = snapshot ? new Date(snapshot.reset * 1000) : null;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">API usage</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Read straight from the headers on your last real GitHub API request — the reliable source.
          GitHub's separate usage-check endpoint can lag behind real activity, so the numbers below
          don't rely on it. Reopen this page to get a fresh reading.
        </p>
      </section>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-destructive">Couldn't load usage</div>
            <p className="text-xs text-destructive/90 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      ) : null}

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

      {!snapshot && loading ? (
        <div className="rounded-lg border border-border bg-card p-6 grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !snapshot ? null : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--color-terminal-green)]" />
            <span className="text-[11px] font-mono text-muted-foreground">rate limit</span>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />
            ) : null}
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
                    resets in {formatDistanceToNowStrict(resetDate)}
                  </span>
                ) : null}
              </div>
            </div>

            <p className="text-[11px] font-mono text-muted-foreground break-all">
              from GET {snapshot.url.replace("https://api.github.com", "")} ·{" "}
              {formatDistanceToNowStrict(new Date(snapshot.seenAt))} ago
            </p>
          </div>
        </div>
      )}

      <DedicatedCheckPanel token={token} />
    </div>
  );
}

function DedicatedCheckPanel({ token }: { token: string }) {
  const [data, setData] = useState<RateLimitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRateLimit(token));
    } catch (err) {
      setError(err instanceof GitHubError ? err.message : "Failed to check.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  return (
    <details className="group rounded-lg border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground hover:text-foreground select-none">
        GitHub's dedicated usage-check endpoint (for comparison — known to lag behind real activity)
      </summary>
      <div className="mt-3 space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void check()}
          disabled={loading}
          className="h-8"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Check /rate_limit (free — doesn't use a request)
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {data ? (
          <>
            <p className="text-xs font-mono text-muted-foreground">
              used {formatNumber(data.used)} of {formatNumber(data.limit)}
            </p>
            <pre className="rounded-md border border-border bg-background p-3 text-[10.5px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(data.raw, null, 2)}
            </pre>
          </>
        ) : null}
      </div>
    </details>
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
