---
name: check-requirements-against-code
description: Check requirements docs against implementation and report discrepancies
allowed-tools: Read, Grep, Glob, Bash, Agent, Edit, Write
---

Comprehensively compare the requirements documents in `docs/` against the actual
implementation under `src/`, then bring the derived docs back in sync. Also
verify that the two AI summary docs (`docs/ai/code-summary.md`,
`docs/ai/requirements-summary.md`), `CLAUDE.md`, and `README.md` agree with both
the requirements docs and the code. Generate a report with recommendations and
questions about any discrepancies.

## Steps

1. **Read all requirements documents** in `docs/`: the numbered set is
   `1-overview.md`, `2-architecture.md`, `3-requirements.md`, `4-templates.md`.
   If new numbered docs have been added since this skill was written, include
   them too. Also read `README.md` and `CLAUDE.md` — both enumerate the module
   layout and the CLI/API surface and drift the same way.

2. **For each FR/NFR in `3-requirements.md`**, verify it against the code:
   - Find the implementing symbol under `src/` (or `src/providers/`).
   - Check the behavior matches what's documented.
   - Confirm the **status marker** is honest. The markers are **Shipped**
     (implemented + tested), **Partial** (implemented, gaps noted), and
     **Deferred** (planned, tracked by a `GG-` ticket). Don't leave a marker as
     **Shipped** if the behavior is actually incomplete, and don't leave it
     **Partial** if the gap has since been closed. Note the `apple` provider's
     standing caveat: its `generate()` path can only be exercised end-to-end on a
     macOS 26+ Apple-Intelligence device, so on-device behavior is verified by
     proxy (injected runner / mocked `apple-fm`) — keep that nuance accurate.

3. **Verify the CLI flag surface (FR-9 / FR-11 / FR-12 / FR-13 / FR-14 / FR-17)**:
   enumerate every flag `parseArgs` in `src/cliArgs.ts` actually accepts, then
   confirm each is (a) listed in the relevant FR row and (b) present in the
   `USAGE` text. Flag any flag in code but not in the docs/usage, or vice versa.
   Do the same for the **environment variables** the code reads —
   `ANTHROPIC_API_KEY` (`anthropicApi.ts`), `APPLE_FM_BIN` (`apple.ts`),
   `GITGIST_LOCAL_ENDPOINT` / `GITGIST_LOCAL_MODEL` (`local.ts`) — and any
   others you find by grepping `process.env`. Each must be documented.

4. **Verify the provider roster** agrees three ways: the `AIProvider`
   implementations under `src/providers/`, the `PROVIDERS` map + `AUTO_ORDER` in
   `src/providers/index.ts`, and the FR rows (FR-5/6/7/14/15) plus the "Adding an
   AI provider" section of `CLAUDE.md`. The auto-selection order described in the
   docs must match `AUTO_ORDER`; `local` must be excluded from it.

5. **Check `CLAUDE.md` completeness**:
   - Every doc under `docs/` (and `docs/ai/`) appears in the "Documentation"
     list. Report docs present on disk but unlisted, or listed but missing.
   - The "Architecture" section names every file under `src/` and
     `src/providers/`. Report any drift (a new `src/*.ts` landing unlisted is the
     most common miss).
   - The "Commands" section lists every `npm run *` script in `package.json`.
   - The "Conventions" and "Adding an AI provider" sections still match reality.

6. **Synchronize `docs/ai/code-summary.md`**: confirm the directory tree matches
   the actual files under `src/`, `src/providers/`, `tests/`, and `docs/` (use
   `Glob`/`ls` to verify); the public-API/exports list matches what
   `src/index.ts` re-exports; the build-output description matches what
   `npm run build` (tsup) emits (`dist/index.js`, `dist/cli.js`, their `.d.ts`);
   the coverage thresholds match `vitest.config.ts`; and the "where do I look for
   X" entries still resolve to files that exist. Make the edits in place.

7. **Synchronize `docs/ai/requirements-summary.md`**: confirm each FR/NFR line
   matches its row in `3-requirements.md` (same status marker, same notes), every
   newly-added FR/NFR is listed, and the "Tracked follow-ups" `GG-` ticket list
   is current. Make the edits in place.

8. **Cross-check the meta tests**: `tests/docs.test.ts` asserts the public barrel
   (`src/index.ts`) and the docs stay in sync. If your audit finds a barrel/doc
   mismatch that those tests *don't* catch, that's a gap worth a follow-up
   ticket; if the tests would catch it, confirm they pass.

9. **Final consistency pass**: `CLAUDE.md`, `README.md`, and the two AI summaries
   must agree with each other and with the source docs / code. Resolve any
   disagreement in favor of the code / `src/index.ts` (API + flags) /
   `3-requirements.md` (behavior) / `vitest.config.ts` (thresholds), and update
   the summaries and `CLAUDE.md` accordingly. **The most common drift here is a
   new public export, a new `src/*.ts` file, or a new CLI flag landing without
   the AI summaries, `CLAUDE.md`, and `README.md` being updated** — look for that
   explicitly.

## Report Format

### Discrepancies Found
For each: **Requirement** (doc + FR/NFR ID), **Implementation** (file:line),
**Type** (`missing` | `different` | `undocumented` | `stale` | `status-wrong`),
**Recommendation** (fix the doc or fix the code).

### CLAUDE.md / Summary Coverage Audit
List docs, source files, exports, flags, env vars, or scripts present in code but
missing from `CLAUDE.md` / the AI summaries (or vice versa), and any coverage
threshold that doesn't match `vitest.config.ts`.

### Files Edited
The summary/doc files you updated and why (or "no changes needed").

### Questions
Ambiguous requirements where the implementation made a judgment call.

### Summary
Total FR/NFR checked · fully implemented · discrepancies by type · doc gaps ·
files edited.

## Filing follow-ups

For each non-trivial discrepancy that needs code or doc work beyond a quick
in-place edit, file a Hot Sheet ticket (`hs-requirement-change` for a
requirement/spec change, `hs-task` for a doc-sync cleanup, `hs-bug` for code that
diverges from a Shipped requirement). Reference the FR/NFR ID in the ticket.
