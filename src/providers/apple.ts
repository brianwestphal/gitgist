import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Probe timeout (ms) — a quick availability check. */
const PROBE_TIMEOUT_MS = 10_000;
/** Default generation timeout (ms) — on-device inference can be slow. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Result of running the Swift helper. */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Spawn the helper, write `stdin`, resolve with its output — injectable for tests. */
export type ProcessRunner = (
  bin: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
) => Promise<ProcessResult>;

const defaultRunner: ProcessRunner = (bin, args, stdin, timeoutMs) =>
  new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => {
        reject(new Error(`apple-fm-helper timed out after ${String(timeoutMs)}ms`));
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
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (err) => {
      finish(() => {
        reject(err);
      });
    });
    child.on('close', (code) => {
      finish(() => {
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
    child.stdin.end(stdin);
  });

/**
 * Path to the Apple Foundation Models helper binary the package ships at
 * `<package>/bin/apple-fm-helper`, resolved relative to this module. The built
 * `dist/*.js` live one level below the package root, so `../bin/...` lands on it.
 */
function packagedBinPath(): string {
  return fileURLToPath(new URL('../bin/apple-fm-helper', import.meta.url));
}

/**
 * Absolute path to the Apple Foundation Models helper binary, or `null` when it
 * isn't present. Resolution order: `GITGIST_APPLE_FM_BIN`, the binary shipped
 * with the package, then `./bin/apple-fm-helper` or `./apple-fm-helper` relative
 * to the current directory.
 */
export function appleFmBinPath(): string | null {
  const env = process.env.GITGIST_APPLE_FM_BIN;
  if (env !== undefined && env !== '' && existsSync(env)) return env;
  for (const candidate of [
    packagedBinPath(),
    join(process.cwd(), 'bin', 'apple-fm-helper'),
    join(process.cwd(), 'apple-fm-helper'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Config captured by {@link createAppleProvider} (injectable for tests). */
export interface AppleProviderConfig {
  runner?: ProcessRunner;
  /** Pretend-platform for tests (default: `process.platform === 'darwin'`). */
  isDarwin?: boolean;
  /** Override the binary path (default: {@link appleFmBinPath}). */
  binPath?: string | null;
}

/**
 * Provider for macOS **Apple Foundation Models** — on-device, free, private, no
 * API key. Node can't call the native framework, so it shells out to a small
 * Swift helper (`apple-fm-helper/main.swift`, built via
 * `scripts/build-apple-fm-helper.sh`) that returns the model's Markdown.
 *
 * Requires macOS 26+ on Apple Silicon with Apple Intelligence. On any other
 * platform, a missing helper, or a failed `--probe`, it reports unavailable and
 * is skipped.
 *
 * @param config - Injectable runner / platform / binary path for tests.
 * @returns A provider backed by the Swift helper.
 */
export function createAppleProvider(config: AppleProviderConfig = {}): AIProvider {
  const runner = config.runner ?? defaultRunner;
  const isDarwin = config.isDarwin ?? process.platform === 'darwin';
  const resolveBin = (): string | null =>
    config.binPath !== undefined ? config.binPath : appleFmBinPath();

  return {
    name: 'apple',

    async isAvailable(): Promise<boolean> {
      if (!isDarwin) return false;
      const bin = resolveBin();
      if (bin === null) return false;
      try {
        const { stdout, code } = await runner(bin, ['--probe'], '', PROBE_TIMEOUT_MS);
        return code === 0 && stdout.trim().toLowerCase().startsWith('available');
      } catch {
        return false;
      }
    },

    async generate(request: GenerateRequest): Promise<string> {
      const bin = resolveBin();
      if (bin === null) {
        throw new Error(
          'Apple Foundation Models helper not found — run `npm run build:apple-fm` (macOS 26+) or set GITGIST_APPLE_FM_BIN.',
        );
      }
      const result = await runner(
        bin,
        ['--generate'],
        JSON.stringify({ system: request.system, prompt: request.prompt }),
        request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (result.code !== 0) {
        const tail = result.stderr.trim();
        throw new Error(
          `Apple Foundation Models helper exited with code ${String(result.code)}${tail !== '' ? `: ${tail}` : ''}`,
        );
      }
      const text = stripCodeFences(result.stdout);
      if (text === '') throw new Error('Apple Foundation Models helper returned no output.');
      return text;
    },
  };
}

/** Default Apple Foundation Models provider. */
export const appleProvider = createAppleProvider();
