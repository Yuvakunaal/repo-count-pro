import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useGitHubAuth } from "@/lib/auth-store";
import { fetchRateLimit, formatNumber, GitHubError, type RateLimitInfo } from "@/lib/github-logic";

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
    <header className="border-b border-border/70">
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
  const [data, setData] = useState<RateLimitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await fetchRateLimit(token);
      setData(info);
    } catch (err) {
      setError(err instanceof GitHubError ? err.message : "Failed to load usage.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const usedPct = data ? Math.min(100, (data.used / data.limit) * 100) : 0;
  const resetDate = data ? new Date(data.reset * 1000) : null;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">API usage</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your GitHub token's REST API rate limit, straight from GitHub. Checking this doesn't use
          up any of your requests.
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

      {loading && !data ? (
        <div className="rounded-lg border border-border bg-card p-6 grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-terminal-green)]" />
              <span className="text-[11px] font-mono text-muted-foreground">rate limit</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={"h-3.5 w-3.5 mr-1.5" + (loading ? " animate-spin" : "")} />
              Refresh
            </Button>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <StatItem label="Used so far" value={formatNumber(data.used)} accent="amber" />
              <StatItem label="Left to use" value={formatNumber(data.remaining)} accent="green" />
              <StatItem label="Total per hour" value={formatNumber(data.limit)} />
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
                  {formatNumber(data.used)} of {formatNumber(data.limit)} used
                </span>
                {resetDate ? (
                  <span title={resetDate.toLocaleString()}>
                    resets in {formatDistanceToNowStrict(resetDate)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
