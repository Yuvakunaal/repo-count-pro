import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Github,
  LogOut,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  ExternalLink,
  ArrowRight,
  Gauge,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGitHubAuth } from "@/lib/auth-store";
import { useCachedAnalysisState, type AnalysisResult } from "@/lib/analysis-cache";
import {
  parseRepoInput,
  fetchRepoMeta,
  fetchBranchSha,
  fetchRecursiveTree,
  countFiles,
  buildMarkdown,
  formatNumber,
  formatPct,
  GitHubError,
  type ExtensionRow,
} from "@/lib/github-logic";

export const Route = createFileRoute("/")({
  component: Index,
});

type Step =
  | "idle"
  | "metadata"
  | "branch"
  | "sha"
  | "tree"
  | "counting"
  | "preparing"
  | "done";

const STEP_LABEL: Record<Exclude<Step, "idle" | "done">, string> = {
  metadata: "Fetching repository metadata…",
  branch: "Resolving default branch…",
  sha: "Resolving commit SHA…",
  tree: "Fetching recursive tree…",
  counting: "Counting files…",
  preparing: "Preparing output…",
};

function Index() {
  const auth = useGitHubAuth();

  if (auth.loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header user={auth.user} onSignOut={auth.signOut} />
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-16 pb-44 sm:pb-32">
        {!auth.token || !auth.user ? (
          <SignInPanel onSignIn={auth.signIn} error={auth.error} />
        ) : (
          <Analyzer token={auth.token} />
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ---------- Header / Footer ---------- */

// Radix's own hover tooltip ignores touch input by design, so a long-press on
// mobile is handled entirely separately here via a small local "peek" label —
// held past `ms` reveals it and suppresses the tap that would otherwise
// follow; a quick tap still acts normally (navigate / open dialog).
function useLongPress(onLongPress: () => void, ms = 500) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const start = useCallback(() => {
    firedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const end = useCallback(
    (e: React.TouchEvent) => {
      cancel();
      if (firedRef.current) e.preventDefault();
    },
    [cancel],
  );

  return { onTouchStart: start, onTouchEnd: end, onTouchMove: cancel, onTouchCancel: cancel };
}

function HeaderIconTooltip({
  label,
  children,
  hoverTooltip = true,
}: {
  label: string;
  children: React.ReactElement;
  /** Desktop hover tooltip — off keeps the mobile long-press peek only. */
  hoverTooltip?: boolean;
}) {
  const [peek, setPeek] = useState(false);
  const longPress = useLongPress(() => {
    setPeek(true);
    window.setTimeout(() => setPeek(false), 1500);
  });

  const trigger = (
    <span className="relative inline-flex" {...longPress}>
      {children}
      {peek ? (
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground shadow-md z-20 sm:hidden">
          {label}
        </span>
      ) : null}
    </span>
  );

  if (!hoverTooltip) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Header({
  user,
  onSignOut,
}: {
  user: { login: string; avatar_url: string } | null;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 bg-background border-b border-border/70">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Repository File Count"
            className="h-8 w-8 rounded-[9px] border border-border/60"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-tight">Repository File Count</span>
            <span className="text-[10.5px] text-muted-foreground font-mono">
              github → tree → count
            </span>
          </div>
        </div>

        {user ? (
          <TooltipProvider delayDuration={300}>
            <div className="flex items-center gap-3">
              <HeaderIconTooltip label={user.login} hoverTooltip={false}>
                <div className="flex items-center gap-2">
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="h-6 w-6 rounded-full border border-border"
                  />
                  <span className="hidden sm:inline text-xs font-mono text-muted-foreground">
                    {user.login}
                  </span>
                </div>
              </HeaderIconTooltip>

              <HeaderIconTooltip label="Usage">
                <Link
                  to="/usage"
                  aria-label="Usage"
                  className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Gauge className="h-4 w-4" />
                </Link>
              </HeaderIconTooltip>

              <AlertDialog>
                <HeaderIconTooltip label="Log out" hoverTooltip={false}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 sm:px-3 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <LogOut className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="sr-only sm:not-sr-only">Log out</span>
                    </Button>
                  </AlertDialogTrigger>
                </HeaderIconTooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Log out?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You'll need to sign in again with your GitHub token to analyze another
                      repository.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onSignOut}>Log out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TooltipProvider>
        ) : null}
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="fixed bottom-0 inset-x-0 z-10 bg-background border-t border-border/70">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-3 sm:h-12 sm:py-0 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-1.5 sm:gap-0 text-center sm:text-left text-[11px] text-muted-foreground font-mono">
        <span>Runs entirely in your browser. Your token never leaves this device.</span>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/Yuvakunaal/repo-count-pro"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <Github className="h-3 w-3" /> Source
          </a>
          <a
            href="https://docs.github.com/rest"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            GitHub REST <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div className="border-t border-border/40 py-2.5 text-center text-[10.5px] font-mono text-muted-foreground/70">
        → made by{" "}
        <a
          href="https://kunaal-portfolio.vercel.app/"
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground hover:text-foreground underline underline-offset-2 decoration-border transition-colors"
        >
          Kunaal
        </a>
      </div>
    </footer>
  );
}

/* ---------- Sign in ---------- */

function SignInPanel({
  onSignIn,
  error,
}: {
  onSignIn: (token: string) => Promise<void>;
  error: string | null;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    try {
      await onSignIn(token);
    } catch {
      /* handled in store */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Sign in with GitHub</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Authenticate with a personal access token to analyze any public repository. Everything
          runs client-side.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="rounded-lg border border-border bg-card p-5 sm:p-6 space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="token" className="text-xs font-medium">
            GitHub token
          </Label>
          <Input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_… or github_pat_…"
            className="font-mono text-sm h-10"
          />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Create one at{" "}
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              github.com/settings/tokens
            </a>{" "}
            with <span className="font-mono">public_repo</span> read access. Stored only in this
            browser.
          </p>
        </div>

        {error ? (
          <div className="text-xs text-destructive flex items-start gap-2 border border-destructive/40 bg-destructive/10 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <Button type="submit" disabled={submitting || !token.trim()} className="w-full h-10">
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Github className="h-4 w-4 mr-2" /> Continue
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

/* ---------- Analyzer ---------- */

function Analyzer({ token }: { token: string }) {
  // Backed by a module-level cache (not localStorage) so the current
  // analysis survives a trip to /usage and back, but resets on a hard
  // reload or an explicit new analysis / "Analyze another repository".
  const {
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
  } = useCachedAnalysisState();
  const [step, setStep] = useState<Step>(() => (result ? "done" : "idle"));
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => !!input.trim() && step === "idle",
    [input, step],
  );

  const analyze = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setError(null);
      setResult(null);
      setRawTree(null);

      const parsed = parseRepoInput(input);
      if (!parsed) {
        setError(
          "Enter a valid repository (e.g. https://github.com/owner/repo, github.com/owner/repo, or owner/repo).",
        );
        return;
      }

      try {
        setStep("metadata");
        const meta = await fetchRepoMeta(parsed.owner, parsed.repo, token);

        setStep("branch");
        const branch = meta.default_branch;

        setStep("sha");
        const sha = await fetchBranchSha(parsed.owner, parsed.repo, branch, token);

        setStep("tree");
        const tree = await fetchRecursiveTree(parsed.owner, parsed.repo, sha, token);

        setStep("counting");
        const counts = countFiles(tree.tree, {
          includeDotfiles,
          configAsCode,
        });

        setStep("preparing");
        await new Promise((r) => setTimeout(r, 120));

        setRawTree(tree.tree);
        setResult({
          fullName: meta.full_name,
          htmlUrl: meta.html_url,
          branch,
          sha,
          truncated: tree.truncated,
          counts,
        });
        setStep("done");
      } catch (err) {
        setError(err instanceof GitHubError ? err.message : "Something went wrong. Please try again.");
        setStep("idle");
      }
    },
    [input, includeDotfiles, configAsCode, token, setError, setResult, setRawTree, setStep],
  );

  // The full tree is already cached from the initial fetch, so filtering after
  // analysis is instant — no re-fetch, just re-run the pure count over rawTree.
  const applyFilters = useCallback(
    (nextDot: boolean, nextCfg: boolean) => {
      setIncludeDotfiles(nextDot);
      setConfigAsCode(nextCfg);
      if (!rawTree) return;
      const counts = countFiles(rawTree, { includeDotfiles: nextDot, configAsCode: nextCfg });
      setResult((prev) => (prev ? { ...prev, counts } : prev));
    },
    [rawTree, setIncludeDotfiles, setConfigAsCode, setResult],
  );

  const reset = () => {
    setInput("");
    setResult(null);
    setRawTree(null);
    setError(null);
    setStep("idle");
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Analyze a repository
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xl">
          Paste any public GitHub repository. We&apos;ll walk its Git tree via the REST API and
          break the files down by extension.
        </p>
      </section>

      <form
        onSubmit={analyze}
        className="rounded-lg border border-border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
          <div className="flex-1">
            <Label
              htmlFor="repo-input"
              className="mb-1.5 block text-[11px] font-mono font-normal text-muted-foreground"
            >
              owner/repo &nbsp;or&nbsp; https://github.com/owner/repo
            </Label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground text-sm font-mono select-none">
                →
              </span>
              <Input
                id="repo-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type or paste here…"
                disabled={step !== "idle" && step !== "done"}
                className="pl-9 h-11 font-mono text-sm"
                autoFocus
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={!canSubmit && step !== "done"}
            className="h-11 px-5"
          >
            {step !== "idle" && step !== "done" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Analyze <ArrowRight className="h-4 w-4 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </form>

      {error ? <ErrorPanel message={error} /> : null}

      {step !== "idle" && step !== "done" ? <LoadingState step={step} /> : null}

      {result && step === "done" ? (
        <Results
          result={result}
          onReset={reset}
          includeDotfiles={includeDotfiles}
          configAsCode={configAsCode}
          onFilterChange={applyFilters}
        />
      ) : null}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <div className="flex flex-col">
        <Label htmlFor={id} className="text-xs font-medium cursor-pointer">
          {label}
        </Label>
        <span className="text-[11px] text-muted-foreground font-mono">{hint}</span>
      </div>
    </div>
  );
}

function FilterBar({
  includeDotfiles,
  configAsCode,
  onChange,
}: {
  includeDotfiles: boolean;
  configAsCode: boolean;
  onChange: (nextDot: boolean, nextCfg: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
      <span className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
        Filters
      </span>
      <ToggleRow
        id="dotfiles"
        label="Include dotfiles"
        hint="Count hidden files and folders"
        checked={includeDotfiles}
        onChange={(v) => onChange(v, configAsCode)}
      />
      <ToggleRow
        id="config"
        label="Count config files as code"
        hint="json, yaml, yml, toml, xml"
        checked={configAsCode}
        onChange={(v) => onChange(includeDotfiles, v)}
      />
    </div>
  );
}

/* ---------- States ---------- */

function LoadingState({ step }: { step: Exclude<Step, "idle" | "done"> }) {
  const order: Array<Exclude<Step, "idle" | "done">> = [
    "metadata",
    "branch",
    "sha",
    "tree",
    "counting",
    "preparing",
  ];
  const currentIdx = order.indexOf(step);

  return (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{STEP_LABEL[step]}</span>
      </div>
      <ol className="space-y-1.5">
        {order.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li
              key={s}
              className={
                "text-[12px] font-mono flex items-center gap-2 " +
                (active
                  ? "text-foreground"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50")
              }
            >
              <span className="w-4 text-center">
                {done ? "✓" : active ? "›" : "·"}
              </span>
              <span>{STEP_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      <div>
        <div className="text-sm font-medium text-destructive">Unable to analyze</div>
        <p className="text-xs text-destructive/90 mt-1 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

/* ---------- Results ---------- */

function Results({
  result,
  onReset,
  includeDotfiles,
  configAsCode,
  onFilterChange,
}: {
  result: AnalysisResult;
  onReset: () => void;
  includeDotfiles: boolean;
  configAsCode: boolean;
  onFilterChange: (nextDot: boolean, nextCfg: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const md = buildMarkdown({
      fullName: result.fullName,
      branch: result.branch,
      sha: result.sha,
      totalFiles: result.counts.totalFiles,
      codeCount: result.counts.codeCount,
      nonCodeCount: result.counts.nonCodeCount,
      code: result.counts.code,
      nonCode: result.counts.nonCode,
    });
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-6">
      {result.truncated ? (
        <div className="rounded-lg border border-[color:var(--color-terminal-amber)]/40 bg-[color:var(--color-terminal-amber)]/10 px-4 py-3 text-xs font-mono text-[color:var(--color-terminal-amber)] flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            GitHub truncated the tree response — this repository is very large. Counts reflect the
            returned subset.
          </span>
        </div>
      ) : null}

      <FilterBar
        includeDotfiles={includeDotfiles}
        configAsCode={configAsCode}
        onChange={onFilterChange}
      />

      <SummaryCard result={result} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy} className="h-9">
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy as Markdown
            </>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset} className="h-9">
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Analyze another repository
        </Button>
      </div>

      <ExtensionTable
        title="Code files"
        subtitle={`${formatNumber(result.counts.codeCount)} of ${formatNumber(result.counts.totalFiles)} total`}
        rows={result.counts.code}
        accent="green"
      />
      <ExtensionTable
        title="Non-code files"
        subtitle={`${formatNumber(result.counts.nonCodeCount)} of ${formatNumber(result.counts.totalFiles)} total`}
        rows={result.counts.nonCode}
        accent="cyan"
      />
    </div>
  );
}

function SummaryCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[color:var(--color-terminal-green)]" />
        <span className="text-[11px] font-mono text-muted-foreground">summary</span>
      </div>
      <div className="p-5 sm:p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
        <SummaryItem
          label="Repository"
          value={
            <a
              href={result.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground inline-flex items-center gap-1 truncate"
            >
              {result.fullName}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          }
          className="col-span-2 sm:col-span-3"
        />
        <SummaryItem label="Branch" value={result.branch} mono />
        <SummaryItem
          label="Commit SHA"
          value={result.sha.slice(0, 10)}
          mono
          title={result.sha}
        />
        <SummaryItem label="Total files" value={formatNumber(result.counts.totalFiles)} strong />
        <SummaryItem
          label="Code files"
          value={formatNumber(result.counts.codeCount)}
          strong
          accent="green"
        />
        <SummaryItem
          label="Non-code files"
          value={formatNumber(result.counts.nonCodeCount)}
          strong
          accent="cyan"
        />
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  mono,
  strong,
  accent,
  className,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  accent?: "green" | "cyan";
  className?: string;
  title?: string;
}) {
  const accentClass =
    accent === "green"
      ? "text-[color:var(--color-terminal-green)]"
      : accent === "cyan"
        ? "text-[color:var(--color-terminal-cyan)]"
        : "text-foreground";
  return (
    <div className={className}>
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        title={title}
        className={[
          "mt-1 truncate",
          mono ? "font-mono text-sm" : "text-sm",
          strong ? "text-xl font-semibold tracking-tight " + accentClass : "text-foreground",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function ExtensionTable({
  title,
  subtitle,
  rows,
  accent,
}: {
  title: string;
  subtitle: string;
  rows: ExtensionRow[];
  accent: "green" | "cyan";
}) {
  const dot =
    accent === "green"
      ? "bg-[color:var(--color-terminal-green)]"
      : "bg-[color:var(--color-terminal-cyan)]";
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={"h-2 w-2 rounded-full " + dot} />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs font-mono text-muted-foreground">
          No files in this category.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium">Extension</th>
                <th className="px-5 py-2.5 font-medium text-right">Count</th>
                <th className="px-5 py-2.5 font-medium text-right">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ext}
                  className="border-b border-border/50 last:border-0 hover:bg-accent/40 transition-colors"
                >
                  <td className="px-5 py-2.5 font-mono text-[13px]">{r.ext}</td>
                  <td className="px-5 py-2.5 font-mono text-[13px] text-right tabular-nums">
                    {formatNumber(r.count)}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[13px] text-right tabular-nums text-muted-foreground">
                    {formatPct(r.percentage)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
