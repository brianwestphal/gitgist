# Manual test plan

Checks that can't be reliably automated — chiefly the **CLI agent providers**,
whose output depends on an external, signed-in CLI and a live model. Unit tests
cover wiring (argument construction, availability, output cleaning); these steps
cover real end-to-end generation.

Run each from a git repo with at least one tag. `npm run build` first.

## CLI agent providers (no API key)

For each provider, ensure its CLI is installed and signed in, then run gitgist
forcing that provider and confirm it returns clean, grouped Markdown (no
conversational preamble, no wrapping code fence).

| Provider | Prerequisite | Command |
| --- | --- | --- |
| `claude-cli` | `claude` signed in | `gitgist v1.0.0..HEAD --provider claude-cli` |
| `codex` | `codex login` done | `gitgist v1.0.0..HEAD --provider codex` |
| `gemini` | `gemini` signed in (Google) | `gitgist v1.0.0..HEAD --provider gemini` |
| `opencode` | `opencode auth login` done | `gitgist v1.0.0..HEAD --provider opencode` |

For each, also verify:

- **`--model` is honored** — e.g. `--provider gemini --model gemini-2.5-flash`,
  `--provider codex --model o3`, `--provider opencode --model anthropic/claude-opus-4-8`.
- **Unauthenticated failure is legible** — sign out (or use a fresh machine) and
  confirm the error names the CLI and suggests the fix (the provider `hint`),
  rather than a stack trace.
- **`--commit-message`** works: `gitgist --staged --commit-message --provider <name>`
  returns a single Conventional Commit message.

## Auto-selection (`--provider auto`)

- With only one agent CLI signed in, `gitgist` (no `--provider`) selects it.
- Resolution order is `claude-cli` → `codex` → `gemini` → `opencode` →
  `anthropic-api` → `apple`; with several available, the earliest wins.
- With none available and no `ANTHROPIC_API_KEY`, gitgist instructs the user to
  use `--no-ai` (or install/sign in to a CLI).

## Diff grounding (FR-25) — output quality

The wiring is automated (the diff reaches the prompt, the budget and noise rules
hold, a failed read degrades). What needs a live model is whether grounding
actually **changes the notes for the better**. See
[7-diff-grounding.md](7-diff-grounding.md).

Set up a range where the commit log *understates* the work — e.g. commit a real
user-facing change under a vague subject (`chore: tidy up`), then:

- **The change is described anyway.** `gitgist <range>` names the behavior that
  only the diff reveals. Compare against `gitgist <range> --no-diff`, which can
  only repeat "tidy up" — the difference is the feature working.
- **Unsupported claims are dropped.** Commit something whose subject overstates
  it (`feat: add caching` for a one-line rename) and confirm the notes describe
  what the diff shows, not the subject's claim.
- **Held-back files aren't invented.** On a range that touches
  `package-lock.json` or `dist/`, confirm the notes don't describe their
  contents (the patch body never included them) and don't hallucinate a
  dependency story from the file name alone.
- **A truncated patch stays honest.** `--max-diff-chars 500` on a large range:
  the notes should summarize what fits, without confidently describing files
  whose diff was cut.

## Commit links (FR-31) — hashes must be real *and* right

Unit tests can only assert the rule text; the failure mode is a plausible-looking
wrong hash, so this needs a live model. See
[11-commit-links.md](11-commit-links.md).

Run `gitgist <range> --link-commits` and cross-check against
`git log --format='%h %s' <range>`:

- **Never invented.** Every cited hash appears in that output. A hash that looks
  right but isn't in the log is the worst outcome — worse than no citation.
- **Never misattributed.** Each bullet's hash is the commit that touched the file
  the bullet describes. This was observed failing before the prompt was told to
  match bullets to commits via the `files:` lists, and it is not something the
  never-invent guard catches.
- **Merged bullets cite all commits.** A bullet combining two commits shows both,
  comma-separated in one set of parentheses.
- **Link shape.** With a GitHub/GitLab/Bitbucket `origin`, bullets carry Markdown
  links (note Bitbucket's `/commits/`); with an unrecognized host, bare hashes and
  **no** guessed URL; with `--commit-url`, the given template.
- **`--format commit` ignores it** — no hash in the subject or body.

## Provider comparison

- `npm run compare` runs the fixed sample history through every backend available
  on the machine and prints them side by side (`scripts/compare-providers.mjs`).

## Automated coverage summary

Wiring for the CLI providers is unit-tested in `tests/providers.test.ts`
(registry membership, `AUTO_ORDER` order, `createCliProvider` model threading via
the `runArgs` function, prompt delivery over stdin/arg, stderr surfacing,
timeout). What remains manual is **real model output quality**, which requires a
signed-in CLI and is inherently non-deterministic.
