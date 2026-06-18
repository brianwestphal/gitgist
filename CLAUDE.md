# CLAUDE.md

Guidance for working in the **gitgist** codebase.

## What this is

`gitgist` generates release notes / changelogs from a range of git commits
(e.g. from a previous tag to `HEAD`). It ships as both a library and a CLI.

## Architecture

The core is a three-stage pipeline, one module per stage:

- `src/git.ts` — `readCommits(range)` shells out to `git log` with a
  control-character-delimited pretty format and returns parsed `Commit`s.
- `src/parse.ts` — `parseCommit(raw)` parses a Conventional Commits subject
  (`type(scope)!: description`) and detects breaking changes (bang marker or
  `BREAKING CHANGE:` footer). Unparseable subjects are kept, not dropped.
- `src/changelog.ts` — `buildChangelog()` groups commits by type into
  `ChangelogSection`s; `renderMarkdown()` emits the Markdown document.

`src/index.ts` is the public API and wires the stages together in
`generateChangelog()`. `src/cli.ts` is the `gitgist` bin. `src/types.ts` holds
shared types.

## Conventions

- ESM only, `type: "module"`. Use `.js` extensions in relative imports (TS
  `moduleResolution: bundler` with `verbatimModuleSyntax`).
- Strict TypeScript and `typescript-eslint` `strictTypeChecked`. Prefer
  `import type` for type-only imports (enforced by lint).
- Public functions and exported types carry TSDoc comments.

## Commands

```bash
npm test          # vitest unit tests with coverage
npm run lint      # eslint over src/ and tests/
npm run typecheck # tsc --noEmit
npm run build     # tsup → dist/ (index + cli, with .d.ts)
```

## Testing

Unit tests live in `tests/*.test.ts` (vitest). Keep `git.ts`'s real-process
work thin; test the pure logic (`parse.ts`, `changelog.ts`) directly with
synthetic commits rather than spinning up repositories.
