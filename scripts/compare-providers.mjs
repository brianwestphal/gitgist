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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');

/**
 * The fixed history every backend summarizes (the first commit is tagged).
 *
 * Each commit carries real file content: gitgist reads the range's actual diff
 * and per-commit file lists (FR-25 / FR-30), so an `--allow-empty` history would
 * compare the backends on the commit-messages-only path rather than on how the
 * tool actually runs.
 */
const COMMITS = [
  {
    subject: 'feat: initial release',
    files: {
      'package.json': '{\n  "name": "acme",\n  "engines": { "node": ">=18" }\n}\n',
      'src/list.js': 'export function list() {\n  return findAll();\n}\n',
    },
  },
  '__TAG__',
  {
    subject: 'feat(api): add cursor-based pagination to the list endpoint',
    files: {
      'src/list.js':
        'export function list({ cursor, limit = 50 } = {}) {\n  const rows = findAll({ after: cursor, limit });\n  return { rows, nextCursor: rows.at(-1)?.id ?? null };\n}\n',
    },
  },
  {
    subject: 'feat(ui): add a dark-mode toggle to the settings page',
    files: {
      'src/settings.jsx':
        "export function Settings({ theme, onTheme }) {\n  return <Toggle checked={theme === 'dark'} onChange={() => onTheme(theme === 'dark' ? 'light' : 'dark')} />;\n}\n",
    },
  },
  {
    subject: 'fix(auth): reject expired tokens instead of returning a 500',
    files: {
      'src/auth.js':
        "export function verifyToken(token) {\n  const payload = decode(token);\n  if (payload.exp * 1000 < Date.now()) {\n    throw new AuthError('token expired', 401);\n  }\n  return payload;\n}\n",
    },
  },
  {
    subject: 'fix: stop the sidebar from flickering on window resize',
    files: {
      'src/sidebar.js':
        'const onResize = debounce(() => measure(), 100);\nwindow.addEventListener("resize", onResize);\n',
    },
  },
  {
    subject: 'perf: cache compiled regexes — about 3x faster cold start',
    files: {
      'src/match.js':
        'const cache = new Map();\n\nexport function compile(pattern) {\n  let re = cache.get(pattern);\n  if (!re) cache.set(pattern, (re = new RegExp(pattern)));\n  return re;\n}\n',
    },
  },
  {
    subject: 'docs: expand the quickstart with a tag-to-HEAD example',
    files: { 'README.md': '# acme\n\n## Quickstart\n\n```bash\nacme v1.0.0..HEAD\n```\n' },
  },
  {
    subject: 'refactor: split the loader into smaller modules',
    files: {
      'src/loader.js': "export { parse } from './loader/parse.js';\n",
      'src/loader/parse.js': 'export function parse(text) {\n  return text.trim().split("\\n");\n}\n',
    },
  },
  {
    subject: 'test: add coverage for the range parser',
    files: {
      'test/range.test.js':
        "import { parseRange } from '../src/range.js';\n\ntest('empty range', () => {\n  expect(parseRange('HEAD..HEAD').empty).toBe(true);\n});\n",
    },
  },
  {
    subject: 'chore: bump eslint to v10',
    files: {
      'package.json':
        '{\n  "name": "acme",\n  "engines": { "node": ">=18" },\n  "devDependencies": { "eslint": "^10.0.0" }\n}\n',
    },
  },
  {
    subject: 'feat!: drop Node 18; the minimum supported version is now Node 20',
    files: {
      'package.json':
        '{\n  "name": "acme",\n  "engines": { "node": ">=20" },\n  "devDependencies": { "eslint": "^10.0.0" }\n}\n',
    },
  },
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
  for (const entry of COMMITS) {
    if (entry === '__TAG__') {
      git('tag', 'v1.0.0');
      continue;
    }
    for (const [path, content] of Object.entries(entry.files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', entry.subject);
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
