import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

const execFileAsync = promisify(execFile);

/** Default wall-clock timeout for a single CLI generation. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** How many trailing stderr lines to include in a failure message. */
const STDERR_TAIL_LINES = 5;

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
  /**
   * Args that run a single headless prompt, e.g. `['-p']`.
   *
   * Either a static list, or a function of the request's `model` — the function
   * form lets a provider thread `--model` through at its CLI's expected position
   * (e.g. `gemini -m <model> -p`, `codex exec -m <model>`). When `model` is
   * undefined the function should return the no-model args.
   */
  runArgs: string[] | ((opts: { model?: string }) => string[]);
  /** Args used to probe availability (default: `['--version']`). */
  versionArgs?: string[];
  /**
   * Build the args that deliver the system prompt through the CLI's dedicated
   * system-prompt flag, e.g. `['--append-system-prompt', system]`.
   *
   * When provided, the system prompt rides the CLI's **system** layer (matching
   * the anthropic-api provider's role split) and only the user prompt is sent as
   * input — so notes-generator instructions like the empty-notes escape hatch
   * behave as a system constraint, not as part of the user turn. When omitted,
   * the system and user prompts are concatenated into the input — the legacy
   * fallback for CLIs without a usable system-prompt flag.
   */
  systemArgs?: (system: string) => string[];
  /**
   * How the prompt reaches the CLI:
   * - `stdin` (default) — piped via stdin, avoiding `ARG_MAX` truncation.
   * - `arg` — appended as the final positional argument.
   */
  input?: 'stdin' | 'arg';
  /** Default wall-clock timeout in ms for a generation (default: 120000). */
  timeoutMs?: number;
  /** Short hint shown when the CLI runs but returns nothing (e.g. not signed in). */
  hint?: string;
}

/** Keep only the last few non-empty lines of stderr for an error message. */
function stderrTail(stderr: string): string {
  const lines = stderr
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(-STDERR_TAIL_LINES).join('\n');
}

/**
 * Build an {@link AIProvider} that shells out to a locally installed CLI.
 *
 * This is the no-API-key path, and the reusable shape every CLI-capable
 * provider should adopt. The system prompt is delivered through the CLI's
 * system-prompt flag when {@link CliProviderSpec.systemArgs} is set, otherwise
 * concatenated ahead of the user prompt; a wrapping Markdown code fence (if any)
 * is stripped from its output, the run is bounded by a timeout, and stderr is
 * surfaced on failure.
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
      const runArgs =
        typeof spec.runArgs === 'function' ? spec.runArgs({ model: request.model }) : spec.runArgs;
      // With a system-prompt flag, keep the system layer separate (like the
      // anthropic-api provider); otherwise fall back to concatenating it in.
      const systemArgs = spec.systemArgs !== undefined ? spec.systemArgs(request.system) : [];
      const inputText =
        spec.systemArgs !== undefined ? request.prompt : `${request.system}\n\n${request.prompt}`;
      const baseArgs = [...systemArgs, ...runArgs];
      const args = input === 'arg' ? [...baseArgs, inputText] : baseArgs;
      const timeoutMs = request.timeoutMs ?? spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      return new Promise<string>((resolve, reject) => {
        const child = spawn(spec.command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        let out = '';
        let err = '';
        let settled = false;

        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(() => {
            reject(new Error(`${spec.command} timed out after ${String(timeoutMs)}ms`));
          });
        }, timeoutMs);

        function finish(action: () => void): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          action();
        }

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          out += chunk;
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          err += chunk;
        });

        // Swallow EPIPE if the child exits before we finish writing stdin; the
        // real cause surfaces via the exit code in the 'close' handler.
        child.stdin.on('error', () => undefined);
        child.on('error', (error) => {
          finish(() => {
            reject(error);
          });
        });
        child.on('close', (code) => {
          finish(() => {
            if (code !== 0) {
              const tail = stderrTail(err);
              const detail = tail === '' ? '' : `: ${tail}`;
              reject(
                new Error(
                  `${spec.command} exited with code ${code === null ? 'null' : String(code)}${detail}`,
                ),
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
        });

        if (input === 'stdin') {
          child.stdin.write(inputText);
        }
        child.stdin.end();
      });
    },
  };
}
