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
  // Range-diff reads (GG-50): counted so a test can assert the diff was never
  // read, and optionally forced to fail so the degrade path (T-5) can be walked.
  const diffReads: unknown[][] = [];
  let rangeDiffError: Error | null = null;
  // Provider resolution (GG-52): budget advertised by the resolved provider, a
  // count of how many times resolution ran, and an optional forced failure.
  let diffBudgetChars: number | undefined;
  let resolveError: unknown;
  const resolves: unknown[] = [];
  return {
    DEFAULT_NOTES,
    calls,
    diffReads,
    setResponder(fn: (ctx: Ctx) => string): void {
      responder = fn;
    },
    failRangeDiff(error: Error): void {
      rangeDiffError = error;
    },
    resolves,
    setDiffBudget(chars: number | undefined): void {
      diffBudgetChars = chars;
    },
    failResolve(error: unknown): void {
      resolveError = error;
    },
    takeRangeDiffError(): Error | null {
      return rangeDiffError;
    },
    reset(): void {
      calls.length = 0;
      diffReads.length = 0;
      rangeDiffError = null;
      resolves.length = 0;
      diffBudgetChars = undefined;
      resolveError = undefined;
      responder = () => DEFAULT_NOTES;
    },
    resolveProvider: (provider: unknown, opts?: { endpoint?: string }) => {
      resolves.push(provider);
      // Deliberately unrestricted: one test rejects with a non-Error to walk
      // the normalization branch in `generateReleaseNotes`.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      if (resolveError !== undefined) return Promise.reject(resolveError);
      return Promise.resolve({
        name: typeof provider === 'string' ? provider : 'auto',
        diffBudgetChars,
        isAvailable: () => Promise.resolve(true),
        generate: (req: { system: string; prompt: string; model?: string }) => {
          const endpoint = opts?.endpoint;
          calls.push({ system: req.system, prompt: req.prompt, provider, model: req.model, endpoint });
          // Resolve via the responder; a throw becomes a rejected promise.
          return Promise.resolve().then(() => responder({ ...req, provider, endpoint }));
        },
      });
    },
  };
});

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveProvider: h.resolveProvider };
});

// The real `readRangeDiff` runs (so the prompt carries genuine patch text); the
// wrapper only records that it was called and lets a test force it to fail.
vi.mock('../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual.readRangeDiff as (...args: unknown[]) => Promise<unknown>;
  return {
    ...actual,
    readRangeDiff: (...args: unknown[]): Promise<unknown> => {
      h.diffReads.push(args);
      const error = h.takeRangeDiffError();
      return error !== null ? Promise.reject(error) : real(...args);
    },
  };
});

const { COMMIT_SYSTEM_PROMPT, NO_USER_FACING_CHANGES, SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT } =
  await import('../src/prompt.js');
const { generateReleaseNotes } = await import('../src/releaseNotes.js');

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

// @covers FR-4, FR-12, FR-13
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

  it('warns via the default stderr sink when notes are suspect and no warn is injected', async () => {
    // No `warn` option → the default `process.stderr` sink fires, and the
    // suspect sentinel falls back to the deterministic changelog.
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      h.setResponder(() => NO_USER_FACING_CHANGES);
      const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo });
      expect(spy).toHaveBeenCalled();
      expect(out).toContain('## Features');
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults cwd to process.cwd() when none is given', async () => {
    // Omitting cwd exercises the `?? process.cwd()` default against this repo;
    // an empty range keeps it fast and deterministic.
    const out = await generateReleaseNotes({ range: 'HEAD..HEAD' });
    expect(out.trim()).toBe('_No changes in `HEAD..HEAD`._');
  });
});

