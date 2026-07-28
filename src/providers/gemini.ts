import { createCliProvider } from './cli.js';

/**
 * Build the `gemini` arguments.
 *
 * `--skip-trust` comes first (see the provider doc below), `-m <model>` (when
 * given) must precede `-p`, and `-p` is the last flag so the prompt is appended
 * as its value.
 *
 * @param opts - The request's model, if any.
 * @returns The CLI arguments for `gemini` (the prompt is appended after these).
 */
export function geminiRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== ''
    ? ['--skip-trust', '-m', model, '-p']
    : ['--skip-trust', '-p'];
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
 *
 * ### Why `--skip-trust` (GG-65)
 *
 * In a workspace the user has not explicitly trusted, headless `gemini -p`
 * **refuses to run** (exit 55) and points at `--skip-trust` /
 * `GEMINI_CLI_TRUST_WORKSPACE=true`. That gate fires on directories one would
 * expect to be fine — including an ordinary git checkout — so without the flag
 * this provider is broken in exactly the automated context it is most useful in,
 * and gitgist is pointed at arbitrary repositories by design (`--cwd`).
 *
 * The flag is passed rather than the environment variable deliberately: it is
 * scoped to this one invocation, whereas the env var would leak to anything else
 * the child spawns.
 *
 * This is a small, bounded escalation, and worth being precise about. Gemini's
 * trust setting governs whether the workspace is *trusted*, not whether tool
 * calls are *approved* — approval is a separate axis (`--approval-mode`,
 * `--yolo`), and gitgist leaves it at the default, so nothing here auto-approves
 * a tool. The user also chose the directory. gitgist asks only for text
 * generation, and the other agent-CLI backends (`claude-cli`, `codex`,
 * `antigravity`) have no equivalent gate, so this brings `gemini` in line with
 * them rather than ahead of them.
 *
 * See [docs/5-providers.md](../../docs/5-providers.md).
 */
export const geminiProvider = createCliProvider({
  name: 'gemini',
  command: 'gemini',
  runArgs: geminiRunArgs,
  input: 'arg',
  hint: 'is the gemini CLI signed in? run `gemini` once to authenticate',
});
