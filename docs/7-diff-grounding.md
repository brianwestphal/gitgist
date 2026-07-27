# 7. Diff grounding

How gitgist decides *what actually changed*. Requirements: **FR-25** (diff-grounded
generation), **FR-26** (bounded, noise-filtered material), **T-5** (degrade when the
diff can't be read). See [3-requirements.md](3-requirements.md).

## Why

A commit range carries two very different kinds of evidence:

| Evidence | What it tells you |
| --- | --- |
| Commit subjects and bodies | What the author *said* they were doing, written before review, often terse (`chore: tidy up`) or stale after a rebase. |
| Changelog / docs files in the range | What someone *claimed* for an audience — intent, restated. |
| **The code diff** | What the software *actually does now*. |

Summarizing from the first two alone produces notes that inherit every gap in the
commit log: a feature added under `chore:` is invisible, a bullet copied from a
stale `CHANGELOG.md` gets repeated as fact, and a subject that overstates its
change goes unchallenged. gitgist reads the **diff** and treats it as the
authority, so the notes describe behavior rather than paraphrasing the commit log.

This is on by **default** — grounding is the normal mode, not an opt-in.

## What gets read

`readRangeDiff(range, { cwd, maxChars })` (`src/git.ts`) returns a `RangeDiff`:

| Field | Contents |
| --- | --- |
| `files` | Every changed path in the range. **Always complete.** |
| `stat` | `git diff --stat` — the per-file line delta. Capped at 4000 chars. |
| `patch` | The unified diff, minus noise paths, capped at `maxChars`. |
| `excluded` | Paths that changed but whose patch body was dropped as noise. |
| `truncated` | True when the stat or patch was trimmed to fit. |
| `isEmpty` | True when the range changed no files (no patch commands run). |

### Range → diff revisions

`git log a..b` lists commits reachable from `b` but not `a`. The diff covering
exactly those commits is the merge-base form **`a...b`**, so that is what
`readRangeDiff` asks for — identical to `a..b` on the linear histories this
usually runs against, and correct when the branches diverged.

A **bare revision** (what `resolveCommitRange` returns for an untagged
repository, meaning "all history up to here") is diffed against git's empty-tree
object `4b825dc…`, so a first release sees its whole tree as the change.

## Keeping the material bounded (FR-26)

A release range can contain megabytes of diff, most of it worthless to a reader.
Two mechanisms keep the prompt useful:

**Noise pathspecs.** Lockfiles, build output, vendored code, and generated assets
are excluded from the patch body via git `:(exclude)` pathspecs — currently
`*.lock`, `*lock.json`, `*lock.yaml`, `*.min.js`, `*.min.css`, `*.map`, `*.snap`,
`dist/*`, `build/*`, `vendor/*`, `node_modules/*`. They stay in `files` and
`stat`: the model still learns that `package-lock.json` changed, it just doesn't
spend 5000 lines of budget on it.

**A character budget.** The patch is capped at 24000 chars by default
(`--max-diff-chars`). The stat and the changed-file list are *never* dropped, so
an oversized range degrades to "here is every file that changed, plus as much
diff as fits" rather than to nothing.

Both are **stated in the prompt**, not applied silently — `rangeDiffToMaterial`
names the excluded files and flags a truncated patch, and the rules tell the
model to describe only what it can see. Hiding the boundary would invite exactly
the invented detail the diff is meant to prevent.

## What the model is told

`rangeDiffToMaterial` (`src/prompt.ts`) emits, after the commit list:

```
Code diff for `v1.0.0..HEAD` — the authoritative record of what actually
changed. Ground the summary in this, not in the commit messages above:

### Changed files (12)
<stat>

### Patch
<patch>

Note: these changed files are listed above but their diff was omitted as
generated/lockfile noise — do not describe their contents: package-lock.json
```

The precedence rule itself lives in `DIFF_IS_SOURCE_OF_TRUTH_RULES`, interpolated
verbatim into `SYSTEM_PROMPT`, `TEMPLATE_SYSTEM_PROMPT`, and
`COMMIT_SYSTEM_PROMPT` so it cannot drift between output formats. It says:

- The diff is authoritative; commit prose and changelog text are secondary and
  may be incomplete, stale, or wrong.
- Report user-facing changes visible in the diff **even when no commit message
  mentions them**; drop or correct claims the diff does not support. On conflict,
  the diff wins.
- Never describe a change you cannot point to in the material. If the patch was
  truncated, say nothing about the omitted part.

This pairs with `NO_CROSS_REFERENCE_RULES` (FR-24): a `CHANGELOG.md` entry in the
range is evidence to describe in full, never a document to defer to.

## When it does not run

| Situation | Behavior |
| --- | --- |
| `--no-ai` / `ai: false` | No diff is read. The deterministic renderer groups commit subjects by Conventional Commit type; a patch has nothing to contribute. |
| `--no-diff` / `diff: false` | Explicit opt-out — commit messages only. Smaller prompts, weaker accuracy. Useful against a small-context local model. |
| No commits in range | Nothing to diff. Working-tree flags supply their own diffs (FR-11). |
| **The diff read fails** (T-5) | **Non-fatal.** `readRangeDiff` throwing — an unresolvable revision, a shallow CI clone whose base commit is absent — emits a warning (`could not read the code diff for … ; summarizing from commit messages only`) and generation continues from the commit messages. A missing diff degrades quality; it must never turn a working run into a failure. |

## Interaction with working-tree changes

`--staged` / `--unstaged` / `--untracked` (FR-11) already fed real diffs to the
model; FR-25 closes the gap for *committed* history, which previously reached the
model as subjects and bodies only. When both are present the prompt carries the
commit list, then the range diff, then the working-tree diffs.

## Related

- [2-architecture.md](2-architecture.md) — module layout.
- [4-templates.md](4-templates.md) — `--template`, which is diff-grounded too.
- [6-fallback.md](6-fallback.md) — provider fallback and suspect empty notes.
