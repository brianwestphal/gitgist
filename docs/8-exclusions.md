# 8. Diff exclusions

Which files' diff *content* gitgist holds back from the model, and how to change
that per project. Requirements: **FR-26** (bounded, noise-filtered material),
**FR-27** (configurable exclusions). Companion to
[7-diff-grounding.md](7-diff-grounding.md), which covers *why* the diff is read
at all.

## The invariant

An exclusion hides a file's **patch body only**. It never hides the fact that the
file changed:

- the path stays in the changed-file list (`RangeDiff.files`, or
  `WorkingChanges.staged`/`unstaged`/`untracked`);
- it stays in the range `--stat`;
- it is listed in `excluded`, and the prompt names it explicitly —
  *"these changed files are listed above but their diff was omitted as
  generated/lockfile noise — do not describe their contents"*;
- the deterministic `--no-ai` listing is unaffected entirely.

So excluding is about **spending the character budget well**, not about
concealment. The model is always told where its evidence stops, because a model
that thinks it saw everything invents the rest.

## The defaults

`DEFAULT_EXCLUDES` (`src/git.ts`) holds bare git pathspec patterns:

| Pattern | Why |
| --- | --- |
| `*.lock`, `*lock.json`, `*lock.yaml` | Lockfiles — thousands of lines, zero reader value. The *fact* of a dependency change matters; the diff doesn't. |
| `*.min.js`, `*.min.css`, `*.map` | Minified/generated output, often single enormous lines. |
| `*.snap` | Test snapshots — they restate other code. |
| `dist/*`, `build/*` | Build output, a derivative of the source already in the diff. |
| `vendor/*`, `node_modules/*` | Vendored third-party code — not this project's change. |

These lean JS/TS, which is the point of making them configurable: they are a
sensible default, not a claim about every repository.

Note git's pathspec matching is fnmatch **without** `FNM_PATHNAME`, so `*`
crosses `/`. `*.lock` matches `a/b/c.lock`, and `dist/*` matches `dist/a/b.js` at
any depth.

## Configuring

Two flags, with deliberately simple semantics:

| Flag | Effect |
| --- | --- |
| `--exclude <pathspec>` | **Adds** a pattern on top of the defaults. Repeatable. |
| `--no-default-excludes` | **Drops** the built-in list, keeping only your own `--exclude` patterns. |

Add-by-default is the common case (project-specific generated files); the full
override exists for the case where a default is simply wrong for the repo.

```bash
# Python: protobuf output and migrations are noise on top of the defaults
gitgist v1.4.0..HEAD --exclude '*.pb.py' --exclude 'migrations/*'

# The published artifact IS dist/ — keep its diff, drop everything built-in
gitgist v1.4.0..HEAD --no-default-excludes --exclude 'testdata/*'

# Go: vendor/ is genuinely part of this change
gitgist v1.4.0..HEAD --no-default-excludes
```

Programmatically, on `generateReleaseNotes` (and on `readRangeDiff` /
`readWorkingChanges` directly, via `DiffExcludeOptions`):

```ts
await generateReleaseNotes({
  range: 'v1.4.0..HEAD',
  exclude: ['*.pb.py', 'migrations/*'],
  defaultExcludes: false, // optional: start from an empty list
});
```

`buildExcludePathspecs(exclude, useDefaults)` is exported if you want to inspect
or reuse the resolved pathspec list. It de-duplicates, drops blank patterns, and
applies the `:(exclude)` magic. With nothing to exclude it returns `[]`, and
gitgist then omits the `--` pathspec separator from the git invocation entirely.

## Scope

Both diff paths honour the same configuration (GG-54): the commit-range patch and
the staged / unstaged / untracked working-tree diffs. There is no way to exclude
from one but not the other — the two are meant to behave alike, and a per-path
split would be a footgun with no clear use case.

Exclusions do **not** affect:

- the range `--stat` (it is a summary, and cheap);
- the changed-file lists;
- `--no-ai` deterministic output;
- which commits are read.

## Not implemented

A project-level config file (`.gitgistignore`, or an `exclude` key in some
`gitgist` config) is **not** supported — every invocation must pass its flags.
That is fine for interactive use and awkward for CI, where the same patterns get
repeated in every job. Tracked as a follow-up; it needs a config-file design
(discovery, format, precedence against flags) that gitgist does not have yet.

## Related

- [7-diff-grounding.md](7-diff-grounding.md) — why the diff is read, and the char budget.
- [3-requirements.md](3-requirements.md) — FR-26 / FR-27.
