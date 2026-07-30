import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  Loader2,
  AlertTriangle,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GitMerge,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Telescope,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCachedAnalysisState } from "@/lib/analysis-cache";
import {
  fetchPullRequestsPage,
  fetchPrCounts,
  fetchOpenAgeSample,
  fetchRecentMergedSample,
  formatNumber,
  searchPullRequestsOnGitHub,
  GitHubError,
  type PullRequestSummary,
  type PrCounts,
} from "@/lib/github-logic";
import {
  searchPullRequests,
  highlightPullRequestMatches,
  computeAvgAgeHours,
  computeMedianMergeHours,
  type PullRequestSearchResult,
} from "@/lib/pr-search";

const PAGE_SIZE = 20;

// Shared shape behind prCounts / medianMergeResult / avgOpenAgeResult below:
// fetch once, cache the result, skip while `ready` is false (avgOpenAge
// needs prCounts to resolve first), guard against a response landing after
// unmount/retry, and expose a loading flag. Deliberately not used for the
// pulls list above — that one accumulates pages rather than settling into a
// single result, so it doesn't fit this shape.
function useFetchOnce<T>(
  result: T | null,
  setResult: (v: T) => void,
  setError: (v: string | null) => void,
  ready: boolean,
  retryTick: number,
  fetchFn: () => Promise<T>,
  errorFallback: string,
): boolean {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (result || !ready) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const value = await fetchFn();
        if (cancelled) return;
        setResult(value);
      } catch (err) {
        if (!cancelled) setError(err instanceof GitHubError ? err.message : errorFallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // fetchFn is a fresh closure every render by design (it closes over
    // owner/repo/token/prCounts) — including it here would refetch on every
    // render. `result` going back to null (a new repo) is what actually
    // needs to retrigger this, and that's already covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, ready, retryTick]);

  return loading;
}

export function PullRequestsPanel({
  owner,
  repo,
  token,
}: {
  owner: string;
  repo: string;
  token: string;
}) {
  const {
    pulls,
    setPulls,
    pullsPagesLoaded,
    setPullsPagesLoaded,
    pullsExhausted,
    setPullsExhausted,
    pullsError,
    setPullsError,
    prCounts,
    setPrCounts,
    prCountsError,
    setPrCountsError,
    medianMergeResult,
    setMedianMergeResult,
    medianMergeError,
    setMedianMergeError,
    avgOpenAgeResult,
    setAvgOpenAgeResult,
    avgOpenAgeError,
    setAvgOpenAgeError,
  } = useCachedAnalysisState();

  // Separate retry counters per concern — the pulls list, and the three
  // independent stats fetches (grouped, since they're presented as one
  // card with one retry button). Kept apart so retrying one never cancels
  // an unrelated, healthy in-flight request from the other (e.g. clicking
  // "retry stats" used to also cancel-and-restart an in-progress pulls
  // page fetch, wasting an API call for a retry nobody asked for).
  const [pullsRetryTick, setPullsRetryTick] = useState(0);
  const [statsRetryTick, setStatsRetryTick] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // "Deep search" — local search only ever sees what's been loaded (title +
  // description), so this hands the current query to GitHub's own search
  // index instead, which also covers comments. One real request, only when
  // the user explicitly asks for it — never fired automatically.
  const [deepQuery, setDeepQuery] = useState<string | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [deepResults, setDeepResults] = useState<PullRequestSummary[] | null>(null);
  const [deepTotalCount, setDeepTotalCount] = useState<number | null>(null);
  // Bumped every time the query changes; a deep search captures the epoch it
  // was fired under and checks it again on resolution. Without this, a slow
  // response for an old query could land *after* the user has already typed
  // something else, silently repopulating the section with results that no
  // longer match what's in the search box.
  const deepSearchEpoch = useRef(0);

  const runDeepSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const epoch = deepSearchEpoch.current;
    setDeepLoading(true);
    setDeepError(null);
    try {
      const { items, totalCount } = await searchPullRequestsOnGitHub(owner, repo, q, token);
      if (deepSearchEpoch.current !== epoch) return;
      setDeepResults(items);
      setDeepTotalCount(totalCount);
      setDeepQuery(q);
    } catch (err) {
      if (deepSearchEpoch.current !== epoch) return;
      setDeepError(err instanceof GitHubError ? err.message : "Failed to search GitHub.");
    } finally {
      if (deepSearchEpoch.current === epoch) setDeepLoading(false);
    }
  };

  // A changed query invalidates any previous deep-search results — they're
  // no longer an answer to what's currently in the box. Also clears
  // deepLoading: a request already in flight for the old query has its
  // epoch bumped out from under it, so its own `finally` block will
  // correctly skip touching this state when it lands — nothing else would
  // otherwise flip it back off, leaving the button stuck disabled.
  useEffect(() => {
    deepSearchEpoch.current += 1;
    setDeepResults(null);
    setDeepTotalCount(null);
    setDeepError(null);
    setDeepQuery(null);
    setDeepLoading(false);
  }, [query]);

  const deepSearchResults = useMemo(
    () => (deepResults ? highlightPullRequestMatches(deepResults, deepQuery ?? "") : []),
    [deepResults, deepQuery],
  );

  // Progressive background load: fetch the next page whenever the previous
  // one lands, until exhausted. Resumes from pullsPagesLoaded on remount
  // (e.g. switching back to this tab), never restarts from page 1.
  useEffect(() => {
    if (pullsExhausted) return;
    let cancelled = false;

    (async () => {
      setPullsError(null);
      try {
        const nextPage = pullsPagesLoaded + 1;
        const { items, hasMore } = await fetchPullRequestsPage(owner, repo, nextPage, token);
        if (cancelled) return;
        setPulls((prev) => [...prev, ...items]);
        setPullsPagesLoaded(nextPage);
        if (!hasMore) setPullsExhausted(true);
      } catch (err) {
        if (!cancelled) {
          setPullsError(err instanceof GitHubError ? err.message : "Failed to load pull requests.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    owner,
    repo,
    token,
    pullsPagesLoaded,
    pullsExhausted,
    pullsRetryTick,
    setPulls,
    setPullsPagesLoaded,
    setPullsExhausted,
    setPullsError,
  ]);

  // Exact open/merged/closed counts, fetched once per repo — see
  // fetchPrCounts for why this beats deriving them from the progressively
  // loaded pulls list (those numbers would keep shifting as more pages
  // arrive; these are final the moment they land).
  const prCountsLoading = useFetchOnce(
    prCounts,
    setPrCounts,
    setPrCountsError,
    true,
    statsRetryTick,
    () => fetchPrCounts(owner, repo, token),
    "Failed to load PR counts.",
  );

  // Median merge time — a dedicated sample of actually-merged PRs (see
  // fetchRecentMergedSample), independent of the pulls list used for
  // browsing/search.
  const medianMergeLoading = useFetchOnce(
    medianMergeResult,
    setMedianMergeResult,
    setMedianMergeError,
    true,
    statsRetryTick,
    async () => ({
      hours: computeMedianMergeHours(await fetchRecentMergedSample(owner, repo, token)),
    }),
    "Failed to load merge times.",
  );

  // Average open-PR age — needs the exact open count from prCounts first,
  // to decide whether every open PR fits in one page or a spread sample
  // across the full backlog is needed (see fetchOpenAgeSample). `ready`
  // being true guarantees prCounts is non-null at the point fetchFn runs.
  const avgOpenAgeLoading = useFetchOnce(
    avgOpenAgeResult,
    setAvgOpenAgeResult,
    setAvgOpenAgeError,
    prCounts !== null,
    statsRetryTick,
    async () => {
      const sample = await fetchOpenAgeSample(owner, repo, token, prCounts!.openCount);
      return { hours: computeAvgAgeHours(sample.createdAts), exact: sample.exact };
    },
    "Failed to load open PR ages.",
  );

  const results = useMemo(() => searchPullRequests(pulls, query), [pulls, query]);

  const totalPrCount = prCounts
    ? prCounts.openCount + prCounts.mergedCount + prCounts.closedUnmergedCount
    : null;

  // Reset to page 1 whenever the result set changes shape (new search, more
  // results arriving from the background load).
  useEffect(() => {
    setPage(1);
  }, [query, pulls.length]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageItems = results.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const stillLoading = !pullsExhausted;
  const searching = query.trim().length > 0;

  // Wait for prCounts to actually resolve before deciding whether to show
  // the card at all — deciding early (while it's still null) meant a
  // zero-PR repo would flash the card with spinners and then have it
  // vanish once the real, all-zero count landed. Still show it on error so
  // the retry affordance is reachable. This also guarantees prCounts is
  // always settled (resolved or errored) by the time the card renders at
  // all, so the open-age tile's own loading flag never needs to account
  // for "still waiting on prCounts" separately — that window is never
  // visible to begin with.
  const showStatsStrip = prCountsError !== null || (totalPrCount !== null && totalPrCount > 0);

  return (
    <div className="space-y-4">
      {showStatsStrip ? (
        <PrStatsStrip
          prCounts={prCounts}
          prCountsLoading={prCountsLoading}
          prCountsError={prCountsError}
          medianMergeResult={medianMergeResult}
          medianMergeLoading={medianMergeLoading}
          medianMergeError={medianMergeError}
          avgOpenAgeResult={avgOpenAgeResult}
          avgOpenAgeLoading={avgOpenAgeLoading}
          avgOpenAgeError={avgOpenAgeError}
          onRetry={() => setStatsRetryTick((t) => t + 1)}
        />
      ) : null}

      <div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, #number, author, branch, or label…"
            className="pl-9 pr-9 h-10 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 text-[11px] font-mono text-muted-foreground space-y-0.5">
          <p>
            <span className="text-foreground">is:open</span> ·{" "}
            <span className="text-foreground">is:closed</span> ·{" "}
            <span className="text-foreground">is:merged</span> ·{" "}
            <span className="text-foreground">is:draft</span> ·{" "}
            <span className="text-foreground">author:name</span> ·{" "}
            <span className="text-foreground">label:name</span>
          </p>
          <p>
            combine freely — e.g.{" "}
            <span className="text-foreground">is:open author:torvalds bug</span> — or just search a
            title, #number, or branch
          </p>
        </div>
      </div>

      {pullsError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-destructive">Couldn't load pull requests</div>
            <p className="text-xs text-destructive/90 mt-1 leading-relaxed">{pullsError}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => setPullsRetryTick((t) => t + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {stillLoading ? (
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            {searching
              ? `searching ${formatNumber(pulls.length)} loaded so far — more may match as loading continues`
              : `loading pull requests… ${formatNumber(pulls.length)} loaded so far`}
          </span>
        </div>
      ) : null}

      {!stillLoading && pulls.length === 0 && !pullsError ? (
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8 text-center">
          <p className="text-sm text-muted-foreground">No pull requests in this repository.</p>
        </div>
      ) : null}

      {!stillLoading && results.length === 0 && pulls.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No pull requests match <span className="text-foreground font-mono">{query}</span>.
          </p>
        </div>
      ) : null}

      {pageItems.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
          {pageItems.map((r) => (
            <PullRequestRow key={r.pr.number} result={r} />
          ))}
        </div>
      ) : null}

      {pageCount > 1 ? (
        <PaginationBar page={clampedPage} pageCount={pageCount} onChange={setPage} />
      ) : null}

      {searching ? (
        <DeepSearchSection
          loading={deepLoading}
          error={deepError}
          results={deepResults ? deepSearchResults : null}
          totalCount={deepTotalCount}
          onSearch={() => void runDeepSearch()}
        />
      ) : null}
    </div>
  );
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function PrStatsStrip({
  prCounts,
  prCountsLoading,
  prCountsError,
  medianMergeResult,
  medianMergeLoading,
  medianMergeError,
  avgOpenAgeResult,
  avgOpenAgeLoading,
  avgOpenAgeError,
  onRetry,
}: {
  prCounts: PrCounts | null;
  prCountsLoading: boolean;
  prCountsError: string | null;
  medianMergeResult: { hours: number | null } | null;
  medianMergeLoading: boolean;
  medianMergeError: string | null;
  avgOpenAgeResult: { hours: number | null; exact: boolean } | null;
  avgOpenAgeLoading: boolean;
  avgOpenAgeError: string | null;
  onRetry: () => void;
}) {
  // Merge rate is exact and all-time, derived from the same search counts
  // as "open now" — not from whatever's progressively loaded.
  const decidedCount = prCounts ? prCounts.mergedCount + prCounts.closedUnmergedCount : 0;
  const mergeRatePct =
    prCounts && decidedCount > 0 ? (prCounts.mergedCount / decidedCount) * 100 : null;

  const anyError = prCountsError ?? medianMergeError ?? avgOpenAgeError;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[color:var(--color-terminal-cyan)]" />
          <span className="text-[11px] font-mono text-muted-foreground">pr velocity</span>
        </div>
        {anyError ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] font-mono text-destructive hover:underline"
          >
            couldn't load some stats — retry
          </button>
        ) : null}
      </div>
      <div className="p-5 sm:p-6 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
        <StatTile
          label="Open now"
          loading={prCountsLoading}
          value={prCounts ? formatNumber(prCounts.openCount) : "—"}
        />
        <StatTile
          label="Merge rate"
          loading={prCountsLoading}
          value={mergeRatePct !== null ? `${mergeRatePct.toFixed(0)}%` : "—"}
        />
        <StatTile
          label="Median time to merge"
          loading={medianMergeLoading}
          value={medianMergeResult?.hours != null ? formatDuration(medianMergeResult.hours) : "—"}
        />
        <StatTile
          label="Avg. age (open)"
          loading={avgOpenAgeLoading}
          value={avgOpenAgeResult?.hours != null ? formatDuration(avgOpenAgeResult.hours) : "—"}
        />
      </div>
      <div className="px-5 pb-4 sm:px-6 -mt-2 space-y-0.5 text-[10.5px] font-mono text-muted-foreground">
        <div>median merge time reflects the most recently merged PRs</div>
        {avgOpenAgeResult && !avgOpenAgeResult.exact && prCounts ? (
          <div>
            avg. open age is estimated from a spread sample across all{" "}
            {formatNumber(prCounts.openCount)} open PRs
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatTile({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight truncate">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : value}
      </div>
    </div>
  );
}

function DeepSearchSection({
  loading,
  error,
  results,
  totalCount,
  onSearch,
}: {
  loading: boolean;
  error: string | null;
  results: PullRequestSearchResult[] | null;
  totalCount: number | null;
  onSearch: () => void;
}) {
  if (results) {
    return (
      <div className="pt-2 space-y-3 border-t border-border/60">
        <p className="text-[11px] font-mono text-muted-foreground">
          <Telescope className="h-3 w-3 inline -mt-0.5 mr-1" />
          found {formatNumber(totalCount ?? results.length)} in GitHub's full search (title,
          description, and comments)
          {totalCount !== null && totalCount > results.length
            ? ` — showing the top ${formatNumber(results.length)}`
            : ""}
        </p>
        {results.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 sm:p-8 text-center">
            <p className="text-sm text-muted-foreground">Nothing on GitHub either.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
            {results.map((r) => (
              <PullRequestRow key={r.pr.number} result={r} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-border/60">
      {error ? (
        <p className="text-xs text-destructive mb-2">{error}</p>
      ) : (
        <p className="text-[11px] font-mono text-muted-foreground mb-2">
          local search only sees titles and descriptions already loaded — GitHub's own search also
          reaches comments
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={onSearch}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Telescope className="h-3.5 w-3.5 mr-1.5" />
        )}
        Search all PR history on GitHub
      </Button>
    </div>
  );
}

function PullRequestRow({ result }: { result: PullRequestSearchResult }) {
  const { pr, titleMatch, bodySnippet } = result;

  const status = pr.draft
    ? { icon: GitPullRequestDraft, label: "draft", accent: "text-muted-foreground" }
    : pr.merged
      ? { icon: GitMerge, label: "merged", accent: "text-[color:var(--color-terminal-cyan)]" }
      : pr.state === "open"
        ? {
            icon: GitPullRequest,
            label: "open",
            accent: "text-[color:var(--color-terminal-green)]",
          }
        : { icon: GitPullRequestClosed, label: "closed", accent: "text-destructive" };
  const StatusIcon = status.icon;

  const timeLabel = pr.merged_at
    ? `merged ${formatDistanceToNowStrict(new Date(pr.merged_at))} ago`
    : pr.closed_at
      ? `closed ${formatDistanceToNowStrict(new Date(pr.closed_at))} ago`
      : `opened ${formatDistanceToNowStrict(new Date(pr.created_at))} ago`;

  return (
    <a
      href={pr.html_url}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex items-start gap-3 px-4 py-3 hover:bg-accent transition-colors"
    >
      <StatusIcon className={"h-4 w-4 mt-0.5 shrink-0 " + status.accent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <span className="text-sm text-foreground truncate">
            {titleMatch ? (
              <>
                {pr.title.slice(0, titleMatch.start)}
                <mark className="bg-[color:var(--color-terminal-amber)]/30 text-foreground rounded-sm">
                  {pr.title.slice(titleMatch.start, titleMatch.end)}
                </mark>
                {pr.title.slice(titleMatch.end)}
              </>
            ) : (
              pr.title
            )}
          </span>
          <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-muted-foreground">
          <span>#{pr.number}</span>
          <span>·</span>
          <span className={status.accent}>{status.label}</span>
          <span>·</span>
          {pr.user ? (
            <span className="inline-flex items-center gap-1">
              <img
                src={pr.user.avatar_url}
                alt={pr.user.login}
                className="h-3.5 w-3.5 rounded-full"
              />
              {pr.user.login}
            </span>
          ) : null}
          <span>·</span>
          <span>{timeLabel}</span>
          {pr.labels.length > 0 ? (
            <>
              <span>·</span>
              <span className="flex flex-wrap gap-1">
                {pr.labels.slice(0, 4).map((l) => (
                  <span
                    key={l.name}
                    className="px-1.5 py-0.5 rounded border border-border text-[10px]"
                  >
                    {l.name}
                  </span>
                ))}
              </span>
            </>
          ) : null}
        </div>
        {bodySnippet ? (
          <p className="mt-1 text-[11px] text-muted-foreground/80 italic truncate">
            {bodySnippet.truncatedStart ? "…" : ""}
            {bodySnippet.text.slice(0, bodySnippet.matchStart)}
            <mark className="bg-[color:var(--color-terminal-amber)]/30 text-foreground not-italic rounded-sm">
              {bodySnippet.text.slice(bodySnippet.matchStart, bodySnippet.matchEnd)}
            </mark>
            {bodySnippet.text.slice(bodySnippet.matchEnd)}
            {bodySnippet.truncatedEnd ? "…" : ""}
          </p>
        ) : null}
      </div>
    </a>
  );
}

function PaginationBar({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  const pages = paginationRange(page, pageCount);

  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="px-2 text-xs text-muted-foreground font-mono">
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "outline" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0 text-xs font-mono"
            onClick={() => onChange(p)}
          >
            {p}
          </Button>
        ),
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Classic condensed page-number strip: 1 … 4 5 [6] 7 8 … 42
function paginationRange(current: number, total: number): (number | "…")[] {
  const delta = 1;
  const range: (number | "…")[] = [];
  const start = Math.max(2, current - delta);
  const end = Math.min(total - 1, current + delta);

  range.push(1);
  if (start > 2) range.push("…");
  for (let i = start; i <= end; i++) range.push(i);
  if (end < total - 1) range.push("…");
  if (total > 1) range.push(total);

  return range;
}
