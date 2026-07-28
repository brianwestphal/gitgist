# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-28


### Features

- **Diff-grounded release notes.** gitgist now reads the range's actual code diff and treats it as the authority for what changed, so a feature buried under `chore: tidy up` still gets described and claims the code doesn't support get dropped. On by default; `--no-diff` returns to commit-messages-only summarizing.
- **New `antigravity` provider** (`agy -p`) — a no-API-key Google backend that supersedes the Gemini CLI, which stopped serving individual tiers on 2026-06-18. It precedes `gemini` in auto-selection; `gemini` stays for Code Assist Standard/Enterprise licensees.
- **New `openai-api` provider** — the OpenAI chat-completions API over `OPENAI_API_KEY` / `OPENAI_BASE_URL`, with no new runtime dependency.
- **`--link-commits`** makes every bullet cite the commit it came from, linking to the commit page. The URL is derived from the git remote automatically (GitHub, GitLab, Bitbucket, and ssh/scp/https remote forms), or set explicitly with `--commit-url '<url>/{hash}'`.
- **Project config file.** `gitgist.config.json` (or a `gitgist` key in `package.json`) pins `exclude`, `provider`, `model`, `maxDiffChars`, `linkCommits`, `commitUrl`, `endpoint`, and the fallback settings per repository; explicitly passed flags still win. `--no-config` skips it.
- **Configurable diff exclusions.** `--exclude <pathspec>` (repeatable) adds to the built-in noise list — lockfiles, build output, vendored deps, generated assets — and `--no-default-excludes` replaces it entirely. Excluded files still appear in the changed-file list and stat, so nothing changed is invisible to the model.
- **Per-commit attribution.** The model now receives each commit's short hash and touched files, so it can group related changes, order them correctly, and attribute work. `--no-attribution` turns it off.
- **Per-provider diff budgets.** Each backend advertises how much diff it can absorb — ~200k chars for the hosted APIs, ~120k for the agent CLIs, 4k for Apple's on-device model — instead of one fixed cap. `--max-diff-chars` still overrides.

### Bug Fixes

- `--model` is now honoured by every provider. `claude-cli` was silently discarding it and running the CLI's default model; `local` now puts the requested model ahead of its config and environment defaults.
- CLI-backed providers spawn in the repository `--cwd` names rather than gitgist's own working directory, so `gitgist --cwd <repo> --provider codex` works from outside a repo.
- The `gemini` provider passes `--skip-trust`, so headless runs no longer fail with exit 55 in untrusted workspaces.
- Failures against OpenAI-compatible endpoints report the real cause — a timeout now says it timed out instead of claiming the server was unreachable — and local models get a much longer generation budget.
- Hash citations are now stripped from output structurally rather than only being discouraged in the prompt, so weaker backends can no longer append a hash to every bullet unless `--link-commits` asked for it.
- The model no longer emits "carried over / dedupe against the draft above" meta sections when a `CHANGELOG.md` `Unreleased` entry is part of the input.
- The diff budget is allocated fairly across changed files instead of first-come in path order, so alphabetically-late source files are no longer starved by scaffolding at the top of the tree.
- The working-tree path (`--staged` / `--working`) now uses the same configurable budget and noise filtering as the commit-range path, instead of a separate hardcoded 8000-char cap with no filtering.

### API

- The public API surface grew considerably: `parseArgs` / `USAGE` / `CliArgs`, the config loaders (`loadConfig`, `parseConfig`, `applyConfig`), the new git helpers (`readRangeDiff`, `readCommitFiles`, `detectCommitUrl`, `commitUrlFromRemote`, `DEFAULT_EXCLUDES`, `buildExcludePathspecs`), prompt pieces (`rangeDiffToMaterial`, `stripUnrequestedHashes`, `ATTRIBUTION_RULES`, `buildCommitLinkRules`, the shared rule blocks), and the new provider exports are all importable.
- `PROVIDER_NAMES` is exported as a runtime array alongside the `ProviderName` type.
- `describeFetchFailure`, `isAbort`, and `defaultFetch` are no longer exported — they were never usable from outside their module.

## [1.1.0] - 2026-06-29


### Features

- Added three zero-config, no-API-key AI providers — Codex, Gemini, and OpenCode — each using the tool's own CLI sign-in, alongside the existing `claude` CLI backend.
- Added a configurable fallback provider (`--fallback-provider`, `--fallback-endpoint`, `--fallback-model`) that's tried when the primary provider errors out.
- Empty release notes are now treated as suspect: when the AI returns `_No user-facing changes._` for a range that actually had commits, gitgist falls back to the deterministic Conventional-Commit changelog instead of trusting it silently.

### Bug Fixes

- Fixed the `claude` CLI provider passing gitgist's instructions as user input, which caused it to echo `_No user-facing changes._` instead of generating notes; the system prompt now rides the CLI's own system layer.
- A fallback provider no longer inherits a `--model`/`--endpoint` that doesn't apply to it — those are only carried over when the fallback targets the same provider as the primary.

### Documentation

- The README now advertises the fallback/resilience behavior and includes a `--template` demo showing commits shaped to a fixed house-style layout.

## [1.0.0] - 2026-06-19


### Bug Fixes
- Fixed the `apple` provider rejecting commit ranges given as full SHAs (e.g. `<sha>^ <sha>`); the on-device language guardrail no longer trips on SHA-heavy prompts.

### Changes
- The `apple` provider now uses the published `apple-fm` package, which ships its own signed and notarized Foundation Models binary ??? the provider works out of the box with no Swift toolchain or bundled helper.

## [Unreleased]

### Added

- `--language <name|auto>`: a language hint for the `apple` provider. Apple's on-device model runs a language-identification guardrail that can reject prompts dominated by non-prose tokens (e.g. a full-SHA range like `<sha>^..<sha>`) with `unsupportedLanguageOrLocale`. gitgist now prefixes the prompt with a short `Treat the following as <language>:` lead-in, defaulting to the detected system language. Pass a language name/code to override (e.g. `--language French`), or `--language auto` to omit the hint entirely.

### Changed

- The on-device `apple` provider now uses the [`apple-fm`](https://www.npmjs.com/package/apple-fm) package instead of a vendored Swift helper. gitgist no longer builds, signs, or bundles its own Foundation Models helper — `apple-fm` ships a Developer-ID-signed, notarized binary, so the provider still works out of the box with no toolchain. Point at a custom helper build with `APPLE_FM_BIN` (the previous `GITGIST_APPLE_FM_BIN` is gone).

## [0.1.0] - 2026-06-18


### Features

- New `npm run compare` tool runs the same changes through every available AI backend (Claude, local OpenAI-compatible, Apple Foundation Models, and the deterministic `--no-ai` grouping) and prints the results side by side, so you can compare how each provider summarizes the same history.

### Documentation

- Added a "Choosing a provider" guide to the README, with a quality/cost/privacy comparison table and a "pick by what you care about most" summary to help you choose between providers.
- Refreshed the README's "See it" section with an animated demo for drafting commit messages from staged changes (`gitgist --staged --commit-message`), so the demos now flow as a progression: AI release notes, commit messages, then offline grouping.
- Better-organized release notes: each change now appears in exactly one section, with breaking changes always grouped on their own.
