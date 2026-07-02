import { describe, expect, it } from 'vitest';

import {
  type AppleGenerateFn,
  type AppleProbeFn,
  AUTO_LANGUAGE,
  createAppleProvider,
  detectSystemLanguage,
} from '../src/providers/apple.js';

/** A fake `apple-fm` probe returning a canned availability result. */
function fakeProbe(available: boolean): AppleProbeFn {
  return () =>
    Promise.resolve(available ? { available: true } : { available: false, reason: 'modelNotReady' });
}

/** A fake `apple-fm` probe that rejects (e.g. the helper binary is missing). */
const throwingProbe: AppleProbeFn = () => Promise.reject(new Error('helper not found'));

/** A fake `apple-fm` generate returning canned output. */
function fakeGenerate(output: string): AppleGenerateFn {
  return () => Promise.resolve(output);
}

// @covers FR-15, FR-17
describe('createAppleProvider', () => {
  it('is unavailable off macOS regardless of the probe', async () => {
    const p = createAppleProvider({ isDarwin: false, probe: fakeProbe(true) });
    expect(await p.isAvailable()).toBe(false);
  });

  it('is available when darwin + the probe says available', async () => {
    const p = createAppleProvider({ isDarwin: true, probe: fakeProbe(true) });
    expect(await p.isAvailable()).toBe(true);
  });

  it('is unavailable when the probe says unavailable', async () => {
    const p = createAppleProvider({ isDarwin: true, probe: fakeProbe(false) });
    expect(await p.isAvailable()).toBe(false);
  });

  it('is unavailable when the probe throws (e.g. helper missing)', async () => {
    const p = createAppleProvider({ isDarwin: true, probe: throwingProbe });
    expect(await p.isAvailable()).toBe(false);
  });

  it('generate() returns the model Markdown (fences stripped)', async () => {
    const p = createAppleProvider({
      isDarwin: true,
      generate: fakeGenerate('```markdown\n## Features\n- a\n```'),
    });
    expect(await p.generate({ system: 's', prompt: 'p' })).toBe('## Features\n- a');
  });

  it('generate() forwards the system prompt and (hinted) user prompt to apple-fm', async () => {
    let received: { system?: string; prompt?: string } | undefined;
    const p = createAppleProvider({
      isDarwin: true,
      detectLanguage: () => 'English',
      generate: (request) => {
        received = request;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 'sys', prompt: 'pr' });
    expect(received?.system).toBe('sys');
    expect(received?.prompt).toBe('Treat the following as English:\n\npr');
  });

  it('generate() defaults the language hint to the detected system language', async () => {
    let prompt = '';
    const p = createAppleProvider({
      isDarwin: true,
      detectLanguage: () => 'French',
      generate: (request) => {
        prompt = request.prompt;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 's', prompt: 'pr' });
    expect(prompt).toBe('Treat the following as French:\n\npr');
  });

  it('generate() falls back to English when the system language is undetectable', async () => {
    let prompt = '';
    const p = createAppleProvider({
      isDarwin: true,
      detectLanguage: () => undefined,
      generate: (request) => {
        prompt = request.prompt;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 's', prompt: 'pr' });
    expect(prompt).toBe('Treat the following as English:\n\npr');
  });

  it('generate() honors an explicit language override (code → display name)', async () => {
    let prompt = '';
    const p = createAppleProvider({
      isDarwin: true,
      language: 'de',
      detectLanguage: () => 'English',
      generate: (request) => {
        prompt = request.prompt;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 's', prompt: 'pr' });
    expect(prompt).toBe('Treat the following as German:\n\npr');
  });

  it('generate() passes a spelled-out language name through verbatim', async () => {
    let prompt = '';
    const p = createAppleProvider({
      isDarwin: true,
      language: 'Klingon',
      generate: (request) => {
        prompt = request.prompt;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 's', prompt: 'pr' });
    expect(prompt).toBe('Treat the following as Klingon:\n\npr');
  });

  it('generate() with language "auto" sends the prompt unprefixed', async () => {
    let received: { system?: string; prompt?: string } | undefined;
    const p = createAppleProvider({
      isDarwin: true,
      language: AUTO_LANGUAGE,
      generate: (request) => {
        received = request;
        return Promise.resolve('## X');
      },
    });
    await p.generate({ system: 'sys', prompt: 'pr' });
    expect(received).toEqual({ system: 'sys', prompt: 'pr' });
  });

  it('generate() throws when apple-fm returns empty output', async () => {
    const p = createAppleProvider({ isDarwin: true, generate: fakeGenerate('   ') });
    await expect(p.generate({ system: 's', prompt: 'p' })).rejects.toThrow(/no output/);
  });

  it('generate() surfaces errors thrown by apple-fm', async () => {
    const p = createAppleProvider({
      isDarwin: true,
      generate: () => Promise.reject(new Error('[modelNotReady] inference failed: boom')),
    });
    await expect(p.generate({ system: 's', prompt: 'p' })).rejects.toThrow(/inference failed: boom/);
  });
});

// @covers FR-17
describe('detectSystemLanguage', () => {
  it('returns an English display name (or undefined), never a bare code', () => {
    const lang = detectSystemLanguage();
    if (lang !== undefined) {
      // A display name, not a code like "en" — at minimum not all-lowercase-2-char.
      expect(lang).not.toMatch(/^[a-z]{2,3}$/);
      expect(lang.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined when the Intl runtime throws (e.g. a small-ICU build)', () => {
    const original = Intl.DateTimeFormat;
    // Simulate a Node build without full ICU, where Intl construction throws.
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = () => {
      throw new Error('no ICU');
    };
    try {
      expect(detectSystemLanguage()).toBeUndefined();
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = original;
    }
  });
});
