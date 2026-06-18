import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Provider that shells out to the locally installed, signed-in `claude` CLI.
 *
 * Requires no API key — it reuses whatever auth the CLI already has. The prompt
 * is piped via stdin (not argv) to avoid `ARG_MAX` truncation on large commit
 * logs, matching the release scripts in the sibling repos.
 */
export const claudeCliProvider: AIProvider = {
  name: 'claude-cli',

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('claude', ['--version'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  },

  generate(request: GenerateRequest): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'ignore'] });

      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code === null ? 'null' : String(code)}`));
          return;
        }
        const text = stripCodeFences(out);
        if (text === '') {
          reject(new Error('claude CLI returned no output (is it signed in?)'));
          return;
        }
        resolve(text);
      });

      child.stdin.write(`${request.system}\n\n${request.prompt}`);
      child.stdin.end();
    });
  },
};
