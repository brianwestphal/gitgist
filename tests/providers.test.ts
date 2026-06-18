import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anthropicApiProvider, PROVIDERS, resolveProvider } from '../src/providers/index.js';

describe('provider registry', () => {
  it('exposes the two concrete providers', () => {
    expect(PROVIDERS['anthropic-api'].name).toBe('anthropic-api');
    expect(PROVIDERS['claude-cli'].name).toBe('claude-cli');
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
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('returns the requested provider when available', async () => {
    const provider = await resolveProvider('anthropic-api');
    expect(provider.name).toBe('anthropic-api');
  });

  it('auto-selects the Anthropic API when a key is set', async () => {
    const provider = await resolveProvider('auto');
    expect(provider.name).toBe('anthropic-api');
  });

  it('throws when the requested provider is unavailable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(resolveProvider('anthropic-api')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
