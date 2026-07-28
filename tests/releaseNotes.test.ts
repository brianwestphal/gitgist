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
    cwd?: string;
    maxTokens?: number;
  }[] = [];
  let responder: (ctx: Ctx) => string = () => DEFAULT_NOTES;
  // Range-diff reads (GG-50): counted so a test can assert the diff was never
  // read, and optionally forced to fail so the degrade path (T-5) can be walked.
  const diffReads: unknown[][] = [];
  let rangeDiffError: Error | null = null;
  // Attribution-map reads (GG-58): counted, and optionally forced to fail so the
  // degrade path can be walked.
  const attributionReads: unknown[][] = [];
  let attributionError: Error | null = null;
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
    attributionReads,
    failAttribution(error: Error): void {
      attributionError = error;
    },
    takeAttributionError(): Error | null {
      return attributionError;
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
      attributionReads.length = 0;
      attributionError = null;
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
        generate: (req: {
          system: string;
          prompt: string;
          model?: string;
          cwd?: string;
          maxTokens?: number;
        }) => {
          const endpoint = opts?.endpoint;
          calls.push({
            system: req.system,
            prompt: req.prompt,
            provider,
            model: req.model,
            endpoint,
            cwd: req.cwd,
            maxTokens: req.maxTokens,
          });
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
    readCommitFiles: (...args: unknown[]): Promise<unknown> => {
      h.attributionReads.push(args);
      const error = h.takeAttributionError();
      return error !== null
        ? Promise.reject(error)
        : (actual.readCommitFiles as (...a: unknown[]) => Promise<unknown>)(...args);
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

  // @covers FR-35
  it('passes the resolved --cwd to the provider, not gitgist\'s process cwd (GG-67)', async () => {
    // The bug: `--cwd` redirected the git reads but never reached generate(), so
    // a CLI backend spawned in whatever directory gitgist happened to run from.
    await generateReleaseNotes({ range: 'HEAD', cwd: repo });
    expect(h.calls[0].cwd).toBe(repo);
    expect(h.calls[0].cwd).not.toBe(process.cwd());
  });

  // @covers FR-35
  it('defaults the provider cwd to process.cwd() when --cwd is omitted', async () => {
    await generateReleaseNotes({ range: 'HEAD' });
    expect(h.calls[0].cwd).toBe(process.cwd());
  });

  // @covers FR-35
  it('the fallback provider is given the same cwd as the primary (GG-67)', async () => {
    // A retry must not silently run in a different directory from the first try.
    h.setResponder(({ provider }) => {
      if (provider === 'claude-cli') throw new Error('primary down');
      return '## Features\n- from the fallback';
    });
    await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'claude-cli',
      fallbackProvider: 'anthropic-api',
    });
    expect(h.calls).toHaveLength(2);
    expect(h.calls.map((c) => c.cwd)).toEqual([repo, repo]);
  });

  // @covers FR-35
  it('every request field generateReleaseNotes owns actually reaches the provider', async () => {
    // A guard for the *class* of bug GG-67 was, not just the one field: an option
    // resolved in releaseNotes.ts that never gets threaded into generate(). If a
    // new GenerateRequest field is added and left unwired, extend this list — the
    // point is that the plumbing is asserted somewhere rather than assumed.
    await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      model: 'a-model',
      maxTokens: 4321,
    });
    const call = h.calls[0];
    expect({
      cwd: call.cwd,
      model: call.model,
      maxTokens: call.maxTokens,
    }).toEqual({ cwd: repo, model: 'a-model', maxTokens: 4321 });
    // system/prompt are non-empty for the same reason — they are plumbing too.
    expect(call.system.length).toBeGreaterThan(0);
    expect(call.prompt.length).toBeGreaterThan(0);
  });

  // @covers FR-37
  it('strips hashes the model volunteered without --link-commits (GG-63)', async () => {
    // What the apple backend actually did: cite a hash on every bullet even
    // though nothing asked. FR-30 promises they stay out, so enforce it.
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    h.setResponder(() => `## Features\n- Added a flag (${hash})`);
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo });
    expect(out).toBe('## Features\n- Added a flag\n');
  });

  // @covers FR-37
  it('KEEPS the hashes when --link-commits asked for them (GG-63)', async () => {
    // The guard must not fight the feature whose whole purpose is emitting
    // hashes — this is the interaction that would make FR-31 silently useless.
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    h.setResponder(() => `## Features\n- Added a flag (${hash})`);
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo, linkCommits: true });
    expect(out).toContain(hash);
  });

  // @covers FR-37
  it('leaves a non-hash parenthetical intact', async () => {
    h.setResponder(() => '## Performance\n- Cached regexes (3x faster cold start)');
    const out = await generateReleaseNotes({ range: 'HEAD', cwd: repo });
    expect(out).toContain('(3x faster cold start)');
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

  // @covers FR-30
  it('feeds per-commit file lists and short hashes to the model', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    const { prompt } = h.calls[0];
    expect(h.attributionReads).toHaveLength(1);
    expect(prompt).toContain('newest first');
    expect(prompt).toContain('files: retry.ts');
    // The short hash rides along so the model has something to attribute to.
    expect(prompt).toMatch(/- chore: tidy up \([0-9a-f]{7}\)/);
  });

  // @covers FR-30
  it('attribution: false skips the read entirely', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, attribution: false, warn });
    expect(h.attributionReads).toHaveLength(0);
    expect(h.calls[0].prompt).not.toContain('files: ');
    // Still diff-grounded — only the attribution map is gone.
    expect(h.calls[0].prompt).toContain('retryForever');
  });

  it('ai: false never reads the attribution map', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, ai: false, warn });
    expect(h.attributionReads).toHaveLength(0);
  });

  // @covers FR-30
  it('degrades without attribution when the map cannot be read, and still generates', async () => {
    // Same contract as the diff read (T-5): a missing map costs quality, never
    // the run.
    h.failAttribution(new Error('fatal: bad revision'));
    const out = await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    expect(out).toBe('## Features\n- did a thing\n');
    expect(warnings.join('\n')).toContain('could not read per-commit file lists');
    expect(warnings.join('\n')).toContain('continuing without commit attribution');
    expect(h.calls[0].prompt).not.toContain('files: ');
    // The diff still made it — only attribution was lost.
    expect(h.calls[0].prompt).toContain('retryForever');
  });

  // @covers FR-30
  it('drops the map when the provider budget cannot afford even one path each', async () => {
    h.setDiffBudget(10);
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    // Read happened, but the rendered material omits it rather than crowding
    // out the diff — and no warning, since nothing went wrong.
    expect(h.attributionReads).toHaveLength(1);
    expect(h.calls[0].prompt).not.toContain('files: ');
    expect(warnings).toEqual([]);
  });

  // @covers FR-31
  it('appends the commit-link rule to the system prompt when asked', async () => {
    await generateReleaseNotes({
      range: 'v1.0.0..HEAD',
      cwd: repo,
      linkCommits: true,
      commitUrl: 'https://example.test/c/{hash}',
      warn,
    });
    const { system } = h.calls[0];
    // The base prompt is intact; the link rule rides on top of it.
    expect(system.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain('End every bullet with the commit it came from');
    expect(system).toContain('https://example.test/c/a1b2c3d');
  });

  // @covers FR-31
  it('leaves the system prompt untouched by default', async () => {
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, warn });
    expect(h.calls[0].system).toBe(SYSTEM_PROMPT);
  });

  // @covers FR-31
  it('ignores commit links for --format commit, where a hash makes no sense', async () => {
    await generateReleaseNotes({
      range: 'v1.0.0..HEAD',
      cwd: repo,
      format: 'commit',
      linkCommits: true,
      warn,
    });
    // Silently ignored, matching how --title behaves for this format (FR-12).
    expect(h.calls[0].system).toBe(COMMIT_SYSTEM_PROMPT);
  });

  // @covers FR-31
  it('needs attribution — without the map there is no hash to cite', async () => {
    await generateReleaseNotes({
      range: 'v1.0.0..HEAD',
      cwd: repo,
      linkCommits: true,
      attribution: false,
      warn,
    });
    expect(h.calls[0].system).toBe(SYSTEM_PROMPT);
  });

  // @covers FR-31
  it('falls back to bare hashes when the URL cannot be derived', async () => {
    // The temp repo has no `origin`, so no template is detected — the rule is
    // still added, just without links.
    await generateReleaseNotes({ range: 'v1.0.0..HEAD', cwd: repo, linkCommits: true, warn });
    const { system } = h.calls[0];
    expect(system).toContain('(a1b2c3d)');
    expect(system).not.toContain('](http');
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

  // @covers FR-37
  it('strips volunteered hashes from the FALLBACK output too, not just the primary', async () => {
    // stripUnrequestedHashes runs inside runProvider, so both attempts pass
    // through it — but only the primary was ever asserted. This is the
    // second-call-in-a-sequence shape that hid the range+working-tree gap (GG-73).
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    h.setResponder((ctx) => {
      if (ctx.provider !== 'anthropic-api') throw new Error('primary boom');
      return `## Features\n- recovered, and volunteered a hash (${hash})`;
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'claude-cli',
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(out).toContain('volunteered a hash');
    expect(out).not.toContain(hash);
  });

  // @covers FR-31
  it('gives the fallback attempt the same --link-commits rules as the primary', async () => {
    // The link rules are built once and appended to the system prompt. A retry
    // must not silently lose provenance, so both attempts must carry them.
    h.setResponder((ctx) => {
      if (ctx.provider !== 'anthropic-api') throw new Error('primary boom');
      return '## Features\n- from the fallback';
    });
    await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'claude-cli',
      fallbackProvider: 'anthropic-api',
      linkCommits: true,
      commitUrl: 'https://example.com/commit/{hash}',
      warn,
    });
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.system).toContain('End every bullet with the commit it came from');
    }
  });

  // @covers T-2
  it('a provider that passes availability but fails at generation lands in the fallback', async () => {
    // This is the shape FR-34 made routine: openai-api's probe checks only that a
    // key is set, so an invalid key resolves fine and fails at generation. The
    // mocked provider reports available and then throws, which is exactly that
    // sequence at the pipeline level.
    let resolvedOk = false;
    h.setResponder((ctx) => {
      if (ctx.provider !== 'anthropic-api') {
        resolvedOk = true; // we only get here after isAvailable() said yes
        throw new Error('401 invalid key');
      }
      return '## Features\n- second provider carried it';
    });
    const out = await generateReleaseNotes({
      range: 'HEAD',
      cwd: repo,
      provider: 'openai-api',
      fallbackProvider: 'anthropic-api',
      warn,
    });
    expect(resolvedOk).toBe(true);
    expect(out).toBe('## Features\n- second provider carried it\n');
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
