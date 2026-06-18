# CLAUDE.md

Guidance for working in the **gitgist** codebase.

## What this is

`gitgist` generates AI-powered release notes / changelogs from a range of git
commits (e.g. from a previous tag to `HEAD`). It ships as both a library and a
CLI. The AI organizes commits into themed Markdown sections; a deterministic
Conventional Commits fallback is available offline.

## Architecture

The pipeline: resolve a range → read commits → generate notes.

- `src/git.ts` — `readCommits(range)` shells out to `git log` (control-char
  pretty format); `latestTag()` / `resolveCommitRange(from, to)` turn a
  `from`/`to` pair into a range (defaults: latest tag → `HEAD`).
- `src/parse.ts` — `parseCommit(raw)` parses Conventional Commit subjects.
- `src/prompt.ts` — `SYSTEM_PROMPT`, `buildUserPrompt()`, `commitsToMaterial()`,
  `stripCodeFences()`: turn commits into the model prompt and clean its output.
- `src/providers/` — pluggable AI backends implementing `AIProvider`
  (`isAvailable()` / `generate()`):
  - `anthropicApi.ts` — official `@anthropic-ai/sdk`, model `claude-opus-4-8`,
    adaptive thinking, streaming. Reads `ANTHROPIC_API_KEY`. SDK is imported
    lazily.
  - `claudeCli.ts` — shells out to `claude -p` (prompt piped via stdin). No key.
  - `index.ts` — `resolveProvider(name)`; `auto` prefers the API, then the CLI.
- `src/releaseNotes.ts` — `generateReleaseNotes()` ties it together (AI path, or
  `ai: false` → deterministic `buildChangelog` + `renderMarkdown`).
- `src/changelog.ts` — deterministic Conventional Commit grouping + Markdown
  rendering (the `--no-ai` path).
- `src/cliArgs.ts` — `parseArgs()` + `USAGE` (testable). `src/cli.ts` — the bin.
- `src/index.ts` — public API. `src/types.ts` — shared types.

## Adding an AI provider

Implement `AIProvider` in `src/providers/<name>.ts` and register it in
`src/providers/index.ts` (`PROVIDERS` + `AUTO_ORDER`). Follow-up providers on
the roadmap: Apple Foundation Models (Swift helper, see `~/Documents/hotsheet`),
Ollama / local OpenAI-compatible endpoints, OpenAI/Codex, Gemini, Cursor.

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
(toggle `ANTHROPIC_API_KEY`). Don't hit the real AI in unit tests.
