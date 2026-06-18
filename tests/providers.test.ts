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
