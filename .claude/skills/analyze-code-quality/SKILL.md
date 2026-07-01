---
name: analyze-code-quality
description: Run all available tests and linters, check for anti-patterns, and generate a comprehensive code quality report
allowed-tools: Read, Grep, Glob, Bash, Agent
---

Analyze the overall quality of the gitgist source. Generate a comprehensive
report.

## Steps

1. **Run unit + integration tests with coverage** (one merged v8 report)
   ```
   npm test
   ```
   Report total tests, pass/fail, and coverage per file. The thresholds in
   `vitest.config.ts` are the floor — currently **statements 80 / branches 75 /
   functions 72 / lines 80**, with `src/cli.ts` excluded as the thin bin. Flag
   any file that drags the suite toward those floors. The real-I/O provider paths
   (`anthropicApi.ts`, `apple.ts`, `local.ts`) are expected to show lower line
   coverage because their network/subprocess calls aren't exercised live; what
   matters is that their *logic* (prompt assembly, response parsing, availability
   selection) is unit-tested via injected runners/`fetch`. Flag a provider whose
   coverage drop reflects untested *logic*, not just untested I/O.

   **Coverage % is a floor, not a ceiling.** 100% line/branch coverage proves
   every line *ran* during the suite — it does **not** prove every behavior or
   sequence is *asserted*. A stateful module can sit at 100%
   line/branch/function/statement coverage and still ship sequence bugs, because
   each operation was tested from a clean initial state while the *transitions
   between internal states* were never exercised. So treat high coverage not as a
   stopping point but as the trigger for the behavioral audit in **step 2** — the
   two together are the bar, not the percentage alone.

2. **Behavioral / state-transition audit** (the coverage number can't see this).

   Coverage tells you every *line* ran; it cannot tell you a *sequence* is wrong
   or a behavior is missing. This step audits the source for **stateful modules**
   and checks whether the tests exercise the transitions *between* their states,
   not just each operation from a clean start.

   1. **Find the stateful modules.** Heuristic: any module with multiple code
      paths keyed on an internal mode/flag/phase, a state machine, a
      cache-with-fallback, retry/degradation logic, or lifecycle transitions. In
      this repo the prime example is `src/releaseNotes.ts` — `generateViaAI()`
      routes primary → configured fallback → deterministic changelog based on
      whether the primary **errored**, whether its output is **suspect**
      (`isInvalid`), and whether a **fallback is configured** (`hasFallback`).
      Other candidates: `resolveProvider` / `AUTO_ORDER` selection in
      `src/providers/index.ts` (which backend wins as availability changes), the
      `createCliProvider` stdin-vs-arg delivery paths in `src/providers/cli.ts`,
      and the working-tree-vs-range branching at the top of `generateReleaseNotes`.
   2. **Enumerate states + transitions.** For each module, list its internal
      states and the transitions between them (e.g. for `generateViaAI`:
      primary-ok · primary-suspect-no-fallback · primary-suspect→fallback-ok ·
      primary-suspect→fallback-suspect · primary-error-no-fallback ·
      primary-error→fallback-ok · primary-error→fallback-error).
   3. **Check the tests exercise the transitions, not just the operations.** Grep
      the suite for tests that drive *multi-step sequences across state
      boundaries* — out-of-order, interleaved, repeated, empty-then-refill,
      error-then-recover. Flag any stateful module whose tests only cover
      **single-operation-from-clean-state** even if its line/branch coverage is at
      100%.
   4. **Recommend an adversarial transition-matrix test** for each flagged module:
      name the specific sequences to add (concretely, e.g. "primary errors, then
      fallback also errors → keeps primary result and warns"). File these as
      `hs-task` / `hs-bug` findings — a 100%-covered module with untested
      transitions is a finding, not a pass.

3. **Run the linter**
   ```
   npm run lint
   ```
   Report errors / warnings grouped by rule.

4. **Run typecheck**
   ```
   npm run typecheck
   ```
   Report any type errors.

5. **Check anti-patterns** (conventions from `CLAUDE.md`):
   - **Relative imports missing `.js`** — grep `src/`/`tests/` for relative
     imports without a `.js` suffix.
   - **Type-only imports not using `import type`** — flag `import { Foo }` where
     `Foo` is only a type.
   - **`any` leaks** — grep `src/` for `: any\b`, `as any\b`, `<any>`. House style
     under `strictTypeChecked` is `unknown` + a narrowing check.
   - **Truthy string checks** — `strict-boolean-expressions` is on; flag any
     `if (someString)` test (use `=== undefined` / `.length > 0`).
   - **Missing TSDoc** — public functions and exported types must carry TSDoc
     (`eslint-plugin-tsdoc`). Spot-check the `src/index.ts` surface.
   - **Runtime dependency creep** — `package.json` runtime `dependencies` should
     be only `@anthropic-ai/sdk` and `apple-fm`. Flag any addition (or a
     mis-placed dep/devDep) for review.
   - **Direct model access** — only `src/providers/apple.ts` may import the
     `apple-fm` package; only `src/providers/anthropicApi.ts` may import
     `@anthropic-ai/sdk` (lazily). Grep `src/` for `FoundationModels` (should be
     zero hits outside comments) and for stray `@anthropic-ai/sdk` imports.
   - **Provider contract** — every file under `src/providers/` except `index.ts`,
     `types.ts`, and `cli.ts` (the factory) should implement `AIProvider`
     (`isAvailable()` / `generate()`) and be registered in `PROVIDERS` +
     (unless opt-in like `local`) `AUTO_ORDER`. Flag a provider that exists but
     isn't wired in, or is wired in but doesn't implement the contract.
   - **TODO/FIXME/HACK** — grep the tree; each is a finding to triage.

6. **Check the build shape**
   ```
   npm run build && ls dist/
   ```
   Verify `dist/index.js`, `dist/cli.js`, and their `.d.ts` files exist, and that
   `dist/cli.js` keeps its `#!/usr/bin/env node` shebang (it's the `gitgist` bin).
   `npm pack --dry-run` for the published file list (the `files` field is `dist`
   minus source maps) — skip if it errors on local npm cache permissions; CI is
   authoritative.

## Report Format

- **Summary**: tests pass/fail, coverage %, lint clean, typecheck clean, build
  outcome.
- **Coverage**: per-file table, highlighting anything near or under threshold,
  distinguishing untested-I/O from untested-logic. State that 100% is a floor,
  not a ceiling.
- **Transition coverage**: per stateful-module assessment — its states, whether
  the tests exercise the transitions between them, and (for any flagged module)
  the concrete adversarial sequences to add. A 100%-covered module with untested
  transitions belongs here as a finding.
- **Lint / Type issues**: grouped.
- **Anti-Pattern Violations**: file + line, severity (high/medium/low), one-line
  fix each.
- **Build Shape**: pass/fail per check from step 6.
- **Recommendations**: prioritized. File Hot Sheet tickets (`hs-task` /
  `hs-bug`) for non-trivial findings.
