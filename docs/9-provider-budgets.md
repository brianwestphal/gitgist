# 9. Provider budgets

How much diff material each AI backend gets, and why it isn't one number.
Requirement: **FR-28** (provider-advertised diff budget). Companion to
[7-diff-grounding.md](7-diff-grounding.md) (why the diff is read) and
[8-exclusions.md](8-exclusions.md) (which files' content is held back).

## Why per-provider

gitgist's backends are not comparable. Their context windows span three orders
of magnitude:

| Backend | Model | Context window |
| --- | --- | --- |
| `anthropic-api` | `claude-opus-4-8` | **1M tokens** |
| `openai-api` | `$GITGIST_OPENAI_MODEL`, else `gpt-5` | frontier-model window |
| `claude-cli` / `codex` / `antigravity` / `gemini` / `opencode` | whatever frontier model the signed-in CLI fronts | 200k–1M tokens |
| `local` | whatever is loaded in Ollama / LM Studio | commonly 4k–8k tokens |
| `apple` | Apple on-device Foundation Model | **~4k tokens** |

A single shared budget cannot serve both ends. Sized for the on-device model it
starves a frontier model of context it could trivially absorb; sized for the
frontier model it overruns the on-device one, which then truncates silently or
fails outright. GG-50 shipped one number (24000 chars) precisely because it was
safe at the small end — correct as a floor, wasteful everywhere else.

## How it works

`AIProvider` carries an optional `diffBudgetChars`. `generateReleaseNotes`
resolves the primary provider **before** reading any diff and uses its budget:

```
--max-diff-chars  →  provider.diffBudgetChars  →  DEFAULT_MAX_DIFF_CHARS (24000)
```

An explicit `--max-diff-chars` always wins — it is the escape hatch when the
advertised default is wrong for your model. A provider that advertises nothing
falls through to the shared default.

The budget governs **both** diff paths (the range patch and the working-tree
sections), exactly as `--max-diff-chars` does — see
[7-diff-grounding.md](7-diff-grounding.md).

## Current budgets

| Provider | Budget (chars) | Reasoning |
| --- | ---: | --- |
| `anthropic-api` | 200,000 | ~50k tokens — a small slice of a 1M-token window. The binding constraint is usefulness and cost, not the window. |
| `openai-api` | 200,000 | Sized like `anthropic-api`, not like `local`: a hosted frontier model, so cost and usefulness bind before the window does. |
| `claude-cli`, `codex`, `antigravity`, `gemini`, `opencode` | 120,000 | ~30k tokens. Prompts reach these CLIs via stdin (or one argv entry), comfortably inside `ARG_MAX` at this size. |
| `local` | 8,000 | The loaded model is unknown to gitgist and Ollama's default context is often 4k–8k tokens. Errs small on purpose. |
| `apple` | 4,000 | ~1k tokens of diff, leaving the rest of the ~4k-token on-device window for the system prompt, commit list, and the notes. |

These are **characters, not tokens**, deliberately. gitgist has no tokenizer and
adding an approximate one would trade a clear unit for a fuzzy one — the whole
pipeline (`readRangeDiff`, `readWorkingChanges`, `capText`, `--max-diff-chars`)
measures characters. The values above are derived from context windows at a
conservative ~3.5 chars/token and then rounded down hard; they are budgets, not
limits, and the model never sees the boundary as anything but a truncation note.

## Resolving the provider early

The budget depends on which backend will consume the diff, so the primary
provider is resolved before the diff is read rather than at generation time.
Two consequences worth knowing:

- **Availability is probed once, not twice.** The resolved instance is reused
  for the primary generation, so a run costs the same number of `--version`
  probes as before.
- **A resolution failure is deferred, not thrown early.** If no provider is
  available, the error is stored and rethrown at generation time — the same
  place it surfaced before, so the FR-23 fallback provider still gets its chance
  to rescue the run (T-2). Moving the throw earlier would have quietly broken
  that.

Resolution is skipped entirely on the `--no-ai` path, which reads no diff.

## Adding a provider

Set `diffBudgetChars` on the provider object (or on the `CliProviderSpec` —
`createCliProvider` defaults it to the shared agent-CLI budget). Derive it from
the model's context window, leave room for the system prompt and the output, and
round down. If the backend's window is genuinely unknown, omit the field and
take the conservative shared default.

`tests/providers.test.ts` asserts the ordering invariant (on-device < local <
agent CLI < API) and that every registered provider advertises a budget — a new
provider with no budget fails there.

## Related

- [7-diff-grounding.md](7-diff-grounding.md) — why the diff is read; `--max-diff-chars`.
- [8-exclusions.md](8-exclusions.md) — which files' diff content is held back.
- [5-providers.md](5-providers.md) — the CLI-first agent providers.

## Timeouts (the sibling axis)

The diff budget bounds *how much* a backend is asked to read; a timeout bounds
*how long* it gets. All of them live in `src/providers/timeouts.ts` and are
overridable per call via `GenerateRequest.timeoutMs`.

| Constant | Value | Applies to |
| --- | --- | --- |
| `GENERATION_TIMEOUT_MS` | 120 s | one generation on the agent-CLI and hosted HTTP/SDK backends |
| `LOCAL_GENERATION_TIMEOUT_MS` | 600 s | one generation on `local` |
| `HTTP_PROBE_TIMEOUT_MS` | 3 s | the OpenAI-compatible `/models` reachability probe |
| `APPLE_PROBE_TIMEOUT_MS` | 10 s | the on-device Apple helper availability probe |

Two of these values are deliberately unlike their neighbours, and both were
learned the hard way:

- **`local` gets 5× the generation budget.** A 12B model measured **87–109 s** on
  a normal prompt, so the shared 120 s left almost no headroom — failures were
  intermittent and, worse, were reported as an unreachable server (GG-64 /
  FR-36).
- **The two probes differ by more than 3×** because they do different work: one
  HTTP request versus spawning a process and asking the OS about model
  availability. They were once both called `PROBE_TIMEOUT_MS`, which invited
  unifying values that should not match (GG-71).
