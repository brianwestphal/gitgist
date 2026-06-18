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
  prompt.ts           # SYSTEM_PROMPT, COMMIT_SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT, buildUserPrompt, commitsToMaterial, stripCodeFences, cleanModelOutput, workingChangesToMaterial
  changelog.ts        # buildChangelog, renderMarkdown, renderWorkingChanges, DEFAULT_GROUPS  (--no-ai path)
  template.ts         # loadTemplate, parseTemplate (--template)
  releaseNotes.ts     # generateReleaseNotes (orchestrator)
  providers/
    types.ts          # AIProvider, GenerateRequest
    cli.ts            # createCliProvider (reusable no-key CLI backend)
    claudeCli.ts      # claudeCliProvider
    anthropicApi.ts   # anthropicApiProvider
    index.ts          # PROVIDERS, AUTO_ORDER, resolveProvider
tests/                # parse, changelog, prompt, cliArgs, git, providers, integration
```

## Public API (`src/index.ts`)

- `generateReleaseNotes(options)` — main entry (AI or `ai:false` offline; commits and/or working-tree changes).
- `generateChangelog(range, options)` — deterministic-only convenience wrapper.
- Commits/range: `readCommits`, `latestTag`, `resolveCommitRange`, `parseCommit`.
- Working tree: `readWorkingChanges`, `renderWorkingChanges`, `workingChangesToMaterial`.
- Changelog: `buildChangelog`, `renderMarkdown`, `DEFAULT_GROUPS`.
- Prompt: `SYSTEM_PROMPT`, `buildUserPrompt`, `commitsToMaterial`, `stripCodeFences`.
- Providers: `resolveProvider`, `PROVIDERS`, `AUTO_ORDER`, `createCliProvider`,
  `anthropicApiProvider`, `claudeCliProvider`, and types `AIProvider`,
  `GenerateRequest`, `CliProviderSpec`.
- Types: `Commit`, `Changelog`, `ChangelogSection`, `ChangelogOptions`,
  `ReadCommitsOptions`, `ReleaseNotesOptions`, `ProviderName`, `RawCommit`.

## Where do I look to…

| Task | Look at |
| --- | --- |
| change the AI instructions / section style | `prompt.ts` (`SYSTEM_PROMPT`) |
| change the commit-message output (`--format commit`) | `prompt.ts` (`COMMIT_SYSTEM_PROMPT`); selected in `releaseNotes.ts` |
| change template parsing or the template prompt (`--template`) | `template.ts`; `prompt.ts` (`TEMPLATE_SYSTEM_PROMPT`, `buildTemplatePrompt`); spec in `docs/4-templates.md` |
| add an AI provider | `providers/` — `createCliProvider` for CLIs, register in `index.ts` (`PROVIDERS` + `AUTO_ORDER`) |
| change how the git range is resolved | `git.ts` (`resolveCommitRange`, `latestTag`) |
| change how commits are read/parsed | `git.ts` (`readCommits`), `parse.ts` |
| change how uncommitted changes are read | `git.ts` (`readWorkingChanges`); orchestration in `releaseNotes.ts` |
| change deterministic (`--no-ai`) grouping | `changelog.ts` |
| add/change a CLI flag | `cliArgs.ts` (+ wire in `cli.ts`, `releaseNotes.ts`) |
| change provider selection order | `providers/index.ts` (`AUTO_ORDER`) |
