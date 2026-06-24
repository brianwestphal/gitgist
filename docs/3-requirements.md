# 3. Requirements

Status markers: **Shipped** (implemented + tested), **Partial** (implemented,
gaps noted), **Deferred** (planned, tracked by a ticket).

## Functional requirements

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-1 | Read commits in a git range | **Shipped** | `readCommits` (`git log -z`); range form `a..b` or `from`/`to` args. |
| FR-2 | Resolve a default range | **Shipped** | `resolveCommitRange`: `from` → latest tag, `to` → `HEAD`; full history if untagged. |
| FR-3 | Parse Conventional Commit subjects | **Shipped** | `parseCommit` — type/scope/description + breaking-change (`!` or footer). |
| FR-4 | Generate AI release notes grouped into themed Markdown sections | **Shipped** | `generateReleaseNotes` + `prompt.ts`; sections vary with the changes. |
| FR-5 | Claude provider — CLI (`claude -p`), no API key | **Shipped** | `claudeCli.ts` via `createCliProvider`. |
| FR-6 | Claude provider — Anthropic API | **Shipped** | `anthropicApi.ts` (`claude-opus-4-8`, adaptive thinking, streaming). |
| FR-7 | Provider auto-selection, CLI-first | **Shipped** | `resolveProvider`/`AUTO_ORDER`. |
| FR-8 | Offline deterministic fallback (`--no-ai`) | **Shipped** | `buildChangelog` + `renderMarkdown`. |
| FR-9 | CLI flags: `--no-ai`, `--provider`, `--model`, `--endpoint` (FR-14), `--language` (FR-17), `--max-tokens`, `--title`, `--cwd`, `--help`, the format flags (`--format`/`--commit-message`, FR-12), `--template` (FR-13), and the working-tree flags (FR-11) | **Shipped** | `cliArgs.ts` (`parseArgs` + `USAGE`). |
| FR-10 | Additional providers: Cursor, and API-key fallbacks for the agent CLIs | **Deferred** | Cursor: GG-7. API-key fallbacks (OpenAI/Codex, Gemini API) tracked as follow-ups. (Codex/Gemini/OpenCode CLI providers shipped — FR-18/19/20.) |
| FR-11 | Summarize **uncommitted** working-tree changes (`--staged`/`--cached`, `--unstaged`, `--untracked`, `--working`) — alongside a range, or standalone (no range) for a commit-message draft | **Shipped** | `readWorkingChanges` (`git.ts`); diffs fed to the AI, or a deterministic file listing under `--no-ai` (`renderWorkingChanges`). |
| FR-12 | Output format selection: `--format notes` (default, themed Markdown) or `--format commit` / `--commit-message` (a single Conventional Commit message). `commit` requires AI; `--title` is ignored for it | **Shipped** | `COMMIT_SYSTEM_PROMPT` (`prompt.ts`) selected in `releaseNotes.ts`. Pairs with FR-11 for "draft my commit message". |
| FR-13 | Custom output templates: `--template <file>` shapes the notes to a Markdown-with-frontmatter template — strict section set/order, per-section `<!-- -->` guidance, global frontmatter directives. Requires AI; not combinable with `--format commit` | **Shipped** | `template.ts` (`loadTemplate`/`parseTemplate`) + `TEMPLATE_SYSTEM_PROMPT`/`buildTemplatePrompt` (`prompt.ts`). Format spec in [4-templates.md](4-templates.md). |
| FR-14 | Local provider: `--provider local` against any OpenAI-compatible endpoint (Ollama / LM Studio / …). Config via `--endpoint`/`GITGIST_LOCAL_ENDPOINT` and `--model`/`GITGIST_LOCAL_MODEL` (else the endpoint's first model). Opt-in only — never auto-selected | **Shipped** | `providers/local.ts` (`createLocalProvider`); returns freeform Markdown (no `response_format`). |
| FR-15 | Apple Foundation Models provider: `--provider apple` for on-device, free, private generation on macOS 26+ (Apple Silicon + Apple Intelligence). Delegates to the [`apple-fm`](https://www.npmjs.com/package/apple-fm) npm package, which wraps `FoundationModels` and returns Markdown; `APPLE_FM_BIN` points at a custom helper build. In `AUTO_ORDER` as a free fallback (a no-op when the device/model isn't available) | **Shipped** | `providers/apple.ts` (`createAppleProvider`) calls `apple-fm`'s `probe()` / `generate()`. |
| FR-16 | The `apple` provider works without a local Swift toolchain: the **Developer-ID-signed + notarized** prebuilt helper binary now ships inside the `apple-fm` dependency (built + signed in that package's release), so gitgist neither builds nor bundles its own | **Shipped** | `apple-fm` is a runtime dependency; no gitgist-side build/sign/notarize job (removed from `release.yml`). (Superseded the old GG-19 CI job.) |
| FR-17 | Apple language hint: the `apple` provider prefixes the prompt with `Treat the following as <language>:` to satisfy the on-device model's language guardrail (which rejects non-prose-heavy prompts, e.g. full-SHA ranges, with `unsupportedLanguageOrLocale`). `--language <name\|code>` overrides the language (default: detected system language); `--language auto` omits the hint | **Shipped** | `providers/apple.ts` (`detectSystemLanguage`, `AUTO_LANGUAGE`, language resolution in `createAppleProvider`); threaded via `--language` → `resolveProvider`. |
| FR-18 | Codex CLI provider: `--provider codex` shells out to the signed-in OpenAI **Codex** CLI (`codex exec`, prompt via stdin), no API key; `--model`/`-m` selects the model. In `AUTO_ORDER` among the CLI backends | **Shipped** | `providers/codex.ts` (a `createCliProvider` spec). Spec in [5-providers.md](5-providers.md). |
| FR-19 | Gemini CLI provider: `--provider gemini` shells out to the signed-in Google **Gemini** CLI (`gemini -p "<prompt>"`), no API key; `--model`/`-m` selects the model. In `AUTO_ORDER` among the CLI backends | **Shipped** | `providers/gemini.ts` (a `createCliProvider` spec). Spec in [5-providers.md](5-providers.md). |
| FR-20 | OpenCode CLI provider: `--provider opencode` shells out to the configured **OpenCode** CLI (`opencode run "<prompt>"`), no gitgist-managed key; `--model`/`-m` selects a `provider/model`. In `AUTO_ORDER` among the CLI backends | **Shipped** | `providers/opencode.ts` (a `createCliProvider` spec); verified end-to-end. Spec in [5-providers.md](5-providers.md). |
| FR-21 | `--model` reaches the CLI agent providers: `createCliProvider` accepts a `runArgs` function of `model`, so `codex`/`gemini`/`opencode` thread `-m <model>` at their CLI's expected position | **Shipped** | `providers/cli.ts` (`CliProviderSpec.runArgs` as `string[] \| (opts) => string[]`). |

## Non-functional requirements

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| NFR-1 | No API key required by default | **Shipped** | CLI-first `AUTO_ORDER`; `--no-ai` needs neither key nor network. |
| NFR-2 | CLI subprocess is bounded + diagnosable | **Shipped** | Timeout + stderr capture in `createCliProvider` (GG-9). |
| NFR-3 | Robust git parsing | **Shipped** | NUL-delimited records; body rejoin (GG-11). |
| NFR-4 | Strict TypeScript, ESM, lint-clean | **Shipped** | `strictTypeChecked`; `.js` import extensions. |
| NFR-5 | Pure logic unit-tested; I/O layer integration-tested | **Shipped** | Vitest; temp-repo integration test (GG-10). |
| NFR-6 | Surface AI output truncation | **Partial** | API provider warns on `stop_reason === 'max_tokens'` (GG-12); `--max-tokens` exposed. |
| NFR-7 | Clean AI output | **Shipped** | `cleanModelOutput` (`prompt.ts`) strips conversational preamble/postamble the agentic `claude-cli` provider can add (GG-18); format-aware, no-op on clean output. |

## Open items

- AI output quality depends on the backend; the `claude -p` agentic CLI can
  occasionally add meta-commentary on trivial inputs (model behavior, not a code
  defect).
