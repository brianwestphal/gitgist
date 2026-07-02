# AI Code Summary

A compact map of the codebase for AI agents. Keep in sync with `src/` when code
changes.

## Directory tree

```
src/
  cli.ts              # gitgist bin (thin)
  cliArgs.ts          # parseArgs() + USAGE
  index.ts            # public API surface + generateChangelog()
  types.ts            # shared types
  git.ts              # readCommits, latestTag, resolveCommitRange, readWorkingChanges
  parse.ts            # parseCommit (Conventional Commits)
  prompt.ts           # SYSTEM_PROMPT, COMMIT_SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT, NO_USER_FACING_CHANGES, isEmptyNotesSentinel, buildUserPrompt, buildTemplatePrompt, commitsToMaterial, stripCodeFences, cleanModelOutput, workingChangesToMaterial
  changelog.ts        # buildChangelog, renderMarkdown, renderWorkingChanges, DEFAULT_GROUPS  (--no-ai path)
  template.ts         # loadTemplate, parseTemplate (--template)
  releaseNotes.ts     # generateReleaseNotes (orchestrator)
  providers/
    types.ts          # AIProvider, GenerateRequest
    cli.ts            # createCliProvider (reusable no-key CLI backend; model via runArgs fn, system via systemArgs hook)
    claudeCli.ts      # claudeCliProvider (claude -p; system via --append-system-prompt)
    codex.ts          # codexProvider (codex exec; no key)
    gemini.ts         # geminiProvider (gemini -p; no key)
    opencode.ts       # opencodeProvider (opencode run; no key)
    anthropicApi.ts   # anthropicApiProvider
    local.ts          # createLocalProvider (Ollama / OpenAI-compatible; opt-in)
    apple.ts          # createAppleProvider (macOS Apple Foundation Models via the apple-fm npm package)
    index.ts          # PROVIDERS, AUTO_ORDER, resolveProvider
tests/                # parse, changelog, prompt, cliArgs, git, template, providers, apple, integration, docs
  conventions.test.ts # requirement-level guards line coverage can't express (feature coverage, export surface, dep allow-list, module structure)
scripts/
  check-features.mjs  # `npm run check:features` — feature/requirement coverage report (FR/NFR/T ↔ @covers)
  lib/features.mjs    # shared traceability parser (parseRequirements, collectCovers, computeCoverage)
```

## Public API (`src/index.ts`)

- `generateReleaseNotes(options)` — main entry (AI or `ai:false` offline; commits and/or working-tree changes; `format`/`template`).
- `generateChangelog(range, options)` — deterministic-only convenience wrapper.
- Commits/range: `readCommits`, `latestTag`, `resolveCommitRange`, `parseCommit`.
- Working tree: `readWorkingChanges`, `renderWorkingChanges`, `workingChangesToMaterial`.
- Changelog: `buildChangelog`, `renderMarkdown`, `DEFAULT_GROUPS`.
- Prompt: `SYSTEM_PROMPT`, `COMMIT_SYSTEM_PROMPT`, `TEMPLATE_SYSTEM_PROMPT`,
  `NO_USER_FACING_CHANGES`, `isEmptyNotesSentinel`, `buildUserPrompt`,
  `buildTemplatePrompt`, `commitsToMaterial`, `workingChangesToMaterial`,
  `stripCodeFences`, `cleanModelOutput`.
- Templates: `loadTemplate`, `parseTemplate`, type `Template`.
- Providers: `resolveProvider`, `PROVIDERS`, `AUTO_ORDER`; `createCliProvider`,
  `claudeCliProvider`, `codexProvider`, `geminiProvider`, `opencodeProvider`;
  `createAnthropicApiProvider`, `anthropicApiProvider`; `createLocalProvider`,
  `localProvider`, `DEFAULT_LOCAL_ENDPOINT`; `createAppleProvider`,
  `appleProvider`, `detectSystemLanguage`, `AUTO_LANGUAGE`; types `AIProvider`,
  `GenerateRequest`, `CliProviderSpec`, `AnthropicApiProviderConfig`,
  `LocalProviderConfig`, `AppleProviderConfig`.
- Types: `Commit`, `Changelog`, `ChangelogSection`, `ChangelogOptions`,
  `ReadCommitsOptions`, `ReleaseNotesOptions`, `ProviderName`, `OutputFormat`,
  `WorkingChanges`, `WorkingChangeOptions`, `RawCommit`.

## Where do I look to…

| Task | Look at |
| --- | --- |
| change the AI instructions / section style | `prompt.ts` (`SYSTEM_PROMPT`) |
| change the commit-message output (`--format commit`) | `prompt.ts` (`COMMIT_SYSTEM_PROMPT`); selected in `releaseNotes.ts` |
| change template parsing or the template prompt (`--template`) | `template.ts`; `prompt.ts` (`TEMPLATE_SYSTEM_PROMPT`, `buildTemplatePrompt`); spec in `docs/4-templates.md` |
| add an AI provider | `providers/` — `createCliProvider` for headless CLIs, `createLocalProvider` for OpenAI-compatible HTTP, `createAppleProvider` (delegates to the `apple-fm` package) for on-device; register in `index.ts` (`PROVIDERS` + `AUTO_ORDER`) |
| change how the git range is resolved | `git.ts` (`resolveCommitRange`, `latestTag`) |
| change how commits are read/parsed | `git.ts` (`readCommits`), `parse.ts` |
| change how uncommitted changes are read | `git.ts` (`readWorkingChanges`); orchestration in `releaseNotes.ts` |
| change deterministic (`--no-ai`) grouping | `changelog.ts` |
| change the fallback-provider retry / suspect empty-notes handling | `releaseNotes.ts` (`generateViaAI`, `hasFallback`, `notesInvalid`); sentinel in `prompt.ts` (`NO_USER_FACING_CHANGES`, `isEmptyNotesSentinel`); spec in `docs/6-fallback.md` |
| add/change a CLI flag | `cliArgs.ts` (+ wire in `cli.ts`, `releaseNotes.ts`) |
| change provider selection order | `providers/index.ts` (`AUTO_ORDER`) |
| add a requirement/behavior + its test link | add an FR/NFR/T row to `docs/3-requirements.md`, add a `// @covers <ID>` tag on the asserting test; verify with `npm run check:features` |
| check every documented behavior is tested (not just every line) | `scripts/check-features.mjs` (`npm run check:features`) + `tests/conventions.test.ts` (enforced in `npm test`); index in `docs/3-requirements.md` |
