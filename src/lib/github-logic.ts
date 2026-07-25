// Pure logic — GitHub API + file counting. Mirrors the Python implementation.

export const CODE_EXTENSIONS = new Set([
  "py","js","ts","jsx","tsx","java","kt","kts","c","h","cc","cpp","cxx","hpp","hh",
  "cs","go","rs","swift","m","mm","php","rb","r","lua","pl","pm","scala","groovy",
  "dart","cr","html","css","scss","sass","less","sh","bash","zsh","ps1","sql","tf","hcl",
]);

export const CONFIG_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "xml"]);

export const SPECIAL_CODE_BASENAMES = new Set([
  "Makefile","Dockerfile","CMakeLists.txt","BUILD","WORKSPACE",
]);

export interface ParsedRepo { owner: string; repo: string }

export function parseRepoInput(input: string): ParsedRepo | null {
  const s = input.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
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
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export class GitHubError extends Error {
  constructor(message: string, public status?: number) {
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
function recordRateLimitHeaders(res: Response, url: string) {
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return;
  const used = res.headers.get("x-ratelimit-used");
  const snapshot: RateLimitHeaderSnapshot = {
    limit: Number(limit),
    remaining: Number(remaining),
    used: used !== null ? Number(used) : Number(limit) - Number(remaining),
    reset: Number(reset),
    resource: res.headers.get("x-ratelimit-resource"),
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
  if (res.status === 401) throw new GitHubError("Your GitHub token is invalid or expired. Please sign in again.", 401);
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") throw new GitHubError("GitHub API rate limit reached. Try again in a few minutes.", 403);
    throw new GitHubError("Access denied by GitHub. The repository may be private or restricted.", 403);
  }
  if (res.status === 404) throw new GitHubError("Repository not found. Check the URL and try again.", 404);
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status}).`, res.status);
  return (await res.json()) as T;
}

export async function fetchRepoMeta(owner: string, repo: string, token: string): Promise<RepoMeta> {
  return ghFetch<RepoMeta>(`https://api.github.com/repos/${owner}/${repo}`, token);
}

export async function fetchBranchSha(owner: string, repo: string, branch: string, token: string): Promise<string> {
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

export async function fetchRecursiveTree(owner: string, repo: string, sha: string, token: string): Promise<TreeResult> {
  return ghFetch<TreeResult>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    token,
  );
}

export interface CountOptions {
  includeDotfiles: boolean;
  configAsCode: boolean;
}

export interface ExtensionRow { ext: string; count: number; percentage: number }
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

export interface GitHubUser { login: string; avatar_url: string; name?: string | null }

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
    return head + rows.map((r) => `| \`${r.ext}\` | ${formatNumber(r.count)} | ${formatPct(r.percentage)} |`).join("\n") + "\n";
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