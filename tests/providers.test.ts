import { afterEach, describe, expect, it } from 'vitest';

import {
  type AnthropicMessage,
  type AnthropicRunParams,
  createAnthropicApiProvider,
} from '../src/providers/anthropicApi.js';
import { createCliProvider } from '../src/providers/cli.js';
import { codexRunArgs } from '../src/providers/codex.js';
import { geminiRunArgs } from '../src/providers/gemini.js';
import { anthropicApiProvider, AUTO_ORDER, PROVIDERS, resolveProvider } from '../src/providers/index.js';
import {
  createLocalProvider,
  extractChatContent,
  type FetchLike,
  parseModelList,
} from '../src/providers/local.js';
import { opencodeRunArgs } from '../src/providers/opencode.js';
import type { AIProvider } from '../src/providers/types.js';

/** A deterministic stand-in provider whose availability we control. */
function fakeProvider(name: string, available: boolean): AIProvider {
  return {
    name,
    isAvailable: () => Promise.resolve(available),
    generate: () => Promise.resolve(`output from ${name}`),
  };
}

describe('provider registry', () => {
  it('exposes the concrete providers keyed by name', () => {
    expect(PROVIDERS['anthropic-api'].name).toBe('anthropic-api');
    expect(PROVIDERS['claude-cli'].name).toBe('claude-cli');
    expect(PROVIDERS.codex.name).toBe('codex');
    expect(PROVIDERS.gemini.name).toBe('gemini');
    expect(PROVIDERS.opencode.name).toBe('opencode');
  });
});

describe('CLI agent provider arg builders', () => {
  it('codex: `exec`, with `-m <model>` after the subcommand', () => {
    expect(codexRunArgs({})).toEqual(['exec']);
    expect(codexRunArgs({ model: '' })).toEqual(['exec']);
    expect(codexRunArgs({ model: 'o3' })).toEqual(['exec', '-m', 'o3']);
  });

  it('gemini: `-p` last, with `-m <model>` before it', () => {
    expect(geminiRunArgs({})).toEqual(['-p']);
    expect(geminiRunArgs({ model: 'gemini-2.5-pro' })).toEqual(['-m', 'gemini-2.5-pro', '-p']);
  });

  it('opencode: `run`, with `-m <provider/model>` after the subcommand', () => {
    expect(opencodeRunArgs({})).toEqual(['run']);
    expect(opencodeRunArgs({ model: 'anthropic/claude-opus-4-8' })).toEqual([
      'run',
      '-m',
      'anthropic/claude-opus-4-8',
    ]);
  });
});

/** A node stub that echoes its argv + stdin as JSON, for arg-wiring assertions. */
const ARG_ECHO =
  "const c=[];process.stdin.on('data',d=>c.push(d));" +
  "process.stdin.on('end',()=>process.stdout.write(" +
  "JSON.stringify({argv:process.argv.slice(1),stdin:c.join('')})));";

describe('createCliProvider model threading (runArgs function)', () => {
  // Non-dash sentinels (`MODEL <id>`) so the `node` stub doesn't intercept them
  // as its own options; the real CLIs parse their `-m`/`-p` flags themselves.
  /** A provider whose runArgs append `MODEL <model>` only when a model is set. */
  function echoProvider(input: 'stdin' | 'arg') {
    return createCliProvider({
      name: 'arg-echo',
      command: process.execPath,
      runArgs: ({ model }) =>
        model !== undefined && model !== ''
          ? ['-e', ARG_ECHO, 'MODEL', model]
          : ['-e', ARG_ECHO],
      input,
    });
  }

  it('threads the model into the args and passes the prompt (arg input)', async () => {
    const out = await echoProvider('arg').generate({ system: 'SYS', prompt: 'BODY', model: 'mod-x' });
    const parsed = JSON.parse(out) as { argv: string[]; stdin: string };
    expect(parsed.argv).toContain('MODEL');
    expect(parsed.argv).toContain('mod-x');
    expect(parsed.argv[parsed.argv.length - 1]).toBe('SYS\n\nBODY');
    expect(parsed.stdin).toBe('');
  });

  it('omits the model args when no model is given and pipes the prompt via stdin', async () => {
    const out = await echoProvider('stdin').generate({ system: 'SYS', prompt: 'BODY' });
    const parsed = JSON.parse(out) as { argv: string[]; stdin: string };
    expect(parsed.argv).not.toContain('MODEL');
    expect(parsed.stdin).toBe('SYS\n\nBODY');
  });
});

