// Pure logic — GitHub API + file counting. Mirrors the Python implementation.

export const CODE_EXTENSIONS = new Set([
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "cs",
  "go",
  "rs",
  "swift",
  "m",
  "mm",
  "php",
  "rb",
  "r",
  "lua",
  "pl",
  "pm",
  "scala",
  "groovy",
  "dart",
  "cr",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "sql",
  "tf",
  "hcl",
]);

export const CONFIG_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "xml"]);

export const SPECIAL_CODE_BASENAMES = new Set([
  "Makefile",
  "Dockerfile",
  "CMakeLists.txt",
  "BUILD",
  "WORKSPACE",
]);

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export function parseRepoInput(input: string): ParsedRepo | null {
  const s = input
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  if (!s) return null;
  // URL form
  const urlMatch = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  // owner/repo
  const shortMatch = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface RepoMeta {
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  license: { name: string } | null;
  topics: string[];
  pushed_at: string;
  homepage: string | null;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface RateLimitHeaderSnapshot {
  limit: number;
  remaining: number;
  used: number;
  reset: number;
  resource: string | null;
  status: number;
  url: string;
  seenAt: number;
}

const LAST_HEADERS_KEY = "rfc.last_ratelimit_headers";

// Every GitHub API response — not just a dedicated /rate_limit check — carries
// x-ratelimit-* headers reflecting the state as of that exact request. Recording
// these lets /usage compare "what the real analyze calls reported" against a
// standalone check, which is the most direct way to catch any discrepancy.
//
// GitHub tracks several *independent* rate-limit buckets (core: 5,000/hour,
// search: 30/min signed-in, graphql, etc.) — a request against one says
// nothing about the others. /usage exists to show the "core" budget that the
// rest of this app actually spends (tree/PR fetches), so only core responses
// update the tracked snapshot; anything else (e.g. the Search API used by
// "search all PR history on GitHub") is deliberately ignored here rather
// than clobbering /usage with a different bucket's much smaller numbers.
function recordRateLimitHeaders(res: Response, url: string) {
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const resource = res.headers.get("x-ratelimit-resource");
  if (limit === null || remaining === null || reset === null) return;
  if (resource !== "core") return;
  const used = res.headers.get("x-ratelimit-used");
  const snapshot: RateLimitHeaderSnapshot = {
    limit: Number(limit),
    remaining: Number(remaining),
    used: used !== null ? Number(used) : Number(limit) - Number(remaining),
    reset: Number(reset),
    resource,
    status: res.status,
    url,
    seenAt: Date.now(),
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LAST_HEADERS_KEY, JSON.stringify(snapshot));
    } catch {
      /* noop */
    }
  }
}

export function getLastSeenRateLimit(): RateLimitHeaderSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_HEADERS_KEY);
    return raw ? (JSON.parse(raw) as RateLimitHeaderSnapshot) : null;
  } catch {
    return null;
  }
}

async function ghFetch<T>(url: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(token), cache: "no-store" });
  } catch {
    throw new GitHubError("Network error contacting GitHub. Check your connection and try again.");
  }
  recordRateLimitHeaders(res, url);
  if (res.status === 401)
    throw new GitHubError("Your GitHub token is invalid or expired. Please sign in again.", 401);
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0")
      throw new GitHubError("GitHub API rate limit reached. Try again in a few minutes.", 403);
    throw new GitHubError(
      "Access denied by GitHub. The repository may be private or restricted.",
      403,
    );
  }
  if (res.status === 404)
    throw new GitHubError("Repository not found. Check the URL and try again.", 404);
  // 429 is GitHub's *secondary* rate limit (too many requests too quickly,
  // separate from the primary hourly quota already handled above via 403) —
  // it carries a Retry-After header telling us exactly how long to wait, so
  // surface that instead of a bare status code.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    const wait = retryAfter ? ` Try again in ${retryAfter}s.` : " Try again in a moment.";
    throw new GitHubError(`GitHub is briefly rate-limiting these requests.${wait}`, 429);
  }
  // 422 is a validation error — GitHub rejected the request itself (e.g. a
  // search query over its length limit, reachable here by pasting a very
  // long snippet into search). The response body's message says why.
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ? `: ${body.message}` : ".";
    throw new GitHubError(`GitHub couldn't process that request${detail}`, 422);
  }
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status}).`, res.status);
  return (await res.json()) as T;
}

export async function fetchRepoMeta(owner: string, repo: string, token: string): Promise<RepoMeta> {
  return ghFetch<RepoMeta>(`https://api.github.com/repos/${owner}/${repo}`, token);
}

