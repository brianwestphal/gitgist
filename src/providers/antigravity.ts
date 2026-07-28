import { createCliProvider } from './cli.js';

/**
 * Build the `agy` arguments. `--model <model>` (when given) must precede `-p`,
 * because `-p` is the last flag and takes the prompt as its value.
 *
 * @param opts - The request's model, if any.
 * @returns The CLI arguments for `agy` (the prompt is appended after these).
 */
export function antigravityRunArgs({ model }: { model?: string }): string[] {
  return model !== undefined && model !== '' ? ['--model', model, '-p'] : ['-p'];
}

/**
 * Provider that shells out to the locally installed, signed-in **Antigravity
 * CLI** (`agy -p "<prompt>"`, non-interactive print mode). Requires no API key —
 * it reuses the CLI's own signed-in Google auth, the same no-key pattern as the
 * `claude-cli` provider.
 *
 * This is Google's **replacement for the Gemini CLI**: Gemini CLI stopped
 * serving Google AI Pro/Ultra and free-tier requests on 2026-06-18, and those
 * tiers are now served through Antigravity. The `gemini` provider (FR-19) is
 * kept for Gemini Code Assist Standard/Enterprise licensees, whose access
 * continues — but `antigravity` precedes it in `AUTO_ORDER`, so the backend that
 * still works for most users wins.
 *
 * `-p`/`--print`/`--prompt` triggers print mode and takes the prompt as its
 * value; `--model` selects the model and must precede `-p`. Model ids come from
 * `agy models` and are human-readable strings containing spaces and parentheses
 * (e.g. `Gemini 3.6 Flash (High)`, `Claude Opus 4.6 (Thinking)`) — they ride as
 * a single argv entry, so no quoting concerns reach the child process. The
 * prompt is passed as an argument (the diff material is capped upstream, so it
 * stays well within the OS argument limit).
 *
 * `agy` writes progress and language-server logs to **stderr** and only the
 * model's answer to stdout, so no preamble stripping beyond the shared
 * fence-stripping is needed.
 */
export const antigravityProvider = createCliProvider({
  name: 'antigravity',
  command: 'agy',
  runArgs: antigravityRunArgs,
  input: 'arg',
  hint: 'is the Antigravity CLI signed in? run `agy` once to authenticate',
});
