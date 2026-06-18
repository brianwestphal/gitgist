import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Describes a CLI-backed AI provider — a locally installed coding/agent CLI
 * (Claude, Codex, Gemini, Cursor, …) invoked in a one-shot headless mode.
 *
 * These backends need **no API key**: they reuse whatever auth the CLI already
 * has, the way the sibling release scripts use `claude -p`.
 */
export interface CliProviderSpec {
  /** Stable provider id, e.g. `claude-cli`. */
  name: string;
  /** Executable to run, e.g. `claude`. */
  command: string;
  /** Args that run a single headless prompt, e.g. `['-p']`. */
  runArgs: string[];
  /** Args used to probe availability (default: `['--version']`). */
  versionArgs?: string[];
  /**
   * How the prompt reaches the CLI:
   * - `stdin` (default) — piped via stdin, avoiding `ARG_MAX` truncation.
   * - `arg` — appended as the final positional argument.
   */
  input?: 'stdin' | 'arg';
  /** Short hint shown when the CLI runs but returns nothing (e.g. not signed in). */
  hint?: string;
}

/**
 * Build an {@link AIProvider} that shells out to a locally installed CLI.
 *
 * This is the no-API-key path, and the reusable shape every CLI-capable
 * provider should adopt. The combined system + user prompt is delivered to the
 * CLI, and a wrapping Markdown code fence (if any) is stripped from its output.
 *
 * @param spec - The CLI invocation details.
 * @returns A provider backed by that CLI.
 */
export function createCliProvider(spec: CliProviderSpec): AIProvider {
  const versionArgs = spec.versionArgs ?? ['--version'];
  const input = spec.input ?? 'stdin';

  return {
    name: spec.name,

    async isAvailable(): Promise<boolean> {
      try {
        await execFileAsync(spec.command, versionArgs, { timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },

    generate(request: GenerateRequest): Promise<string> {
      const fullPrompt = `${request.system}\n\n${request.prompt}`;
      const args = input === 'arg' ? [...spec.runArgs, fullPrompt] : spec.runArgs;

      return new Promise<string>((resolve, reject) => {
        const child = spawn(spec.command, args, { stdio: ['pipe', 'pipe', 'ignore'] });

        let out = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          out += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(`${spec.command} exited with code ${code === null ? 'null' : String(code)}`),
            );
            return;
          }
          const text = stripCodeFences(out);
          if (text === '') {
            const hint = spec.hint !== undefined ? ` (${spec.hint})` : '';
            reject(new Error(`${spec.command} returned no output${hint}`));
            return;
          }
          resolve(text);
        });

        if (input === 'stdin') {
          child.stdin.write(fullPrompt);
        }
        child.stdin.end();
      });
    },
  };
}
