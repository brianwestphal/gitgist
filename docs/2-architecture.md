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
                    ├─ claude-cli   (providers/claudeCli.ts → providers/cli.ts)
                    └─ anthropic-api (providers/anthropicApi.ts)
                 prompt built by prompt.ts (SYSTEM_PROMPT + buildUserPrompt)
```

## Modules (`src/`)

| File | Responsibility |
| --- | --- |
| `git.ts` | `readCommits(range)` (NUL-delimited `git log -z`), `latestTag()`, `resolveCommitRange(from, to)`. |
| `parse.ts` | `parseCommit(raw)` — Conventional Commit subject + breaking-change parsing. |
| `prompt.ts` | `SYSTEM_PROMPT`, `buildUserPrompt`, `commitsToMaterial`, `stripCodeFences`. |
| `changelog.ts` | Deterministic grouping (`buildChangelog`) + Markdown rendering (`renderMarkdown`) — the `--no-ai` path. |
| `providers/types.ts` | `AIProvider` / `GenerateRequest` interfaces. |
| `providers/cli.ts` | `createCliProvider()` — reusable no-key CLI backend (timeout, stderr capture). |
| `providers/claudeCli.ts` | The `claude -p` provider (a `createCliProvider` spec). |
| `providers/anthropicApi.ts` | Anthropic API via `@anthropic-ai/sdk` (`claude-opus-4-8`, adaptive thinking, streaming). |
| `providers/index.ts` | `PROVIDERS`, `AUTO_ORDER`, `resolveProvider(name, order?)`. |
| `releaseNotes.ts` | `generateReleaseNotes()` — orchestrates the whole flow. |
| `cliArgs.ts` | `parseArgs()` + `USAGE` (pure, testable). |
| `cli.ts` | The `gitgist` bin (thin wrapper). |
| `index.ts` | Public API surface + `generateChangelog()` convenience wrapper. |
| `types.ts` | Shared types (`Commit`, `Changelog`, `ReleaseNotesOptions`, `ProviderName`, …). |

## Provider resolution

`resolveProvider('auto')` walks `AUTO_ORDER` (`[claude-cli, anthropic-api]`) and
returns the first available provider — zero-config CLIs (no key) before API-key
backends. A specific provider can be forced; if none is available the caller is
told to use `--no-ai`.

## Trust boundaries

- **git output** — read via `git log -z` (NUL record separator, immune to
  in-message control chars); extra body fields are rejoined defensively.
- **CLI subprocess** — bounded by a timeout; stderr captured and surfaced on
  failure; stdin EPIPE swallowed.
- **AI output** — treated as Markdown; a wrapping code fence is stripped.
