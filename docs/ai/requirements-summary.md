# AI Requirements Summary

Compact digest of [../3-requirements.md](../3-requirements.md) for AI agents.
Keep status markers in sync with the implementation.

> **Feature coverage (GG-45).** Every Shipped/Partial requirement AND every state
> transition (`T-N`) has an asserting test, linked by a `// @covers <ID>` tag next
> to that test. `npm run check:features` (`scripts/check-features.mjs`) and
> `tests/conventions.test.ts` fail if a documented behavior has no `@covers` test,
> or a tag names an unknown id — an axis the v8 line/branch report is blind to.
> When you add/change a requirement, add its row here + in `3-requirements.md` and
> a `@covers` tag on the test.

## Functional

- **FR-1 Read commits in a range** — Shipped. `git.ts:readCommits` (`git log -z`).
- **FR-2 Default range resolution** — Shipped. `git.ts:resolveCommitRange` (latest tag → HEAD; full history if untagged).
- **FR-3 Conventional Commit parsing** — Shipped. `parse.ts:parseCommit`.
- **FR-4 AI release notes, themed sections** — Shipped. `releaseNotes.ts` + `prompt.ts`.
- **FR-5 Claude CLI provider (no key)** — Shipped. `providers/claudeCli.ts`.
- **FR-6 Anthropic API provider** — Shipped. `providers/anthropicApi.ts`.
- **FR-7 CLI-first auto-selection** — Shipped. `providers/index.ts`.
- **FR-8 Offline `--no-ai` fallback** — Shipped. `changelog.ts`.
- **FR-9 CLI flags** — Shipped. `cliArgs.ts` (`--no-ai/--provider/--model/--endpoint/--fallback-provider/--fallback-endpoint/--fallback-model/--max-tokens/--no-diff/--max-diff-chars/--exclude/--no-default-excludes/--no-attribution/--link-commits/--commit-url/--no-config/--title/--cwd/--help` + format, template, language, and working-tree flags).
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
- **FR-23 Configurable fallback provider** — Shipped. `--fallback-provider/--fallback-endpoint/--fallback-model` retry with a secondary config on a primary error or suspect response, before the deterministic changelog. The provider-specific model/endpoint inherit the primary's only when the fallback is the **same** provider (else that provider's own default). `releaseNotes.ts` (`hasFallback`/`runFallback`/`generateViaAI`) + `ReleaseNotesOptions.fallback*`/`warn`. Spec: `docs/6-fallback.md`.
- **FR-24 Self-contained output (no cross-reference/dedupe)** — Shipped. Shared `NO_CROSS_REFERENCE_RULES` block in `prompt.ts`, interpolated verbatim into all three system prompts: never emit "Carried over from … — dedupe against the draft above" / "already in the changelog" / "see also" or any reconcile-two-documents instruction. A changelog `Unreleased` entry in the input is *evidence of what changed* — describe it in full, never defer to it. Changelog de-duplication is an external tool's job (GG-51).
- **FR-25 Diff-grounded generation** — Shipped, **default on**. Every AI run over a range also reads the real code diff (`git.ts:readRangeDiff`) and feeds it as the authority: `prompt.ts:rangeDiffToMaterial` + `DIFF_IS_SOURCE_OF_TRUTH_RULES` (in all three system prompts) tell the model the diff outranks commit prose and changelog text, to report diff-only changes, and to drop unsupported claims. `--no-diff`/`diff:false` opts out; `--no-ai` never reads a diff. Spec: `docs/7-diff-grounding.md` (GG-50).
- **FR-26 Bounded, noise-filtered diff** — Shipped. **One** budget (default 24000 chars, `--max-diff-chars`) + the `NOISE_PATHSPECS` `:(exclude)` filter govern **both** diff paths: the range patch and the working-tree sections (GG-54). Working-tree budget is shared only across sections with content (`shareBudget`), so a lone `--staged` gets it all. Changed-file lists + range stat always survive; held-back files and truncation are stated in the prompt (`RangeDiff`/`WorkingChanges` `excluded`+`truncated`), never hidden.
- **FR-27 Configurable diff exclusions** — Shipped. `--exclude <pathspec>` (repeatable) adds to `DEFAULT_EXCLUDES`; `--no-default-excludes` drops the built-ins. `git.ts:buildExcludePathspecs` + `DiffExcludeOptions` (`exclude`/`defaultExcludes`), threaded into both diff readers. FR-26's visibility invariant preserved. Spec: `docs/8-exclusions.md` (GG-53).
- **FR-28 Provider-advertised diff budget** — Shipped. `AIProvider.diffBudgetChars` sizes diff material per backend (apple 4k → local 8k → agent CLIs 120k → anthropic-api 200k chars). Precedence: `--max-diff-chars` → provider budget → shared default. Primary provider resolved **before** the diff read (single probe, instance reused); resolution errors **deferred** to generation time so FR-23's fallback still applies. Spec: `docs/9-provider-budgets.md` (GG-52).
- **FR-29 Per-file diff budget allocation** — Shipped. The patch budget is water-filled across **every** changed file (smallest first; leftovers flow to bigger files) instead of a positional first-N-chars cut, which spent the budget alphabetically and gave late-sorting paths zero. `git.ts:capPatch`/`splitPatchByFile`/`sliceToLine`; shortened files reported via `trimmedFiles` and named in the prompt. No path ranked above another. Applies to the range patch and each working-tree section (GG-57).
- **FR-30 Commit attribution** — Shipped. `git.ts:readCommitFiles` maps commit hash → touched files (one `git log --name-only`); `prompt.ts:commitsToMaterial` folds it into the commit list with short hashes. Enables attribution / grouping / ordering at ~2.6k chars vs 312k for per-commit patches (GG-55 rejected those). Sized to ~15% of the diff budget by `attributionFilesPerCommit`, dropped when it won't fit; honours FR-27; `ATTRIBUTION_RULES` forbids citing an unseen hash. `--no-attribution` opts out. Spec: `docs/10-attribution.md` (GG-58).
- **FR-31 Visible commit provenance** — Shipped. `--link-commits` ends each bullet with its commit; `--commit-url <template>` (needs `{hash}`) or auto-derived from `origin` for GitHub/GitLab (`/commit/`) and Bitbucket (`/commits/`), else bare hashes — never a guessed URL. `prompt.ts:buildCommitLinkRules` appended to the system prompt; tells the model to match bullets to commits via the `files:` lists (real-but-swapped hashes were observed without that), to cite ALL commits a merged bullet covers, and keeps the never-invent-a-hash guard. Requires FR-30; ignored for `--format commit`. Spec: `docs/11-commit-links.md` (GG-59).
- **FR-32 Project config file** — Shipped. `gitgist.config.json` or `package.json#gitgist`, discovered by walking up from `--cwd` and **stopping at the repo root**. Precedence flag → config → default, except `exclude` which **appends** CLI patterns to the config baseline. Unknown keys rejected. Per-invocation options (range/cwd/title/working-tree/`ai`) stay CLI-only. `--no-config` skips it. `config.ts` (`loadConfig`/`parseConfig`/`applyConfig`); `CliArgs.explicit` lets a flag outrank config despite concrete boolean defaults. Spec: `docs/12-config.md` (GG-56).

## State transitions (T-N)

Multi-step sequences across the stateful paths — the exact gap line coverage
misses. Each is walked by a test in `tests/releaseNotes.test.ts` /
`tests/providers.test.ts` (see `@covers`).

- **T-1 Provider auto fall-through** — `resolveProvider('auto')` skips an unavailable provider → next available; all unavailable → error. `providers/index.ts`.
- **T-2 Primary error → fallback → deterministic** — `releaseNotes.ts:generateViaAI` (recover, or fallback error → keep primary / deterministic; no fallback → propagate).
- **T-3 Suspect empty-notes → deterministic** — sentinel **with** commits is suspect → deterministic; **without** commits (working-tree-only) is trusted.
- **T-4 Fallback config inheritance** — same-provider fallback inherits model/endpoint; different provider uses its own default unless overridden.
- **T-5 Diff read fails → degrade to prose** — `readRangeDiff` throws (bad rev, shallow clone) → warn, don't fail → generation continues from commit messages alone and still returns notes. `releaseNotes.ts`.

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
