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
export const claudeCliProvider = createCliProvider({
  name: 'claude-cli',
  command: 'claude',
  runArgs: ['-p'],
  systemArgs: claudeSystemArgs,
  hint: 'is the claude CLI signed in?',
});