describe('createCliProvider', () => {
  it('reports unavailable when the command is missing', async () => {
    const provider = createCliProvider({
      name: 'nope-cli',
      command: 'definitely-not-a-real-binary-xyz',
      runArgs: ['-p'],
    });
    expect(provider.name).toBe('nope-cli');
    expect(await provider.isAvailable()).toBe(false);
  });

  it('generate() pipes the prompt and returns the CLI output', async () => {
    // A node stub that echoes whatever it reads on stdin.
    const provider = createCliProvider({
      name: 'echo-cli',
      command: process.execPath,
      runArgs: ['-e', 'process.stdin.on("data", (d) => process.stdout.write(d))'],
    });
    const out = await provider.generate({ system: 'SYS', prompt: 'PROMPT' });
    expect(out).toContain('SYS');
    expect(out).toContain('PROMPT');
  });

  it('generate() surfaces stderr on a non-zero exit', async () => {
    const provider = createCliProvider({
      name: 'fail-cli',
      command: process.execPath,
      runArgs: ['-e', 'process.stderr.write("auth failed: bad token"); process.exit(1)'],
      input: 'arg',
    });
    await expect(provider.generate({ system: '', prompt: '' })).rejects.toThrow(
      /exited with code 1: auth failed: bad token/,
    );
  });

  it('generate() rejects after the timeout', async () => {
    const provider = createCliProvider({
      name: 'hang-cli',
      command: process.execPath,
      runArgs: ['-e', 'setInterval(() => undefined, 1000)'],
      input: 'arg',
    });
    await expect(
      provider.generate({ system: '', prompt: '', timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 200ms/);
  });
});

describe('local provider helpers', () => {
  it('parseModelList extracts ids from an OpenAI /models response', () => {
    expect(parseModelList({ data: [{ id: 'llama3.2' }, { id: 'qwen' }, {}] })).toEqual([
      'llama3.2',
      'qwen',
    ]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
  });

  it('extractChatContent pulls choices[0].message.content', () => {
    expect(extractChatContent({ choices: [{ message: { content: '## Features' } }] })).toBe(
      '## Features',
    );
    expect(extractChatContent({ choices: [] })).toBe('');
    expect(extractChatContent({})).toBe('');
  });
});

/** A fake fetch that routes /models and /chat/completions to canned responses. */
function fakeFetch(models: string[], content: string): FetchLike {
  return (url) => {
    if (url.endsWith('/models')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: models.map((id) => ({ id })) }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });
  };
}

describe('createLocalProvider', () => {
  it('isAvailable() is true when the endpoint lists ≥1 model', async () => {
    const p = createLocalProvider({ fetchImpl: fakeFetch(['llama3.2'], '') });
    expect(await p.isAvailable()).toBe(true);
  });

  it('isAvailable() is false when no models are listed', async () => {
    const p = createLocalProvider({ fetchImpl: fakeFetch([], '') });
    expect(await p.isAvailable()).toBe(false);
  });

  it('isAvailable() is false when the endpoint is unreachable', async () => {
    const p = createLocalProvider({
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(await p.isAvailable()).toBe(false);
  });

  it('generate() posts the chat request and returns the message content', async () => {
    const p = createLocalProvider({
      model: 'llama3.2',
      fetchImpl: fakeFetch(['llama3.2'], '## Features\n- a'),
    });
    expect(await p.generate({ system: 's', prompt: 'p' })).toBe('## Features\n- a');
  });

  it('generate() discovers the first model when none is configured', async () => {
    const original = process.env.GITGIST_LOCAL_MODEL;
    delete process.env.GITGIST_LOCAL_MODEL;
    try {
      const p = createLocalProvider({ fetchImpl: fakeFetch(['mistral'], 'notes') });
      expect(await p.generate({ system: 's', prompt: 'p' })).toBe('notes');
    } finally {
      if (original !== undefined) process.env.GITGIST_LOCAL_MODEL = original;
    }
  });

  it('generate() throws when no model is available', async () => {
    const original = process.env.GITGIST_LOCAL_MODEL;
    delete process.env.GITGIST_LOCAL_MODEL;
    try {
      const p = createLocalProvider({ fetchImpl: fakeFetch([], 'x') });
      await expect(p.generate({ system: 's', prompt: 'p' })).rejects.toThrow(/No local model/);
    } finally {
      if (original !== undefined) process.env.GITGIST_LOCAL_MODEL = original;
    }
  });
});

describe('anthropicApiProvider.isAvailable', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('is available when the key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(await anthropicApiProvider.isAvailable()).toBe(true);
  });

  it('is unavailable when the key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await anthropicApiProvider.isAvailable()).toBe(false);
  });

  it('is unavailable for an empty key', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect(await anthropicApiProvider.isAvailable()).toBe(false);
  });
});

