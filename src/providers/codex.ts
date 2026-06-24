import { createCliProvider } from './cli.js';

/**
 * Build the `codex exec` arguments, threading `-m <model>` after the subcommand
 * when a model is given. `codex exec` reads the prompt from stdin.
 *
 * @param opts - The request's model, if any.
 * @returns The CLI arguments for `codex`.
 */
export function codexRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== '' ? ['exec', '-m', model] : ['exec'];
}

/**
 * Provider that shells out to the locally installed, signed-in **Codex CLI**
 * (`codex exec`, prompt piped via stdin). Requires no API key — it reuses the
 * CLI's own ChatGPT/Codex auth, the same no-key pattern as the `claude-cli`
 * provider.
 *
 * `codex exec` reads its instructions from stdin when no prompt argument is
 * given. `--model`/`-m` selects the model (e.g. `gpt-5-codex`, `o3`).
 */
export const codexProvider = createCliProvider({
  name: 'codex',
  command: 'codex',
  runArgs: codexRunArgs,
  hint: 'is the codex CLI signed in? run `codex login`',
});
