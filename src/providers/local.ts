import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Default OpenAI-compatible base URL — Ollama's port + `/v1` prefix. */
export const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434/v1';

/** Reachability-probe timeout (ms). */
const PROBE_TIMEOUT_MS = 3000;
/** Default generation timeout (ms) — local models can be slow. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The subset of `fetch` this module uses — injectable for tests. */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type FetchLike = (
  url: string,
  init?: FetchInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

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

/** Extract model ids from an OpenAI `/models` response (`{ data: [{ id }] }`). */
export function parseModelList(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (item !== null && typeof item === 'object') {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string' && id !== '') ids.push(id);
    }
  }
  return ids;
}

/** Pull `choices[0].message.content` from an OpenAI chat-completion response. */
export function extractChatContent(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return '';
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = choices[0];
  if (first === null || typeof first !== 'object') return '';
  const message = (first as { message?: unknown }).message;
  if (message === null || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/** Fetch with a wall-clock timeout via `AbortController`. */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider for a local **OpenAI-compatible** chat endpoint — Ollama, LM Studio,
 * llama.cpp's server, vLLM, etc. Free, private, on-device. No API key.
 *
 * Opt-in only (`--provider local`): it is deliberately **not** in the auto
 * resolution order, so a normal run never probes localhost.
 *
 * @param config - Endpoint/model overrides and an injectable fetch.
 * @returns A provider backed by the local endpoint.
 */
export function createLocalProvider(config: LocalProviderConfig = {}): AIProvider {
  const fetchImpl = config.fetchImpl ?? defaultFetch;

  async function listModels(endpoint: string, timeoutMs: number): Promise<string[]> {
    const res = await fetchWithTimeout(fetchImpl, `${endpoint}/models`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return [];
    return parseModelList(await res.json());
  }

  return {
    name: 'local',

    async isAvailable(): Promise<boolean> {
      try {
        const endpoint = resolveEndpoint(config.endpoint);
        return (await listModels(endpoint, PROBE_TIMEOUT_MS)).length > 0;
      } catch {
        return false;
      }
    },

    async generate(request: GenerateRequest): Promise<string> {
      const endpoint = resolveEndpoint(config.endpoint);
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      // Model precedence: explicit (--model) → env → the endpoint's first model.
      let model = config.model?.trim() ?? '';
      if (model === '') model = process.env.GITGIST_LOCAL_MODEL?.trim() ?? '';
      if (model === '') model = (await listModels(endpoint, PROBE_TIMEOUT_MS))[0] ?? '';
      if (model === '') {
        throw new Error(
          `No local model available at ${endpoint}. Install one (e.g. \`ollama pull llama3.2\`) or pass --model.`,
        );
      }

      let res;
      try {
        res = await fetchWithTimeout(
          fetchImpl,
          `${endpoint}/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Freeform Markdown out — no response_format coercion.
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.prompt },
              ],
              stream: false,
            }),
          },
          timeoutMs,
        );
      } catch {
        throw new Error(
          `Local endpoint not reachable at ${endpoint}. Start your local server (e.g. Ollama) or pass --endpoint.`,
        );
      }

      if (!res.ok) {
        throw new Error(`Local endpoint ${endpoint} returned HTTP ${String(res.status)}.`);
      }
      const content = extractChatContent(await res.json());
      if (content.trim() === '') {
        throw new Error(`Local endpoint ${endpoint} returned an empty response.`);
      }
      return stripCodeFences(content);
    },
  };
}

/** Default-config local provider (reads env / Ollama default). */
export const localProvider = createLocalProvider();
