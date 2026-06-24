# 5. AI providers

gitgist's AI backends are pluggable: each implements the `AIProvider` interface
(`isAvailable()` / `generate()`) in `src/providers/` and registers in
`src/providers/index.ts`. This doc is the reference for the **CLI-first agent
providers** — locally installed coding/agent CLIs invoked in a one-shot headless
mode, reusing the CLI's own sign-in so **no gitgist-managed API key** is needed.
They are the default-friendly path and sit early in `AUTO_ORDER`.

For the other backends see: `claude-cli` / `anthropic-api` ([3-requirements.md](3-requirements.md)
FR-5/FR-6), `local` (FR-14), `apple` (FR-15/FR-16/FR-17).

## The shared CLI backend

All agent-CLI providers are built from `createCliProvider()` (`src/providers/cli.ts`):

- The combined `system\n\nprompt` is delivered to the CLI via **stdin** (default,
  avoids `ARG_MAX`) or as the final **argument** (`input: 'arg'`).
- `runArgs` is either a static list or a **function of the request's `model`**, so
  a provider threads `--model` through at its CLI's expected position. When no
  `--model` is given, the no-model args are used and the CLI's own default model
  applies.
- The run is bounded by a timeout (default 120 s); a non-zero exit surfaces the
  last few stderr lines; a wrapping Markdown code fence is stripped from stdout
  (`stripCodeFences`), and the orchestrator additionally runs `cleanModelOutput`
  to drop any conversational preamble an agentic CLI may add.
- `isAvailable()` runs `<command> --version` (binary present); sign-in is **not**
  probed — an unauthenticated CLI fails at `generate()` with its own error
  surfaced, and the provider's `hint` points at the fix.

## Providers

| Provider | CLI invocation | `--model` | Auth |
| --- | --- | --- | --- |
| `claude-cli` (FR-5) | `claude -p` (stdin) | — | `claude` sign-in |
| `codex` (FR-18) | `codex exec` (stdin) | `-m <model>` (e.g. `gpt-5-codex`, `o3`) | `codex login` (ChatGPT/Codex) |
| `gemini` (FR-19) | `gemini -p "<prompt>"` (arg) | `-m <model>` (e.g. `gemini-2.5-pro`) | `gemini` Google sign-in |
| `opencode` (FR-20) | `opencode run "<prompt>"` (arg) | `-m <provider/model>` (e.g. `anthropic/claude-opus-4-8`) | `opencode auth login` |

Each is selectable with `--provider <name>` and participates in `--provider auto`
(in `AUTO_ORDER`: `claude-cli` → `codex` → `gemini` → `opencode` → `anthropic-api`
→ `apple`). All return freeform Markdown.

### `codex` — OpenAI Codex CLI (FR-18)

`src/providers/codex.ts`. `codex exec` runs Codex non-interactively and reads its
instructions from stdin when no prompt argument is given; gitgist pipes the
prompt via stdin. `-m <model>` selects the model. No `OPENAI_API_KEY` is required
for the CLI path — it reuses the signed-in Codex/ChatGPT session.

### `gemini` — Google Gemini CLI (FR-19)

`src/providers/gemini.ts`. `gemini -p "<prompt>"` triggers Gemini's headless
mode; `-m <model>` (placed before `-p`) selects the model. The prompt is passed
as an argument. No `GEMINI_API_KEY` is required for the CLI path — it reuses the
signed-in Google session.

### `opencode` — OpenCode CLI (FR-20)

`src/providers/opencode.ts`. `opencode run "<message>"` runs a one-shot prompt;
`-m <provider/model>` selects the model in OpenCode's `provider/model` form. The
prompt is passed as an argument. gitgist manages no key — OpenCode uses whatever
provider/credentials it is configured with (`opencode auth`).

## Roadmap

- **Cursor** (GG-7) — a `cursor-agent` headless provider, same CLI-first shape,
  once its non-interactive invocation is confirmed.
- **API-key fallbacks** — optional secondary backends for the agent CLIs (OpenAI
  via `openai`, Google via `@google/genai`), placed after the CLI backends in
  `AUTO_ORDER`. Deferred so the new runtime dependencies are a separate decision
  (tracked as follow-up tickets).

## Verification status

`opencode` has been verified end-to-end (real generation returns clean Markdown).
`codex` and `gemini` have verified **invocations** (the CLIs run with gitgist's
exact arguments and reach their backends), but end-to-end output on this
maintainer's machine is auth-gated — like `claude-cli`, real output quality is
validated by running the signed-in CLI, not by unit tests. See the
[manual test plan](manual-test-plan.md) for the live checks.
