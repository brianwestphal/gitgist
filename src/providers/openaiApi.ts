import {
  chatCompletion,
  type FetchLike,
  type OpenAiCompatibleTarget,
} from './openaiCompatible.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Default OpenAI base URL (the `/v1` prefix is part of the endpoint). */
export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1';

/**
 * Default model when `--model` is not given.
 *
 * **Not verified against a live account** — gitgist has no OpenAI key on the
 * maintainer's machine, and OpenAI's served ids change over time and by account.
 * Treat this as a starting point, not a guarantee: pass `--model <id>` (or set
 * `GITGIST_OPENAI_MODEL`) if your account serves something else. A wrong id
 * surfaces as a `404`/`400` from the API with the id echoed back, which the
 * provider passes through verbatim.
 */
const DEFAULT_MODEL = 'gpt-5';

/**
 * Diff-material budget for the hosted OpenAI backend. Sized like the Anthropic
 * API backend rather than the `local` one: these are frontier models with very
 * large context windows, so the binding constraint is usefulness and cost, not
 * the window. See `docs/9-provider-budgets.md`.
 */
const API_DIFF_BUDGET_CHARS = 200_000;

/** Config captured by {@link createOpenAiApiProvider} (injectable for tests). */
export interface OpenAiApiProviderConfig {
  /** Base URL override (default: `OPENAI_BASE_URL`, else OpenAI's). */
  endpoint?: string;
  /** Model id override (default: `GITGIST_OPENAI_MODEL`, else {@link DEFAULT_MODEL}). */
  model?: string;
  /** API key override (default: reads `OPENAI_API_KEY`). */
  apiKey?: () => string | undefined;
  /** Injectable fetch (default: global `fetch`). */
  fetchImpl?: FetchLike;
}

/** Resolve the base URL (no trailing slash) from config → env → default. */
function resolveEndpoint(configured: string | undefined): string {
  const fromEnv = process.env.OPENAI_BASE_URL?.trim();
  const base =
    configured !== undefined && configured.trim() !== ''
      ? configured.trim()
      : fromEnv !== undefined && fromEnv !== ''
        ? fromEnv
        : DEFAULT_OPENAI_ENDPOINT;
  return base.replace(/\/+$/, '');
}

/** Read `OPENAI_API_KEY`, treating unset and empty as the same thing. */
function keyFromEnv(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key === undefined || key === '' ? undefined : key;
}

/** Turn an auth-shaped status into an actionable hint. */
function httpHint(status: number): string | undefined {
  if (status === 401 || status === 403) return 'Check OPENAI_API_KEY.';
  if (status === 404) return 'Check the model id (--model) and OPENAI_BASE_URL.';
  if (status === 429) return 'Rate limited or out of quota — retry later.';
  return undefined;
}

/**
 * Build an {@link AIProvider} backed by the **OpenAI chat-completions API** over
 * plain `fetch` — no vendor SDK, so no new runtime dependency (GG-32 chose this
 * over the `openai` package deliberately; `tests/conventions.test.ts` guards the
 * dependency list).
 *
 * It shares its transport with the `local` provider via `openaiCompatible.ts`;
 * the differences are the hosted default endpoint, the bearer token, and a
 * key-only availability check.
 *
 * `isAvailable()` checks only that `OPENAI_API_KEY` is set — it makes **no
 * network call**, matching the `anthropic-api` backend. That matters because this
 * provider sits in `AUTO_ORDER`: a probe that reached the network would add
 * latency to every auto-resolved run, and a probe that validated the key would
 * cost a request. The consequence is that an invalid or exhausted key is
 * discovered at generation time, where the API's own error is surfaced.
 *
 * `--endpoint` is **not** threaded here (it is documented as the `local`
 * provider's flag); point this backend at Azure or a proxy with
 * `OPENAI_BASE_URL`, the variable OpenAI's own SDK reads.
 *
 * @param config - Endpoint/model/key overrides and an injectable fetch.
 * @returns A provider backed by the OpenAI API.
 */
export function createOpenAiApiProvider(config: OpenAiApiProviderConfig = {}): AIProvider {
  const apiKey = config.apiKey ?? keyFromEnv;

  return {
    name: 'openai-api',
    diffBudgetChars: API_DIFF_BUDGET_CHARS,

    isAvailable(): Promise<boolean> {
      return Promise.resolve(apiKey() !== undefined);
    },

    // `async` matters: the keyless guard below must *reject* rather than throw
    // synchronously, so callers using `.catch()` (not just `try { await }`) see it.
    async generate(request: GenerateRequest): Promise<string> {
      const key = apiKey();
      if (key === undefined) {
        throw new Error('The openai-api provider is unavailable: set OPENAI_API_KEY.');
      }

      const target: OpenAiCompatibleTarget = {
        endpoint: resolveEndpoint(config.endpoint),
        label: 'OpenAI API',
        unreachableHint: 'Check your network, or OPENAI_BASE_URL if you set it.',
        headers: { Authorization: `Bearer ${key}` },
        fetchImpl: config.fetchImpl,
        httpHint,
      };

      // Model precedence: explicit (--model) → config → env → the built-in
      // default. Written as sequential checks, not `??`, because an empty string
      // is not nullish and would otherwise stop the chain at the first blank.
      let model = request.model?.trim() ?? '';
      if (model === '') model = config.model?.trim() ?? '';
      if (model === '') model = process.env.GITGIST_OPENAI_MODEL?.trim() ?? '';
      if (model === '') model = DEFAULT_MODEL;

      return chatCompletion(target, {
        model,
        system: request.system,
        prompt: request.prompt,
        timeoutMs: request.timeoutMs,
      });
    },
  };
}

/** Default OpenAI API provider (reads `OPENAI_API_KEY` / `OPENAI_BASE_URL`). */
export const openaiApiProvider = createOpenAiApiProvider();
