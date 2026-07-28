import { stripCodeFences } from '../prompt.js';
import { GENERATION_TIMEOUT_MS, HTTP_PROBE_TIMEOUT_MS } from './timeouts.js';

/**
 * The shared **OpenAI-protocol client** behind every backend that speaks
 * `POST /chat/completions` — the on-device `local` provider (Ollama / LM Studio /
 * llama.cpp / vLLM) and the hosted `openai-api` provider.
 *
 * It exists so those backends share one tested transport instead of two copies:
 * the wire format, model listing, response extraction, timeout handling, and
 * error mapping all live here. What differs between them — the base URL, whether
 * a bearer token is sent, how availability is decided, and how the model is
 * chosen — stays in the provider modules, because those are the actual
 * differences and not incidental duplication.
 *
 * Deliberately dependency-free: plain `fetch`, no vendor SDK. gitgist's runtime
 * dependency list is a guarded surface (see `tests/conventions.test.ts`), and
 * this protocol is small enough that an SDK would buy nothing.
 */

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

/* v8 ignore next -- thin wrapper over the global fetch; tests inject fetchImpl. */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * One OpenAI-compatible endpoint, plus how it should describe itself when
 * something goes wrong.
 *
 * The `label` / `unreachableHint` pair is what keeps error messages actionable
 * per backend: an unreachable `local` endpoint should say "start Ollama", while
 * an unreachable hosted API should not.
 */
export interface OpenAiCompatibleTarget {
  /** Base URL including any `/v1` prefix, without a trailing slash. */
  endpoint: string;
  /** How this backend names itself in errors, e.g. `Local endpoint`, `OpenAI API`. */
  label: string;
  /** Appended to the unreachable error — the concrete fix for this backend. */
  unreachableHint: string;
  /**
   * Appended to the **timeout** error. Kept separate from
   * {@link unreachableHint} because a slow model and a dead server call for
   * opposite advice, and conflating them sent users to restart a server that was
   * working fine (GG-64).
   */
  timeoutHint?: string;
  /** Extra request headers, e.g. `Authorization: Bearer …`. */
  headers?: Record<string, string>;
  /** Injectable fetch (default: the global `fetch`). */
  fetchImpl?: FetchLike;
  /**
   * Optional extra guidance for a specific HTTP status — used to turn a bare
   * `401` into "check your API key" rather than leaving the caller to guess.
   */
  httpHint?: (status: number) => string | undefined;
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
 * Turn a `fetch` rejection into a short, human-readable cause.
 *
 * An `AbortError` here can only have come from our own timeout; otherwise the underlying `code` (`ECONNREFUSED`,
 * `ECONNRESET`, …) is far more useful than the generic "fetch failed" wrapper
 * Node puts in front of it.
 *
 * @param error - Whatever `fetch` rejected with.
 * @param timeoutMs - The wall-clock budget, named in the timeout case.
 * @returns A short cause description.
 */
export function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (isAbort(error)) return `timed out after ${String(timeoutMs)}ms`;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === 'string' && code !== '') return code;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'unknown error';
}

/**
 * Whether a `fetch` rejection came from our own {@link fetchWithTimeout} abort.
 *
 * @param error - Whatever `fetch` rejected with.
 * @returns True for an `AbortError`.
 */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Merge the target's auth headers with the JSON content type. */
function requestHeaders(target: OpenAiCompatibleTarget): Record<string, string> {
  return { 'Content-Type': 'application/json', ...target.headers };
}

/**
 * List the model ids the endpoint advertises (`GET /models`).
 *
 * Returns an empty list — rather than throwing — when the endpoint answers with
 * a non-2xx, so callers can treat "reachable but unusable" the same as "no
 * models". A transport failure still rejects.
 *
 * @param target - The endpoint to query.
 * @param timeoutMs - Wall-clock timeout (default: {@link HTTP_PROBE_TIMEOUT_MS}).
 * @returns The advertised model ids, or `[]`.
 */
export async function listModels(
  target: OpenAiCompatibleTarget,
  timeoutMs: number = HTTP_PROBE_TIMEOUT_MS,
): Promise<string[]> {
  const fetchImpl = target.fetchImpl ?? defaultFetch;
  const res = await fetchWithTimeout(
    fetchImpl,
    `${target.endpoint}/models`,
    { method: 'GET', headers: requestHeaders(target) },
    timeoutMs,
  );
  if (!res.ok) return [];
  return parseModelList(await res.json());
}

/** A single chat-completion request. */
export interface ChatCompletionRequest {
  /** Model id to send. */
  model: string;
  /** System-role message. */
  system: string;
  /** User-role message. */
  prompt: string;
  /** Wall-clock timeout (default: {@link GENERATION_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/**
 * Run one chat completion and return the assistant's text, with any wrapping
 * Markdown fence stripped.
 *
 * No `response_format` is sent — every gitgist backend wants freeform Markdown,
 * and coercing JSON would fight the prompt. No output-token cap is sent either:
 * the parameter name differs across model generations, and `--max-tokens` is
 * documented as applying to the `anthropic-api` backend only.
 *
 * @param target - Endpoint, auth headers, and error-message wording.
 * @param request - Model and the system/user messages.
 * @returns The assistant's text.
 * @throws If the endpoint is unreachable, answers non-2xx, or returns no text.
 */
export async function chatCompletion(
  target: OpenAiCompatibleTarget,
  request: ChatCompletionRequest,
): Promise<string> {
  const fetchImpl = target.fetchImpl ?? defaultFetch;
  const timeoutMs = request.timeoutMs ?? GENERATION_TIMEOUT_MS;

  let res;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${target.endpoint}/chat/completions`,
      {
        method: 'POST',
        headers: requestHeaders(target),
        // Freeform Markdown out — no response_format coercion.
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          stream: false,
        }),
      },
      timeoutMs,
    );
  } catch (error) {
    // A timeout is NOT unreachability, and must not be reported as one: the
    // server answered fine, the model was just slow. Reporting "start your local
    // server" there sent users to fix something that was not broken (GG-64).
    if (isAbort(error)) {
      const hint = target.timeoutHint === undefined ? '' : ` ${target.timeoutHint}`;
      throw new Error(
        `${target.label} timed out after ${String(timeoutMs)}ms at ${target.endpoint}.${hint}`,
        { cause: error },
      );
    }
    // Otherwise still name the underlying cause rather than swallowing it — a
    // refused connection and a socket dropped mid-request are different problems.
    throw new Error(
      `${target.label} not reachable at ${target.endpoint}. ${target.unreachableHint}` +
        ` (${describeFetchFailure(error, timeoutMs)})`,
      { cause: error },
    );
  }

  if (!res.ok) {
    const hint = target.httpHint?.(res.status);
    const suffix = hint === undefined || hint === '' ? '' : ` ${hint}`;
    throw new Error(
      `${target.label} ${target.endpoint} returned HTTP ${String(res.status)}.${suffix}`,
    );
  }

  const content = extractChatContent(await res.json());
  if (content.trim() === '') {
    throw new Error(`${target.label} ${target.endpoint} returned an empty response.`);
  }
  return stripCodeFences(content);
}
