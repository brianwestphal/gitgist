# 4. Templates

`--template <file>` shapes the AI output to a Markdown template you control —
its section set, order, wording, and per-section guidance. This is for teams
with a fixed release-notes house style (specific sections, emoji, ordering).

```bash
gitgist v1.4.0..HEAD --template release-notes.md
```

A worked example ships at
[`templates/release-notes.example.md`](../templates/release-notes.example.md).

## Format

A template is a **Markdown file with optional YAML frontmatter**:

```markdown
---
audience: end users upgrading the package
tone: concise and friendly
guidance: |
  Exclude internal refactors, test-only changes, and CI tweaks.
  Call out anything that changes the public API.
---

## ⚠️ Breaking Changes
<!-- Requires action on upgrade; include a short migration note. -->

## 🚀 Features
<!-- New capabilities and notable UX improvements. -->

## 🐛 Bug Fixes
<!-- User-visible fixes only. -->
```

Three parts, all optional except the body:

| Part | Role |
| --- | --- |
| **YAML frontmatter** (`---` fenced, at the top) | Global directives — `audience`, `tone`, `guidance`, what to include/exclude. Interpreted by the model; never appears in the output. |
| **Markdown headings** (`##`, `###`, …) | The output sections, used **verbatim and in order** (wording + emoji preserved). |
| **HTML comments** (`<!-- … -->`) | Per-section guidance for the heading directly above. Steers that section's content; never appears in the output. |

> gitgist does not parse the frontmatter itself — the template (frontmatter +
> body) is fed to the model as the required output shape. So any human-readable
> YAML the model can follow works; there is no fixed schema.

## Behavior (strict)

- The output uses **only** the template's sections, in the template's order.
- A section with no relevant changes is **omitted** (no empty sections).
- The model never invents sections the template doesn't list.
- Noise (internal refactors, tests, CI, ticket IDs) is filtered unless the
  template's guidance says otherwise.
- `--title <text>` still works — it adds a top-level `#` heading above the
  templated sections (e.g. a version header).

## Constraints

- **Requires AI.** `--template` with `--no-ai` errors (the template is an AI
  instruction; there is no deterministic mapping from commits to arbitrary
  custom sections).
- **Not combinable with `--format commit`** (a commit message has no sections).
- Works with any input: a commit range, working-tree flags (`--staged`, …), or
  both.

## Related

Requirement **FR-13** in [3-requirements.md](3-requirements.md).
