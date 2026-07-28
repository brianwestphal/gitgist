# 2. Architecture

The pipeline is: **resolve a range → read commits → generate notes**.

```
cli.ts ── parseArgs (cliArgs.ts)
   │
   ▼
generateReleaseNotes (releaseNotes.ts)
   │
   ├─ resolveCommitRange / latestTag / readCommits  (git.ts)
   │        └─ parseCommit (parse.ts)
   │
   ├─ ai:false → buildChangelog + renderMarkdown (changelog.ts)   [offline]
   │
   └─ ai:true  → resolveProvider (providers/index.ts)
                    ├─ claude-cli    (providers/claudeCli.ts → providers/cli.ts)
                    ├─ codex         (providers/codex.ts    → providers/cli.ts)
                    ├─ antigravity   (providers/antigravity.ts → providers/cli.ts)
                    ├─ gemini        (providers/gemini.ts   → providers/cli.ts — legacy)
                    ├─ opencode      (providers/opencode.ts → providers/cli.ts)
                    ├─ anthropic-api (providers/anthropicApi.ts)
                    ├─ openai-api    (providers/openaiApi.ts   → providers/openaiCompatible.ts)
                    ├─ local         (providers/local.ts       → providers/openaiCompatible.ts, opt-in)
                    └─ apple         (providers/apple.ts — via the apple-fm package)
                 prompt built by prompt.ts (SYSTEM_PROMPT / COMMIT_SYSTEM_PROMPT /
                 TEMPLATE_SYSTEM_PROMPT + buildUserPrompt / buildTemplatePrompt)
```

## Modules (`src/`)

