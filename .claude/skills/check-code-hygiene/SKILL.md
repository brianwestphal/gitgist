---
name: check-code-hygiene
description: Check code for standardization, readability, maintenance complexity, and defensive coding practices
allowed-tools: Read, Grep, Glob, Bash, Agent
---

Analyze the gitgist codebase for code hygiene issues. Generate a report on
standardization, human readability, maintenance complexity, and defensive coding.

Scope: `src/` and `src/providers/`, and (where relevant) `tests/` and the
helper scripts under `scripts/`. gitgist is small — expect 0–5 findings in a
healthy state.

## Analysis Areas

### 1. Standardization
- **File naming**: `src/` uses lowercase/camelCase matching the primary concept
  of the file (`cliArgs.ts`, `releaseNotes.ts`, `changelog.ts`). Providers live
  under `src/providers/` named for the backend (`anthropicApi.ts`, `claudeCli.ts`,
  `local.ts`, `apple.ts`). Flag a name that matches neither convention.
- **Identifier casing**: camelCase values, PascalCase types, SCREAMING_SNAKE
  module-level constants (e.g. `SYSTEM_PROMPT`, `AUTO_ORDER`, `AUTO_LANGUAGE`).
  Flag inconsistencies.
- **Import style** (CLAUDE.md "Conventions"): all relative imports use the `.js`
  extension; type-only imports use `import type`. eslint enforces order — if lint
  passes, order is fine, but the `.js` extension and `import type` checks are your
  responsibility (grep for relative imports missing `.js`, and for `import {`
  lines that pull in only types).
- **Error message style**: throws should be descriptive and actionable (e.g.
  `--max-tokens expects a number, got "abc"`). Flag terse
  `throw new Error('failed')`-style throws, especially in `cliArgs.ts` and the
  provider boundaries.
- **TSDoc**: CLAUDE.md requires TSDoc on public functions and exported types
  (`eslint-plugin-tsdoc` is on). Flag any exported symbol in `src/index.ts`'s
  surface that lacks it.

### 2. Human Readability
- **File / function length**: gitgist has no hard LOC cap, but flag any `src/*.ts`
  that has grown unwieldy (≫ ~250 LOC) or any function over ~50 lines or nested
  deeper than 3 — `prompt.ts`, `releaseNotes.ts`, and `cliArgs.ts` are the usual
  growth spots.
- **Magic numbers / strings**: defaults like the subprocess timeout, default
  `max-tokens`, and the model id (`claude-opus-4-8`) should live as named
  constants. Flag a new inline literal that should be one.
- **Comments**: house style is *why*, not *what*. Flag both noise comments that
  paraphrase the next line AND missing rationale on non-obvious code (e.g. the
  NUL-record git parsing in `git.ts`, the agentic-CLI preamble stripping in
  `prompt.ts`/`cleanModelOutput`, the Apple language-guardrail prefix in
  `apple.ts`).

### 3. Maintenance Complexity
- **Layering** (the pipeline in CLAUDE.md "Architecture"): pure logic stays in
  `parse.ts` / `changelog.ts` / `prompt.ts` / `cliArgs.ts` / `template.ts`; only
  `git.ts` shells out to `git`; only the provider modules talk to an AI backend;
  `cli.ts` is the thin bin. Flag a layer violation (e.g. `releaseNotes.ts`
  spawning a process directly, or pure logic importing a provider).
- **Provider boundary**: each provider implements `AIProvider`
  (`isAvailable()` / `generate()`). Only `apple.ts` may import the `apple-fm`
  package; only `anthropicApi.ts` may import `@anthropic-ai/sdk` (and it must stay
  a **lazy** import); CLI backends go through `createCliProvider` in
  `providers/cli.ts` rather than re-implementing subprocess handling. Flag any
  provider that reaches around these.
- **Dependencies**: `package.json` runtime `dependencies` are intentionally just
  `@anthropic-ai/sdk` and `apple-fm`. Flag any *new* runtime dependency (or a dev
  dependency that should be runtime, or vice versa) — call it out for review
  rather than assuming it's wrong.
- **Duplicate patterns**: spot-check with grep for repeated subprocess/`execFile`
  idioms (should be centralized in `git.ts` and `providers/cli.ts`) and repeated
  fence-stripping logic (should be `stripCodeFences`/`cleanModelOutput` in
  `prompt.ts`).

### 4. Defensive Coding
- **Boundary validation**: `parseArgs` rejects unknown flags and bad numbers;
  `git.ts` bounds and parses subprocess output robustly; `createCliProvider`
  bounds the child with a timeout and captures stderr (NFR-2). Verify these still
  hold and haven't regressed.
- **`any` / non-null**: grep `src/` for `: any`, `as any`, `<any>`, and `!`
  non-null assertions (tests get a pass). House style under `strictTypeChecked`
  is `unknown` + narrowing.
- **Truthy string checks**: `strict-boolean-expressions` is on — flag any
  `if (someString)` style test that should be `=== undefined` / `.length > 0`.
- **Swallowed errors**: flag any blanket `try { … } catch { /* nothing */ }`
  without a documented reason. The CLI-availability probes legitimately catch and
  return `false`; a swallowed error in a generate path is a finding.
- **Stale artifacts**: check for leftovers from the vendored-Apple-FM-helper
  removal (commit `1b0502a` replaced a vendored Swift helper with the `apple-fm`
  package) — orphaned files, dead `release.yml` jobs, or `src/` code referencing a
  removed local helper. Grep `src/` for `FoundationModels` (should be zero hits
  outside comments — gitgist reaches the model only through the `apple-fm`
  package).

### Quick gates
Run and report: `npm run lint`, `npm run typecheck`, `npm test`. Grep the tree
for `TODO|FIXME|HACK|XXX`, `console.log`, and `eslint-disable` — each is a
finding to triage.

## Report Format

For each finding: **File** (path + lines), **Category**
(standardization | readability | maintenance | defensive), **Severity**
(high | medium | low), **Description**, **Suggestion**.

End with a prioritized top-N (gitgist is small — expect 0–5 in a healthy state).
File Hot Sheet tickets (`hs-task` for cleanups, `hs-bug` for real defects) for any
non-trivial finding.
