# CLAUDE.md

Guidance for working in the **gitgist** codebase.

## What this is

`gitgist` generates AI-powered release notes / changelogs from a range of git
commits (e.g. from a previous tag to `HEAD`). It ships as both a library and a
CLI. The AI organizes commits into themed Markdown sections; a deterministic
Conventional Commits fallback is available offline.

## Architecture

The pipeline: resolve a range → read commits → generate notes.

- `src/git.ts` — `readCommits(range)` shells out to `git log` (NUL-delimited
  records); `latestTag()` / `resolveCommitRange(from, to)` turn a `from`/`to`
  pair into a range (defaults: latest tag → `HEAD`); `readWorkingChanges()`
  gathers staged/unstaged/untracked diffs for the `--staged`/`--working` flags.
- `src/parse.ts` — `parseCommit(raw)` parses Conventional Commit subjects.
- `src/prompt.ts` — `SYSTEM_PROMPT`, `buildUserPrompt()`, `commitsToMaterial()`,
  `stripCodeFences()`: turn commits into the model prompt and clean its output.
- `src/providers/` — pluggable AI backends implementing `AIProvider`
  (`isAvailable()` / `generate()`):
  - `cli.ts` — `createCliProvider({ command, runArgs, … })`: the reusable
    no-API-key path for any headless coding/agent CLI (`claude -p` and friends).
    Prompt delivered via stdin (default) or as an arg; strips wrapping fences.
  - `claudeCli.ts` — the `claude -p` provider, built from `createCliProvider`.
  - `anthropicApi.ts` — official `@anthropic-ai/sdk`, model `claude-opus-4-8`,
    adaptive thinking, streaming. Reads `ANTHROPIC_API_KEY`. SDK is imported
    lazily.
  - `index.ts` — `resolveProvider(name, order?)`; `auto` (`AUTO_ORDER`) prefers
    the zero-config CLI (no key), then API-key backends.
- `src/releaseNotes.ts` — `generateReleaseNotes()` ties it together (AI path, or
  `ai: false` → deterministic `buildChangelog` + `renderMarkdown`).
- `src/changelog.ts` — deterministic Conventional Commit grouping + Markdown
  rendering (the `--no-ai` path).
- `src/cliArgs.ts` — `parseArgs()` + `USAGE` (testable). `src/cli.ts` — the bin.
- `src/index.ts` — public API. `src/types.ts` — shared types.

## Adding an AI provider

Implement `AIProvider` in `src/providers/<name>.ts` and register it in
`src/providers/index.ts` (`PROVIDERS` + `AUTO_ORDER`).

**Prefer a CLI (no-key) backend.** If the target tool offers a headless mode
(like `claude -p`), build the provider with `createCliProvider()` — it needs no
API key and is the default-friendly path that belongs early in `AUTO_ORDER`.
Reserve API-key providers (`anthropicApi.ts`-style) for tools without a usable
CLI, and place them after the CLI backends.

Follow-up providers on the roadmap, CLI-first where possible: Apple Foundation
Models (on-device Swift helper, see `~/Documents/hotsheet`), Ollama / local
OpenAI-compatible endpoints, OpenAI/Codex (`codex exec`), Gemini CLI, Cursor
agent.

## Conventions

- ESM only, `type: "module"`. Use `.js` extensions in relative imports.
- Strict TypeScript + `typescript-eslint` `strictTypeChecked`. `import type` for
  type-only imports. Avoid truthy checks on strings (`strict-boolean-expressions`).
- Public functions and exported types carry TSDoc.

## Commands

```bash
npm test          # vitest unit tests with coverage
npm run lint      # eslint over src/ and tests/
npm run typecheck # tsc --noEmit
npm run build     # tsup → dist/ (index + cli, with .d.ts)
```

## Testing

Keep AI/process/git calls thin and test the pure logic directly: `parse.ts`,
`changelog.ts`, `prompt.ts`, `cliArgs.ts`, `resolveCommitRange` (the
`from`-provided cases avoid spawning git), and provider availability/selection
(toggle `ANTHROPIC_API_KEY`). The git + orchestration layer is covered by
`tests/integration.test.ts`, which builds a throwaway temp repo and exercises
`readCommits` / `resolveCommitRange` / `generateReleaseNotes({ ai: false })`
offline. CLI providers are tested against a small `node -e` stub command. Don't
hit the real AI in unit tests.

## Documentation

- [docs/1-overview.md](docs/1-overview.md) — what gitgist is and its principles.
- [docs/2-architecture.md](docs/2-architecture.md) — module layout and data flow.
- [docs/3-requirements.md](docs/3-requirements.md) — FR/NFR requirements with status.
- [docs/ai/code-summary.md](docs/ai/code-summary.md) — AI-oriented code map.
- [docs/ai/requirements-summary.md](docs/ai/requirements-summary.md) — AI-oriented requirements digest.

Keep `docs/ai/*` and the requirement status markers in sync when code changes.
