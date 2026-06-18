import { describe, expect, it } from 'vitest';

import { createAppleProvider, type ProcessRunner } from '../src/providers/apple.js';

/** A fake runner that returns canned output for `--probe` / `--generate`. */
function fakeRunner(
  probe: string,
  generateOut: { stdout?: string; stderr?: string; code?: number } = {},
): ProcessRunner {
  return (_bin, args) => {
    if (args.includes('--probe')) {
      return Promise.resolve({ stdout: probe, stderr: '', code: 0 });
    }
    return Promise.resolve({
      stdout: generateOut.stdout ?? '',
      stderr: generateOut.stderr ?? '',
      code: generateOut.code ?? 0,
    });
  };
}

describe('createAppleProvider', () => {
  const BIN = '/fake/apple-fm-helper';

  it('is unavailable off macOS regardless of the helper', async () => {
    const p = createAppleProvider({ isDarwin: false, binPath: BIN, runner: fakeRunner('available') });
    expect(await p.isAvailable()).toBe(false);
  });

  it('is unavailable when the helper binary is missing', async () => {
    const p = createAppleProvider({ isDarwin: true, binPath: null, runner: fakeRunner('available') });
    expect(await p.isAvailable()).toBe(false);
  });

  it('is available when darwin + helper + probe says "available"', async () => {
    const p = createAppleProvider({ isDarwin: true, binPath: BIN, runner: fakeRunner('available') });
    expect(await p.isAvailable()).toBe(true);
  });

  it('is unavailable when the probe says "unavailable"', async () => {
    const p = createAppleProvider({ isDarwin: true, binPath: BIN, runner: fakeRunner('unavailable') });
    expect(await p.isAvailable()).toBe(false);
  });

  it('generate() returns the helper Markdown (fences stripped)', async () => {
    const p = createAppleProvider({
      isDarwin: true,
      binPath: BIN,
      runner: fakeRunner('available', { stdout: '```markdown\n## Features\n- a\n```' }),
    });
    expect(await p.generate({ system: 's', prompt: 'p' })).toBe('## Features\n- a');
  });

  it('generate() surfaces stderr on a non-zero exit', async () => {
    const p = createAppleProvider({
      isDarwin: true,
      binPath: BIN,
      runner: fakeRunner('available', { stderr: 'inference failed: boom', code: 4 }),
    });
    await expect(p.generate({ system: 's', prompt: 'p' })).rejects.toThrow(
      /exited with code 4: inference failed: boom/,
    );
  });

  it('generate() throws a helpful error when the helper is missing', async () => {
    const p = createAppleProvider({ isDarwin: true, binPath: null, runner: fakeRunner('available') });
    await expect(p.generate({ system: 's', prompt: 'p' })).rejects.toThrow(/helper not found/);
  });
});
