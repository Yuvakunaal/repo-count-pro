import { useCallback, useState } from "react";
import type { CountResult, GitTreeEntry } from "./github-logic";

export interface AnalysisResult {
  fullName: string;
  htmlUrl: string;
  branch: string;
  sha: string;
  truncated: boolean;
  counts: CountResult;
}

interface AnalysisCache {
  input: string;
  rawTree: GitTreeEntry[] | null;
  result: AnalysisResult | null;
  includeDotfiles: boolean;
  configAsCode: boolean;
}

// A plain module-level object, not React state — it survives client-side
// route navigation (the module stays loaded, e.g. a trip to /usage and back
// via the header icon) but resets on a hard page reload. Keeps the analyzer's
// results in place unless the user explicitly starts a new analysis or resets,
// without persisting potentially large tree data to browser storage.
const cache: AnalysisCache = {
  input: "",
  rawTree: null,
  result: null,
  includeDotfiles: false,
  configAsCode: true,
};

export function useCachedAnalysisState() {
  const [input, setInputState] = useState(cache.input);
  const [rawTree, setRawTreeState] = useState(cache.rawTree);
  const [result, setResultState] = useState(cache.result);
  const [includeDotfiles, setIncludeDotfilesState] = useState(cache.includeDotfiles);
  const [configAsCode, setConfigAsCodeState] = useState(cache.configAsCode);

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
  };
}
