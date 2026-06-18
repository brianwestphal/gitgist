#!/usr/bin/env node
/**
 * Compare the release notes different AI backends produce for the *same* set of
 * changes — a manual, exploratory tool (not a CI test: AI output is
 * non-deterministic and each backend needs its runtime present, so there's
 * nothing stable to assert).
 *
 *   npm run compare
 *
 * It seeds a throwaway git repo with a fixed, representative history, then runs
 * the built CLI (`dist/cli.js`) once per provider and prints each result. A
 * provider that isn't available on this machine (no `claude` CLI, no
 * `ANTHROPIC_API_KEY`, no local server, no Apple helper) is skipped with the
 * reason. The deterministic `--no-ai` grouping is included as a baseline.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');

/** The fixed history every backend summarizes (the first commit is tagged). */
const COMMITS = [
  'feat: initial release',
  '__TAG__',
  'feat(api): add cursor-based pagination to the list endpoint',
  'feat(ui): add a dark-mode toggle to the settings page',
  'fix(auth): reject expired tokens instead of returning a 500',
  'fix: stop the sidebar from flickering on window resize',
  'perf: cache compiled regexes — about 3x faster cold start',
  'docs: expand the quickstart with a tag-to-HEAD example',
  'refactor: split the loader into smaller modules',
  'test: add coverage for the range parser',
  'chore: bump eslint to v10',
  'feat!: drop Node 18; the minimum supported version is now Node 20',
];

/** Each run: a label, the gitgist args, and whether it needs an AI backend. */
const RUNS = [
  { label: 'claude-cli (Claude via the signed-in CLI)', args: ['--provider', 'claude-cli'] },
  { label: 'anthropic-api (Claude via the API)', args: ['--provider', 'anthropic-api'] },
  { label: 'local (Ollama / OpenAI-compatible)', args: ['--provider', 'local'] },
  { label: 'apple (on-device Apple Foundation Models)', args: ['--provider', 'apple'] },
  { label: 'no-ai (deterministic Conventional Commits)', args: ['--no-ai'] },
];

function seedRepo(dir) {
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  git('init', '-q');
  git('config', 'user.email', 'compare@example.com');
  git('config', 'user.name', 'gitgist compare');
  git('config', 'commit.gpgsign', 'false');
  for (const subject of COMMITS) {
    if (subject === '__TAG__') git('tag', 'v1.0.0');
    else git('commit', '--allow-empty', '-q', '-m', subject);
  }
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, 'v1.0.0..HEAD', ...args, '--cwd', dir], {
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'gitgist-compare-'));
  try {
    seedRepo(dir);
    process.stdout.write(`\nSame ${COMMITS.length - 2} commits (v1.0.0..HEAD), each backend's take:\n`);
    for (const { label, args } of RUNS) {
      process.stdout.write(`\n${'═'.repeat(72)}\n▶ ${label}\n${'─'.repeat(72)}\n`);
      const { ok, out, err } = run(dir, args);
      if (ok && out !== '') {
        process.stdout.write(`${out}\n`);
      } else {
        const reason = err.split('\n').find((l) => l.startsWith('gitgist:')) ?? err.split('\n')[0] ?? 'no output';
        process.stdout.write(`(skipped — ${reason})\n`);
      }
    }
    process.stdout.write(`\n${'═'.repeat(72)}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
