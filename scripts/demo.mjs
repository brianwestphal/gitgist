#!/usr/bin/env node
/**
 * Re-capturable animated CLI demos for the README.
 *
 * Each demo seeds a throwaway git repository with a representative set of
 * commits, runs the real built CLI (`dist/cli.js`) against it, captures its
 * actual transcript, then renders that transcript into a self-contained animated
 * terminal SVG with `domotion-svg`: a title card introducing the concept, then a
 * terminal that types the command and reveals the captured output.
 *
 *   npm run demo                       # build + (re)generate assets/demos/*.svg
 *
 * The SVGs embedded in README.md are the output of this script. The seeded repo
 * is deterministic; the `--no-ai` demo is therefore fully reproducible, while
 * the AI demo reflects the live model's real output (wording can vary slightly
 * between captures — that is the tool's actual behavior). The temp repo is a
 * throwaway; only the SVGs under assets/ are kept.
 *
 * Rendering drives headless Chromium via Playwright (domotion installs it on
 * first use). The AI demo uses whatever provider `--provider auto` resolves —
 * typically the signed-in `claude` CLI, so no API key is required.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { terminalHeight, terminalHtml, titleCardHtml, WIDTH } from './lib/terminal.mjs';

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

/** Seed a throwaway git repo with COMMITS and a `v1.0.0` tag. */
function seedRepo(dir) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  git('init', '-q');
  git('config', 'user.email', 'demo@example.com');
  git('config', 'user.name', 'gitgist demo');
  git('config', 'commit.gpgsign', 'false');
  for (const subject of COMMITS) {
    if (subject === '__TAG__') {
      git('tag', 'v1.0.0');
      continue;
    }
    git('commit', '--allow-empty', '-q', '-m', subject);
  }
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
    title: {
      eyebrow: 'AI release notes',
      headline: 'From raw commits to a changelog',
      subtitle:
        'Point gitgist at a commit range; Claude writes the user-facing notes and drops the noise. No API key — it uses your signed-in claude CLI.',
    },
    cmd: 'gitgist v1.0.0..HEAD --title "v1.5.0"',
    capture: (dir) => runCli(dir, ['v1.0.0..HEAD', '--title', 'v1.5.0']),
  },
  {
    slug: 'offline',
    title: {
      eyebrow: 'Offline mode',
      headline: 'No AI? No problem',
      subtitle:
        '--no-ai groups commits by Conventional Commit type — fully offline, deterministic, and zero dependencies beyond git.',
    },
    cmd: 'gitgist v1.0.0..HEAD --no-ai',
    capture: (dir) => runCli(dir, ['v1.0.0..HEAD', '--no-ai']),
  },
];

/**
 * Compose one demo into an animated SVG: write the two frame HTML files and a
 * domotion `animate` config into a temp dir, then shell out to the installed
 * `domotion` CLI to capture and stitch them.
 */
async function buildSvg(demo, lines) {
  const height = terminalHeight(lines.length);
  const work = await mkdtemp(join(tmpdir(), `dm-${demo.slug}-`));
  try {
    const titleHtml = join(work, 'title.html');
    const termHtml = join(work, 'term.html');
    const config = join(work, 'config.json');
    await writeFile(titleHtml, titleCardHtml({ ...demo.title, height }));
    await writeFile(termHtml, terminalHtml({ title: 'gitgist', outputLines: lines, height }));

    const speed = 28; // characters per second
    const typeMs = Math.ceil((demo.cmd.length / speed) * 1000);
    const revealDelay = typeMs + 350; // let the command settle before output appears
    const termDuration = revealDelay + 300 + 3600; // reveal + hold
    const outHideDelay = termDuration - 150; // fade output as the typed command self-erases

    await writeFile(
      config,
      JSON.stringify(
        {
          width: WIDTH,
          height,
          output: join(OUT_DIR, `${demo.slug}.svg`),
          optimize: true,
          frames: [
            {
              input: 'title.html',
              duration: 1700,
              transition: { type: 'crossfade', duration: 500 },
            },
            {
              input: 'term.html',
              duration: termDuration,
              transition: { type: 'crossfade', duration: 500 },
              overlays: [
                {
                  kind: 'typing',
                  text: `${demo.cmd} `,
                  anchor: { selector: '.cmd', at: 'left' },
                  fontSize: 15,
                  color: '#e6edf3',
                  speed,
                  caret: true,
                },
              ],
              animations: [
                {
                  selector: '.outbody',
                  property: 'opacity',
                  from: '0',
                  to: '1',
                  duration: 300,
                  delay: revealDelay,
                },
                {
                  selector: '.out',
                  property: 'opacity',
                  from: '1',
                  to: '0',
                  duration: 100,
                  delay: outHideDelay,
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    const r = spawnSync(DOMOTION, ['animate', config], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (r.status !== 0) throw new Error(`domotion failed for ${demo.slug} (exit ${r.status})`);
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
      seedRepo(dir);
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
