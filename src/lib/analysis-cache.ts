import { useCallback, useState } from "react";
import type { CountResult, GitTreeEntry, PullRequestSummary } from "./github-logic";

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

  const resetPulls = useCallback(() => {
    setPulls([]);
    setPullsPagesLoaded(0);
    setPullsExhausted(false);
    setPullsError(null);
  }, [setPulls, setPullsPagesLoaded, setPullsExhausted, setPullsError]);

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
    resetPulls,
  };
}
