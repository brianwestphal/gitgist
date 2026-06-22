import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Default model — the most capable Opus-tier model. */
const DEFAULT_MODEL = 'claude-opus-4-8';

/** Default output cap; generous enough for notes plus adaptive thinking. */
const DEFAULT_MAX_TOKENS = 16000;

/** The truncation warning emitted when the model hits its output cap (NFR-6). */
const TRUNCATION_WARNING =
  'gitgist: warning: release notes may be truncated (hit max_tokens). ' +
  'Raise --max-tokens or narrow the commit range.\n';

/** Resolved parameters for a single Anthropic generation. */
export interface AnthropicRunParams {
  model: string;
  maxTokens: number;
  system: string;
  prompt: string;
}

/** The slice of an Anthropic message this provider consumes. */
export interface AnthropicMessage {
  /** Why generation stopped; `'max_tokens'` means the output was truncated. */
  stopReason: string | null;
  /** Output content blocks; only `text` blocks contribute to the result. */
  content: { type: string; text?: string }[];
}

/** Runs one generation and returns the final message (injectable for tests). */
export type AnthropicRunFn = (params: AnthropicRunParams) => Promise<AnthropicMessage>;

/** Config captured by {@link createAnthropicApiProvider} (injectable for tests). */
export interface AnthropicApiProviderConfig {
  /**
   * Override the SDK round-trip (default: the real, lazily-imported
   * `@anthropic-ai/sdk` streaming call). Tests inject a fake to exercise the
   * truncation-warning and text-extraction logic without a network call.
   */
  run?: AnthropicRunFn;
  /** Override the warning sink (default: `process.stderr`). */
  warn?: (message: string) => void;
  /** Pretend an API key is present (injectable for tests; default: reads env). */
  hasApiKey?: () => boolean;
}

/**
 * Default {@link AnthropicRunFn}: the real Anthropic Messages API call via the
 * official SDK, using adaptive thinking and streaming per Anthropic's guidance
 * for this model. The SDK is imported **lazily** so `--no-ai` and the CLI
 * provider don't pay the load cost.
 */
const defaultRun: AnthropicRunFn = async ({ model, maxTokens, system, prompt }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const message = await stream.finalMessage();
  return {
    stopReason: message.stop_reason,
    content: message.content.map((block) =>
      block.type === 'text' ? { type: block.type, text: block.text } : { type: block.type },
    ),
  };
};

/**
 * Build an {@link AIProvider} backed by the **Anthropic Messages API** (official
 * SDK). Reads the API key from `ANTHROPIC_API_KEY` (the SDK's default credential
 * resolution). Warns on stderr when generation hits `max_tokens` so truncated
 * notes are surfaced rather than silently returned (NFR-6).
 *
 * @param config - Injectable SDK call / warning sink / key check for tests.
 * @returns A provider backed by the Anthropic API.
 */
export function createAnthropicApiProvider(config: AnthropicApiProviderConfig = {}): AIProvider {
  const run = config.run ?? defaultRun;
  const warn = config.warn ?? ((message: string) => void process.stderr.write(message));
  const hasApiKey =
    config.hasApiKey ??
    (() => {
      const key = process.env.ANTHROPIC_API_KEY;
      return key !== undefined && key !== '';
    });

  return {
    name: 'anthropic-api',

    isAvailable(): Promise<boolean> {
      return Promise.resolve(hasApiKey());
    },

    async generate(request: GenerateRequest): Promise<string> {
      const message = await run({
        model: request.model ?? DEFAULT_MODEL,
        maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        prompt: request.prompt,
      });

      if (message.stopReason === 'max_tokens') warn(TRUNCATION_WARNING);

      let text = '';
      for (const block of message.content) {
        if (block.type === 'text' && block.text !== undefined) text += block.text;
      }
      return stripCodeFences(text);
    },
  };
}

/** Default Anthropic API provider (reads `ANTHROPIC_API_KEY`, real SDK call). */
export const anthropicApiProvider = createAnthropicApiProvider();
