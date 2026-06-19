import {
  generate as appleGenerate,
  type GenerateRequest as AppleGenerateRequest,
  type HelperOptions,
  probe as appleProbe,
  type ProbeResult,
} from 'apple-fm';

import { stripCodeFences } from '../prompt.js';
import type { AIProvider, GenerateRequest } from './types.js';

/** Probe timeout (ms) — a quick availability check. */
const PROBE_TIMEOUT_MS = 10_000;
/** Default generation timeout (ms) — on-device inference can be slow. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The `apple-fm` probe function (injectable for tests). */
export type AppleProbeFn = (options?: HelperOptions) => Promise<ProbeResult>;
/** The `apple-fm` generate function (injectable for tests). */
export type AppleGenerateFn = (
  request: AppleGenerateRequest,
  options?: HelperOptions,
) => Promise<string>;

/** Config captured by {@link createAppleProvider} (injectable for tests). */
export interface AppleProviderConfig {
  /** Override the `apple-fm` probe (default: the package's `probe`). */
  probe?: AppleProbeFn;
  /** Override the `apple-fm` generate (default: the package's `generate`). */
  generate?: AppleGenerateFn;
  /** Pretend-platform for tests (default: `process.platform === 'darwin'`). */
  isDarwin?: boolean;
}

/**
 * Provider for macOS **Apple Foundation Models** — on-device, free, private, no
 * API key. It delegates to the [`apple-fm`](https://www.npmjs.com/package/apple-fm)
 * package, which bundles a small Swift helper that wraps the `FoundationModels`
 * framework and returns the model's Markdown. Point at a custom helper build with
 * `APPLE_FM_BIN`.
 *
 * Requires macOS 26+ on Apple Silicon with Apple Intelligence. On any other
 * platform, or when the on-device model isn't available, the probe reports
 * unavailable and the provider is skipped.
 *
 * @param config - Injectable probe / generate / platform for tests.
 * @returns A provider backed by `apple-fm`.
 */
export function createAppleProvider(config: AppleProviderConfig = {}): AIProvider {
  const probe = config.probe ?? appleProbe;
  const generate = config.generate ?? appleGenerate;
  const isDarwin = config.isDarwin ?? process.platform === 'darwin';

  return {
    name: 'apple',

    async isAvailable(): Promise<boolean> {
      if (!isDarwin) return false;
      try {
        const { available } = await probe({ timeoutMs: PROBE_TIMEOUT_MS });
        return available;
      } catch {
        return false;
      }
    },

    async generate(request: GenerateRequest): Promise<string> {
      const output = await generate(
        { system: request.system, prompt: request.prompt },
        { timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      );
      const text = stripCodeFences(output);
      if (text === '') throw new Error('Apple Foundation Models returned no output.');
      return text;
    },
  };
}

/** Default Apple Foundation Models provider. */
export const appleProvider = createAppleProvider();
