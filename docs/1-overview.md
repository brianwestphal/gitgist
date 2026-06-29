# 1. Overview

**gitgist** generates release notes / changelogs from a range of git commits,
using AI to organize the changes into themed Markdown sections. It ships as both
an installable npm CLI (`gitgist`) and a programmatic library.

## Goal

Given a commit range (e.g. from the previous release tag to `HEAD`), produce
clean, user-facing release notes in Markdown — grouped into whatever sections
fit the actual changes (Features, Bug Fixes, Performance, Breaking Changes, …),
with internal noise (refactors, CI tweaks, ticket IDs) filtered out.

```bash
gitgist v2.0 HEAD
gitgist v1.4.0..HEAD --title "v1.5.0"
gitgist                 # latest tag → HEAD (or full history if untagged)
gitgist --no-ai         # offline Conventional Commits grouping
```

## Principles

- **No API key by default.** Prefer zero-config CLI backends (`claude -p`) the
  way the sibling tools do; fall back to API keys, then to a fully offline
  deterministic mode (`--no-ai`).
- **Pluggable providers.** Claude ships first (CLI + API); other backends
  (Apple Foundation Models, Ollama/local, Codex, Gemini, Cursor) plug into the
  same `AIProvider` interface — CLI-first wherever the tool offers a headless
  mode.
- **Small, typed, tested core.** Strict TypeScript, ESM, pure logic separated
  from I/O so it can be unit-tested directly.

## Related docs

- [2-architecture.md](2-architecture.md) — module layout and data flow.
- [3-requirements.md](3-requirements.md) — FR/NFR requirements with status.
- [4-templates.md](4-templates.md) — the `--template` format reference.
- [5-providers.md](5-providers.md) — the CLI-first agent providers reference.
- [6-fallback.md](6-fallback.md) — fallback provider + suspect empty-notes handling.
- [ai/code-summary.md](ai/code-summary.md) — AI-oriented code map.
- [ai/requirements-summary.md](ai/requirements-summary.md) — AI-oriented
  requirements digest.
