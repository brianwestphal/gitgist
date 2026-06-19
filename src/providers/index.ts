import type { ProviderName } from '../types.js';
import { anthropicApiProvider } from './anthropicApi.js';
import { appleProvider, createAppleProvider } from './apple.js';
import { claudeCliProvider } from './claudeCli.js';
import { createLocalProvider, localProvider } from './local.js';
import type { AIProvider } from './types.js';

export { anthropicApiProvider } from './anthropicApi.js';
export {
  appleProvider,
  type AppleProviderConfig,
  AUTO_LANGUAGE,
  createAppleProvider,
  detectSystemLanguage,
} from './apple.js';
export { claudeCliProvider } from './claudeCli.js';
export { type CliProviderSpec, createCliProvider } from './cli.js';
export {
  createLocalProvider,
  DEFAULT_LOCAL_ENDPOINT,
  extractChatContent,
  localProvider,
  type LocalProviderConfig,
  parseModelList,
} from './local.js';
export type { AIProvider, GenerateRequest } from './types.js';

/** Registry of concrete providers, keyed by name. */
export const PROVIDERS: Record<Exclude<ProviderName, 'auto'>, AIProvider> = {
  'anthropic-api': anthropicApiProvider,
  'claude-cli': claudeCliProvider,
  local: localProvider,
  apple: appleProvider,
};

/**
 * Auto-resolution order. Zero-config CLI backends (no API key) come first —
 * matching how the sibling tools default to `claude -p` — then API-key
 * backends, then on-device Apple Foundation Models as a free fallback (only
 * reached when nothing earlier is available, and a no-op when its helper isn't
 * built). The `local` provider is intentionally absent: it is opt-in only
 * (`--provider local`) so a normal run never probes localhost.
 */
export const AUTO_ORDER: AIProvider[] = [claudeCliProvider, anthropicApiProvider, appleProvider];

/** Options for {@link resolveProvider}. */
export interface ResolveProviderOptions {
  /** Resolution order for `auto` (default: {@link AUTO_ORDER}; injectable for tests). */
  order?: AIProvider[];
  /** Base URL for the `local` provider. */
  endpoint?: string;
  /** Model name for the `local` provider. */
  model?: string;
  /** Language hint for the `apple` provider (see {@link createAppleProvider}). */
  language?: string;
}

function unavailableMessage(name: string, endpoint?: string): string {
  if (name === 'anthropic-api') {
    return 'The anthropic-api provider is unavailable: set ANTHROPIC_API_KEY.';
  }
  if (name === 'local') {
    const where = endpoint !== undefined && endpoint !== '' ? ` at ${endpoint}` : '';
    return `The local provider is unavailable: no OpenAI-compatible server reachable${where} (start Ollama / LM Studio, or pass --endpoint).`;
  }
  return 'The claude-cli provider is unavailable: install the `claude` CLI and sign in.';
}

/**
 * Resolve which AI provider to use.
 *
 * @param requested - A specific provider, or `auto` to pick the first available.
 * @param opts - Resolution order (for `auto`) and `local` endpoint/model config.
 * @returns The selected, available provider.
 * @throws If the requested provider (or, for `auto`, every provider) is unavailable.
 */
export async function resolveProvider(
  requested: ProviderName = 'auto',
  opts: ResolveProviderOptions = {},
): Promise<AIProvider> {
  const { language } = opts;
  // The default `appleProvider` already applies the system-language hint; only
  // rebuild it when the caller overrides the language (an explicit value or
  // `auto`), so `--language` works in both the explicit and `auto` paths.
  const baseOrder = opts.order ?? AUTO_ORDER;
  const order =
    language === undefined
      ? baseOrder
      : baseOrder.map((p) => (p.name === 'apple' ? createAppleProvider({ language }) : p));

  if (requested !== 'auto') {
    const provider =
      requested === 'local'
        ? createLocalProvider({ endpoint: opts.endpoint, model: opts.model })
        : requested === 'apple'
          ? createAppleProvider({ language })
          : PROVIDERS[requested];
    if (!(await provider.isAvailable())) {
      throw new Error(unavailableMessage(provider.name, opts.endpoint));
    }
    return provider;
  }

  for (const provider of order) {
    if (await provider.isAvailable()) return provider;
  }

  throw new Error(
    'No AI provider available. Install and sign in to a supported CLI (e.g. `claude`), ' +
      'set ANTHROPIC_API_KEY to use the Anthropic API, run a local server and pass ' +
      '--provider local, or pass --no-ai for deterministic Conventional Commits grouping.',
  );
}
