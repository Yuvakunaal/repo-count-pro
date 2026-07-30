import { useEffect, useState, useCallback } from "react";
import { fetchUser, type GitHubUser, GitHubError } from "./github-logic";

const TOKEN_KEY = "rfc.github.token";
const USER_KEY = "rfc.github.user";

export interface AuthState {
  token: string | null;
  user: GitHubUser | null;
  loading: boolean;
  error: string | null;
}

export function useGitHubAuth() {
  // Starts as "signed out", not "loading": the server never has access to
  // localStorage, so it can only ever render the signed-out view anyway.
  // Starting the client at the same value keeps the first hydration pass
  // identical to the SSR output (no mismatch) — real content ships in the
  // initial HTML instead of a bare spinner. The effect below still swaps in
  // an already-authenticated session right after mount.
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const uRaw = typeof window !== "undefined" ? localStorage.getItem(USER_KEY) : null;
    if (t && uRaw) {
      try {
        setState({ token: t, user: JSON.parse(uRaw) as GitHubUser, loading: false, error: null });
        return;
      } catch {
        /* fallthrough */
      }
    }
    setState((s) => ({ ...s, loading: false }));
  }, []);

  const signIn = useCallback(async (token: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const user = await fetchUser(token.trim());
      localStorage.setItem(TOKEN_KEY, token.trim());
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState({ token: token.trim(), user, loading: false, error: null });
    } catch (e) {
      const msg = e instanceof GitHubError ? e.message : "Failed to validate token.";
      setState({ token: null, user: null, loading: false, error: msg });
      throw e;
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ token: null, user: null, loading: false, error: null });
  }, []);

  return { ...state, signIn, signOut };
}
