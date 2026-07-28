import { createCliProvider } from './cli.js';

/**
 * Build the `claude` system-prompt args. Passing gitgist's instructions via
 * `--append-system-prompt` keeps them in Claude Code's **system** layer instead
 * of the user turn — see {@link claudeCliProvider}.
 *
 * @param system - The system prompt to append.
 * @returns The CLI args carrying the system prompt.
 */
export function claudeSystemArgs(system: string): string[] {
  return ['--append-system-prompt', system];
}

/**
 * Provider that shells out to the locally installed, signed-in `claude` CLI
 * (`claude -p`, user prompt piped via stdin). Requires no API key — it reuses
 * the CLI's own auth, exactly like the release scripts in the sibling repos.
 *
 * `claude -p` is Claude Code, which carries its own system prompt, so gitgist's
 * instructions are passed via `--append-system-prompt` rather than inlined into
 * the user turn. Inlining them made the model treat the empty-notes escape hatch
 * (`_No user-facing changes._`) as user input and echo it back instead of
 * generating notes (GG-38).
 */
/**
 * Build the `claude` arguments, threading `--model` when one was requested.
 *
 * `claude -p` reads the prompt from stdin rather than as a flag value, so the
 * order is not forced — `--model` goes first to match the other CLI backends.
 *
 * This was a static `['-p']` until GG-74, which silently dropped
 * `GenerateRequest.model`: `gitgist --provider claude-cli --model <id>` ran
 * whatever model the CLI defaulted to, with no error. FR-21 had only ever wired
 * `codex`/`gemini`/`opencode`.
 *
 * @param opts - The request's model, if any.
 * @returns The CLI arguments for `claude`.
 */
export function claudeRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== '' ? ['--model', model, '-p'] : ['-p'];
}

export const claudeCliProvider = createCliProvider({
  name: 'claude-cli',
  command: 'claude',
  runArgs: claudeRunArgs,
  systemArgs: claudeSystemArgs,
  hint: 'is the claude CLI signed in?',
});
