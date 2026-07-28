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
| `antigravity` | `agy` signed in (Google) | `gitgist v1.0.0..HEAD --provider antigravity` |
| `gemini` (legacy) | `gemini` signed in **with a Code Assist Standard/Enterprise license** — individual tiers were retired 2026-06-18 | `gitgist v1.0.0..HEAD --provider gemini` (gitgist passes `--skip-trust`; confirm generation succeeds in a directory you have *not* trusted interactively) |
| `opencode` | `opencode auth login` done | `gitgist v1.0.0..HEAD --provider opencode` |

For each, also verify:

- **`--model` is honored** — e.g. `--provider codex --model <an id your account
  serves>` (ChatGPT accounts refuse most ids; `codex exec` prints the default on
  its `model:` line),
  `--provider opencode --model anthropic/claude-opus-4-8`,
  `--provider antigravity --model 'Gemini 3.6 Flash (High)'` (ids come from
  `agy models` and contain spaces/parens — quote them). A quick way to prove the
  flag reaches the CLI rather than being ignored: pass a bogus model and confirm
  the CLI rejects it.
- **Unauthenticated failure is legible** — sign out (or use a fresh machine) and
  confirm the error names the CLI and suggests the fix (the provider `hint`),
  rather than a stack trace.
- **`--commit-message`** works: `gitgist --staged --commit-message --provider <name>`
  returns a single Conventional Commit message.

## `openai-api` (FR-34) — never run live

**Partly verified live, deliberately.** No OpenAI key exists on the maintainer's
machine, but pointing the provider at the real API with a *deliberately invalid*
key returned:

```
gitgist: OpenAI API https://api.openai.com/v1 returned HTTP 401. Check OPENAI_API_KEY.
```

A `401` — rather than a `404` (wrong URL) or `400` (malformed body) — means the
endpoint, headers, and request body are well-formed enough for OpenAI to parse the
request and reject only the credential. So **request construction and the error
path are confirmed against the real API**; what remains unverified is the
**success path** and the **default model id**. With a valid `OPENAI_API_KEY`:

- `gitgist v1.0.0..HEAD --provider openai-api` returns clean grouped Markdown.
- **Confirm the default model id.** `src/providers/openaiApi.ts` defaults to
  `gpt-5`, chosen without a live check — OpenAI's served ids vary by account and
  over time. If the API rejects it, the fix is a one-line default change; the
  error arrives as a `404`/`400` with the id echoed plus a "check the model id"
  hint.
- `--model <id>` overrides it; `GITGIST_OPENAI_MODEL` does too, at lower precedence.
- `OPENAI_BASE_URL` retargets the call (Azure / a proxy). `--endpoint` is **not**
  wired to this provider by design — it belongs to `local`.
- **Error legibility:** a bad key should report `HTTP 401. Check OPENAI_API_KEY.`
  rather than a stack trace.
- `--commit-message` works.
- `--fallback-provider openai-api` is reached when the primary fails (FR-23).

Note that `isAvailable()` only checks that the key is *set*, so an invalid or
exhausted key resolves fine and fails at generation — that is deliberate (no
network in the probe path), and worth confirming reads sensibly.

## Auto-selection (`--provider auto`)

- With only one agent CLI signed in, `gitgist` (no `--provider`) selects it.
- Resolution order is `claude-cli` → `codex` → `antigravity` → `gemini` →
  `opencode` → `anthropic-api` → `openai-api` → `apple`; with several available,
  the earliest wins.
- **A signed-in CLI must beat a set API key.** With both a CLI and
  `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` present, `auto` must pick the CLI — the
  paid path should never be chosen silently.
- **`antigravity` must win over `gemini`** when both CLIs are installed. `gemini`'s
  `--version` probe still passes on a retired individual account, so this ordering
  is the only thing stopping `auto` from picking a backend that fails at generation.
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
