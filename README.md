# Repository File Count

A fast, no-frills way to see what's actually inside a GitHub repository — how many files it has, how much of it is real code versus everything else, and how that breaks down by file type.

Paste in any public repo, sign in with a GitHub token, and get a clean count in seconds. No cloning, no local setup, nothing to install.

## What it does

- **Full repository breakdown** — walks the entire file tree of any public GitHub repo and counts every file in it.
- **Code vs. non-code** — separates source files from docs, assets, configs, and everything else, so you get a real sense of a project's size.
- **Breakdown by extension** — see exactly how many `.ts`, `.py`, `.go`, `.md`, and other files make up the repository.
- **Instant filtering** — after analyzing, toggle whether dotfiles are included and whether config files (`json`, `yaml`, `yml`, `toml`, `xml`) count as code. Results update immediately, with no extra fetching.
- **Handles large repositories** — flags when GitHub truncates very large trees so counts stay honest about what was actually measured.
- **Copy as Markdown** — grab a shareable summary of the results in one click, ready to paste into a PR, README, or notes.
- **API usage at a glance** — a dedicated usage view shows how much of your hourly GitHub API rate limit you've used, sourced from your own recent activity so it never costs a request to check.
- **Runs entirely in your browser** — your GitHub token is used only to talk to GitHub's API directly from your device. It's never sent anywhere else or stored on a server.

## How it works

1. Sign in with a GitHub personal access token (read-only access to public repos is enough).
2. Paste a repository as a URL, `owner/repo`, or a `github.com/owner/repo` link.
3. Get an instant breakdown of total files, code files, and non-code files — by extension.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
