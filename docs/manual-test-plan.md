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

## Provider comparison

- `npm run compare` runs the fixed sample history through every backend available
  on the machine and prints them side by side (`scripts/compare-providers.mjs`).

## Automated coverage summary

Wiring for the CLI providers is unit-tested in `tests/providers.test.ts`
(registry membership, `AUTO_ORDER` order, `createCliProvider` model threading via
the `runArgs` function, prompt delivery over stdin/arg, stderr surfacing,
timeout). What remains manual is **real model output quality**, which requires a
signed-in CLI and is inherently non-deterministic.
