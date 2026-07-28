# 13. OpenAI-compatible backends

Two of gitgist's providers speak the same wire protocol — `POST /chat/completions`
— and therefore share one client:

| Provider | Requirement | Endpoint | Auth | Cost / privacy |
| --- | --- | --- | --- | --- |
| `local` | FR-14 | `$GITGIST_LOCAL_ENDPOINT`, else `http://localhost:11434/v1` | none | free, on-device |
| `openai-api` | FR-34 | `$OPENAI_BASE_URL`, else `https://api.openai.com/v1` | `Authorization: Bearer $OPENAI_API_KEY` | per-token, sent to OpenAI |

`src/providers/openaiCompatible.ts` holds the transport; `local.ts` and
`openaiApi.ts` hold only what actually differs between them.

## Why REST and not the `openai` SDK

GG-32 originally scoped `openai-api` as an `openai`-SDK backend. It shipped as
plain `fetch` instead, for one concrete reason: **`local.ts` already contained a
working OpenAI-protocol client**, so the SDK would have added a runtime
dependency to duplicate code gitgist already had and already tested.

That dependency is not a free choice here. `tests/conventions.test.ts` pins the
runtime dependency list to exactly `['@anthropic-ai/sdk', 'apple-fm']` and calls
anything else *"a supply-chain regression [that] must be justified with a new
requirement"*. gitgist's pitch is a zero-config tool that needs no API key
(NFR-1); one vendor SDK for the reference backend is defensible, but a second
sets the precedent that every vendor gets one.

The protocol in use here is a single POST with two messages. An SDK buys nothing
for that.

## The shared client

`openaiCompatible.ts` exports:

- **`chatCompletion(target, request)`** — one completion, returning the
  assistant's text with any wrapping Markdown fence stripped.