// @covers FR-25, FR-26, T-5
describe('diff-grounded generation (GG-50)', () => {
  let repo: string;
  const warnings: string[] = [];
  const warn = (m: string): void => void warnings.push(m);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitgist-diff-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'a@b.c');
    git(repo, 'config', 'user.name', 'T');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'base.ts'), 'export const base = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'feat: base');
    git(repo, 'tag', 'v1.0.0');
    // The commit subject deliberately understates the change: only the diff
    // reveals `retryForever`. That gap is exactly what GG-50 closes.
    writeFileSync(join(repo, 'retry.ts'), 'export function retryForever(): void {}\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'chore: tidy up');
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  beforeEach(() => {
    h.reset();
    warnings.length = 0;
  });

  it('sends the real patch to the model alongside the commit messages', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    const { prompt } = h.calls[0];
    // Commit prose is still there…
    expect(prompt).toContain('chore: tidy up');
    // …but so is the code the prose never mentions.
    expect(prompt).toContain('Code diff for `v1.0.0..HEAD`');
    expect(prompt).toContain('export function retryForever(): void {}');
    expect(prompt).toContain('authoritative record');
  });

  it('grounds the commit and template formats in the diff too', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, format: 'commit', warn });
    expect(h.calls[0].prompt).toContain('retryForever');

    const tpl = join(repo, 'tpl.md');
    writeFileSync(tpl, '## Highlights\n');
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, template: tpl, warn });
    expect(h.calls[1].prompt).toContain('retryForever');
  });

  it('diff: false sends commit messages only, and never reads the diff', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, diff: false, warn });
    expect(h.diffReads).toHaveLength(0);
    expect(h.calls[0].prompt).toContain('chore: tidy up');
    expect(h.calls[0].prompt).not.toContain('retryForever');
  });

  it('ai: false never reads the diff (the deterministic path groups subjects)', async () => {
    const out = await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, ai: false, warn });
    expect(h.diffReads).toHaveLength(0);
    expect(out).toContain('tidy up');
  });

  it('threads maxDiffChars through and tells the model the patch was cut', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, maxDiffChars: 30, warn });
    expect(h.diffReads[0][1]).toMatchObject({ maxChars: 30 });
    expect(h.calls[0].prompt).toContain('had their diff shortened to fit');
    expect(h.calls[0].prompt).toContain('do not speculate about the omitted portion');
  });

  // T-5: read commits → diff read fails → warn → generate anyway from prose.
  it('degrades to commit messages when the diff cannot be read, and still generates', async () => {
    h.failRangeDiff(new Error('fatal: bad revision'));
    const out = await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    // Non-fatal: the run completes with notes rather than throwing.
    expect(out).toBe('## Features\n- did a thing\n');
    expect(warnings.join('\n')).toContain('could not read the code diff');
    expect(warnings.join('\n')).toContain('summarizing from commit messages only');
    // The prompt fell back to prose alone — no diff section.
    expect(h.calls[0].prompt).toContain('chore: tidy up');
    expect(h.calls[0].prompt).not.toContain('Code diff for');
  });

  // @covers FR-28
  it('sizes the diff from the provider budget, and lets --max-diff-chars override it', async () => {
    // A small-context backend (e.g. apple) advertises a tight budget…
    h.setDiffBudget(30);
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    expect(h.diffReads[0][1]).toMatchObject({ maxChars: 30 });
    expect(h.calls[0].prompt).toContain('had their diff shortened to fit');

    // …and an explicit flag still wins over it.
    h.reset();
    h.setDiffBudget(30);
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, maxDiffChars: 90_000, warn });
    expect(h.diffReads[0][1]).toMatchObject({ maxChars: 90_000 });
    expect(h.calls[0].prompt).not.toContain('truncated');
  });

  // @covers FR-28
  it('falls back to the shared default when the provider advertises no budget', async () => {
    h.setDiffBudget(undefined);
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    // `undefined` reaches readRangeDiff, which applies DEFAULT_MAX_DIFF_CHARS.
    expect(h.diffReads[0][1]).toMatchObject({ maxChars: undefined });
    expect(h.calls[0].prompt).toContain('retryForever');
  });

  // @covers FR-28
  it('resolves the primary provider once, not once per read', async () => {
    // The budget is needed before the diff is read, so resolution moved up
    // front — the same instance must then be reused for generation rather than
    // probing availability a second time.
    h.setDiffBudget(50_000);
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    expect(h.resolves).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it('never resolves a provider on the deterministic path', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, ai: false, warn });
    expect(h.resolves).toHaveLength(0);
  });

  // @covers FR-28, T-2
  it('defers an up-front resolution failure so the fallback still rescues it', async () => {
    // Resolution now happens before generation; its error must still surface at
    // generation time, where T-2's fallback retry can recover — not earlier.
    h.failResolve(new Error('no provider available'));
    await expect(
      generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn }),
    ).rejects.toThrow(/no provider available/);
    expect(warnings).toEqual([]);
  });

  // @covers FR-28
  it('normalizes a non-Error resolution failure before rethrowing it', async () => {
    h.failResolve('provider blew up');
    await expect(
      generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn }),
    ).rejects.toThrow(/provider blew up/);
  });

  it('warns about an unreadable diff via the default stderr sink', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      h.failRangeDiff(new Error('fatal: bad revision'));
      await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// @covers FR-22, FR-23, T-2, T-3, T-4
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

  it('uses the singular "commit" noun when a single-commit range is suspect', async () => {
    h.setResponder(() => NO_USER_FACING_CHANGES);
    // HEAD~1..HEAD spans exactly one commit (`fix: thing two`) → singular
    // warning, no fallback, deterministic changelog.
    const out = await generateReleaseNotes({ range: 'HEAD~1..HEAD', cwd: repo, warn });
    expect(out).toContain('## Bug Fixes');
    expect(warnings.some((w) => /\b1 commit\b/.test(w))).toBe(true);
  });

  it('formats a non-Error thrown value in the retry warning', async () => {
    // The primary rejects with a bare string (not an Error), exercising the
    // `String(error)` branch of the warning formatter.
    h.setResponder((ctx) => {
      // Intentionally a non-Error to exercise the String(error) fallback.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (ctx.provider !== 'anthropic-api') throw 'plain string failure';
      return '## Features\n- recovered';
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(out).toBe('## Features\n- recovered\n');
    expect(warnings.some((w) => w.includes('plain string failure'))).toBe(true);
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
