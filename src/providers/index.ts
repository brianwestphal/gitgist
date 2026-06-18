import type { ProviderName } from '../types.js';
import { anthropicApiProvider } from './anthropicApi.js';
import { claudeCliProvider } from './claudeCli.js';
import type { AIProvider } from './types.js';

export { anthropicApiProvider } from './anthropicApi.js';
export { claudeCliProvider } from './claudeCli.js';
export { type CliProviderSpec, createCliProvider } from './cli.js';
export type { AIProvider, GenerateRequest } from './types.js';

/** Registry of concrete providers, keyed by name. */
export const PROVIDERS: Record<Exclude<ProviderName, 'auto'>, AIProvider> = {
  'anthropic-api': anthropicApiProvider,
  'claude-cli': claudeCliProvider,
};

/**
 * Auto-resolution order. Zero-config CLI backends (no API key) come first —
 * matching how the sibling tools default to `claude -p` — with API-key
 * backends as the fallback.
 */
export const AUTO_ORDER: AIProvider[] = [claudeCliProvider, anthropicApiProvider];

function unavailableMessage(name: string): string {
  if (name === 'anthropic-api') {
    return 'The anthropic-api provider is unavailable: set ANTHROPIC_API_KEY.';
  }
  return 'The claude-cli provider is unavailable: install the `claude` CLI and sign in.';
}

/**
 * Resolve which AI provider to use.
 *
 * @param requested - A specific provider, or `auto` to pick the first available.
 * @param order - Resolution order for `auto` (default: {@link AUTO_ORDER}; injectable for tests).
 * @returns The selected, available provider.
 * @throws If the requested provider (or, for `auto`, every provider) is unavailable.
 */
export async function resolveProvider(
  requested: ProviderName = 'auto',
  order: AIProvider[] = AUTO_ORDER,
): Promise<AIProvider> {
  if (requested !== 'auto') {
    const provider = PROVIDERS[requested];
    if (!(await provider.isAvailable())) {
      throw new Error(unavailableMessage(provider.name));
    }
    return provider;
  }

  for (const provider of order) {
    if (await provider.isAvailable()) return provider;
  }

  throw new Error(
    'No AI provider available. Install and sign in to a supported CLI (e.g. `claude`), ' +
      'set ANTHROPIC_API_KEY to use the Anthropic API, or pass --no-ai for deterministic ' +
      'Conventional Commits grouping.',
  );
}
