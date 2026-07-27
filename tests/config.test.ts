import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cliArgs.js';
import { applyConfig, CONFIG_FILENAME, loadConfig, parseConfig } from '../src/config.js';

const created: string[] = [];

/** A temp git repo, so `loadConfig`'s walk has a root to stop at. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitgist-cfg-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(dir: string, name: string, body: unknown): void {
  writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// @covers FR-32
describe('parseConfig validation', () => {
  it('accepts a full, valid config', () => {
    const config = parseConfig(
      {
        exclude: ['generated/*'],
        defaultExcludes: false,
        diff: true,
        maxDiffChars: 90_000,
        attribution: true,
        linkCommits: true,
        commitUrl: 'https://x/c/{hash}',
        provider: 'claude-cli',
        model: 'claude-opus-4-8',
        endpoint: 'http://localhost:11434/v1',
        fallbackProvider: 'anthropic-api',
        fallbackEndpoint: 'http://localhost:1234/v1',
        fallbackModel: 'claude-haiku-4-5',
        language: 'French',
        maxTokens: 8000,
        format: 'notes',
        template: 'notes.md',
      },
      'test',
    );
    expect(config.provider).toBe('claude-cli');
    expect(config.exclude).toEqual(['generated/*']);
    expect(config.maxDiffChars).toBe(90_000);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    // A dropped typo looks exactly like the setting not working.
    expect(() => parseConfig({ excludes: ['x'] }, 'f.json')).toThrow(/unknown option excludes/);
    expect(() => parseConfig({ excludes: [], nope: 1 }, 'f.json')).toThrow(/unknown options/);
    // The message lists what IS valid, so the fix is obvious.
    expect(() => parseConfig({ excludes: ['x'] }, 'f.json')).toThrow(/known: attribution, commitUrl/);
  });

  it('rejects a non-object top level', () => {
    for (const bad of [[], 'x', 3, null]) {
      expect(() => parseConfig(bad, 'f.json')).toThrow(/expected a JSON object/);
    }
  });

  it('type-checks each option and names the offender', () => {
    expect(() => parseConfig({ model: 3 }, 'f')).toThrow(/model must be a non-empty string/);
    expect(() => parseConfig({ model: '  ' }, 'f')).toThrow(/model must be a non-empty string/);
    expect(() => parseConfig({ diff: 'yes' }, 'f')).toThrow(/diff must be true or false/);
    expect(() => parseConfig({ maxTokens: 0 }, 'f')).toThrow(/maxTokens must be a positive integer/);
    expect(() => parseConfig({ maxDiffChars: 1.5 }, 'f')).toThrow(/positive integer/);
    expect(() => parseConfig({ provider: 'bogus' }, 'f')).toThrow(/provider must be one of/);
    expect(() => parseConfig({ format: 'changelog' }, 'f')).toThrow(/format must be/);
    expect(() => parseConfig({ exclude: 'x' }, 'f')).toThrow(/array of non-empty strings/);
    expect(() => parseConfig({ exclude: ['ok', 3] }, 'f')).toThrow(/array of non-empty strings/);
  });

  it('requires {hash} in commitUrl, matching the CLI flag', () => {
    expect(() => parseConfig({ commitUrl: 'https://x/c/' }, 'f')).toThrow(/\{hash\} placeholder/);
  });

  it('names the source file in every error', () => {
    expect(() => parseConfig({ diff: 1 }, '/p/gitgist.config.json')).toThrow(
      /\(\/p\/gitgist\.config\.json\)/,
    );
  });
});

// @covers FR-32
describe('loadConfig discovery', () => {
  it('finds gitgist.config.json at the repo root', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, { provider: 'codex' });
    const loaded = await loadConfig(dir);
    expect(loaded?.config.provider).toBe('codex');
    expect(loaded?.path).toBe(join(dir, CONFIG_FILENAME));
  });

  it('walks up from a nested subdirectory', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, { linkCommits: true });
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect((await loadConfig(nested))?.config.linkCommits).toBe(true);
  });

  it('falls back to package.json#gitgist', async () => {
    const dir = repo();
    write(dir, 'package.json', { name: 'x', gitgist: { exclude: ['gen/*'] } });
    const loaded = await loadConfig(dir);
    expect(loaded?.config.exclude).toEqual(['gen/*']);
    expect(loaded?.path).toBe(join(dir, 'package.json'));
  });

  it('prefers the dedicated file over package.json', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, { provider: 'codex' });
    write(dir, 'package.json', { gitgist: { provider: 'gemini' } });
    expect((await loadConfig(dir))?.config.provider).toBe('codex');
  });

  it('ignores a package.json with no gitgist key', async () => {
    const dir = repo();
    write(dir, 'package.json', { name: 'x' });
    expect(await loadConfig(dir)).toBeNull();
  });

  it('stops at the repository root, never escaping into a parent project', async () => {
    // A config above the repo belongs to something else — picking it up would
    // silently apply an unrelated project's settings.
    const outer = mkdtempSync(join(tmpdir(), 'gitgist-outer-'));
    created.push(outer);
    write(outer, CONFIG_FILENAME, { provider: 'gemini' });
    const inner = join(outer, 'inner');
    mkdirSync(inner);
    execFileSync('git', ['init', '-q'], { cwd: inner });
    expect(await loadConfig(inner)).toBeNull();
  });

  it('returns null when there is no config anywhere', async () => {
    expect(await loadConfig(repo())).toBeNull();
  });

  it('resolves a relative template against the config file, not the cwd', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, { template: 'notes.md' });
    const nested = join(dir, 'deep');
    mkdirSync(nested);
    // Loaded from a subdirectory, the template still points at the repo root's.
    expect((await loadConfig(nested))?.config.template).toBe(join(dir, 'notes.md'));
  });

  it('reports malformed JSON with the file path', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, '{ not json');
    await expect(loadConfig(dir)).rejects.toThrow(/not valid JSON/);
  });

  it('surfaces a validation error from a discovered file', async () => {
    const dir = repo();
    write(dir, CONFIG_FILENAME, { provider: 'nope' });
    await expect(loadConfig(dir)).rejects.toThrow(/provider must be one of/);
  });
});

// @covers FR-32
describe('applyConfig precedence', () => {
  it('fills in options the CLI did not specify', () => {
    const merged = applyConfig(parseArgs([]), { provider: 'codex', maxDiffChars: 5000 });
    expect(merged.provider).toBe('codex');
    expect(merged.maxDiffChars).toBe(5000);
  });

  it('lets an explicit flag beat the config', () => {
    const merged = applyConfig(parseArgs(['--provider', 'gemini']), { provider: 'codex' });
    expect(merged.provider).toBe('gemini');
  });

  it('lets an explicit boolean flag beat the config, despite its concrete default', () => {
    // `diff` defaults to true, so its value alone can't say whether --no-diff was
    // passed — this is what `explicit` exists for.
    expect(applyConfig(parseArgs(['--no-diff']), { diff: true }).diff).toBe(false);
    // …and with no flag, the config's `false` is applied over the default `true`.
    expect(applyConfig(parseArgs([]), { diff: false }).diff).toBe(false);
  });

  it('appends CLI exclude patterns to the config list rather than replacing them', () => {
    // The config holds the project baseline; --exclude is this run's addition.
    const merged = applyConfig(parseArgs(['--exclude', 'one-off/*']), {
      exclude: ['generated/*', 'vendored/*'],
    });
    expect(merged.exclude).toEqual(['generated/*', 'vendored/*', 'one-off/*']);
  });

  it('uses the config list alone when no --exclude is given', () => {
    expect(applyConfig(parseArgs([]), { exclude: ['generated/*'] }).exclude).toEqual([
      'generated/*',
    ]);
  });

  it('is a no-op for a null config', () => {
    const args = parseArgs(['--provider', 'codex']);
    expect(applyConfig(args, null)).toBe(args);
  });

  it('never lets the config set a per-invocation option', () => {
    // range/from/to/cwd/title/staged/ai are CLI-only by design; even if one
    // slipped into a config object it must not reach the merged args.
    const merged = applyConfig(parseArgs([]), { provider: 'codex' } as never);
    expect(merged.range).toBeUndefined();
    expect(merged.title).toBeUndefined();
    expect(merged.ai).toBe(true);
    expect(merged.staged).toBe(false);
  });
});
