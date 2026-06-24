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

2. **Run the linter**
   ```
   npm run lint
   ```
   Report errors / warnings grouped by rule.

3. **Run typecheck**
   ```
   npm run typecheck
   ```
   Report any type errors.

4. **Check anti-patterns** (conventions from `CLAUDE.md`):
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

5. **Check the build shape**
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
  distinguishing untested-I/O from untested-logic.
- **Lint / Type issues**: grouped.
- **Anti-Pattern Violations**: file + line, severity (high/medium/low), one-line
  fix each.
- **Build Shape**: pass/fail per check from step 5.
- **Recommendations**: prioritized. File Hot Sheet tickets (`hs-task` /
  `hs-bug`) for non-trivial findings.
