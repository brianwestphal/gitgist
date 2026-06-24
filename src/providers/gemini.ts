import { createCliProvider } from './cli.js';

/**
 * Build the `gemini` arguments. `-m <model>` (when given) must precede `-p`, and
 * `-p` is the last flag so the prompt is appended as its value.
 *
 * @param opts - The request's model, if any.
 * @returns The CLI arguments for `gemini` (the prompt is appended after these).
 */
export function geminiRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== '' ? ['-m', model, '-p'] : ['-p'];
}

/**
 * Provider that shells out to the locally installed, signed-in **Gemini CLI**
 * (`gemini -p "<prompt>"`, non-interactive headless mode). Requires no API key
 * — it reuses the CLI's own signed-in Google auth, the same no-key pattern as
 * the `claude-cli` provider.
 *
 * `-p`/`--prompt` triggers headless mode and takes the prompt as its value;
 * `--model`/`-m` selects the model (e.g. `gemini-2.5-pro`) and must precede
 * `-p`. The prompt is passed as an argument (the diff material is capped
 * upstream, so it stays well within the OS argument limit).
 */
export const geminiProvider = createCliProvider({
  name: 'gemini',
  command: 'gemini',
  runArgs: geminiRunArgs,
  input: 'arg',
  hint: 'is the gemini CLI signed in? run `gemini` once to authenticate',
});
