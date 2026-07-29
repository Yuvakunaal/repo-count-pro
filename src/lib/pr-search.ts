// Client-side PR search — no network calls, runs against whatever's already
// loaded. Supports a few GitHub-style qualifiers (is:open/closed/merged/draft,
// author:name, label:name) plus fuzzy free-text matching across the title,
// description, PR number, author, branch names, and labels, ranked by match
// quality.
import type { PullRequestSummary } from "./github-logic";

export interface BodySnippet {
  text: string;
  matchStart: number;
  matchEnd: number;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface PullRequestSearchResult {
  pr: PullRequestSummary;
  score: number;
  titleMatch: { start: number; end: number } | null;
  bodySnippet: BodySnippet | null;
}

type StateQualifier = "open" | "closed" | "merged" | "draft";
const STATE_QUALIFIERS: readonly StateQualifier[] = ["open", "closed", "merged", "draft"];

function prStates(pr: PullRequestSummary): Set<StateQualifier> {
  const s = new Set<StateQualifier>();
  if (pr.draft) s.add("draft");
  if (pr.merged) s.add("merged");
  s.add(pr.state);
  return s;
}

interface ParsedQuery {
  is: StateQualifier[];
  author: string[];
  label: string[];
  freeText: string;
}

function parseQuery(query: string): ParsedQuery {
  const is: StateQualifier[] = [];
  const author: string[] = [];
  const label: string[] = [];
  const rest: string[] = [];

  const tokens = query.match(/"[^"]*"|\S+/g) ?? [];
  for (const token of tokens) {
    const m = token.match(/^(is|author|label):(.+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const value = m[2].replace(/^"|"$/g, "").toLowerCase();
      if (key === "is" && (STATE_QUALIFIERS as string[]).includes(value)) {
        is.push(value as StateQualifier);
      } else if (key === "author" && value) {
        author.push(value);
      } else if (key === "label" && value) {
        label.push(value);
      }
      continue;
    }
    rest.push(token.replace(/^"|"$/g, ""));
  }

  return { is, author, label, freeText: rest.join(" ").trim() };
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

const SNIPPET_CONTEXT = 50;

// Collapse markdown noise and *any* run of whitespace — spaces, tabs, real
// newlines — down to a single space. This matters beyond tidiness: a single-
// line <input> can't hold line breaks, so pasting multi-line text (e.g. a
// code block copied from a PR description) strips the newlines but keeps
// each line's original indentation, leaving irregular multi-space gaps where
// the line breaks used to be. The PR body still has real newlines and normal
// indentation. Two representations of identical content, different bytes —
// a literal indexOf between them fails even on an exact quote. Normalizing
// whitespace on both the query and the body before comparing (below) is what
// makes pasted multi-line snippets actually findable.
const normalizeForSearch = (s: string) =>
  s
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Builds a short, highlighted excerpt around the match — like a search-engine
// result snippet — so the user can see *why* a description-only match fired
// instead of just trusting a hidden "matched somewhere in the body" claim.
// Operates directly on the already-normalized body text (see
// normalizeForSearch), so the returned offsets need no further translation.
function makeSnippet(normalizedBody: string, idx: number, len: number): BodySnippet {
  const start = Math.max(0, idx - SNIPPET_CONTEXT);
  const end = Math.min(normalizedBody.length, idx + len + SNIPPET_CONTEXT);

  return {
    text: normalizedBody.slice(start, end),
    matchStart: idx - start,
    matchEnd: idx - start + len,
    truncatedStart: start > 0,
    truncatedEnd: end < normalizedBody.length,
  };
}

function scoreFreeText(
  pr: PullRequestSummary,
  q: string,
): {
  score: number;
  titleMatch: { start: number; end: number } | null;
  bodySnippet: BodySnippet | null;
} {
  const numberMatch = q.match(/^#?(\d+)$/);
  if (numberMatch && pr.number === Number(numberMatch[1])) {
    return { score: 1000, titleMatch: null, bodySnippet: null };
  }

  const title = pr.title.toLowerCase();
  const author = pr.user?.login.toLowerCase() ?? "";
  const branches = `${pr.head.ref} ${pr.base.ref}`.toLowerCase();
  const labels = pr.labels.map((l) => l.name.toLowerCase());

  if (title === q) {
    return { score: 900, titleMatch: { start: 0, end: pr.title.length }, bodySnippet: null };
  }
  if (title.startsWith(q)) {
    return { score: 800, titleMatch: { start: 0, end: q.length }, bodySnippet: null };
  }

  const titleIdx = title.indexOf(q);
  if (titleIdx !== -1) {
    return {
      score: 700,
      titleMatch: { start: titleIdx, end: titleIdx + q.length },
      bodySnippet: null,
    };
  }

  if (author === q) return { score: 650, titleMatch: null, bodySnippet: null };
  if (labels.includes(q)) return { score: 600, titleMatch: null, bodySnippet: null };
  if (author.includes(q)) return { score: 550, titleMatch: null, bodySnippet: null };
  if (branches.includes(q)) return { score: 500, titleMatch: null, bodySnippet: null };
  if (labels.some((l) => l.includes(q))) {
    return { score: 450, titleMatch: null, bodySnippet: null };
  }

  // Description text — free (already loaded with every PR), no extra request.
  // Both sides go through normalizeForSearch (see its comment for why: a
  // pasted multi-line code block and the body's real multi-line formatting
  // are different byte-for-byte even when the content is identical). Search
  // on a lowercased copy but build the snippet from the original-case one —
  // toLowerCase() preserves per-character length here, so the index lines up
  // on both, and the displayed excerpt keeps real capitalization.
  if (pr.body) {
    const bodyNormalized = normalizeForSearch(pr.body);
    const qNormalized = normalizeForSearch(q);
    const bodyIdx = qNormalized ? bodyNormalized.toLowerCase().indexOf(qNormalized) : -1;
    if (bodyIdx !== -1) {
      return {
        score: 400,
        titleMatch: null,
        bodySnippet: makeSnippet(bodyNormalized, bodyIdx, qNormalized.length),
      };
    }
  }

  const words = q.split(/\s+/).filter(Boolean);
  const titleWords = title.split(/\s+/);
  const overlap = words.filter((w) => titleWords.some((tw) => tw.includes(w))).length;
  if (overlap > 0) {
    return { score: 300 + overlap * 20, titleMatch: null, bodySnippet: null };
  }

  if (isSubsequence(q, title)) return { score: 100, titleMatch: null, bodySnippet: null };

  return { score: -1, titleMatch: null, bodySnippet: null };
}

// For results GitHub's own search already found (which can include matches
// inside comments we never fetch) — adds title/body highlighting where we
// happen to be able to see the match ourselves, but never drops an item.
// Unlike searchPullRequests, absence of a local match is not evidence of
// absence: GitHub already confirmed this result, just via text we don't have.
export function highlightPullRequestMatches(
  pulls: PullRequestSummary[],
  query: string,
): PullRequestSearchResult[] {
  const { freeText } = parseQuery(query.trim());
  const q = freeText.toLowerCase();
  if (!q) return pulls.map((pr) => ({ pr, score: 0, titleMatch: null, bodySnippet: null }));

  return pulls.map((pr) => {
    const { titleMatch, bodySnippet } = scoreFreeText(pr, q);
    return { pr, score: 0, titleMatch, bodySnippet };
  });
}

export function searchPullRequests(
  pulls: PullRequestSummary[],
  query: string,
): PullRequestSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return pulls.map((pr) => ({ pr, score: 0, titleMatch: null, bodySnippet: null }));
  }

  const { is, author, label, freeText } = parseQuery(trimmed);
  const q = freeText.toLowerCase();

  const results: PullRequestSearchResult[] = [];
  for (const pr of pulls) {
    if (is.length) {
      const states = prStates(pr);
      if (!is.some((want) => states.has(want))) continue;
    }
    if (author.length) {
      const login = pr.user?.login.toLowerCase() ?? "";
      if (!author.includes(login)) continue;
    }
    if (label.length) {
      const prLabels = pr.labels.map((l) => l.name.toLowerCase());
      if (!label.some((l) => prLabels.includes(l))) continue;
    }

    if (!q) {
      results.push({ pr, score: 0, titleMatch: null, bodySnippet: null });
      continue;
    }
    const { score, titleMatch, bodySnippet } = scoreFreeText(pr, q);
    if (score < 0) continue;
    results.push({ pr, score, titleMatch, bodySnippet });
  }

  // Array.prototype.sort is stable (ES2019+), so equal scores keep their
  // original newest-first relative order.
  return results.sort((a, b) => b.score - a.score);
}

export interface PrStats {
  medianMergeHours: number | null;
  mergeRatePct: number | null;
  openCount: number;
  avgOpenAgeHours: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const hoursBetween = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

// Every input here (created_at/merged_at/closed_at/state) is already on
// PullRequestSummary — nothing extra to fetch. Recomputes on every call, so
// it stays live as more pages arrive from the progressive PR load.
export function computePrStats(pulls: PullRequestSummary[]): PrStats {
  const mergeDurations = pulls
    .filter((p) => p.merged && p.merged_at)
    .map((p) => hoursBetween(p.created_at, p.merged_at as string));

  const closedUnmerged = pulls.filter((p) => p.state === "closed" && !p.merged).length;
  const mergedCount = mergeDurations.length;
  const decidedCount = mergedCount + closedUnmerged;

  const openPulls = pulls.filter((p) => p.state === "open");
  const now = new Date().toISOString();
  const openAges = openPulls.map((p) => hoursBetween(p.created_at, now));

  return {
    medianMergeHours: median(mergeDurations),
    mergeRatePct: decidedCount > 0 ? (mergedCount / decidedCount) * 100 : null,
    openCount: openPulls.length,
    avgOpenAgeHours:
      openAges.length > 0 ? openAges.reduce((a, b) => a + b, 0) / openAges.length : null,
  };
}
