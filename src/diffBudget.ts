/**
 * How the diff material handed to a model is **bounded** — the pure arithmetic
 * behind FR-26 (one shared char budget, nothing silently invisible) and FR-29
 * (that budget shared fairly across every changed file).
 *
 * This lives apart from `git.ts` on purpose. Nothing here runs a subprocess or
 * touches the filesystem: it is string and integer work over patch text that
 * `git.ts` has already fetched. Keeping it separate honours the layering rule in
 * CLAUDE.md (only `git.ts` shells out to git) and — the reason it was extracted
 * (GG-72) — makes the allocation directly unit-testable. While these functions
 * were private to the git module, FR-29's max-min fair allocation could only be
 * exercised by building real git repositories, which is a slow and indirect way
 * to assert arithmetic.
 *
 * See [docs/7-diff-grounding.md](../docs/7-diff-grounding.md).
 */

/**
 * Default total character budget for diff material (FR-26), overridable with
 * `--max-diff-chars` and superseded by the resolved provider's own budget
 * (FR-28, see `docs/9-provider-budgets.md`).
 */
export const DEFAULT_MAX_DIFF_CHARS = 24000;

/**
 * Cap on the range's `--stat` summary, separate from the patch budget.
 *
 * The changed-file list is the FR-26 visibility guarantee — a range touching
 * hundreds of files must still say so — but it should not crowd out the patch it
 * is summarizing, so it gets its own smaller allowance.
 */
export const MAX_STAT_CHARS = 4000;

/** Header line that begins each file's section of a unified diff. */
const DIFF_FILE_HEADER = /^diff --git a\/(.*?) b\//;

/**
 * Trim `text` to `maxChars`, appending `note` when anything was cut.
 *
 * @param text - The text to bound.
 * @param maxChars - Maximum characters to keep.
 * @param note - Parenthetical explanation appended when truncated.
 * @returns The bounded text and whether it was cut.
 */
export function capText(
  text: string,
  maxChars: number,
  note: string,
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, maxChars)}\n… (${note})`, truncated: true };
}

/**
 * Split a char budget across the sections that actually carry content, so a
 * single-category run gets the whole budget instead of a fixed fraction of it.
 *
 * @param budget - Total chars available for all sections.
 * @param sections - How many sections have content.
 * @returns The per-section allowance.
 */
export function shareBudget(budget: number, sections: number): number {
  return sections > 0 ? Math.floor(budget / sections) : budget;
}

/**
 * Split a unified diff into one section per changed file.
 *
 * @param patch - Raw `git diff` output.
 * @returns Per-file sections in git's original order.
 */
export function splitPatchByFile(patch: string): { path: string; text: string }[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((section) => section.trim() !== '')
    .map((text) => ({ path: DIFF_FILE_HEADER.exec(text)?.[1] ?? '(unknown)', text }));
}

/**
 * Trim to the last complete line within `max`, so a section doesn't end
 * mid-line and stays readable as a diff.
 *
 * Falls back to a raw cut when line-aligning would throw away most of the
 * allowance — a generated or minified file can be one enormous line, and
 * rounding back to the previous newline there would leave only the diff header.
 * Half the allowance is the cutoff: better a truncated line than no content.
 *
 * @param text - The section text.
 * @param max - Maximum characters to keep.
 * @returns The trimmed text.
 */
export function sliceToLine(text: string, max: number): string {
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf('\n');
  return lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut;
}

/**
 * Cap a unified diff by giving **every changed file a share of the budget**,
 * rather than keeping the first N characters of the concatenation (GG-57).
 *
 * `git diff` emits files in path order, so a positional cut spends the whole
 * budget alphabetically: on this repo's own release range every `src/` file
 * received zero patch text while `.agents/` scaffolding consumed the allowance.
 * The model was then told the diff was authoritative — while being shown the
 * least relevant part of the change.
 *
 * Allocation is max-min fair ("water-filling"): sections are served
 * smallest-first, each offered an equal share of what remains, and whatever a
 * small file doesn't need flows back to the larger ones. That fits as many
 * whole files as the budget allows while guaranteeing **no file is silently
 * invisible** — the FR-26 invariant, now enforced per file rather than per
 * patch. Ecosystem-neutral by design: no path is treated as more important
 * than another (see `docs/7-diff-grounding.md`).
 *
 * @param patch - Raw `git diff` output.
 * @param budget - Total characters available for the patch body.
 * @returns The capped patch, whether anything was cut, and which files were.
 */
export function capPatch(
  patch: string,
  budget: number,
): { text: string; truncated: boolean; trimmed: string[] } {
  const sections = splitPatchByFile(patch);
  // No recognizable file headers (or nothing to cut) — fall back to a plain cap.
  if (sections.length === 0 || patch.trim().length <= budget) {
    const capped = capText(patch, budget, 'diff truncated');
    return { text: capped.text, truncated: capped.truncated, trimmed: [] };
  }

  const allowance = new Map<string, number>();
  let remaining = budget;
  let unserved = sections.length;
  for (const section of [...sections].sort((a, b) => a.text.length - b.text.length)) {
    const fairShare = Math.floor(remaining / unserved);
    const granted = Math.min(section.text.length, fairShare);
    allowance.set(section.path, granted);
    remaining -= granted;
    unserved--;
  }

  const trimmed: string[] = [];
  const kept = sections.map(({ path, text }) => {
    const granted = allowance.get(path) ?? 0;
    if (granted >= text.length) return text.trimEnd();
    trimmed.push(path);
    return `${sliceToLine(text, granted)}\n… (${path} diff truncated)`;
  });

  return { text: kept.join('\n').trim(), truncated: trimmed.length > 0, trimmed };
}
