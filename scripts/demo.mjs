#!/usr/bin/env node
/**
 * Re-capturable animated CLI demos for the README.
 *
 * Each demo seeds a throwaway git repository with a representative set of
 * commits, runs the real built CLI (`dist/cli.js`) against it, and captures its
 * actual transcript. That transcript is turned into a self-contained animated
 * terminal SVG in two steps (see `scripts/lib/terminal.mjs`):
 *
 *   1. `buildCast` synthesizes an asciinema v2 recording that types the command
 *      and streams the captured output. `domotion term` renders it into a
 *      looping, transparent-background terminal — a faithful simulation with a
 *      blinking caret, ANSI color, and timed line reveal.
 *   2. `wrapTerminal` nests that terminal inside a macOS-style window (rounded
 *      corners, drop shadow, traffic lights, title bar) with a broadcast-style
 *      lower-third caption, all on a transparent canvas.
 *
 *   npm run demo                       # build + (re)generate assets/demos/*.svg
 *
 * The SVGs embedded in README.md are the output of this script. The seeded repo
 * is deterministic; the `--no-ai` demo is therefore fully reproducible, while
 * the AI demos (release notes and the staged commit message) reflect the live
 * model's real output (wording can vary slightly between captures — that is the
 * tool's actual behavior). The temp repo is a throwaway; only the SVGs under
 * assets/ are kept.
 *
 * Rendering drives headless Chromium via Playwright (domotion installs it on
 * first use). The AI demos use whatever provider `--provider auto` resolves —
 * typically the signed-in `claude` CLI, so no API key is required.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCast, PALETTE, wrapTerminal } from './lib/terminal.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const DOMOTION = join(ROOT, 'node_modules', '.bin', 'domotion');
const OUT_DIR = join(ROOT, 'assets', 'demos');

/**
 * Representative history for the demos. The first commit is tagged `v1.0.0`, so
 * `v1.0.0..HEAD` is everything after it: a healthy mix of user-facing work plus
 * internal noise (refactor / test / chore) that the AI filters out and the
 * deterministic `--no-ai` grouping keeps.
 */
const COMMITS = [
  'feat: initial release',
  '__TAG__',
  'feat: stream large diffs instead of buffering them in memory',
  'feat(cli): add --watch to regenerate notes on every commit',
  'fix: handle an empty commit range without crashing',
  'fix(auth): reject expired tokens instead of returning a 500',
  'perf: cache the parsed config — about 3x faster startup',
  'docs: expand the quickstart with a tag-to-HEAD example',
  'refactor: split the loader into smaller modules',
  'test: add coverage for the range parser',
  'chore: bump eslint to v10',
  'feat!: drop Node 18; the minimum supported version is now Node 20',
];

/** Open a `git` runner bound to `dir`, with demo identity/config preset. */
function gitIn(dir) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  git('init', '-q');
  git('config', 'user.email', 'demo@example.com');
  git('config', 'user.name', 'gitgist demo');
  git('config', 'commit.gpgsign', 'false');
  return git;
}

/** Seed a throwaway git repo with COMMITS and a `v1.0.0` tag. */
function seedRepo(dir) {
  const git = gitIn(dir);
  for (const subject of COMMITS) {
    if (subject === '__TAG__') {
      git('tag', 'v1.0.0');
      continue;
    }
    git('commit', '--allow-empty', '-q', '-m', subject);
  }
}

/** The committed baseline of the file the commit-message demo then edits. */
const AUTH_BEFORE = `export function verifyToken(token) {
  const payload = decode(token);
  return payload;
}
`;

/** The staged version — adds an expiry check that rejects stale tokens. */
const AUTH_AFTER = `export function verifyToken(token) {
  const payload = decode(token);
  if (payload.exp * 1000 < Date.now()) {
    throw new AuthError('token expired', 401);
  }
  return payload;
}
`;

/**
 * Seed a repo for the commit-message demo: one committed baseline file, then a
 * real, staged edit for gitgist to summarize into a Conventional Commit message.
 */
function seedStaged(dir) {
  const git = gitIn(dir);
  writeFileSync(join(dir, 'auth.js'), AUTH_BEFORE);
  git('add', 'auth.js');
  git('commit', '-q', '-m', 'feat: add token verification');
  writeFileSync(join(dir, 'auth.js'), AUTH_AFTER);
  git('add', 'auth.js');
}

/**
 * A compact house-style template for the `--template` demo: a fixed section set
 * with emoji and per-section AI guidance, plus frontmatter that tells the model
 * to drop internal noise. Shaped to the seeded COMMITS (breaking / features /
 * fixes / perf), so the output is the same work re-themed to a team's format.
 */
