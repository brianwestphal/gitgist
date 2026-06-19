import { describe, expect, it } from 'vitest';

import {
  type AppleGenerateFn,
  type AppleProbeFn,
  createAppleProvider,
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

  it('generate() forwards the system prompt and user prompt to apple-fm', async () => {
    let received: unknown;
    const p = createAppleProvider({
      isDarwin: true,
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