- **`listModels(target, timeoutMs?)`** — `GET /models`, returning `[]` when the
  endpoint answers non-2xx (so "reachable but unusable" reads the same as "no
  models"); a transport failure still rejects.
- **`parseModelList`** / **`extractChatContent`** — the two response shapes.
- **`FetchLike`** / **`FetchInit`** — the injectable `fetch` seam the unit tests
  use instead of a network.

An `OpenAiCompatibleTarget` carries the endpoint, optional auth headers, an
injectable fetch, and — importantly — **this backend's own error wording**:

```ts
{ endpoint, label, unreachableHint, headers?, fetchImpl?, httpHint? }
```

The `label` / `unreachableHint` pair exists so shared transport does not flatten
the diagnostics. An unreachable `local` endpoint should say *"Start your local
server (e.g. Ollama) or pass --endpoint"*; an unreachable hosted API must not.
`httpHint(status)` turns a bare status into a fix — for `openai-api`, `401`/`403`
→ check `OPENAI_API_KEY`, `404` → check the model id, `429` → rate limited.

### Failure reporting (FR-36)

A `fetch` rejection is **classified, not flattened**:

| Cause | Message |
| --- | --- |
| Our own `AbortController` fired | `<label> timed out after <n>ms at <endpoint>.` + `timeoutHint` |
| Anything else | `<label> not reachable at <endpoint>. <unreachableHint> (<cause>)` |

`<cause>` is the underlying `code` where Node exposes one (`ECONNREFUSED`,
`ECONNRESET`), so an occurrence is diagnosable from the output alone. The original
`Error` is attached as `cause` for programmatic callers.

This split exists because conflating the two produced actively wrong advice. A
locally hosted 12B model took **87–109 s** on a normal prompt against the shared
120 s budget, so it intermittently timed out — and was reported as *"Local
endpoint not reachable… Start your local server"* while the server was perfectly
healthy (GG-64). `timeoutHint` is therefore a separate field from
`unreachableHint`: a slow model and a dead server need opposite fixes.

That measurement also drove `local`'s own **10-minute** generation budget
(`LOCAL_TIMEOUT_MS`) rather than the shared 120 s. A hosted API is fast in a way a
local model is not, so `openai-api` keeps the shared default.
`GenerateRequest.timeoutMs` still overrides either.

### What is deliberately not sent

- **No `response_format`.** Every backend wants freeform Markdown; coercing JSON
  would fight the prompt.
- **No output-token cap.** The parameter name differs across model generations
  (`max_tokens` vs `max_completion_tokens`), and `--max-tokens` is documented as
  applying to `anthropic-api` only. `local` never sent one either.

## `openai-api` specifics (FR-34)

**Availability is the key, and only the key.** `isAvailable()` returns whether
`OPENAI_API_KEY` is set (empty or whitespace-only counts as unset). It makes **no
network call**, matching `anthropic-api`. This matters because `openai-api` is in
`AUTO_ORDER`: a probe that reached the network would add latency to every
auto-resolved run, and one that validated the key would cost a request. The
trade-off is explicit — an invalid or exhausted key is discovered at generation
time, where the API's own error is surfaced with a hint.

Contrast `local`, whose probe *is* a network call: a local server may simply not
be running, and there is no cheaper signal.

**Model precedence:** `--model` → the factory's `model` → `$GITGIST_OPENAI_MODEL`
→ the built-in default.

`local`'s chain has the same shape: `--model` → the factory's `model` →
`$GITGIST_LOCAL_MODEL` → **whatever the endpoint has loaded** (its last step
discovers rather than defaulting, since gitgist cannot know what you are running).
Both start at `GenerateRequest.model`, which is the contract every backend shares
— `local` was the exception until GG-74, and that gap was invisible from the CLI
because `resolveProvider` bakes `--model` into the factory config.

> **The built-in default (`gpt-5`) is unverified.** gitgist has no OpenAI key on
> the maintainer's machine, so no *successful* call has confirmed it, and OpenAI's
> served ids vary by account and over time. (The request shape itself *is*
> confirmed live: an invalid key returns a `401` from the real API rather than a
> `404`/`400`, so the URL, headers, and body parse correctly.) Pass `--model <id>` or set
> `$GITGIST_OPENAI_MODEL` if your account serves something else — a wrong id
> comes back as a `404`/`400` with the id echoed, which the provider passes
> through verbatim alongside the "check the model id" hint. See the
> [manual test plan](manual-test-plan.md).

**`--endpoint` is not threaded here.** That flag is documented as the `local`
provider's. Point this backend at Azure or a proxy with `$OPENAI_BASE_URL`, the
variable OpenAI's own SDK reads.

**Position in `AUTO_ORDER`:** after every no-key CLI backend and after
`anthropic-api`, before `apple` — `[claude-cli, codex, antigravity, gemini,
opencode, anthropic-api, openai-api, apple]`. A paid API should never win over a
sign-in the user already has.

## Relationship to the CLI backends

`openai-api` does **not** replace `codex` (FR-18), which reaches the same vendor
through a signed-in CLI with no key and is verified end-to-end. `codex` is the
better default. What this backend adds is the case a CLI cannot serve:

- **CI with no interactive sign-in** — an `OPENAI_API_KEY` works unattended.
- A same-vendor `--fallback-provider` target for FR-23.

## Not built: a Gemini API backend

GG-33 proposed the equivalent for Google and was **closed as superseded**. The
`antigravity` provider (FR-33) already covers that vendor with no API key and is
verified end-to-end, and the `gemini` CLI it would have backstopped is itself
retired for individual tiers. The unattended-CI gap for Google is a known,
accepted limitation.

Should that change, Google exposes an OpenAI-compatible endpoint — a third
provider could reuse this client with only a new target.

## See also

- [5-providers.md](5-providers.md) — the no-key CLI backends.
- [9-provider-budgets.md](9-provider-budgets.md) — why `openai-api` advertises a
  200,000-char diff budget and `local` only 8,000.
- [6-fallback.md](6-fallback.md) — `--fallback-provider`.
