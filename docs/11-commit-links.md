# 11. Commit links

How a bullet tells the reader which commit it came from. Requirement:
**FR-31**. The user-visible half of [10-attribution.md](10-attribution.md),
which explains how the model learns that in the first place.

## Why it's opt-in

[FR-30](10-attribution.md) gives the model each commit's short hash and the files
it touched, and `ATTRIBUTION_RULES` deliberately ends by telling it *not* to emit
hashes "unless the requested format asks for them". Nothing asked, so attribution
paid off only in grouping and ordering — the hashes never reached the reader.

`--link-commits` is the format asking. It stays off by default because most
release notes read better without provenance clutter; when you do want it —
published notes, an internal changelog people audit against — it is one flag.

```bash
gitgist v1.4.0..HEAD --link-commits
```

```markdown
## Features

- Added `login(user, mfa?)` for user authentication, with optional MFA
  enforcement ([0a9a988](https://github.com/acme/widgets/commit/0a9a988))

## Breaking Changes

- Removed the exported constants `a` and `b`
  ([0a9a988](https://github.com/acme/widgets/commit/0a9a988), [1a7cecc](https://github.com/acme/widgets/commit/1a7cecc))
```

## Where the URL comes from

A bare hash in published notes is much less useful than a link, so gitgist tries
to produce a link with no configuration:

1. **`--commit-url <template>`** — an explicit template containing `{hash}`.
   Required for a self-hosted forge. A template without the placeholder is
   rejected at parse time rather than silently producing broken links.
2. **The `origin` remote** — `detectCommitUrl` reads it and maps the host to its
   commit-page shape. All three remote spellings work: `git@host:owner/repo.git`,
   `https://host/owner/repo.git`, and `ssh://git@host/owner/repo.git`.
3. **Neither** — bullets cite bare hashes.

| Host | Commit path |
| --- | --- |
| `github.com` | `/commit/{hash}` |
| `gitlab.com` | `/commit/{hash}` |
| `bitbucket.org` | **`/commits/{hash}`** |

Bitbucket's plural is the reason this is a lookup table and not a format string.
An **unrecognized host yields no URL at all** — bare hashes are correct and a
guessed URL is a 404 on every bullet. To link on a self-hosted forge, pass
`--commit-url`.

## What the model is told

`buildCommitLinkRules(urlTemplate?)` is appended to the system prompt only when
links are requested, so the default prompt is byte-identical to before. It says:

- **End every bullet with its commit** — as `(a1b2c3d)`, or as
  `([a1b2c3d](https://…/commit/a1b2c3d))` when a template exists. The example in
  the rule is rendered with the real template, so the model sees the exact shape
  it should produce rather than a placeholder to interpret.
- **Match bullets to commits via the `files:` lists** — the change lives in a
  file, and the commit listing that file is the one that made it. This line is
  load-bearing: without it, live runs produced *real but swapped* hashes.
  `ATTRIBUTION_RULES` prevents **invented** hashes; it does nothing about
  **misattributed** ones, and a real hash on the wrong bullet is still wrong.
- **A merged bullet cites all its commits**, comma-separated in one set of
  parentheses. The notes prompt actively encourages combining related commits
  into one bullet, so this case is common — citing just one would misrepresent
  where the change came from. Stated outright rather than left to the model.
- **The never-invent guard still applies in full.** Only a hash appearing
  verbatim in the material may be cited; a change that can't be tied to a commit
  gets a bullet with no citation.

## Interactions

| With | Behavior |
| --- | --- |
| `--no-attribution` | No links. There is no hash to cite without the map — the flag is a no-op rather than an error. |
| `--format commit` | **Ignored.** A hash in a Conventional Commit subject is meaningless, and the commit doesn't exist yet when drafting its own message. Silently ignored, matching how `--title` behaves for this format (FR-12). |
| `--no-ai` | Not applicable — the deterministic renderer already prints each commit's short hash. |
| `--template` | Works. The rule is appended to `TEMPLATE_SYSTEM_PROMPT` like any other, so templated sections get citations too. |

## Verifying

The failure mode worth checking is a plausible-looking wrong hash, so a live run
is the only real test — unit tests can only assert the rule text. Cross-check the
cited hashes against `git log --format='%h %s' <range>`:

- every cited hash appears in that output (never invented);
- each bullet's hash is the commit that touched the file the bullet describes
  (never misattributed);
- a bullet covering two commits cites both.

This is in [manual-test-plan.md](manual-test-plan.md).

## Related

- [10-attribution.md](10-attribution.md) — how the model learns which commit did what.
- [7-diff-grounding.md](7-diff-grounding.md) — where bullet content comes from.
- [4-templates.md](4-templates.md) — templated output, which links work with.
