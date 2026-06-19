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

/** The `language` value that disables the language hint entirely. */
export const AUTO_LANGUAGE = 'auto';

/** Config captured by {@link createAppleProvider} (injectable for tests). */
export interface AppleProviderConfig {
  /** Override the `apple-fm` probe (default: the package's `probe`). */
  probe?: AppleProbeFn;
  /** Override the `apple-fm` generate (default: the package's `generate`). */
  generate?: AppleGenerateFn;
  /** Pretend-platform for tests (default: `process.platform === 'darwin'`). */
  isDarwin?: boolean;
  /**
   * Language hint for the user prompt (see {@link createAppleProvider} for why
   * it exists):
   *
   * - omitted ⇒ detect the system language (falling back to English).
   * - a language name or BCP-47 code (e.g. `"French"`, `"fr"`, `"en-US"`) ⇒
   *   hint that language.
   * - `"auto"` ({@link AUTO_LANGUAGE}) ⇒ omit the hint entirely and let the model
   *   detect the language itself (which can fail the guardrail — opt-in).
   */
  language?: string;
  /** Override system-language detection (injectable for tests). */
  detectLanguage?: () => string | undefined;
}

/**
 * Detect the host's language as an English display name (e.g. `"English"`,
 * `"French"`), via the `Intl` runtime. Returns `undefined` if it can't be
 * resolved.
 */
export function detectSystemLanguage(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const lang = new Intl.Locale(locale).language;
    if (lang === '') return undefined;
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
    return name === undefined || name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * Render a language name or BCP-47 code as an English display name: `"fr"` /
 * `"en-US"` → `"French"` / `"English"`. A value that isn't a recognized code
 * (e.g. an already-spelled-out `"English"`) is returned verbatim.
 */
function languageDisplayName(value: string): string {
  try {
    const lang = new Intl.Locale(value).language;
    if (lang !== '') {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
      if (name !== undefined && name !== '' && name.toLowerCase() !== lang.toLowerCase()) {
        return name;
      }
    }
  } catch {
    // Not a parseable locale/code — treat the value as a plain language name.
  }
  return value;
}

/**
 * Resolve the effective language hint: `undefined` means "no prefix" (the
 * {@link AUTO_LANGUAGE} case), otherwise the display name to hint.
 */
function resolveLanguageHint(
  language: string | undefined,
  detect: () => string | undefined,
): string | undefined {
  if (language === AUTO_LANGUAGE) return undefined;
  if (language !== undefined && language !== '') return languageDisplayName(language);
  return detect() ?? 'English';
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
 * **Language hint.** Apple's on-device model runs a language-identification
 * guardrail over the prompt and rejects input it can't place in a supported
 * language (`unsupportedLanguageOrLocale`) — which a prompt dominated by
 * non-prose tokens (e.g. a full-SHA range like `<sha>^..<sha>`) can trip even
 * when the surrounding text is English. To defuse it, the user prompt is
 * prefixed with a short `Treat the following as <language>:` lead-in. The
 * language defaults to the detected system language (see
 * {@link AppleProviderConfig.language}); the instruction is inert for the actual
 * generation (the model does not echo it). Pass {@link AUTO_LANGUAGE} to opt out.
 *
 * @param config - Injectable probe / generate / platform / language for tests.
 * @returns A provider backed by `apple-fm`.
 */
export function createAppleProvider(config: AppleProviderConfig = {}): AIProvider {
  const probe = config.probe ?? appleProbe;
  const generate = config.generate ?? appleGenerate;
  const isDarwin = config.isDarwin ?? process.platform === 'darwin';
  const languageHint = resolveLanguageHint(
    config.language,
    config.detectLanguage ?? detectSystemLanguage,
  );

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
      const prompt =
        languageHint === undefined
          ? request.prompt
          : `Treat the following as ${languageHint}:\n\n${request.prompt}`;
      const output = await generate(
        { system: request.system, prompt },
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
