# 6. Fallback & suspect-response handling

gitgist defends against two failure modes of AI generation: a provider that
**errors**, and a provider that **succeeds but returns a likely-invalid
response**. Both are handled in `generateReleaseNotes` (`src/releaseNotes.ts`).

See also: [3-requirements.md](3-requirements.md) (FR-22/FR-23), [5-providers.md](5-providers.md)
(the providers themselves), [2-architecture.md](2-architecture.md) (data flow).

## The suspect empty-notes sentinel

The notes system prompt tells the model to emit one exact sentinel when nothing
is user-facing:

```
_No user-facing changes._
```

That string is the shared constant `NO_USER_FACING_CHANGES` in `src/prompt.ts`,
embedded in `SYSTEM_PROMPT` and matched by `isEmptyNotesSentinel()` — one source
of truth, so the instruction and the check can never drift.

A returned sentinel is **suspect only when the range actually had commits**
(`commits.length > 0`). With commits present, an empty-notes result is usually a
model misfire (the original GG-38 symptom — see GG-38's fix), not a real empty
range. When there are **no** commits (e.g. a working-tree-only run), the sentinel
is trusted and returned as-is.

> Scope: the sentinel concept applies to the default **notes** format only.
> `--format commit` and `--template` have no such sentinel, so they never flag a
> suspect response — only the on-error retry (below) applies to them.

## The fallback chain

For a notes run with commits in range, the resolution order is:

1. **Primary provider** (`--provider` / `--model` / `--endpoint`). If it returns
   valid notes, use them.
2. **Configured fallback provider** — tried when the primary **errors** *or*
   returns the suspect sentinel, and only if a fallback is configured (any of
   `--fallback-provider` / `--fallback-endpoint` / `--fallback-model`). Each
   unset fallback field inherits the primary's value, so `--fallback-model`
   alone just retries with a different model on the same provider. If the
   fallback returns valid notes, use them.
3. **Deterministic changelog** — the final safety net. If the result is still the
   suspect sentinel after step 1 (no fallback) or step 2 (fallback also empty /
   errored), gitgist renders the deterministic Conventional-Commit changelog (the
   same output as `--no-ai`) instead of trusting the sentinel.

Every transition emits a `gitgist:` **stderr warning** (a non-fatal notice), so
the substitution is never silent: a retry notice when the fallback is tried, and
a "falling back to the deterministic changelog" notice when step 3 fires.

### Errors vs. suspect responses

| Situation | No fallback configured | Fallback configured |
| --- | --- | --- |
| Primary **errors** (notes) | retry n/a → deterministic changelog only if the result were suspect; a hard error propagates (exit 1) | retry with fallback; if it also errors, the error propagates |
| Primary returns **suspect sentinel** (notes, commits in range) | warn → deterministic changelog | warn → retry with fallback → valid notes, else deterministic changelog |
| Primary **errors** (`--format commit` / `--template`) | error propagates (exit 1) | retry with fallback; if it also errors, propagate |

A hard primary error with **no** fallback configured stays fatal — gitgist does
not silently convert a provider failure into a deterministic changelog, so a
misconfiguration (bad `--provider`, missing key) still surfaces. Use `--no-ai`
for an explicit deterministic run.

## CLI

```
--fallback-provider <name>   Secondary provider (same names as --provider).
--fallback-endpoint <url>    --endpoint for the fallback (default: inherits --endpoint).
--fallback-model <id>        --model for the fallback (default: inherits --model).
```

Examples:

```bash
# Draft locally; if the small local model returns nothing useful, retry on Claude.
gitgist v1.4.0..HEAD --provider local --model llama3.2 --fallback-provider anthropic-api

# Same provider, a stronger model only on a suspect/empty result.
gitgist v1.4.0..HEAD --fallback-model claude-opus-4-8
```

## Programmatic API

`generateReleaseNotes(options)` accepts `fallbackProvider` / `fallbackEndpoint` /
`fallbackModel`, plus an optional `warn(message)` sink (defaults to writing
`gitgist: <message>` to stderr; inject a collector in tests).
