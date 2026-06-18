# AI Requirements Summary

Compact digest of [../3-requirements.md](../3-requirements.md) for AI agents.
Keep status markers in sync with the implementation.

## Functional

- **FR-1 Read commits in a range** — Shipped. `git.ts:readCommits` (`git log -z`).
- **FR-2 Default range resolution** — Shipped. `git.ts:resolveCommitRange` (latest tag → HEAD; full history if untagged).
- **FR-3 Conventional Commit parsing** — Shipped. `parse.ts:parseCommit`.
- **FR-4 AI release notes, themed sections** — Shipped. `releaseNotes.ts` + `prompt.ts`.
- **FR-5 Claude CLI provider (no key)** — Shipped. `providers/claudeCli.ts`.
- **FR-6 Anthropic API provider** — Shipped. `providers/anthropicApi.ts`.
- **FR-7 CLI-first auto-selection** — Shipped. `providers/index.ts`.
- **FR-8 Offline `--no-ai` fallback** — Shipped. `changelog.ts`.
- **FR-9 CLI flags** — Shipped. `cliArgs.ts` (`--no-ai/--provider/--model/--max-tokens/--title/--cwd/--help` + working-tree flags).
- **FR-10 More providers** — Deferred. GG-3 (Apple FM), GG-4 (Ollama/local), GG-5 (Codex), GG-6 (Gemini), GG-7 (Cursor).
- **FR-11 Uncommitted working-tree changes** — Shipped. `git.ts:readWorkingChanges` + `--staged`/`--cached`/`--unstaged`/`--untracked`/`--working`; standalone (no range) summarizes only pending changes (commit-message draft). Deterministic listing via `changelog.ts:renderWorkingChanges`.

## Non-functional

- **NFR-1 No key by default** — Shipped.
- **NFR-2 Bounded/diagnosable subprocess** — Shipped (GG-9: timeout + stderr).
- **NFR-3 Robust git parsing** — Shipped (GG-11: NUL records, body rejoin).
- **NFR-4 Strict TS / ESM / lint-clean** — Shipped.
- **NFR-5 Unit + integration tests** — Shipped (GG-10).
- **NFR-6 Surface truncation** — Partial (GG-12: `max_tokens` warning + `--max-tokens`).

## Tracked follow-ups

GG-3, GG-4, GG-5, GG-6, GG-7 (providers); GG-12 (truncation handling, partial);
GG-13 (these docs).