/** A text content block, as the provider expects from the SDK. */
function textBlock(text: string): AnthropicMessage['content'][number] {
  return { type: 'text', text };
}

describe('createAnthropicApiProvider.generate', () => {
  it('concatenates text blocks and strips a wrapping code fence', async () => {
    const provider = createAnthropicApiProvider({
      run: () =>
        Promise.resolve({
          stopReason: 'end_turn',
          content: [textBlock('```markdown\n## Features\n'), textBlock('- a\n```')],
        }),
      warn: () => undefined,
    });
    expect(await provider.generate({ system: 's', prompt: 'p' })).toBe('## Features\n- a');
  });

  it('ignores non-text content blocks', async () => {
    const provider = createAnthropicApiProvider({
      run: () =>
        Promise.resolve({
          stopReason: 'end_turn',
          content: [{ type: 'thinking' }, textBlock('## Notes'), { type: 'tool_use' }],
        }),
      warn: () => undefined,
    });
    expect(await provider.generate({ system: 's', prompt: 'p' })).toBe('## Notes');
  });

  it('warns on stderr when the model hits max_tokens (NFR-6)', async () => {
    const warnings: string[] = [];
    const provider = createAnthropicApiProvider({
      run: () => Promise.resolve({ stopReason: 'max_tokens', content: [textBlock('partial')] }),
      warn: (m) => warnings.push(m),
    });
    await provider.generate({ system: 's', prompt: 'p' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/truncated.*max_tokens/);
  });

  it('does not warn when generation stops normally', async () => {
    const warnings: string[] = [];
    const provider = createAnthropicApiProvider({
      run: () => Promise.resolve({ stopReason: 'end_turn', content: [textBlock('full')] }),
      warn: (m) => warnings.push(m),
    });
    await provider.generate({ system: 's', prompt: 'p' });
    expect(warnings).toHaveLength(0);
  });

  it('defaults the model and max_tokens, and forwards overrides to the run', async () => {
    const calls: AnthropicRunParams[] = [];
    const run = (params: AnthropicRunParams): Promise<AnthropicMessage> => {
      calls.push(params);
      return Promise.resolve({ stopReason: 'end_turn', content: [textBlock('x')] });
    };
    const provider = createAnthropicApiProvider({ run, warn: () => undefined });

    await provider.generate({ system: 'sys', prompt: 'body' });
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-4-8',
      maxTokens: 16000,
      system: 'sys',
      prompt: 'body',
    });

    await provider.generate({ system: 's', prompt: 'p', model: 'claude-haiku-4-5', maxTokens: 99 });
    expect(calls[1]).toMatchObject({ model: 'claude-haiku-4-5', maxTokens: 99 });
  });

  it('isAvailable() honors the injected key check', async () => {
    expect(await createAnthropicApiProvider({ hasApiKey: () => true }).isAvailable()).toBe(true);
    expect(await createAnthropicApiProvider({ hasApiKey: () => false }).isAvailable()).toBe(false);
  });
});

describe('resolveProvider', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('returns a requested provider when available', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const provider = await resolveProvider('anthropic-api');
    expect(provider.name).toBe('anthropic-api');
  });

  it('throws when the requested provider is unavailable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(resolveProvider('anthropic-api')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('auto-selects the first available provider in order', async () => {
    const order = [fakeProvider('cli', false), fakeProvider('api', true)];
    const provider = await resolveProvider('auto', { order });
    expect(provider.name).toBe('api');
  });

  it('auto prefers an earlier available provider (CLI before API)', async () => {
    const order = [fakeProvider('cli', true), fakeProvider('api', true)];
    const provider = await resolveProvider('auto', { order });
    expect(provider.name).toBe('cli');
  });

  it('throws when no provider in the order is available', async () => {
    const order = [fakeProvider('cli', false), fakeProvider('api', false)];
    await expect(resolveProvider('auto', { order })).rejects.toThrow(/No AI provider available/);
  });

  it('auto order: CLI agents → API → apple, and never local', () => {
    const names = AUTO_ORDER.map((p) => p.name);
    expect(names).not.toContain('local');
    expect(names).toEqual([
      'claude-cli',
      'codex',
      'gemini',
      'opencode',
      'anthropic-api',
      'apple',
    ]);
  });
});
