# 3. Requirements

Status markers: **Shipped** (implemented + tested), **Partial** (implemented,
gaps noted), **Deferred** (planned, tracked by a ticket).

## Functional requirements

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-1 | Read commits in a git range | **Shipped** | `readCommits` (`git log -z`); range form `a..b` or `from`/`to` args. |
| FR-2 | Resolve a default range | **Shipped** | `resolveCommitRange`: `from` → latest tag, `to` → `HEAD`; full history if untagged. |
| FR-3 | Parse Conventional Commit subjects | **Shipped** | `parseCommit` — type/scope/description + breaking-change (`!` or footer). |
| FR-4 | Generate AI release notes grouped into themed Markdown sections | **Shipped** | `generateReleaseNotes` + `prompt.ts`; sections vary with the changes. |
| FR-5 | Claude provider — CLI (`claude -p`), no API key | **Shipped** | `claudeCli.ts` via `createCliProvider`. |
| FR-6 | Claude provider — Anthropic API | **Shipped** | `anthropicApi.ts` (`claude-opus-4-8`, adaptive thinking, streaming). |
| FR-7 | Provider auto-selection, CLI-first | **Shipped** | `resolveProvider`/`AUTO_ORDER`. |
| FR-8 | Offline deterministic fallback (`--no-ai`) | **Shipped** | `buildChangelog` + `renderMarkdown`. |
| FR-9 | CLI flags: `--no-ai`, `--provider`, `--model`, `--max-tokens`, `--title`, `--cwd`, `--help`, and the working-tree flags (FR-11) | **Shipped** | `cliArgs.ts`. |
| FR-10 | Additional providers: Apple FM, Ollama/local, Codex, Gemini, Cursor | **Deferred** | Tickets GG-3, GG-4, GG-5, GG-6, GG-7 (CLI-first where possible). |
| FR-11 | Summarize **uncommitted** working-tree changes (`--staged`/`--cached`, `--unstaged`, `--untracked`, `--working`) — alongside a range, or standalone (no range) for a commit-message draft | **Shipped** | `readWorkingChanges` (`git.ts`); diffs fed to the AI, or a deterministic file listing under `--no-ai` (`renderWorkingChanges`). |
| FR-12 | Output format selection: `--format notes` (default, themed Markdown) or `--format commit` / `--commit-message` (a single Conventional Commit message). `commit` requires AI; `--title` is ignored for it | **Shipped** | `COMMIT_SYSTEM_PROMPT` (`prompt.ts`) selected in `releaseNotes.ts`. Pairs with FR-11 for "draft my commit message". |

## Non-functional requirements

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| NFR-1 | No API key required by default | **Shipped** | CLI-first `AUTO_ORDER`; `--no-ai` needs neither key nor network. |
| NFR-2 | CLI subprocess is bounded + diagnosable | **Shipped** | Timeout + stderr capture in `createCliProvider` (GG-9). |
| NFR-3 | Robust git parsing | **Shipped** | NUL-delimited records; body rejoin (GG-11). |
| NFR-4 | Strict TypeScript, ESM, lint-clean | **Shipped** | `strictTypeChecked`; `.js` import extensions. |
| NFR-5 | Pure logic unit-tested; I/O layer integration-tested | **Shipped** | Vitest; temp-repo integration test (GG-10). |
| NFR-6 | Surface AI output truncation | **Partial** | API provider warns on `stop_reason === 'max_tokens'` (GG-12); `--max-tokens` exposed. |

## Open items

- AI output quality depends on the backend; the `claude -p` agentic CLI can
  occasionally add meta-commentary on trivial inputs (model behavior, not a code
  defect).
