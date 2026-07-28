import {
  chatCompletion,
  type FetchLike,
  listModels,
  type OpenAiCompatibleTarget,
} from './openaiCompatible.js';
import { HTTP_PROBE_TIMEOUT_MS, LOCAL_GENERATION_TIMEOUT_MS } from './timeouts.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Default OpenAI-compatible base URL — Ollama's port + `/v1` prefix. */
export const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434/v1';

/** Config captured by {@link createLocalProvider}. */
export interface LocalProviderConfig {
  /** OpenAI-compatible base URL (default: `GITGIST_LOCAL_ENDPOINT` or Ollama). */
  endpoint?: string;
  /** Model name (default: `GITGIST_LOCAL_MODEL`, else the endpoint's first model). */
  model?: string;
  /** Injectable fetch (default: global `fetch`). */
  fetchImpl?: FetchLike;
}

/** Resolve the base URL (no trailing slash) from config → env → default. */
function resolveEndpoint(configured: string | undefined): string {
  const fromEnv = process.env.GITGIST_LOCAL_ENDPOINT?.trim();
  const base =
    configured !== undefined && configured.trim() !== ''
      ? configured.trim()
      : fromEnv !== undefined && fromEnv !== ''
        ? fromEnv
        : DEFAULT_LOCAL_ENDPOINT;
  return base.replace(/\/+$/, '');
}

/**
 * Diff-material budget for a local OpenAI-compatible endpoint. Whatever model
 * happens to be loaded is unknown to gitgist, and Ollama's default context is
 * commonly 4k–8k tokens — so this errs small deliberately. Raise it with
 * `--max-diff-chars` when the loaded model has room. See
 * `docs/9-provider-budgets.md`.
 */
const LOCAL_DIFF_BUDGET_CHARS = 8_000;

/**
 * Provider for a local **OpenAI-compatible** chat endpoint — Ollama, LM Studio,
 * llama.cpp's server, vLLM, etc. Free, private, on-device. No API key.
 *
 * Opt-in only (`--provider local`): it is deliberately **not** in the auto
 * resolution order, so a normal run never probes localhost.
 *
 * The wire protocol lives in `openaiCompatible.ts`, shared with the hosted
 * `openai-api` backend. What is specific to this provider is the Ollama-shaped
 * endpoint default, the *network* availability probe (a local server may simply
 * not be running), and picking up whatever model the endpoint has loaded.
 *
 * @param config - Endpoint/model overrides and an injectable fetch.
 * @returns A provider backed by the local endpoint.
 */
export function createLocalProvider(config: LocalProviderConfig = {}): AIProvider {
  /** The endpoint plus this backend's error wording. */
  function target(): OpenAiCompatibleTarget {
    return {
      endpoint: resolveEndpoint(config.endpoint),
      label: 'Local endpoint',
      unreachableHint: 'Start your local server (e.g. Ollama) or pass --endpoint.',
      timeoutHint:
        'The server is up but the model is slow — try a smaller model, lower --max-diff-chars, or allow more time.',
      fetchImpl: config.fetchImpl,
    };
  }

  return {
    name: 'local',
    diffBudgetChars: LOCAL_DIFF_BUDGET_CHARS,

    async isAvailable(): Promise<boolean> {
      try {
        return (await listModels(target(), HTTP_PROBE_TIMEOUT_MS)).length > 0;
      } catch {
        return false;
      }
    },

    async generate(request: GenerateRequest): Promise<string> {
      const where = target();

      // Model precedence: explicit (--model) → env → the endpoint's first model.
      let model = config.model?.trim() ?? '';
      if (model === '') model = process.env.GITGIST_LOCAL_MODEL?.trim() ?? '';
      if (model === '') model = (await listModels(where, HTTP_PROBE_TIMEOUT_MS))[0] ?? '';
      if (model === '') {
        throw new Error(
          `No local model available at ${where.endpoint}. Install one (e.g. \`ollama pull llama3.2\`) or pass --model.`,
        );
      }

      return chatCompletion(where, {
        model,
        system: request.system,
        prompt: request.prompt,
        timeoutMs: request.timeoutMs ?? LOCAL_GENERATION_TIMEOUT_MS,
      });
    },
  };
}

/** Default-config local provider (reads env / Ollama default). */
export const localProvider = createLocalProvider();
