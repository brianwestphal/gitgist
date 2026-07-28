import { describe, expect, it } from 'vitest';

import {
  capPatch,
  capText,
  DEFAULT_MAX_DIFF_CHARS,
  MAX_STAT_CHARS,
  shareBudget,
  sliceToLine,
  splitPatchByFile,
} from '../src/diffBudget.js';

/**
 * A unified-diff section for `path`, roughly `chars` long.
 *
 * Every section must end with a newline: `splitPatchByFile` splits on a
 * line-start lookahead, so a section cut mid-line would swallow the next file's
 * header instead of starting a new section.
 */
function section(path: string, chars: number): string {
  const header = `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n`;
  let body = '';
  // Newline every 10 chars so line-aligned trimming has somewhere to land.
  while (header.length + body.length < chars) body += `+${'x'.repeat(8)}\n`;
  return header + body;
}

describe('capText', () => {
  it('leaves text within budget untouched, and trims the edges', () => {
    expect(capText('  hello  ', 100, 'note')).toEqual({ text: 'hello', truncated: false });
  });

  it('cuts to budget and says why', () => {
    const out = capText('a'.repeat(50), 10, 'diff truncated');
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith('a'.repeat(10))).toBe(true);
    expect(out.text).toContain('(diff truncated)');
  });

  it('treats a budget exactly equal to the length as fitting', () => {
    // Boundary: `<=`, not `<` — an exact fit must not be reported as truncated.
    expect(capText('abcde', 5, 'n')).toEqual({ text: 'abcde', truncated: false });
  });
});

describe('shareBudget', () => {
  it('divides the budget across the sections that have content', () => {
    expect(shareBudget(900, 3)).toBe(300);
  });

  it('gives a lone section the whole budget', () => {
    // The FR-26 rule that a `--staged`-only run is not charged for absent sections.
    expect(shareBudget(900, 1)).toBe(900);
  });

  it('returns the full budget rather than dividing by zero', () => {
    expect(shareBudget(900, 0)).toBe(900);
  });

  it('floors rather than handing out fractional characters', () => {
    expect(shareBudget(10, 3)).toBe(3);
  });
});

describe('splitPatchByFile', () => {
  it('splits on the file header and keeps git order', () => {
    const patch = `${section('b.ts', 60)}${section('a.ts', 60)}`;
    expect(splitPatchByFile(patch).map((s) => s.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('returns nothing for an empty patch', () => {
    expect(splitPatchByFile('')).toEqual([]);
    expect(splitPatchByFile('   \n  ')).toEqual([]);
  });

  it('labels a section whose header it cannot parse', () => {
    // Reachable on unusual diff output; the section must still be accounted for
    // rather than dropped, since dropping it would hide a changed file.
    const odd = 'diff --git nonstandard\n+something\n';
    expect(splitPatchByFile(odd)).toEqual([{ path: '(unknown)', text: odd }]);
  });
});

describe('sliceToLine', () => {
  it('rounds back to the last complete line', () => {
    expect(sliceToLine('aaaa\nbbbb\ncccc\n', 12)).toBe('aaaa\nbbbb');
  });

  it('takes a raw cut when line-aligning would throw away most of the allowance', () => {
    // A minified/generated file can be one enormous line. Rounding back to the
    // previous newline there would leave only the header, so a truncated line
    // beats no content.
    const oneHugeLine = `short\n${'y'.repeat(200)}`;
    const out = sliceToLine(oneHugeLine, 100);
    expect(out.length).toBe(100);
    expect(out).toContain('y');
  });

  it('returns the whole text when it already fits', () => {
    expect(sliceToLine('abc', 100)).toBe('abc');
  });
});

// @covers FR-29
describe('capPatch — max-min fair allocation (GG-57)', () => {
  it('leaves a patch that already fits completely alone', () => {
    const patch = `${section('a.ts', 100)}${section('b.ts', 100)}`;
    const out = capPatch(patch, 10_000);
    expect(out.truncated).toBe(false);
    expect(out.trimmed).toEqual([]);
    expect(out.text).toContain('a.ts');
    expect(out.text).toContain('b.ts');
  });

  it('never leaves a late-sorting file with nothing — the GG-57 regression', () => {
    // A positional cut spent the budget alphabetically and gave `zzz.ts` zero
    // characters. Every file must appear in the output.
    const patch = `${section('aaa.ts', 4000)}${section('zzz.ts', 4000)}`;
    const out = capPatch(patch, 2000);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain('aaa.ts');
    expect(out.text).toContain('zzz.ts');
    expect(out.trimmed).toEqual(expect.arrayContaining(['aaa.ts', 'zzz.ts']));
  });

  it('lets a small file keep everything and flows its remainder to a large one', () => {
    // The water-filling property: served smallest-first, so the small file takes
    // only what it needs and the big file gets more than an equal split.
    const small = section('small.ts', 200);
    const big = section('big.ts', 6000);
    const out = capPatch(small + big, 3000);
    // The small file survives intact — it is not in the trimmed list.
    expect(out.trimmed).toEqual(['big.ts']);
    // And the big file received well over half the budget (an equal 1500 split
    // would have trimmed the small file too).
    expect(out.text.length).toBeGreaterThan(2000);
  });

  it('shares fairly when every file is over its equal share', () => {
    // Nothing can flow back, so each of four files gets ~budget/4 and all are
    // trimmed — but none is dropped.
    const patch = [1, 2, 3, 4].map((n) => section(`f${String(n)}.ts`, 3000)).join('');
    const out = capPatch(patch, 4000);
    expect(out.trimmed).toHaveLength(4);
    for (const n of [1, 2, 3, 4]) expect(out.text).toContain(`f${String(n)}.ts`);
  });

  it('handles a single file larger than the entire budget', () => {
    const out = capPatch(section('huge.ts', 50_000), 500);
    expect(out.truncated).toBe(true);
    expect(out.trimmed).toEqual(['huge.ts']);
    expect(out.text).toContain('huge.ts');
  });

  it('still bounds a patch with no recognizable file headers', () => {
    // Text without a `diff --git` line yields one `(unknown)` section rather than
    // none, so it goes through the normal allocation. Either way it is bounded
    // and what was held back is reported — the FR-26 invariant does not depend on
    // the header being parseable.
    const out = capPatch('just some text with no diff headers at all', 10);
    expect(out.truncated).toBe(true);
    expect(out.trimmed).toEqual(['(unknown)']);
    expect(out.text.length).toBeLessThan(60);
  });

  it('plain-caps an empty patch without inventing sections', () => {
    const out = capPatch('   \n  ', 10);
    expect(out.trimmed).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it('reports a trimmed file by path so the prompt can name it', () => {
    // FR-26's visibility invariant: anything held back must be stateable.
    const out = capPatch(`${section('kept.ts', 100)}${section('cut.ts', 9000)}`, 1200);
    expect(out.trimmed).toContain('cut.ts');
    expect(out.trimmed).not.toContain('kept.ts');
    expect(out.text).toContain('(cut.ts diff truncated)');
  });

  it('is idempotent enough to re-cap without losing files', () => {
    const once = capPatch(`${section('a.ts', 4000)}${section('b.ts', 4000)}`, 2000);
    const twice = capPatch(once.text, 2000);
    expect(twice.text).toContain('a.ts');
    expect(twice.text).toContain('b.ts');
  });
});

describe('budget constants', () => {
  it('keeps the stat allowance well under the patch budget', () => {
    // The stat is a summary of the patch; it must not be able to crowd it out.
    expect(MAX_STAT_CHARS).toBeLessThan(DEFAULT_MAX_DIFF_CHARS);
  });
});
