import { useCallback, useState } from "react";
import type { CountResult, GitTreeEntry, PrCounts, PullRequestSummary } from "./github-logic";

export interface RepoHealth {
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  topics: string[];
  pushedAt: string;
  homepage: string | null;
}

export interface AnalysisResult {
  fullName: string;
  owner: string;
  repo: string;
  htmlUrl: string;
  branch: string;
  sha: string;
  truncated: boolean;
  counts: CountResult;
  health: RepoHealth;
}

export type ResultTab = "files" | "prs";

export interface MedianMergeResult {
  hours: number | null;
}

export interface AvgOpenAgeResult {
  hours: number | null;
  // true when every open PR was actually measured (openCount fit in one
  // page); false when this is a spread sample across a larger backlog.
  exact: boolean;
}

interface AnalysisCache {
  input: string;
  rawTree: GitTreeEntry[] | null;
  result: AnalysisResult | null;
  includeDotfiles: boolean;
  configAsCode: boolean;
  activeTab: ResultTab;
  // Pull requests tab: loaded progressively in the background, so these are
  // cached the same way — a trip to /usage and back (or switching tabs and
  // coming back) shouldn't restart the load from page 1.
  pulls: PullRequestSummary[];
  pullsPagesLoaded: number;
  pullsExhausted: boolean;
  pullsError: string | null;
  // Exact open/merged/closed-unmerged counts from GitHub's search
  // total_count — a separate, one-shot fetch from the progressive pulls
  // list above, so it's cached independently.
  prCounts: PrCounts | null;
  prCountsError: string | null;
  // Duration stats — each from its own dedicated, purpose-sampled fetch
  // (see fetchRecentMergedSample / fetchOpenAgeSample), not derived from
  // the pulls list above.
  medianMergeResult: MedianMergeResult | null;
  medianMergeError: string | null;
  avgOpenAgeResult: AvgOpenAgeResult | null;
  avgOpenAgeError: string | null;
}

// A plain module-level object, not React state — it survives client-side
// route navigation (the module stays loaded, e.g. a trip to /usage and back
// via the header icon) but resets on a hard page reload. Keeps the analyzer's
// results in place unless the user explicitly starts a new analysis or resets,
// without persisting potentially large tree/PR data to browser storage.
const cache: AnalysisCache = {
  input: "",
  rawTree: null,
  result: null,
  includeDotfiles: false,
  configAsCode: true,
  activeTab: "files",
  pulls: [],
  pullsPagesLoaded: 0,
  pullsExhausted: false,
  pullsError: null,
  prCounts: null,
  prCountsError: null,
  medianMergeResult: null,
  medianMergeError: null,
  avgOpenAgeResult: null,
  avgOpenAgeError: null,
};

export function useCachedAnalysisState() {
  const [input, setInputState] = useState(cache.input);
  const [rawTree, setRawTreeState] = useState(cache.rawTree);
  const [result, setResultState] = useState(cache.result);
  const [includeDotfiles, setIncludeDotfilesState] = useState(cache.includeDotfiles);
  const [configAsCode, setConfigAsCodeState] = useState(cache.configAsCode);
  const [activeTab, setActiveTabState] = useState(cache.activeTab);
  const [pulls, setPullsState] = useState(cache.pulls);
  const [pullsPagesLoaded, setPullsPagesLoadedState] = useState(cache.pullsPagesLoaded);
  const [pullsExhausted, setPullsExhaustedState] = useState(cache.pullsExhausted);
  const [pullsError, setPullsErrorState] = useState(cache.pullsError);
  const [prCounts, setPrCountsState] = useState(cache.prCounts);
  const [prCountsError, setPrCountsErrorState] = useState(cache.prCountsError);
  const [medianMergeResult, setMedianMergeResultState] = useState(cache.medianMergeResult);
  const [medianMergeError, setMedianMergeErrorState] = useState(cache.medianMergeError);
  const [avgOpenAgeResult, setAvgOpenAgeResultState] = useState(cache.avgOpenAgeResult);
  const [avgOpenAgeError, setAvgOpenAgeErrorState] = useState(cache.avgOpenAgeError);

  const setInput = useCallback((value: string) => {
    cache.input = value;
    setInputState(value);
  }, []);

  const setRawTree = useCallback((value: GitTreeEntry[] | null) => {
    cache.rawTree = value;
    setRawTreeState(value);
  }, []);

  const setResult = useCallback(
    (value: AnalysisResult | null | ((prev: AnalysisResult | null) => AnalysisResult | null)) => {
      setResultState((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        cache.result = next;
        return next;
      });
    },
    [],
  );

  const setIncludeDotfiles = useCallback((value: boolean) => {
    cache.includeDotfiles = value;
    setIncludeDotfilesState(value);
  }, []);

  const setConfigAsCode = useCallback((value: boolean) => {
    cache.configAsCode = value;
    setConfigAsCodeState(value);
  }, []);

  const setActiveTab = useCallback((value: ResultTab) => {
    cache.activeTab = value;
    setActiveTabState(value);
  }, []);

  const setPulls = useCallback(
    (value: PullRequestSummary[] | ((prev: PullRequestSummary[]) => PullRequestSummary[])) => {
      setPullsState((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        cache.pulls = next;
        return next;
      });
    },
    [],
  );

  const setPullsPagesLoaded = useCallback((value: number) => {
    cache.pullsPagesLoaded = value;
    setPullsPagesLoadedState(value);
  }, []);

  const setPullsExhausted = useCallback((value: boolean) => {
    cache.pullsExhausted = value;
    setPullsExhaustedState(value);
  }, []);

  const setPullsError = useCallback((value: string | null) => {
    cache.pullsError = value;
    setPullsErrorState(value);
  }, []);

  const setPrCounts = useCallback((value: PrCounts | null) => {
    cache.prCounts = value;
    setPrCountsState(value);
  }, []);

  const setPrCountsError = useCallback((value: string | null) => {
    cache.prCountsError = value;
    setPrCountsErrorState(value);
  }, []);

  const setMedianMergeResult = useCallback((value: MedianMergeResult | null) => {
    cache.medianMergeResult = value;
    setMedianMergeResultState(value);
  }, []);

  const setMedianMergeError = useCallback((value: string | null) => {
    cache.medianMergeError = value;
    setMedianMergeErrorState(value);
  }, []);

  const setAvgOpenAgeResult = useCallback((value: AvgOpenAgeResult | null) => {
    cache.avgOpenAgeResult = value;
    setAvgOpenAgeResultState(value);
  }, []);

  const setAvgOpenAgeError = useCallback((value: string | null) => {
    cache.avgOpenAgeError = value;
    setAvgOpenAgeErrorState(value);
  }, []);

  const resetPulls = useCallback(() => {
    setPulls([]);
    setPullsPagesLoaded(0);
    setPullsExhausted(false);
    setPullsError(null);
    setPrCounts(null);
    setPrCountsError(null);
    setMedianMergeResult(null);
    setMedianMergeError(null);
    setAvgOpenAgeResult(null);
    setAvgOpenAgeError(null);
  }, [
    setPulls,
    setPullsPagesLoaded,
    setPullsExhausted,
    setPullsError,
    setPrCounts,
    setPrCountsError,
    setMedianMergeResult,
    setMedianMergeError,
    setAvgOpenAgeResult,
    setAvgOpenAgeError,
  ]);

  return {
    input,
    setInput,
    rawTree,
    setRawTree,
    result,
    setResult,
    includeDotfiles,
    setIncludeDotfiles,
    configAsCode,
    setConfigAsCode,
    activeTab,
    setActiveTab,
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
    resetPulls,
  };
}
