import { createCliProvider } from './cli.js';

/**
 * Provider that shells out to the locally installed, signed-in `claude` CLI
 * (`claude -p`, prompt piped via stdin). Requires no API key — it reuses the
 * CLI's own auth, exactly like the release scripts in the sibling repos.
 */
export const claudeCliProvider = createCliProvider({
  name: 'claude-cli',
  command: 'claude',
  runArgs: ['-p'],
  hint: 'is the claude CLI signed in?',
});
