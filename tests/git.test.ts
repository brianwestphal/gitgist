import { describe, expect, it } from 'vitest';

import { resolveCommitRange } from '../src/git.js';

describe('resolveCommitRange', () => {
  it('builds from..to when both are given', async () => {
    expect(await resolveCommitRange('v1.0.0', 'HEAD')).toBe('v1.0.0..HEAD');
  });

  it('defaults the end to HEAD', async () => {
    expect(await resolveCommitRange('v1.0.0', undefined)).toBe('v1.0.0..HEAD');
  });

  it('builds from..to with an explicit end', async () => {
    expect(await resolveCommitRange('v1.0.0', 'v2.0.0')).toBe('v1.0.0..v2.0.0');
  });
});
