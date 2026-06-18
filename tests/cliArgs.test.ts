import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cliArgs.js';

describe('parseArgs', () => {
  it('defaults to AI, auto provider, no positionals', () => {
    const args = parseArgs([]);
    expect(args).toMatchObject({ ai: true, provider: 'auto', help: false });
    expect(args.from).toBeUndefined();
    expect(args.to).toBeUndefined();
    expect(args.range).toBeUndefined();
  });

  it('reads from and to positionals', () => {
    const args = parseArgs(['v2.0', 'HEAD']);
    expect(args.from).toBe('v2.0');
    expect(args.to).toBe('HEAD');
    expect(args.range).toBeUndefined();
  });

  it('treats a single `..` positional as an explicit range', () => {
    const args = parseArgs(['v1.4.0..HEAD']);
    expect(args.range).toBe('v1.4.0..HEAD');
    expect(args.from).toBeUndefined();
  });

  it('parses --no-ai', () => {
    expect(parseArgs(['--no-ai']).ai).toBe(false);
  });

  it('parses --title, --cwd, --model', () => {
    const args = parseArgs(['--title', 'v1.5.0', '--cwd', '/repo', '--model', 'claude-sonnet-4-6']);
    expect(args.title).toBe('v1.5.0');
    expect(args.cwd).toBe('/repo');
    expect(args.model).toBe('claude-sonnet-4-6');
  });

  it('parses a valid --provider', () => {
    expect(parseArgs(['--provider', 'claude-cli']).provider).toBe('claude-cli');
  });

  it('parses a valid --max-tokens', () => {
    expect(parseArgs(['--max-tokens', '8000']).maxTokens).toBe(8000);
  });

  it('rejects a non-numeric --max-tokens', () => {
    expect(() => parseArgs(['--max-tokens', 'lots'])).toThrow(/Invalid --max-tokens/);
  });

  it('rejects a non-positive --max-tokens', () => {
    expect(() => parseArgs(['--max-tokens', '0'])).toThrow(/Invalid --max-tokens/);
  });

  it('rejects an invalid --provider', () => {
    expect(() => parseArgs(['--provider', 'bogus'])).toThrow(/Invalid --provider/);
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
  });

  it('rejects too many positionals', () => {
    expect(() => parseArgs(['a', 'b', 'c'])).toThrow(/Too many arguments/);
  });

  it('sets help for -h', () => {
    expect(parseArgs(['-h']).help).toBe(true);
  });
});
