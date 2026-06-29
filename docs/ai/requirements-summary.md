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
- **FR-9 CLI flags** — Shipped. `cliArgs.ts` (`--no-ai/--provider/--model/--endpoint/--fallback-provider/--fallback-endpoint/--fallback-model/--max-tokens/--title/--cwd/--help` + format, template, language, and working-tree flags).
- **FR-10 More providers** — Deferred. GG-7 (Cursor); API-key fallbacks for the agent CLIs (OpenAI/Codex, Gemini API) as follow-ups. (Codex/Gemini/OpenCode CLI providers shipped — FR-18/19/20.)
- **FR-11 Uncommitted working-tree changes** — Shipped. `git.ts:readWorkingChanges` + `--staged`/`--cached`/`--unstaged`/`--untracked`/`--working`; standalone (no range) summarizes only pending changes (commit-message draft). Deterministic listing via `changelog.ts:renderWorkingChanges`.
- **FR-12 Output format** — Shipped. `--format notes` (default) or `--format commit` / `--commit-message` → a Conventional Commit message via `prompt.ts:COMMIT_SYSTEM_PROMPT` (requires AI; `--title` ignored).
- **FR-13 Templates** — Shipped. `--template <file>`: Markdown-with-frontmatter template (`template.ts:loadTemplate/parseTemplate` + `prompt.ts:TEMPLATE_SYSTEM_PROMPT/buildTemplatePrompt`); strict sections/order. Requires AI; not combinable with `--format commit`. Spec: `docs/4-templates.md`.
- **FR-14 Local provider** — Shipped. `--provider local` → OpenAI-compatible endpoint (Ollama/LM Studio) via `providers/local.ts:createLocalProvider`; `--endpoint`/`GITGIST_LOCAL_ENDPOINT`, `--model`/`GITGIST_LOCAL_MODEL`. Opt-in only (not in `AUTO_ORDER`).
- **FR-15 Apple Foundation Models** — Shipped. `--provider apple` (macOS 26+ on-device) via `providers/apple.ts:createAppleProvider`, which delegates to the [`apple-fm`](https://www.npmjs.com/package/apple-fm) npm package (`probe()`/`generate()`); `APPLE_FM_BIN` for a custom helper build. In `AUTO_ORDER` as a free fallback.
- **FR-16 Notarized prebuilt helper** — Shipped (via the `apple-fm` dependency). The Developer-ID-signed + notarized arm64 helper now ships inside `apple-fm` (built + signed in that package's release), so gitgist neither builds nor bundles its own — the old `release.yml` `apple-fm` job is removed. (Superseded the GG-19 CI job.)
- **FR-17 Apple language hint** — Shipped. `providers/apple.ts` prefixes the prompt with `Treat the following as <language>:` to satisfy the on-device language guardrail (`unsupportedLanguageOrLocale` on non-prose-heavy prompts like full-SHA ranges). Default = detected system language (`detectSystemLanguage`); `--language <name|code>` overrides, `--language auto` (`AUTO_LANGUAGE`) omits it. Threaded via `resolveProvider`.
- **FR-18 Codex CLI provider** — Shipped. `--provider codex` → `providers/codex.ts` (`codex exec`, prompt via stdin, `-m <model>`); no key, in `AUTO_ORDER`. Spec: `docs/5-providers.md`.
- **FR-19 Gemini CLI provider** — Shipped. `--provider gemini` → `providers/gemini.ts` (`gemini -p "<prompt>"`, `-m <model>`); no key, in `AUTO_ORDER`. Spec: `docs/5-providers.md`.
- **FR-20 OpenCode CLI provider** — Shipped (verified end-to-end). `--provider opencode` → `providers/opencode.ts` (`opencode run "<prompt>"`, `-m <provider/model>`); no gitgist key, in `AUTO_ORDER`. Spec: `docs/5-providers.md`.
- **FR-21 `--model` for CLI agents** — Shipped. `providers/cli.ts` `CliProviderSpec.runArgs` accepts a `model`-function form so `codex`/`gemini`/`opencode` place `-m <model>` correctly.
- **FR-22 Suspect empty-notes handling** — Shipped. `releaseNotes.ts`: a returned `_No user-facing changes._` sentinel (`prompt.ts:NO_USER_FACING_CHANGES`/`isEmptyNotesSentinel`) is suspect when commits were in range → warn + deterministic changelog (notes only; working-tree-only sentinel trusted). Spec: `docs/6-fallback.md`. Follows GG-38.
- **FR-23 Configurable fallback provider** — Shipped. `--fallback-provider/--fallback-endpoint/--fallback-model` retry with a secondary config on a primary error or suspect response (unset fields inherit the primary's), before the deterministic changelog. `releaseNotes.ts` (`hasFallback`/`runFallback`/`generateViaAI`) + `ReleaseNotesOptions.fallback*`/`warn`. Spec: `docs/6-fallback.md`.

## Non-functional

- **NFR-1 No key by default** — Shipped.
- **NFR-2 Bounded/diagnosable subprocess** — Shipped (GG-9: timeout + stderr).
- **NFR-3 Robust git parsing** — Shipped (GG-11: NUL records, body rejoin).
- **NFR-4 Strict TS / ESM / lint-clean** — Shipped.
- **NFR-5 Unit + integration tests** — Shipped (GG-10).
- **NFR-6 Surface truncation** — Partial (GG-12: `max_tokens` warning + `--max-tokens`).
- **NFR-7 Clean AI output** — Shipped (GG-18: `cleanModelOutput` strips agentic-CLI preamble/postamble).

## Tracked follow-ups

GG-7 (Cursor provider); API-key fallbacks for the agent CLIs (OpenAI/Codex,
Gemini API) as follow-ups; GG-12 (truncation handling, partial); GG-13 (these
docs). Shipped: GG-5 (Codex/FR-18), GG-6 (Gemini/FR-19), GG-31 (OpenCode/FR-20).
