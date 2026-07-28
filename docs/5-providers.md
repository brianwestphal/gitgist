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

- The prompt is delivered to the CLI via **stdin** (default, avoids `ARG_MAX`) or
  as the final **argument** (`input: 'arg'`).
- The system prompt is kept in the CLI's **system layer** when the spec sets a
  `systemArgs(system)` hook (e.g. `claude-cli` → `--append-system-prompt`); then
  only the user prompt is sent as input. Without the hook the system + user
  prompts are concatenated (`system\n\nprompt`) into the input — the fallback for
  CLIs with no system-prompt flag. (Inlining gitgist's instructions into the user
  turn made `claude -p` echo the `_No user-facing changes._` escape hatch instead
  of generating notes — GG-38.)
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
| `claude-cli` (FR-5) | `claude -p` (stdin; system via `--append-system-prompt`) | — | `claude` sign-in |
| `codex` (FR-18) | `codex exec` (stdin) | `-m <model>` (e.g. `gpt-5-codex`, `o3`) | `codex login` (ChatGPT/Codex) |
| `antigravity` (FR-33) | `agy -p "<prompt>"` (arg) | `--model <model>` (e.g. `Gemini 3.6 Flash (High)`) | `agy` Google sign-in |
| `gemini` (FR-19) — **legacy** | `gemini -p "<prompt>"` (arg) | `-m <model>` (e.g. `gemini-2.5-pro`) | `gemini` Google sign-in (Code Assist Standard/Enterprise only) |
| `opencode` (FR-20) | `opencode run "<prompt>"` (arg) | `-m <provider/model>` (e.g. `anthropic/claude-opus-4-8`) | `opencode auth login` |

Each is selectable with `--provider <name>` and participates in `--provider auto`
(in `AUTO_ORDER`: `claude-cli` → `codex` → `antigravity` → `gemini` → `opencode` →
`anthropic-api` → `apple`). All return freeform Markdown.

### `codex` — OpenAI Codex CLI (FR-18)

`src/providers/codex.ts`. `codex exec` runs Codex non-interactively and reads its
instructions from stdin when no prompt argument is given; gitgist pipes the
prompt via stdin. `-m <model>` selects the model. No `OPENAI_API_KEY` is required
for the CLI path — it reuses the signed-in Codex/ChatGPT session.

### `antigravity` — Google Antigravity CLI (FR-33)

`src/providers/antigravity.ts`. `agy -p "<prompt>"` runs Antigravity's
non-interactive **print mode**; `--model <model>` (placed before `-p`, since `-p`
consumes the prompt as its value) selects the model. The prompt is passed as an
argument. No API key is required — it reuses the CLI's signed-in Google session.

Model ids come from `agy models` and are human-readable strings **containing
spaces and parentheses** — `Gemini 3.6 Flash (High)`, `Gemini 3.1 Pro (Low)`,
`Claude Sonnet 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`. They ride as a single
argv entry, so no shell quoting reaches the child process; quote them for your
own shell (`--model 'Gemini 3.6 Flash (High)'`).

`agy` writes progress and language-server chatter to **stderr** and only the
model's answer to stdout, so nothing beyond the shared fence-stripping is needed.

**This is the replacement for the Gemini CLI.** Google announced the transition at
I/O on 2026-05-19; on **2026-06-18** Gemini CLI stopped serving Google AI Pro/Ultra
and free-tier requests, which now route through Antigravity.

### `gemini` — Google Gemini CLI (FR-19, legacy)

`src/providers/gemini.ts`. `gemini -p "<prompt>"` triggers Gemini's headless
mode; `-m <model>` (placed before `-p`) selects the model. The prompt is passed
as an argument. No `GEMINI_API_KEY` is required for the CLI path — it reuses the
signed-in Google session.

**Superseded by `antigravity`.** Since 2026-06-18 this backend returns
`IneligibleTierError` ("no longer supported for Gemini Code Assist for
individuals") for Google AI Pro/Ultra and free-tier accounts. It is **kept, not
removed**, because Gemini Code Assist **Standard/Enterprise** licensees and Google
Cloud deployments retain access.

Two consequences worth knowing:

- **`isAvailable()` cannot detect this.** The probe is `gemini --version`, which
  still succeeds on a retired account — sign-in and entitlement are deliberately
  not probed (see the shared CLI backend above). That is why `antigravity`
  precedes `gemini` in `AUTO_ORDER`: ordering, not probing, is what keeps `auto`
  off a dead backend. An explicit `--provider gemini` still fails at generation
  with the CLI's own error surfaced.
- **Headless runs also need a trusted workspace.** In an untrusted directory the
  CLI refuses with a trusted-folders error and wants `--skip-trust` or
  `GEMINI_CLI_TRUST_WORKSPACE=true`; gitgist passes neither.

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
  (tracked as follow-up tickets). The Google one is now lower value for individual
  users: `antigravity` already covers the no-key Google path that `gemini` used to.

## Verification status

`opencode` and `antigravity` have been verified end-to-end (real generation
returns clean Markdown; for `antigravity`, both the default model and an explicit
`--model`).

`codex` has a verified **invocation** (the CLI runs with gitgist's exact arguments
and reaches its backend), but end-to-end output on this maintainer's machine is
auth-gated — like `claude-cli`, real output quality is validated by running the
signed-in CLI, not by unit tests.

`gemini` **can no longer be verified end-to-end on an individual account**: it
returns `IneligibleTierError` since the 2026-06-18 retirement. Its invocation
remains verified, and confirming output now requires a Code Assist
Standard/Enterprise license. See the [manual test plan](manual-test-plan.md) for
the live checks.
