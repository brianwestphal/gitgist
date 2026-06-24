import { createCliProvider } from './cli.js';

/**
 * Build the `opencode run` arguments, threading `-m <provider/model>` after the
 * subcommand when a model is given. The prompt is appended as a positional.
 *
 * @param opts - The request's model, if any (OpenCode's `provider/model` form).
 * @returns The CLI arguments for `opencode` (the prompt is appended after these).
 */
export function opencodeRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== '' ? ['run', '-m', model] : ['run'];
}

/**
 * Provider that shells out to the locally installed, configured **OpenCode CLI**
 * (`opencode run "<prompt>"`). Requires no gitgist-managed API key — it reuses
 * whatever provider/credentials OpenCode is configured with (`opencode auth`),
 * the same no-key pattern as the `claude-cli` provider.
 *
 * `opencode run` takes the message as a positional argument; `--model`/`-m`
 * selects the model in OpenCode's `provider/model` form (e.g.
 * `anthropic/claude-opus-4-8`). The prompt is passed as an argument (the diff
 * material is capped upstream, so it stays well within the OS argument limit).
 */
export const opencodeProvider = createCliProvider({
  name: 'opencode',
  command: 'opencode',
  runArgs: opencodeRunArgs,
  input: 'arg',
  hint: 'is opencode configured? run `opencode auth login`',
});
