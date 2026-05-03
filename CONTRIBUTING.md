# Contributing to Stream Manager

Thanks for your interest in contributing. This is a side project maintained by one person, so please be patient with response times — but contributions of any size are genuinely welcome.

## Reporting bugs

Open an issue using the **Bug report** template. Please include:
- Stream Manager version (Help → About, or check the title bar)
- Windows version
- Steps to reproduce
- What you expected vs. what happened
- Relevant log output if available (logs are at `%APPDATA%/stream-manager/logs/`)

## Requesting features

Open an issue using the **Feature request** template. Describe the workflow problem you're trying to solve, not just the feature you want — that helps me find the right shape for the solution.

Check `_todo.md` first; the feature you want may already be planned.

## Submitting code

1. Fork the repo and create a branch from `master`.
2. Run the dev environment (see README → Getting Started as a dev).
3. Keep changes focused — one feature or fix per PR.
4. Match the existing code style. TypeScript strict, functional React components, Tailwind for styling.
5. Test your change manually against the affected workflows. There's no automated test suite yet.
6. Open a PR with a clear description of what changed and why.

## Scope

Stream Manager is intentionally Windows-first and OBS-friendly. Cross-platform PRs are welcome but will need to preserve Windows behavior. Big architectural changes — new dependencies, switching frameworks, restructuring the IPC layer — are best discussed in an issue first.

## Code of conduct

Be decent. Don't be a jerk to other contributors. Disagreements about technical decisions are fine; personal attacks are not.