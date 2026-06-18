import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Default model — the most capable Opus-tier model. */
const DEFAULT_MODEL = 'claude-opus-4-8';

/** Default output cap; generous enough for notes plus adaptive thinking. */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * Anthropic Messages API provider, using the official SDK. Reads the API key
 * from `ANTHROPIC_API_KEY` (the SDK's default credential resolution). Uses
 * adaptive thinking and streaming, per Anthropic's guidance for this model.
 */
export const anthropicApiProvider: AIProvider = {
  name: 'anthropic-api',

  isAvailable(): Promise<boolean> {
    const key = process.env.ANTHROPIC_API_KEY;
    return Promise.resolve(key !== undefined && key !== '');
  },

  async generate(request: GenerateRequest): Promise<string> {
    // Imported lazily so `--no-ai` and the CLI provider don't pay the load cost.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const stream = client.messages.stream({
      model: request.model ?? DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });

    const message = await stream.finalMessage();

    let text = '';
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
    }
    return stripCodeFences(text);
  },
};
