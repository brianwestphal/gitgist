import { afterEach, describe, expect, it } from 'vitest';

import { createCliProvider } from '../src/providers/cli.js';
import { anthropicApiProvider, PROVIDERS, resolveProvider } from '../src/providers/index.js';
import type { AIProvider } from '../src/providers/types.js';

/** A deterministic stand-in provider whose availability we control. */
function fakeProvider(name: string, available: boolean): AIProvider {
  return {
    name,
    isAvailable: () => Promise.resolve(available),
    generate: () => Promise.resolve(`output from ${name}`),
  };
}

describe('provider registry', () => {
  it('exposes the two concrete providers', () => {
    expect(PROVIDERS['anthropic-api'].name).toBe('anthropic-api');
    expect(PROVIDERS['claude-cli'].name).toBe('claude-cli');
  });
});

describe('createCliProvider', () => {
  it('reports unavailable when the command is missing', async () => {
    const provider = createCliProvider({
      name: 'nope-cli',
      command: 'definitely-not-a-real-binary-xyz',
      runArgs: ['-p'],
    });
    expect(provider.name).toBe('nope-cli');
    expect(await provider.isAvailable()).toBe(false);
  });

  it('generate() pipes the prompt and returns the CLI output', async () => {
    // A node stub that echoes whatever it reads on stdin.
    const provider = createCliProvider({
      name: 'echo-cli',
      command: process.execPath,
      runArgs: ['-e', 'process.stdin.on("data", (d) => process.stdout.write(d))'],
    });
    const out = await provider.generate({ system: 'SYS', prompt: 'PROMPT' });
    expect(out).toContain('SYS');
    expect(out).toContain('PROMPT');
  });

  it('generate() surfaces stderr on a non-zero exit', async () => {
    const provider = createCliProvider({
      name: 'fail-cli',
      command: process.execPath,
      runArgs: ['-e', 'process.stderr.write("auth failed: bad token"); process.exit(1)'],
      input: 'arg',
    });
    await expect(provider.generate({ system: '', prompt: '' })).rejects.toThrow(
      /exited with code 1: auth failed: bad token/,
    );
  });

  it('generate() rejects after the timeout', async () => {
    const provider = createCliProvider({
      name: 'hang-cli',
      command: process.execPath,
      runArgs: ['-e', 'setInterval(() => undefined, 1000)'],
      input: 'arg',
    });
    await expect(
      provider.generate({ system: '', prompt: '', timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 200ms/);
  });
});

describe('anthropicApiProvider.isAvailable', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('is available when the key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(await anthropicApiProvider.isAvailable()).toBe(true);
  });

  it('is unavailable when the key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await anthropicApiProvider.isAvailable()).toBe(false);
  });

  it('is unavailable for an empty key', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect(await anthropicApiProvider.isAvailable()).toBe(false);
  });
});

describe('resolveProvider', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('returns a requested provider when available', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const provider = await resolveProvider('anthropic-api');
    expect(provider.name).toBe('anthropic-api');
  });

  it('throws when the requested provider is unavailable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(resolveProvider('anthropic-api')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('auto-selects the first available provider in order', async () => {
    const order = [fakeProvider('cli', false), fakeProvider('api', true)];
    const provider = await resolveProvider('auto', order);
    expect(provider.name).toBe('api');
  });

  it('auto prefers an earlier available provider (CLI before API)', async () => {
    const order = [fakeProvider('cli', true), fakeProvider('api', true)];
    const provider = await resolveProvider('auto', order);
    expect(provider.name).toBe('cli');
  });

  it('throws when no provider in the order is available', async () => {
    const order = [fakeProvider('cli', false), fakeProvider('api', false)];
    await expect(resolveProvider('auto', order)).rejects.toThrow(/No AI provider available/);
  });
});