export async function fetchBranchSha(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string> {
  const b = await ghFetch<{ commit: { sha: string } }>(
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    token,
  );
  return b.commit.sha;
}

export interface TreeResult {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

export async function fetchRecursiveTree(
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<TreeResult> {
  return ghFetch<TreeResult>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    token,
  );
}

export interface PullRequestSummary {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  user: { login: string; avatar_url: string } | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  labels: { name: string; color: string }[];
  head: { ref: string };
  base: { ref: string };
}

const PULL_REQUESTS_PAGE_SIZE = 100;

// GitHub's /pulls list doesn't expose a "merged" flag directly (only
// /pulls/{number} does) — but a closed PR with merged_at set is merged, and
// this holds for every item this endpoint returns.
export async function fetchPullRequestsPage(
  owner: string,
  repo: string,
  page: number,
  token: string,
): Promise<{ items: PullRequestSummary[]; hasMore: boolean }> {
  const raw = await ghFetch<Omit<PullRequestSummary, "merged">[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${PULL_REQUESTS_PAGE_SIZE}&page=${page}`,
    token,
  );
  const items = raw.map((pr) => ({ ...pr, merged: pr.state === "closed" && !!pr.merged_at }));
  return { items, hasMore: items.length === PULL_REQUESTS_PAGE_SIZE };
}

// Local search only ever sees title + description, because that's all the
// list endpoint returns — it can't see review/conversation comments (e.g. a
// bot quoting a diff back in a review comment). Fetching comments for every
// loaded PR to close that gap would mean 1-2 extra requests *per PR*, which
// defeats the whole point of the progressive-load design on large repos.
// GitHub's own search index already covers title + body + comments in one
// request, so this hands off to that instead of trying to replicate it
// locally — same qualifier syntax (is:/author:/label:) works here too.
export async function searchPullRequestsOnGitHub(
  owner: string,
  repo: string,
  query: string,
  token: string,
): Promise<{ items: PullRequestSummary[]; totalCount: number }> {
  const q = encodeURIComponent(`repo:${owner}/${repo} is:pr ${query}`);
  const data = await ghFetch<{
    total_count: number;
    items: Array<{
      number: number;
      title: string;
      body: string | null;
      state: "open" | "closed";
      draft: boolean;
      user: { login: string; avatar_url: string } | null;
      html_url: string;
      created_at: string;
      updated_at: string;
      closed_at: string | null;
      labels: { name: string; color: string }[];
      pull_request?: { merged_at: string | null };
    }>;
  }>(`https://api.github.com/search/issues?q=${q}&per_page=25`, token);

  const items: PullRequestSummary[] = data.items.map((it) => ({
    number: it.number,
    title: it.title,
    body: it.body,
    state: it.state,
    merged: !!it.pull_request?.merged_at,
    draft: it.draft,
    user: it.user,
    html_url: it.html_url,
    created_at: it.created_at,
    updated_at: it.updated_at,
    closed_at: it.closed_at,
    merged_at: it.pull_request?.merged_at ?? null,
    labels: it.labels,
    head: { ref: "" },
    base: { ref: "" },
  }));

  return { items, totalCount: data.total_count };
}

export interface PrCounts {
  openCount: number;
  mergedCount: number;
  closedUnmergedCount: number;
}

// Search's total_count is computed server-side across the repo's *entire*
// history and returned even with per_page=1 — exact and instant, unlike
// paginating every PR locally just to count them. Three lightweight calls,
// no PR bodies fetched, so this stays cheap even for repos with thousands
// of PRs, and the numbers never shift as more pages load elsewhere.
//
// Note: `is:unmerged` alone also matches *open* PRs (they're not merged
// yet either) — confirmed against a live repo where is:open + is:merged +
// is:unmerged overcounted the true total by exactly the open count. The
// correct query for "closed but never merged" is is:closed+is:unmerged
// together.
export async function fetchPrCounts(owner: string, repo: string, token: string): Promise<PrCounts> {
  const buildQuery = (extra: string) => encodeURIComponent(`repo:${owner}/${repo} is:pr ${extra}`);
  const search = (extra: string) =>
    ghFetch<{ total_count: number }>(
      `https://api.github.com/search/issues?q=${buildQuery(extra)}&per_page=1`,
      token,
    );

  const [open, merged, closedUnmerged] = await Promise.all([
    search("is:open"),
    search("is:merged"),
    search("is:closed is:unmerged"),
  ]);

  return {
    openCount: open.total_count,
    mergedCount: merged.total_count,
    closedUnmergedCount: closedUnmerged.total_count,
  };
}

const OPEN_AGE_MAX_SAMPLE_PAGES = 5;

// Evenly spread page numbers across [1, totalPages], including both ends.
function pickSamplePages(totalPages: number, max: number): number[] {
  if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (let i = 0; i < max; i++) {
    pages.add(Math.round(1 + (i * (totalPages - 1)) / (max - 1)));
  }
  return [...pages].sort((a, b) => a - b);
}

export interface OpenAgeSample {
  createdAts: string[];
  exact: boolean;
}

// Sampling only the most-recently-*created* open PRs makes old, neglected
// ones structurally invisible — confirmed against microsoft/vscode, whose
// oldest open PR is 10+ years old and could never appear in a "100 most
// recent" window no matter how it's computed. Correctness here means
// spanning the *entire* open backlog, not just its newest slice. With the
// exact open count already known (fetchPrCounts), this fetches every open
// PR if they all fit on one page, or a small, fixed number of pages spread
// evenly from newest to oldest otherwise — capped so cost never grows
// unbounded on repos with thousands of open PRs.
export async function fetchOpenAgeSample(
  owner: string,
  repo: string,
  token: string,
  openCount: number,
): Promise<OpenAgeSample> {
  if (openCount === 0) return { createdAts: [], exact: true };

  const totalPages = Math.ceil(openCount / PULL_REQUESTS_PAGE_SIZE);
  const pages = pickSamplePages(totalPages, OPEN_AGE_MAX_SAMPLE_PAGES);

  const pageResults = await Promise.all(
    pages.map((page) =>
      ghFetch<{ created_at: string }[]>(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&sort=created&direction=desc&per_page=${PULL_REQUESTS_PAGE_SIZE}&page=${page}`,
        token,
      ),
    ),
  );

  return {
    createdAts: pageResults.flat().map((pr) => pr.created_at),
    exact: totalPages <= OPEN_AGE_MAX_SAMPLE_PAGES,
  };
}

export interface MergeDurationPair {
  createdAt: string;
  mergedAt: string;
}

// Deliberately recency-biased, unlike the open-age sample above — "how
// fast is this project merging right now" is a coherent thing to measure
// from recent activity, whereas open-PR age needs the true population
// average. sort=updated (not created) so the sample is dominated by PRs
// that *just* merged, rather than ones that merely happen to be recently
// opened and haven't had time to merge yet (which would bias the sample
// toward faster-than-typical merges).
//
// GitHub has no "sort by merged date" option, so sort=updated is the best
// available proxy — but updated_at also bumps on comments/labels added
// long *after* merge, which would let a stale merge masquerade as recent
// activity. Filtering to PRs whose updated_at lands within minutes of
// merged_at keeps only PRs whose most recent update *was* the merge
// itself, excluding old merges resurfaced by unrelated later activity.
const MERGE_UPDATE_SKEW_MS = 5 * 60 * 1000;

export async function fetchRecentMergedSample(
  owner: string,
  repo: string,
  token: string,
): Promise<MergeDurationPair[]> {
  const raw = await ghFetch<{ created_at: string; updated_at: string; merged_at: string | null }[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${PULL_REQUESTS_PAGE_SIZE}`,
    token,
  );
  return raw
    .filter((pr): pr is { created_at: string; updated_at: string; merged_at: string } => {
      if (!pr.merged_at) return false;
      const skewMs = Math.abs(new Date(pr.updated_at).getTime() - new Date(pr.merged_at).getTime());
      return skewMs <= MERGE_UPDATE_SKEW_MS;
    })
    .map((pr) => ({ createdAt: pr.created_at, mergedAt: pr.merged_at }));
}

export interface CountOptions {
  includeDotfiles: boolean;
  configAsCode: boolean;
}

export interface ExtensionRow {
  ext: string;
  count: number;
  percentage: number;
}
export interface CountResult {
  totalFiles: number;
  codeCount: number;
  nonCodeCount: number;
  code: ExtensionRow[];
  nonCode: ExtensionRow[];
}

function hasHiddenSegment(path: string): boolean {
  return path.split("/").some((seg) => seg.startsWith("."));
}

function classify(path: string): { ext: string; isCode: boolean; isConfig: boolean } {
  const base = path.split("/").pop() ?? path;

  // Dockerfile variants normalize to "Dockerfile"
  if (/^Dockerfile(\..+)?$/i.test(base) || /\.Dockerfile$/i.test(base)) {
    return { ext: "Dockerfile", isCode: true, isConfig: false };
  }
  if (SPECIAL_CODE_BASENAMES.has(base)) {
    return { ext: base, isCode: true, isConfig: false };
  }

  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return { ext: "(no ext)", isCode: false, isConfig: false };
  }
  const ext = base.slice(dot + 1).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return { ext, isCode: true, isConfig: false };
  if (CONFIG_EXTENSIONS.has(ext)) return { ext, isCode: false, isConfig: true };
  return { ext, isCode: false, isConfig: false };
}

export function countFiles(entries: GitTreeEntry[], opts: CountOptions): CountResult {
  const codeMap = new Map<string, number>();
  const nonCodeMap = new Map<string, number>();

  for (const e of entries) {
    if (e.type !== "blob") continue;
    if (!opts.includeDotfiles && hasHiddenSegment(e.path)) continue;

    const { ext, isCode, isConfig } = classify(e.path);
    const treatAsCode = isCode || (isConfig && opts.configAsCode);
    const bucket = treatAsCode ? codeMap : nonCodeMap;
    bucket.set(ext, (bucket.get(ext) ?? 0) + 1);
  }

  const codeCount = [...codeMap.values()].reduce((a, b) => a + b, 0);
  const nonCodeCount = [...nonCodeMap.values()].reduce((a, b) => a + b, 0);
  const totalFiles = codeCount + nonCodeCount;

  const toRows = (m: Map<string, number>, denom: number): ExtensionRow[] =>
    [...m.entries()]
      .map(([ext, count]) => ({ ext, count, percentage: denom > 0 ? (count / denom) * 100 : 0 }))
      .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));

  return {
    totalFiles,
    codeCount,
    nonCodeCount,
    code: toRows(codeMap, totalFiles),
    nonCode: toRows(nonCodeMap, totalFiles),
  };
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name?: string | null;
}

export async function fetchUser(token: string): Promise<GitHubUser> {
  return ghFetch<GitHubUser>("https://api.github.com/user", token);
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  used: number;
  reset: number;
  raw: unknown;
}

// Checking this endpoint does not count against the rate limit itself.
export async function fetchRateLimit(token: string): Promise<RateLimitInfo> {
  const data = await ghFetch<{
    resources: { core: { limit: number; remaining: number; reset: number; used?: number } };
  }>("https://api.github.com/rate_limit", token);
  const core = data.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    reset: core.reset,
    used: core.used ?? core.limit - core.remaining,
    raw: data,
  };
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

export function buildMarkdown(meta: {
  fullName: string;
  branch: string;
  sha: string;
  totalFiles: number;
  codeCount: number;
  nonCodeCount: number;
  code: ExtensionRow[];
  nonCode: ExtensionRow[];
}): string {
  const table = (rows: ExtensionRow[]) => {
    if (!rows.length) return "_None_\n";
    const head = "| Extension | Count | Percentage |\n|---|---:|---:|\n";
    return (
      head +
      rows
        .map((r) => `| \`${r.ext}\` | ${formatNumber(r.count)} | ${formatPct(r.percentage)} |`)
        .join("\n") +
      "\n"
    );
  };
  return [
    `# Repository File Count — ${meta.fullName}`,
    "",
    `- **Repository:** \`${meta.fullName}\``,
    `- **Branch:** \`${meta.branch}\``,
    `- **Commit SHA:** \`${meta.sha}\``,
    `- **Total files:** ${formatNumber(meta.totalFiles)}`,
    `- **Code files:** ${formatNumber(meta.codeCount)}`,
    `- **Non-code files:** ${formatNumber(meta.nonCodeCount)}`,
    "",
    "## Code Files",
    "",
    table(meta.code),
    "## Non-Code Files",
    "",
    table(meta.nonCode),
  ].join("\n");
}
