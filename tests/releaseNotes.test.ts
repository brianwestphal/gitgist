import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A capturing fake provider, shared with the mocked module via vi.hoisted.
const h = vi.hoisted(() => {
  const calls: { system: string; prompt: string }[] = [];
  return {
    calls,
    // Returns a clean notes body with a leading preamble, so we can also assert
    // cleanModelOutput ran (the preamble before the first heading is stripped).
    fakeProvider: {
      name: 'fake',
      isAvailable: () => Promise.resolve(true),
      generate: (req: { system: string; prompt: string }) => {
        calls.push({ system: req.system, prompt: req.prompt });
        return Promise.resolve('Here are the notes:\n\n## Features\n- did a thing');
      },
    },
  };
});

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveProvider: () => Promise.resolve(h.fakeProvider) };
});

const { COMMIT_SYSTEM_PROMPT, SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT } = await import(
  '../src/prompt.js'
);
const { generateReleaseNotes } = await import('../src/releaseNotes.js');

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('generateReleaseNotes AI branches (mocked provider)', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgist-rn-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'a@b.c');
    git(repo, 'config', 'user.name', 'T');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'feat: thing one');
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'fix: thing two');
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  beforeEach(() => {
    h.calls.length = 0;
  });

  it('default notes path uses SYSTEM_PROMPT and cleans the output', async () => {
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].system).toBe(SYSTEM_PROMPT);
    // Preamble stripped by cleanModelOutput.
    expect(out).toBe('## Features\n- did a thing\n');
  });

  it('--format commit uses COMMIT_SYSTEM_PROMPT and skips the title heading', async () => {
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo, format: 'commit', title: 'v9' });
    expect(h.calls[0].system).toBe(COMMIT_SYSTEM_PROMPT);
    expect(out.startsWith('# v9')).toBe(false);
  });

  it('--template uses TEMPLATE_SYSTEM_PROMPT and embeds the template body', async () => {
    const tpl = join(repo, 'tpl.md');
    writeFileSync(tpl, '## Highlights\n<!-- the big stuff -->');
    await generateReleaseNotes({ range: 'HEAD', cwd: repo, template: tpl });
    expect(h.calls[0].system).toBe(TEMPLATE_SYSTEM_PROMPT);
    expect(h.calls[0].prompt).toContain('## Highlights');
  });

  it('renders the --title heading for the notes path', async () => {
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo, title: 'v1.2.3' });
    expect(out.startsWith('# v1.2.3\n\n')).toBe(true);
  });
});
