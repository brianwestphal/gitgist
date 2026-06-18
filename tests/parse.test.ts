import { describe, expect, it } from 'vitest';

import { parseCommit, type RawCommit } from '../src/parse.js';

function raw(subject: string, body = ''): RawCommit {
  return {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    subject,
    body,
    author: 'Test Author',
    date: '2026-01-01T00:00:00Z',
  };
}

describe('parseCommit', () => {
  it('parses type, scope, and description', () => {
    const commit = parseCommit(raw('feat(cli): add --title flag'));
    expect(commit.type).toBe('feat');
    expect(commit.scope).toBe('cli');
    expect(commit.description).toBe('add --title flag');
    expect(commit.breaking).toBe(false);
  });

  it('parses a type without a scope', () => {
    const commit = parseCommit(raw('fix: handle empty range'));
    expect(commit.type).toBe('fix');
    expect(commit.scope).toBeNull();
    expect(commit.description).toBe('handle empty range');
  });

  it('detects the breaking-change bang marker', () => {
    const commit = parseCommit(raw('feat!: drop Node 18 support'));
    expect(commit.breaking).toBe(true);
    expect(commit.description).toBe('drop Node 18 support');
  });

  it('detects a BREAKING CHANGE footer in the body', () => {
    const commit = parseCommit(raw('refactor: rework loader', 'BREAKING CHANGE: API renamed'));
    expect(commit.breaking).toBe(true);
  });

  it('falls back to the full subject for non-conventional commits', () => {
    const commit = parseCommit(raw('WIP messing around'));
    expect(commit.type).toBeNull();
    expect(commit.description).toBe('WIP messing around');
  });

  it('derives a 7-character short hash', () => {
    const commit = parseCommit(raw('docs: readme'));
    expect(commit.shortHash).toBe('abcdef1');
  });
});
