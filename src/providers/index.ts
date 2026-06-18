import type { ProviderName } from '../types.js';
import { anthropicApiProvider } from './anthropicApi.js';
import { claudeCliProvider } from './claudeCli.js';
import type { AIProvider } from './types.js';

export { anthropicApiProvider } from './anthropicApi.js';
export { claudeCliProvider } from './claudeCli.js';
export type { AIProvider, GenerateRequest } from './types.js';

/** Registry of concrete providers, keyed by name. */
export const PROVIDERS: Record<Exclude<ProviderName, 'auto'>, AIProvider> = {
  'anthropic-api': anthropicApiProvider,
  'claude-cli': claudeCliProvider,
};

/** Auto-resolution order: prefer the explicit API key, then the CLI. */
const AUTO_ORDER: AIProvider[] = [anthropicApiProvider, claudeCliProvider];

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
 * @returns The selected, available provider.
 * @throws If the requested provider (or, for `auto`, every provider) is unavailable.
 */
export async function resolveProvider(requested: ProviderName = 'auto'): Promise<AIProvider> {
  if (requested !== 'auto') {
    const provider = PROVIDERS[requested];
    if (!(await provider.isAvailable())) {
      throw new Error(unavailableMessage(provider.name));
    }
    return provider;
  }

  for (const provider of AUTO_ORDER) {
    if (await provider.isAvailable()) return provider;
  }

  throw new Error(
    'No AI provider available. Set ANTHROPIC_API_KEY to use the Anthropic API, ' +
      'install and sign in to the `claude` CLI, or pass --no-ai for deterministic ' +
      'Conventional Commits grouping.',
  );
}