| File | Responsibility |
| --- | --- |
| `git.ts` | `readCommits(range)` (NUL-delimited `git log -z`), `latestTag()`, `resolveCommitRange(from, to)`, `readRangeDiff(range)` (the range's real code diff), `readWorkingChanges(opts)`. |
| `parse.ts` | `parseCommit(raw)` — Conventional Commit subject + breaking-change parsing. |
| `prompt.ts` | `SYSTEM_PROMPT` / `COMMIT_SYSTEM_PROMPT` / `TEMPLATE_SYSTEM_PROMPT`, the shared `DIFF_IS_SOURCE_OF_TRUTH_RULES` / `NO_CROSS_REFERENCE_RULES` rule blocks, `rangeDiffToMaterial`, `buildUserPrompt`, `buildTemplatePrompt`, `commitsToMaterial`, `workingChangesToMaterial`, `stripCodeFences`, `cleanModelOutput`. |
| `changelog.ts` | Deterministic grouping (`buildChangelog`) + Markdown rendering (`renderMarkdown`, `renderWorkingChanges`) — the `--no-ai` path. |
| `template.ts` | `loadTemplate` / `parseTemplate` for `--template` (Markdown + YAML frontmatter). |
| `providers/types.ts` | `AIProvider` / `GenerateRequest` interfaces. |
| `providers/cli.ts` (spawns the child in `GenerateRequest.cwd`, FR-35) | `createCliProvider()` — reusable no-key CLI backend (timeout, stderr capture). |
| `providers/claudeCli.ts` | The `claude -p` provider (a `createCliProvider` spec; system prompt via `--append-system-prompt`). |
| `providers/codex.ts` | The `codex exec` provider (a `createCliProvider` spec; no key). |
| `providers/antigravity.ts` | The `agy -p` provider (a `createCliProvider` spec; no key) — Google's replacement for the Gemini CLI. |
| `providers/gemini.ts` | The `gemini -p` provider (a `createCliProvider` spec; no key). **Legacy** — retired for individual tiers 2026-06-18. |
| `providers/opencode.ts` | The `opencode run` provider (a `createCliProvider` spec; no key). |
| `providers/anthropicApi.ts` | Anthropic API via `@anthropic-ai/sdk` (`claude-opus-4-8`, adaptive thinking, streaming). |
| `providers/local.ts` | `createLocalProvider()` — any OpenAI-compatible endpoint (Ollama / LM Studio); opt-in. |
| `providers/apple.ts` | `createAppleProvider()` — on-device Apple Foundation Models via the `apple-fm` package. |
| `providers/openaiApi.ts` | The `openai-api` provider — OpenAI chat-completions over `fetch`, no SDK. |
| `providers/openaiCompatible.ts` | The shared OpenAI-protocol client (`chatCompletion`, `listModels`) behind `local` + `openai-api`. |
| `diffBudget.ts` | Pure FR-26/FR-29 budget arithmetic: `capPatch` (max-min fair allocation), `capText`, `shareBudget`, `splitPatchByFile`, `sliceToLine`. No I/O. |
| `providers/index.ts` | `PROVIDERS`, `AUTO_ORDER`, `resolveProvider(requested, opts?)`. |
| `releaseNotes.ts` | `generateReleaseNotes()` — orchestrates the whole flow. |
| `cliArgs.ts` | `parseArgs()` + `USAGE` (pure, testable); `explicit` records which flags were passed. |
| `config.ts` | `loadConfig` / `parseConfig` / `applyConfig` — `gitgist.config.json` or `package.json#gitgist`, merged flag-over-config ([12-config.md](12-config.md)). |
| `cli.ts` | The `gitgist` bin (thin wrapper). |
| `index.ts` | Public API surface + `generateChangelog()` convenience wrapper. |
| `types.ts` | Shared types (`Commit`, `Changelog`, `ReleaseNotesOptions`, `ProviderName`, …). |

## Provider resolution

`resolveProvider('auto')` walks `AUTO_ORDER`
(`[claude-cli, codex, antigravity, gemini, opencode, anthropic-api, openai-api, apple]`)
and returns the first available provider — zero-config signed-in CLIs (no key) before the
API-key backend, then on-device Apple Foundation Models as a free fallback (a
no-op when the device/model isn't available). The `local` provider is
intentionally **not** in `AUTO_ORDER` (opt-in via `--provider local`, so a
normal run never probes localhost). A specific provider can be forced; if none
is available the caller is told to use `--no-ai`.

`antigravity` sits **before** `gemini` on purpose. Gemini CLI stopped serving
Google AI Pro/Ultra and free-tier requests on 2026-06-18, but its `--version`
availability probe still succeeds — so without that ordering `auto` would select
a backend that fails at generation time. `gemini` remains in the order behind it
for Gemini Code Assist Standard/Enterprise licensees, who keep access.

## Diff grounding

Every AI run over a commit range also reads the **actual code diff**
(`readRangeDiff`) and feeds it to the model as the authoritative record of what
changed — commit subjects, bodies, and any changelog text in the range are
secondary. The patch is capped and noise-filtered (lockfiles, `dist/`, vendored
code) while the changed-file list always survives, and whatever was held back is
stated in the prompt. `--no-diff` opts out; a failed diff read warns and degrades
to commit messages rather than failing the run. See
[7-diff-grounding.md](7-diff-grounding.md).

## Fallback & suspect responses

`generateReleaseNotes` guards the AI path: a primary **error** or a **suspect
empty-notes sentinel** (the model returns `_No user-facing changes._` while the
range had commits) triggers a retry with a configured fallback provider
(`--fallback-provider`/`--fallback-endpoint`/`--fallback-model`), then the
deterministic changelog as a final safety net — each step warned on stderr. See
[6-fallback.md](6-fallback.md).

## Trust boundaries

- **git output** — read via `git log -z` (NUL record separator, immune to
  in-message control chars); extra body fields are rejoined defensively.
- **CLI subprocess** — bounded by a timeout; stderr captured and surfaced on
  failure; stdin EPIPE swallowed.
- **AI output** — treated as Markdown; a wrapping code fence is stripped.
