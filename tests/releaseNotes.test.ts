import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A configurable fake provider, shared with the mocked module via vi.hoisted.
// `responder` decides each generation's output from the resolved provider name
// and per-call model (so fallback tests can vary behavior by `--fallback-*`); it
// may throw to simulate a provider error. Defaults to clean notes with a leading
// preamble, so we can also assert cleanModelOutput ran.
const h = vi.hoisted(() => {
  const DEFAULT_NOTES = 'Here are the notes:\n\n## Features\n- did a thing';
  type Ctx = { provider: unknown; model?: string; endpoint?: string; system: string; prompt: string };
  const calls: {
    system: string;
    prompt: string;
    provider: unknown;
    model?: string;
    endpoint?: string;
  }[] = [];
  let responder: (ctx: Ctx) => string = () => DEFAULT_NOTES;
  return {
    DEFAULT_NOTES,
    calls,
    setResponder(fn: (ctx: Ctx) => string): void {
      responder = fn;
    },
    reset(): void {
      calls.length = 0;
      responder = () => DEFAULT_NOTES;
    },
    resolveProvider: (provider: unknown, opts?: { endpoint?: string }) =>
      Promise.resolve({
        name: typeof provider === 'string' ? provider : 'auto',
        isAvailable: () => Promise.resolve(true),
        generate: (req: { system: string; prompt: string; model?: string }) => {
          const endpoint = opts?.endpoint;
          calls.push({ system: req.system, prompt: req.prompt, provider, model: req.model, endpoint });
          // Resolve via the responder; a throw becomes a rejected promise.
          return Promise.resolve().then(() => responder({ ...req, provider, endpoint }));
        },
      }),
  };
});

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveProvider: h.resolveProvider };
});

const { COMMIT_SYSTEM_PROMPT, NO_USER_FACING_CHANGES, SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT } =
  await import('../src/prompt.js');
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
    h.reset();
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

