# Repository File Count

A fast, no-frills way to explore a GitHub repository — how it's built, file by file, and what's happening in its pull requests.

Paste in any public repo, sign in with a GitHub token, and get a clean breakdown in seconds. No cloning, no local setup, nothing to install.

## File analysis

- **Full repository breakdown** — walks the entire file tree of any public GitHub repo and counts every file in it.
- **Code vs. non-code** — separates source files from docs, assets, configs, and everything else, so you get a real sense of a project's size.
- **Breakdown by extension** — see exactly how many `.ts`, `.py`, `.go`, `.md`, and other files make up the repository.
- **Instant filtering** — toggle whether dotfiles are included and whether config files (`json`, `yaml`, `yml`, `toml`, `xml`) count as code. Results update immediately, with no extra fetching.
- **Handles large repositories** — flags when GitHub truncates very large trees so counts stay honest about what was actually measured.
- **Copy as Markdown** — grab a shareable summary of the results in one click, ready to paste into a PR, README, or notes.

## Pull requests

- **Every PR, not just the open ones** — loads the repository's full pull request history (open, closed, and merged) progressively in the background, with clean pagination once loaded.
- **Search as you type** — instant, local, zero-latency filtering across title, PR number, author, branch, labels, and description. No submit button, no waiting.
- **GitHub-style qualifiers** — `is:open`, `is:merged`, `is:draft`, `author:name`, `label:name`, freely combinable with each other and with plain text (e.g. `is:open author:torvalds bug`).
- **Finds matches in descriptions, not just titles** — including pasted multi-line code, normalized so formatting differences don't break the match. Shows a highlighted excerpt so you can see exactly why something matched.
- **Deep search when you need it** — one click hands your query to GitHub's own search index, which also reaches comments, for the rare cases local search can't see.

## API usage

A dedicated page shows how much of your hourly GitHub API budget you've used, sourced from your own recent activity — viewing or refreshing it never costs a request itself.

## Privacy

Your GitHub token is used only to talk to GitHub's API directly from your device. It's never sent anywhere else or stored on a server.

## How it works

1. Sign in with a GitHub personal access token (read-only access to public repos is enough).
2. Paste a repository as a URL, `owner/repo`, or a `github.com/owner/repo` link.
3. Get an instant file breakdown, browse and search its pull requests, and check your API usage — all without leaving the tab.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