const TEMPLATE = `---
audience: users upgrading the package
tone: concise and friendly
guidance: |
  Exclude internal refactors, test-only changes, and CI/build tweaks.
  Call out anything that needs action on upgrade.
---

## ⚠️ Breaking Changes
<!-- Requires action on upgrade; add a short migration note for each. -->

## 🚀 Features
<!-- New, user-facing capabilities. One bullet each. -->

## 🐛 Bug Fixes
<!-- User-visible fixes only. -->

## ⚡ Performance
<!-- Speed or resource wins a user would notice. -->
`;

/** Seed the template demo: the standard history plus a template file to apply. */
function seedTemplate(dir) {
  seedRepo(dir);
  writeFileSync(join(dir, 'release-notes.md'), TEMPLATE);
}

/** Run the built CLI in `dir` and return its transcript (stderr+stdout) as lines. */
function runCli(dir, argv) {
  const r = spawnSync(process.execPath, [CLI, ...argv, '--cwd', dir], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`gitgist exited ${r.status}: ${r.stderr}`);
  }
  return `${r.stderr}${r.stdout}`.trimEnd().split('\n');
}

const DEMOS = [
  {
    slug: 'ai-release-notes',
    accent: PALETTE.heading,
    eyebrow: 'AI release notes',
    headline: 'From raw commits to a changelog',
    cmd: 'gitgist v1.0.0..HEAD --title "v1.5.0"',
    capture: (dir) => runCli(dir, ['v1.0.0..HEAD', '--title', 'v1.5.0']),
  },
  {
    slug: 'template',
    accent: '#d2a8ff',
    eyebrow: 'Templates',
    headline: 'Your house style, every release',
    cmd: 'gitgist v1.0.0..HEAD --template release-notes.md',
    seed: seedTemplate,
    capture: (dir) => runCli(dir, ['v1.0.0..HEAD', '--template', 'release-notes.md']),
  },
  {
    slug: 'commit-message',
    accent: '#58a6ff',
    eyebrow: 'Commit messages',
    headline: 'Draft the commit from your staged diff',
    cmd: 'gitgist --staged --commit-message',
    seed: seedStaged,
    capture: (dir) => runCli(dir, ['--staged', '--commit-message']),
  },
  {
    slug: 'offline',
    accent: PALETTE.warn,
    eyebrow: 'Offline mode',
    headline: 'No AI? No problem',
    cmd: 'gitgist v1.0.0..HEAD --no-ai',
    capture: (dir) => runCli(dir, ['v1.0.0..HEAD', '--no-ai']),
  },
];

/**
 * Compose one demo into an animated SVG: synthesize a cast, render it to a
 * transparent terminal with `domotion term`, then wrap it in the window chrome.
 */
async function buildSvg(demo, lines) {
  const work = await mkdtemp(join(tmpdir(), `dm-${demo.slug}-`));
  try {
    const castPath = join(work, 'demo.cast');
    const termPath = join(work, 'term.svg');
    const { cast, cols, rows } = buildCast({ command: demo.cmd, outputLines: lines });
    await writeFile(castPath, cast);

    const r = spawnSync(
      DOMOTION,
      // prettier-ignore
      [
        'term', '--cast', castPath,
        '--bg', 'transparent',
        '--fg', PALETTE.fgText,
        '--font-size', '15',
        '--cols', String(cols),
        '--rows', String(rows),
        '--min-frame-ms', '150',
        '--max-frame-ms', '2600',
        '--tail-ms', '2600',
        '-o', termPath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    if (r.status !== 0) throw new Error(`domotion term failed for ${demo.slug} (exit ${r.status})`);

    const termSvg = await readFile(termPath, 'utf8');
    const svg = wrapTerminal({
      termSvg,
      windowTitle: 'gitgist — zsh',
      eyebrow: demo.eyebrow,
      headline: demo.headline,
      accent: demo.accent,
    });
    await writeFile(join(OUT_DIR, `${demo.slug}.svg`), svg);
    process.stdout.write(`  ${demo.slug}.svg (${lines.length} lines)\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), 'gitgist-demo-'));
  try {
    for (const demo of DEMOS) {
      const dir = join(root, demo.slug);
      await mkdir(dir, { recursive: true });
      (demo.seed ?? seedRepo)(dir);
      const lines = demo.capture(dir);
      await buildSvg(demo, lines);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  process.stdout.write(`\nWrote ${DEMOS.length} demo SVGs to assets/demos/\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
