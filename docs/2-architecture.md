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
                    ├─ anthropic-api (providers/anthropicApi.ts)
                    ├─ local         (providers/local.ts — opt-in)
                    └─ apple         (providers/apple.ts — via the apple-fm package)
                 prompt built by prompt.ts (SYSTEM_PROMPT / COMMIT_SYSTEM_PROMPT /
                 TEMPLATE_SYSTEM_PROMPT + buildUserPrompt / buildTemplatePrompt)
```

## Modules (`src/`)

| File | Responsibility |
| --- | --- |
| `git.ts` | `readCommits(range)` (NUL-delimited `git log -z`), `latestTag()`, `resolveCommitRange(from, to)`. |
| `parse.ts` | `parseCommit(raw)` — Conventional Commit subject + breaking-change parsing. |
| `prompt.ts` | `SYSTEM_PROMPT` / `COMMIT_SYSTEM_PROMPT` / `TEMPLATE_SYSTEM_PROMPT`, `buildUserPrompt`, `buildTemplatePrompt`, `commitsToMaterial`, `workingChangesToMaterial`, `stripCodeFences`, `cleanModelOutput`. |
| `changelog.ts` | Deterministic grouping (`buildChangelog`) + Markdown rendering (`renderMarkdown`, `renderWorkingChanges`) — the `--no-ai` path. |
| `template.ts` | `loadTemplate` / `parseTemplate` for `--template` (Markdown + YAML frontmatter). |
| `providers/types.ts` | `AIProvider` / `GenerateRequest` interfaces. |
| `providers/cli.ts` | `createCliProvider()` — reusable no-key CLI backend (timeout, stderr capture). |
| `providers/claudeCli.ts` | The `claude -p` provider (a `createCliProvider` spec). |
| `providers/anthropicApi.ts` | Anthropic API via `@anthropic-ai/sdk` (`claude-opus-4-8`, adaptive thinking, streaming). |
| `providers/local.ts` | `createLocalProvider()` — any OpenAI-compatible endpoint (Ollama / LM Studio); opt-in. |
| `providers/apple.ts` | `createAppleProvider()` — on-device Apple Foundation Models via the `apple-fm` package. |
| `providers/index.ts` | `PROVIDERS`, `AUTO_ORDER`, `resolveProvider(requested, opts?)`. |
| `releaseNotes.ts` | `generateReleaseNotes()` — orchestrates the whole flow. |
| `cliArgs.ts` | `parseArgs()` + `USAGE` (pure, testable). |
| `cli.ts` | The `gitgist` bin (thin wrapper). |
| `index.ts` | Public API surface + `generateChangelog()` convenience wrapper. |
| `types.ts` | Shared types (`Commit`, `Changelog`, `ReleaseNotesOptions`, `ProviderName`, …). |

## Provider resolution

`resolveProvider('auto')` walks `AUTO_ORDER`
(`[claude-cli, anthropic-api, apple]`) and returns the first available provider —
zero-config CLIs (no key) before API-key backends, then on-device Apple
Foundation Models as a free fallback (a no-op when the device/model isn't
available). The `local` provider is intentionally **not** in `AUTO_ORDER`
(opt-in via `--provider local`, so a normal run never probes localhost). A
specific provider can be forced; if none is available the caller is told to use
`--no-ai`.

## Trust boundaries

- **git output** — read via `git log -z` (NUL record separator, immune to
  in-message control chars); extra body fields are rejoined defensively.
- **CLI subprocess** — bounded by a timeout; stderr captured and surfaced on
  failure; stdin EPIPE swallowed.
- **AI output** — treated as Markdown; a wrapping code fence is stripped.