describe('generateReleaseNotes empty-notes sentinel + fallback (GG-39)', () => {
  let repo: string;
  const warnings: string[] = [];
  const warn = (m: string): void => void warnings.push(m);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgist-fb-'));
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
    h.reset();
    warnings.length = 0;
  });

  it('falls back to the deterministic changelog when the model returns the sentinel for a non-empty range', async () => {
    h.setResponder(() => NO_USER_FACING_CHANGES);
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo, warn });
    // Deterministic Conventional-Commit grouping replaces the suspect sentinel.
    expect(out).toContain('## Features');
    expect(out).toContain('thing one');
    expect(out).toContain('## Bug Fixes');
    expect(out).not.toContain(NO_USER_FACING_CHANGES);
    expect(warnings.some((w) => w.includes('no user-facing changes'))).toBe(true);
    // No fallback configured → exactly one provider attempt.
    expect(h.calls).toHaveLength(1);
  });

  it('retries with the configured fallback model and uses its valid notes', async () => {
    h.setResponder((ctx) =>
      ctx.model === 'rescue-model' ? '## Features\n- rescued note' : NO_USER_FACING_CHANGES,
    );
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      fallbackModel: 'rescue-model',
      warn,
    });
    expect(out).toBe('## Features\n- rescued note\n');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].model).toBe('rescue-model');
    expect(warnings.some((w) => w.includes('retrying with the fallback'))).toBe(true);
  });

  it('uses the deterministic changelog when both primary and fallback return the sentinel', async () => {
    h.setResponder(() => NO_USER_FACING_CHANGES);
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(out).toContain('## Features');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].provider).toBe('anthropic-api');
    // Both the retry notice and the deterministic-fallback notice fired.
    expect(warnings.some((w) => w.includes('retrying with the fallback'))).toBe(true);
    expect(warnings.some((w) => w.includes('deterministic changelog'))).toBe(true);
  });

  it('retries with the fallback provider when the primary errors', async () => {
    h.setResponder((ctx) => {
      if (ctx.provider !== 'anthropic-api') throw new Error('primary boom');
      return '## Features\n- recovered after error';
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'claude-cli',
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(out).toBe('## Features\n- recovered after error\n');
    expect(warnings.some((w) => w.includes('primary provider failed'))).toBe(true);
  });

  it('propagates the error when the primary fails and no fallback is configured', async () => {
    h.setResponder(() => {
      throw new Error('primary boom');
    });
    await expect(generateReleaseNotes({ range: 'HEAD', cwd: repo, warn })).rejects.toThrow(
      /primary boom/,
    );
  });

  it('keeps the primary result and warns when the fallback also errors', async () => {
    h.setResponder((ctx) => {
      if (ctx.provider === 'anthropic-api') throw new Error('fallback boom');
      return NO_USER_FACING_CHANGES;
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      fallbackProvider: 'anthropic-api',
      warn,
    });
    // Fallback failed → deterministic changelog still kicks in (suspect primary).
    expect(out).toContain('## Features');
    expect(warnings.some((w) => w.includes('fallback provider failed'))).toBe(true);
  });

  it('trusts the sentinel when there are no commits in range (working changes only)', async () => {
    writeFileSync(join(repo, 'staged.txt'), 'hello');
    git(repo, 'add', 'staged.txt');
    h.setResponder(() => NO_USER_FACING_CHANGES);
    const out = await generateReleaseNotes({ staged: true, cwd: repo, warn });
    // No commits → the sentinel is not suspect; it is returned as-is, no fallback.
    expect(out.trim()).toBe(NO_USER_FACING_CHANGES);
    expect(h.calls).toHaveLength(1);
    expect(warnings).toHaveLength(0);
    git(repo, 'reset', '-q');
    rmSync(join(repo, 'staged.txt'));
  });

  it('does NOT inherit the primary model/endpoint when the fallback is a different provider (GG-40)', async () => {
    h.setResponder((ctx) =>
      ctx.provider === 'anthropic-api' ? '## Features\n- ok' : NO_USER_FACING_CHANGES,
    );
    await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'local',
      model: 'llama3.2',
      endpoint: 'http://localhost:11434/v1',
      fallbackProvider: 'anthropic-api',
      warn,
    });
    const fb = h.calls[1];
    expect(fb.provider).toBe('anthropic-api');
    // The provider-specific primary model/endpoint are not carried across.
    expect(fb.model).toBeUndefined();
    expect(fb.endpoint).toBeUndefined();
  });

  it('inherits the primary model/endpoint when the fallback is the same provider (GG-40)', async () => {
    h.setResponder(() => NO_USER_FACING_CHANGES); // both attempts suspect → deterministic
    await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'local',
      model: 'llama3.2',
      endpoint: 'http://localhost:11434/v1',
      fallbackProvider: 'local',
      warn,
    });
    const fb = h.calls[1];
    expect(fb.provider).toBe('local');
    expect(fb.model).toBe('llama3.2');
    expect(fb.endpoint).toBe('http://localhost:11434/v1');
  });

  it('an explicit --fallback-model is used even across a different provider (GG-40)', async () => {
    h.setResponder((ctx) =>
      ctx.model === 'claude-haiku-4-5' ? '## Features\n- pinned' : NO_USER_FACING_CHANGES,
    );
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'local',
      model: 'llama3.2',
      fallbackProvider: 'anthropic-api',
      fallbackModel: 'claude-haiku-4-5',
      warn,
    });
    expect(out).toBe('## Features\n- pinned\n');
    expect(h.calls[1].model).toBe('claude-haiku-4-5');
  });

  it('on --format commit, retries on a primary error but never flags the sentinel', async () => {
    h.setResponder((ctx) => {
      if (ctx.provider !== 'anthropic-api') throw new Error('primary boom');
      return 'feat: recovered commit message';
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      format: 'commit',
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(out.trim()).toBe('feat: recovered commit message');
  });
});
