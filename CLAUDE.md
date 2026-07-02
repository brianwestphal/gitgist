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
- `src/prompt.ts` — `SYSTEM_PROMPT` (themed notes) and `COMMIT_SYSTEM_PROMPT`
  (`--format commit`, a Conventional Commit message), plus `buildUserPrompt()`,
  `workingChangesToMaterial()`, `commitsToMaterial()`, `stripCodeFences()`.
  `releaseNotes.ts` picks the system prompt from `options.format`.
- `src/providers/` — pluggable AI backends implementing `AIProvider`
  (`isAvailable()` / `generate()`):
  - `cli.ts` — `createCliProvider({ command, runArgs, … })`: the reusable
    no-API-key path for any headless coding/agent CLI (`claude -p` and friends).
    Prompt delivered via stdin (default) or as an arg; strips wrapping fences.
  - `claudeCli.ts` — the `claude -p` provider, built from `createCliProvider`.
  - `codex.ts` / `gemini.ts` / `opencode.ts` — the other no-key agent-CLI
    providers (`codex exec`, `gemini -p`, `opencode run`), each a
    `createCliProvider` spec. `--model` is threaded via `createCliProvider`'s
    `runArgs`-function form. See [docs/5-providers.md](docs/5-providers.md).
  - `anthropicApi.ts` — official `@anthropic-ai/sdk`, model `claude-opus-4-8`,
    adaptive thinking, streaming. Reads `ANTHROPIC_API_KEY`. SDK is imported
    lazily.
  - `local.ts` — `createLocalProvider()`: any OpenAI-compatible endpoint
    (Ollama / LM Studio) via `fetch`; returns freeform Markdown. Opt-in only.
  - `apple.ts` — `createAppleProvider()`: on-device macOS Apple Foundation
    Models, delegating to the [`apple-fm`](https://www.npmjs.com/package/apple-fm)
    npm dependency (`probe()` / `generate()`). `apple-fm` bundles the signed Swift
    helper that wraps `FoundationModels`; `APPLE_FM_BIN` points at a custom build.
    Prefixes the prompt with `Treat the following as <language>:` to satisfy the
    on-device language guardrail (`--language`, default: detected system language;
    `auto` opts out). See `detectSystemLanguage` / `AUTO_LANGUAGE`.
  - `index.ts` — `resolveProvider(name, opts?)`; `auto` (`AUTO_ORDER`) prefers
    the zero-config CLI, then API-key backends, then on-device `apple` (a no-op
    when the device/model isn't available). `local` is excluded from `AUTO_ORDER`
    (never auto-probed); `opts` carries the local endpoint/model.
- `src/releaseNotes.ts` — `generateReleaseNotes()` ties it together (AI path, or
  `ai: false` → deterministic `buildChangelog` + `renderMarkdown`).
- `src/changelog.ts` — deterministic Conventional Commit grouping + Markdown
  rendering (the `--no-ai` path).
- `src/template.ts` — `loadTemplate()` / `parseTemplate()` for `--template`
  (Markdown + YAML frontmatter); fed to the model via `TEMPLATE_SYSTEM_PROMPT`.
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

Threading `--model` through a CLI backend: pass `runArgs` as a function of
`{ model }` (see `providers/codex.ts` / `gemini.ts` / `opencode.ts`) so the model
flag lands at that CLI's expected position.

Follow-up providers on the roadmap, CLI-first where possible: Cursor agent
(`cursor-agent`, GG-7), plus optional API-key fallbacks for the agent CLIs
(OpenAI / `@google/genai`). (Done: OpenAI/Codex — `providers/codex.ts`; Gemini
CLI — `providers/gemini.ts`; OpenCode — `providers/opencode.ts`; Ollama / local
OpenAI-compatible — `providers/local.ts`; Apple Foundation Models —
`providers/apple.ts`, delegating to the `apple-fm` npm package.) Provider specs:
[docs/5-providers.md](docs/5-providers.md).

## Conventions

- ESM only, `type: "module"`. Use `.js` extensions in relative imports.
- Strict TypeScript + `typescript-eslint` `strictTypeChecked`. `import type` for
  type-only imports. Avoid truthy checks on strings (`strict-boolean-expressions`).
- Public functions and exported types carry TSDoc.

### Code search (prefer ast-grep for structure)

For **structural / syntax-aware** searches over the `.ts` source, use **ast-grep**
(the `ast-grep` skill, or the CLI: `ast-grep run --lang ts -p '<pattern>' src`)
rather than text grep — it matches the AST, so it skips comments/strings and
catches multi-line/nested shapes. This is the same mindset as the project's
strict-typed lint rules (§ Conventions: `strict-boolean-expressions`,
`consistent-type-imports`). Good fits here: `$A as $B` casts (we keep these
rare), `JSON.parse($X) as $T`, truthy string checks the linter forbids, relative
imports missing the required `.js` extension, `process.env.$X` reads, and
specific call/spec shapes like `createCliProvider({ $$$ })` or `resolveProvider($$$)`
when threading a new provider or `--model`. Also the natural tool for
codemod-style rewrites (`ast-grep run -p '<old>' --rewrite '<new>'`).

Keep **text search** (ripgrep / the editor's grep / the Explore agent) for what
it's best at: literal strings (e.g. `FEEDBACK NEEDED`), identifier/symbol
lookups, **filenames**, and **non-code files** (the `docs/` Markdown, JSON,
`git log` output) — there AST has nothing to match and text is simpler + faster.
This repo is TypeScript-only, so `--lang ts` covers everything; there are no
`.tsx` or Rust sources here.

## Commands

```bash
npm test              # vitest unit tests with coverage
npm run check:features # feature/requirement coverage report (behaviors, not lines)
npm run lint          # eslint over src/ and tests/
npm run typecheck     # tsc --noEmit
npm run build         # tsup → dist/ (index + cli, with .d.ts)
```

## Git workflow

- **Commit freely** when it helps — commit completed, coherent units of work as
  needed without asking first.
- **Never `git push` without explicit permission.** Pushing to a remote always
  requires the user to ask for it (or confirm) in that moment; prior approval to
  commit does not extend to pushing.

## Documentation

- [docs/1-overview.md](docs/1-overview.md) — what gitgist is and its principles.
- [docs/2-architecture.md](docs/2-architecture.md) — module layout and data flow.
- [docs/3-requirements.md](docs/3-requirements.md) — FR/NFR requirements with status.
- [docs/4-templates.md](docs/4-templates.md) — the `--template` format reference.
- [docs/5-providers.md](docs/5-providers.md) — the CLI-first agent providers (codex/gemini/opencode) reference.
- [docs/6-fallback.md](docs/6-fallback.md) — fallback provider + suspect empty-notes (`--fallback-*`) handling.
- [docs/manual-test-plan.md](docs/manual-test-plan.md) — manual checks (CLI-provider output quality).
- [docs/ai/code-summary.md](docs/ai/code-summary.md) — AI-oriented code map.
- [docs/ai/requirements-summary.md](docs/ai/requirements-summary.md) — AI-oriented requirements digest.

<!-- hotsheet:begin section=ticket-driven-work v=1 -->
## Ticket-Driven Work

When the user gives you work directly (not via the Hot Sheet channel or events), create Hot Sheet tickets before starting implementation — especially for substantial or multi-step work.

- **Do create tickets** for: features, bug fixes, refactoring, multi-step tasks, anything changing code. **Don't** for: simple questions, git commits, quick lookups, trivial one-liners. **When in doubt, create them.**
- Create via the Hot Sheet API (prefer the `hotsheet_*` MCP tools), mark Up Next, then work through them: set status `started` → implement → set `completed` with notes.
- **Always create follow-up tickets** for incomplete work (unfinished steps, open design questions, known gaps, designed-but-unbuilt features). If it's not in a ticket, it's forgotten.
- **Incomplete-work checklist** — before marking a ticket `completed`, file follow-ups for any: (1) UI placeholder text ("coming soon"), (2) TODO/FIXME comments, (3) documented-but-unimplemented requirements, (4) empty/stub functions returning mock data.
- **Use FEEDBACK NEEDED before deferring or asking about follow-ups.** When about to (a) defer a ticket needing more work, (b) ask whether to file follow-ups, or (c) close with a question buried in notes — DON'T. Leave the ticket `started`, add a `FEEDBACK NEEDED:` note (per `.hotsheet/worklist.md`), signal channel done, and wait. It's the only reliable way to surface a question.
<!-- hotsheet:end section=ticket-driven-work -->

<!-- hotsheet:begin section=testing-philosophy v=2 -->
## Testing Philosophy

- **Double coverage**: every feature covered by both unit tests AND E2E tests. Unit = logic in isolation; E2E = real user flows through the running app with minimal mocking.
- **Unit tests**: Mock external deps (filesystem, network), test real logic.
- **E2E tests**: As much as possible, use test automation tools to run realistic, user-facing flows. Minimize mocks.
- **Coverage**: Merge all test coverage (e.g. unit, E2E server, E2E browser) into one report. Low-coverage files should get more of both test types. Aim for 100% coverage of code lines, 100% coverage of branches, and 100% of features described in the requirements documentation.
- **Coverage is a floor, not a ceiling**: 100% line/branch coverage shows every line *ran*, not that every *behavior* — or every *sequence* of behaviors — is *asserted*. It is structurally blind to a **missing state transition**: a bug living in an untested interaction sails through a green 100% report because the individual lines still get hit by isolated, single-operation tests.
- **Transition-matrix testing for stateful modules**: for anything with modes / multiple code paths / a cache / a state machine, enumerate the states AND the transitions between them, then write tests that walk realistic multi-step sequences crossing state boundaries — not just each operation from a clean initial state.
- **Adversarial pass on stateful changes**: when adding or altering a stateful code path, deliberately try to break it with out-of-order / interleaved / repeated / empty-then-refill sequences; pin any that would have failed as permanent regression tests.
- **Manual test plan**: keep a manual test plan doc (e.g. `docs/manual-test-plan.md`) for features that can't be reliably automated. **Keep it up to date** — add such features there; when you add automated coverage for a previously-manual item, remove it and note it in an "Automated Coverage Summary".
- **Always fix lint and type errors before finishing**: Fix as you go, don't batch.

<!-- hotsheet:begin specifics=testing-philosophy v=1 -->
### This project's test setup

- **Unit tests** (`tests/**/*.test.ts`): [vitest](https://vitest.dev/) with v8 coverage,
  configured in `vitest.config.ts` (`globals: true`, coverage floors that fail the run on
  regression). Keep AI/process/git calls thin and test the pure logic directly — `parse.ts`,
  `changelog.ts`, `prompt.ts`, `cliArgs.ts`, `template.ts`, and provider availability/selection
  (toggle `ANTHROPIC_API_KEY`). The `from`-provided `resolveCommitRange` cases avoid spawning git.
  Mock external deps; never hit the real AI.
- **Integration tests** (`tests/integration.test.ts`): vitest — no separate E2E framework. Stands
  in for E2E: builds a throwaway temp git repo and exercises `readCommits` / `resolveCommitRange` /
  `generateReleaseNotes({ ai: false })` offline. CLI providers run against a small `node -e` stub command.
- **Meta tests** (`tests/docs.test.ts`): assert the public barrel (`src/index.ts`) and the docs stay in sync.
- **Convention / feature-coverage guards** (`tests/conventions.test.ts`, GG-45): the requirement-level
  invariants line coverage can't express — every Shipped/Partial requirement AND every state transition
  (`T-N`) in `docs/3-requirements.md` has an asserting test linked by a `// @covers <ID>` tag; the public
  export surface matches the docs; the runtime dependency allow-list holds; relative imports carry `.js`;
  only the two provider modules import an SDK. **Feature coverage is a separate axis from line/branch
  coverage** — `npm run check:features` (`scripts/check-features.mjs`, shared parser in
  `scripts/lib/features.mjs`) prints the FR/NFR/T ↔ test report and fails on an uncovered behavior or a
  stale tag, even at 100% line coverage. When you add/change a behavior, add its row to
  `docs/3-requirements.md` (+ the AI summary) and a `// @covers <ID>` tag on the test that would fail if it
  regressed. It runs in `npm test` (via the conventions test) and as its own CI job.
- **Commands**: `npm test` (`vitest run --coverage`, all of the above, one merged v8 report in `coverage/`)
  · `npm run test:watch` for watch mode. No manual test plan doc yet — add one (`docs/manual-test-plan.md`)
  if a feature can't be reliably automated.
<!-- hotsheet:end specifics=testing-philosophy -->
<!-- hotsheet:end section=testing-philosophy -->

<!-- hotsheet:begin section=requirements-documentation v=1 -->
## Requirements Documentation

Keep human-readable requirements documents as the source of truth for what the project does, and **keep them up to date in the same change as the code** (add/remove/modify a requirement → update its doc). Create new docs for major new functional areas. Cross-reference related docs with relative links.

### AI Summaries

Maintain two synthesis docs an AI assistant reads at the start of a fresh session — keep them in sync with reality (source doc/code wins on conflict), and prefer small targeted edits over rewrites:

- A **codebase map** — directory tree, entry points, data schema, build, tests, settings, and a "where do I look for X" index. Update it in the same change when you add a file or directory, add a route/endpoint, change the schema, add a client module, or add a setting key.
- A **requirements summary** — a synthesized view of every requirements doc with status markers (e.g. Shipped / Partial / Design only / Deferred). Update it in the same change when you add a requirements doc, ship a design-only feature, or defer/regress a shipped one.

<!-- hotsheet:begin specifics=requirements-documentation v=1 -->
### This project's docs layout

Requirements docs live in `docs/`, numbered by topic (`1-overview.md`, `2-architecture.md`,
`3-requirements.md`, `4-templates.md`) — see the **Documentation** section above for the full
index. The two AI-summary files:

- **Codebase map**: `docs/ai/code-summary.md`
- **Requirements summary**: `docs/ai/requirements-summary.md` (status markers live here and in
  `docs/3-requirements.md`)

Update both AI summaries and the requirement status markers in the same change as the code.
<!-- hotsheet:end specifics=requirements-documentation -->
<!-- hotsheet:end section=requirements-documentation -->
