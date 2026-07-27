# 10. Commit attribution

What the model knows about *which commit did what*, and why that isn't the
per-commit patch it might sound like. Requirement: **FR-30**. Companion to
[7-diff-grounding.md](7-diff-grounding.md) (the net diff) and
[9-provider-budgets.md](9-provider-budgets.md) (the budget it shares).

## The gap

`readRangeDiff` supplies the **net** diff for a range — one patch covering every
commit together. It answers *what changed*, but has no notion of:

- **which commit** made a given change (blocking any "link each bullet to its
  commit/PR" output);
- **what order** changes landed in;
- **which changes belong together** — a signal for grouping bullets into sections.

## Why not per-commit patches

The obvious fix is to send the diff per commit. It was measured (GG-55) and
rejected. On this repo's real ranges, the sum of per-commit patches is
**1.18×–1.71×** the net diff — cheaper than assumed, but that isn't the problem.
Real release ranges already overflow every provider budget, so per-commit mode
spends the same allowance on 1.2–1.7× more bytes and the model ends up seeing
*less* of the release:

| Range | Budget | Net coverage | Per-commit coverage |
| --- | ---: | ---: | ---: |
| `v1.1.0..HEAD` | 120,000 | 49% | **38%** |
| `v1.1.0..HEAD` | 200,000 | 82% | **63%** |

The overhead is re-diffed files, not new information. And the churn it would
reveal — lines added then removed inside the range, invisible in a net diff —
measured at just **1.8%–7.8%** of added lines.

## What gitgist does instead

`readCommitFiles(range, …)` (`src/git.ts`) runs one `git log --name-only` and
returns a **full commit hash → paths it touched** map. `commitsToMaterial` folds
that into the commit list already in the prompt: each commit gains its short hash
and the files it touched.

```
Here are the 12 commits in `v1.1.0..HEAD` (newest first):

- fix: allocate the diff budget per file (GG-57) (452e526)
  files: docs/3-requirements.md, src/git.ts, src/prompt.ts, +7 more
- feat: size the diff budget per provider (GG-52) (cd4f7e9)
  files: src/providers/types.ts, src/releaseNotes.ts, +9 more
```

Measured on `v1.1.0..HEAD`: **~2,600 characters** — against **312,772** for full
per-commit patches. It *adds* information rather than repeating hunks the model
already has.

Note the short hash appears **only when a map is present**. Without one there is
nothing to attribute to, and a hash the model can see is a hash it may cite.

## Budgeting

The map is cheap but not free, and it shares the diff budget (FR-28). At the
`apple` provider's 4,000-char budget the full form would consume the entire
allowance the diff needs.

`attributionFilesPerCommit(budget, commitCount)` keeps it to roughly **15%** of
the budget, shrinking the per-commit list as the budget tightens or the range
grows, and returning `0` — which drops the map entirely — when not even one path
per commit fits:

| Budget | Commits | Paths listed per commit |
| ---: | ---: | ---: |
| 120,000 (agent CLIs) | 12 | 10 (the cap) |
| 24,000 (shared default) | 12 | 10 |
| 4,000 (`apple`) | 12 | 1 |
| 1,000 | 500 | 0 — map dropped |

A commit that touched more files than its allowance shows `+N more`, so the
model still learns the change was broad without paying for the full list. Ten
paths is the ceiling regardless of budget: beyond that the extra paths say
little the count doesn't.

## What the model is told

`ATTRIBUTION_RULES` is interpolated verbatim into all three system prompts:

- The file lists exist to work out **which commit made a change**, to **group**
  changes touching the same files, and to read the **order** they landed
  (newest first).
- **Only cite a hash that appears verbatim** in the material. Never guess,
  reconstruct, or invent one; if unsure which commit made a change, describe it
  without a hash. A model that knows hashes exist will otherwise happily produce
  a plausible-looking one.
- Don't echo hashes into the output unless the requested format asks for them —
  the lists are reasoning aids, not content.

## Scope and opt-out

| Situation | Behavior |
| --- | --- |
| Default | On. One extra `git log` per run. |
| `--no-attribution` / `attribution: false` | Skipped entirely. |
| `--no-ai` | Never read — the deterministic renderer groups commit subjects. |
| No commits in range | Nothing to attribute. |
| Budget too small | Dropped automatically (see above). |
| **The read fails** | **Non-fatal** — warn and continue without attribution, matching the diff read's degrade behavior (T-5). |

Exclusions apply (FR-27), so the map never advertises a lockfile the diff was
told to hide — `--no-default-excludes` brings those paths back here too.

## Related

- [7-diff-grounding.md](7-diff-grounding.md) — the net diff and its budget.
- [8-exclusions.md](8-exclusions.md) — which paths are held back.
- [9-provider-budgets.md](9-provider-budgets.md) — the budget this shares.
