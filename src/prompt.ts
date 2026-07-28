import type { Template } from './template.js';
import type { Commit, OutputFormat, RangeDiff, WorkingChanges } from './types.js';

/**
 * The exact sentinel the model is told to emit when a range has no user-facing
 * changes. Kept as a shared constant so the {@link SYSTEM_PROMPT} instruction
 * and the post-generation {@link isEmptyNotesSentinel} check can never drift.
 */
export const NO_USER_FACING_CHANGES = '_No user-facing changes._';

/**
 * Whether the model's (cleaned) notes output is exactly the empty-notes
 * sentinel. The orchestrator treats this as **suspect** when the range actually
 * contained commits — a possible model misfire rather than a real empty range.
 *
 * @param text - The cleaned model output.
 * @returns `true` when the output is the sentinel and nothing else.
 */
export function isEmptyNotesSentinel(text: string): boolean {
  return text.trim() === NO_USER_FACING_CHANGES;
}

/**
 * Shared rule block making the code diff — not the prose around it — the
 * authority for what changed (GG-50).
 *
 * Commit subjects, commit bodies, and changelog/documentation files in a range
 * describe what someone *intended*; only the patch shows what the code actually
 * does. gitgist feeds both, so the model needs an explicit precedence rule:
 * read the diff, and treat the prose as a hint that can be incomplete or wrong.
 *
 * Embedded verbatim in {@link SYSTEM_PROMPT}, {@link TEMPLATE_SYSTEM_PROMPT},
 * and {@link COMMIT_SYSTEM_PROMPT} so the rule can never drift between formats.
 */
export const DIFF_IS_SOURCE_OF_TRUTH_RULES = `- When a code diff is included below, it is the authoritative record of what changed. Commit subjects, commit bodies, and any changelog or documentation text are secondary — they state what someone intended or claimed, and can be incomplete, stale, or wrong. Read the diff and ground every statement in it.
- Report what the code actually does: describe user-facing changes that are visible in the diff even when no commit message mentions them, and drop or correct any claim the diff does not support. Where the diff and the prose disagree, the diff wins.
- Never describe a change you cannot point to in the material you were given. If the patch was truncated or some files were listed without their diff, summarize what you can see and say nothing about the parts you cannot.`;

/**
 * Shared rule block governing commit attribution (GG-58).
 *
 * When the commit list carries per-commit file lists, the model can tie a change
 * to the commit that made it. The risk is the obvious one: a model that knows
 * hashes exist will happily invent one. This says it may only use a hash it can
 * actually see.
 *
 * Embedded verbatim in {@link SYSTEM_PROMPT}, {@link TEMPLATE_SYSTEM_PROMPT},
 * and {@link COMMIT_SYSTEM_PROMPT} so the rule can never drift between formats.
 */
export const ATTRIBUTION_RULES = `- Each commit above may list the files it touched. Use that to work out which commit made a change, to group changes that touch the same files into one theme, and to read the order they landed in — commits are listed newest first.
- Only ever cite a commit hash that appears verbatim in the material above. Never guess, reconstruct, or invent a hash, and never cite one for a change you cannot tie to that commit's file list. If you are unsure which commit made a change, describe the change without a hash.
- Do not add hashes to the output unless the requested format asks for them; the file lists are there to help you reason, not to be echoed back.`;

/** Placeholder a `--commit-url` template must contain. */
export const COMMIT_URL_PLACEHOLDER = '{hash}';

/**
 * Build the rule that turns commit attribution into visible provenance (GG-59).
 *
 * {@link ATTRIBUTION_RULES} deliberately tells the model *not* to emit hashes
 * "unless the requested format asks for them" — this is the format asking. It is
 * appended to the system prompt only when `--link-commits` is set, so the
 * default output is unchanged.
 *
 * The multi-commit policy is stated outright rather than left to the model: a
 * bullet that merges several commits cites **all** of them, because citing only
 * one would misrepresent where the change came from.
 *
 * @param urlTemplate - A URL containing `{hash}`; omit for bare hashes.
 * @returns The rule block to append to a system prompt.
 */
export function buildCommitLinkRules(urlTemplate?: string): string {
  const cite =
    urlTemplate === undefined
      ? 'Cite it in parentheses at the end of the line, e.g. `- Added a retry flag (a1b2c3d)`.'
      : `Cite it in parentheses at the end of the line as a Markdown link, replacing ${COMMIT_URL_PLACEHOLDER} in \`${urlTemplate}\` with the hash, e.g. \`- Added a retry flag ([a1b2c3d](${urlTemplate.replace(COMMIT_URL_PLACEHOLDER, 'a1b2c3d')}))\`.`;
  return `- End every bullet with the commit it came from. ${cite}
- Work out which commit that is from the \`files:\` list under each commit: the change you are describing lives in a file, and the commit whose list contains that file is the commit that made it. Check the file before citing — a real hash on the wrong bullet is still wrong.
- When a bullet covers several commits, cite ALL of them, comma-separated inside the one set of parentheses — citing only one would misrepresent where the change came from.
- This overrides the instruction not to emit hashes: hashes are wanted here. The rule that you may only cite a hash appearing verbatim in the material still applies in full — if you cannot tie a change to a specific commit, write the bullet with no citation rather than guessing one.`;
}

/**
 * Shared rule block forbidding meta / cross-reference output (GG-51).
 *
 * Whenever a changelog or release-notes file is part of the input — an
 * `Unreleased` section being the common case — models are prone to emitting a
 * deferral instead of the change itself: a "Carried over from … — dedupe
 * against the draft above" section, a "see the changelog" pointer, or an
 * instruction telling the reader to reconcile two documents. gitgist's output
 * must always stand on its own and fully describe the software change;
 * de-duplicating against an existing `CHANGELOG.md` is an external tool's
 * responsibility and out of scope here.
 *
 * Embedded verbatim in {@link SYSTEM_PROMPT}, {@link TEMPLATE_SYSTEM_PROMPT},
 * and {@link COMMIT_SYSTEM_PROMPT} so the rule can never drift between formats.
 */
export const NO_CROSS_REFERENCE_RULES = `- Describe the software changes themselves; never write about the output or about other documents. Do NOT emit meta or cross-reference content of any kind — no "Carried over from …", "Previously announced", "Already in the changelog", "See also", or "dedupe against the draft above", and no instruction telling the reader to reconcile, merge, or de-duplicate anything. De-duplicating against an existing changelog is a separate tool's job and is out of scope for you.
- A changelog, release-notes, or other documentation file in the input is just another changed file. If the input already contains an entry for this work (e.g. an \`Unreleased\` section), treat it as evidence of what changed: describe that change in full, in your own words, in the place it belongs. Never defer to it, never assume the reader has seen it, and never drop or shorten a change because it already appears there.`;

/**
 * System prompt instructing the model to turn commits into grouped,
 * user-facing release notes. The sections are intentionally not fixed — the
 * model picks whatever headings best fit the actual changes.
 */
export const SYSTEM_PROMPT = `You are a release-notes generator. You are given git commits and/or uncommitted changes (diffs) from a repository. Write concise, user-facing release notes in Markdown that summarize what changed.

Rules:
- Output ONLY Markdown — no preamble, no explanation, no closing remarks, and do not wrap the whole thing in a code fence.
- Organize the changes under \`##\` section headings grouped by theme that fits THIS set of changes (for example: Features, Bug Fixes, Performance, UX, Documentation, Breaking Changes). Invent whatever sections describe the work best, and omit any section that would be empty. Order sections by impact, most important first; put "Breaking Changes" first whenever there are any.
- Each change goes in EXACTLY ONE section — never list the same change twice. A breaking change goes under "Breaking Changes" only; do not also (or instead) put it under "Features" or any other section.
- Each change is a single \`-\` bullet on one short, user-facing line. Combine several related commits into one bullet where that reads better.
- INCLUDE user-visible changes: new features, bug fixes, performance, UX, breaking changes, and notable behavior changes.
- EXCLUDE noise: ticket IDs, pure-internal refactors, test-only changes, CI/build tweaks, routine dependency bumps, and implementation detail.
${DIFF_IS_SOURCE_OF_TRUTH_RULES}
${ATTRIBUTION_RULES}
${NO_CROSS_REFERENCE_RULES}
- Scale the amount of detail to the volume of real user-facing work. Do not pad, and do not invent changes that are not present in the commits.
- If there are no user-facing changes, output exactly: \`${NO_USER_FACING_CHANGES}\``;

/**
 * System prompt for `--format commit`: produce a single Conventional Commit
 * message (subject + optional body + footer) instead of grouped release notes.
 */
export const COMMIT_SYSTEM_PROMPT = `You write git commit messages. You are given git commits and/or uncommitted changes (diffs). Produce ONE commit message that describes them, following the Conventional Commits standard.

Rules:
- Output ONLY the commit message — no preamble, no explanation, no Markdown headings, and do not wrap it in a code fence.
- First line is the subject: \`type(scope): description\`. The scope is optional. Use an imperative description ("add", not "added"/"adds"), no trailing period, and keep it to about 50 characters (72 max).
- Choose one type: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
- If the change is breaking, append \`!\` after the type/scope (e.g. \`feat!:\`) and add a \`BREAKING CHANGE: <what broke>\` footer.
- For anything beyond a trivial one-liner, add a blank line then a body: a few short bullet points or sentences explaining what changed and why. Wrap body lines at about 72 characters.
${DIFF_IS_SOURCE_OF_TRUTH_RULES}
${ATTRIBUTION_RULES}
${NO_CROSS_REFERENCE_RULES}
- Summarize the actual changes; do not invent anything not present in the input.`;

/**
 * System prompt for `--template`: produce release notes that follow a
 * user-supplied template exactly (strict section set, in order).
 */
export const TEMPLATE_SYSTEM_PROMPT = `You are a release-notes generator. You are given git commits and/or uncommitted changes (diffs), plus a TEMPLATE that defines the exact output format. Produce Markdown release notes that follow the template precisely.

Template rules:
- Use EXACTLY the section headings from the template, with the same wording, emoji, and order. Do NOT add, rename, reorder, merge, or split sections, and do NOT invent sections the template does not list.
- Omit a section entirely if it has no relevant changes — do not emit an empty section or a placeholder.
- Text inside HTML comments (\`<!-- ... -->\`) is guidance for the section directly above it: follow it to decide that section's content, but do NOT include the comments in your output.
- If the template has YAML frontmatter (a \`---\`-fenced block at the top), treat it as global directives — audience, tone, and what to include or exclude. Apply it, but do NOT output the frontmatter.
- Under each section, write concise, user-facing bullet points. Filter out noise (internal refactors, tests, CI tweaks, ticket IDs) unless the template's guidance says otherwise. Summarize the actual changes; do not invent anything.
${DIFF_IS_SOURCE_OF_TRUTH_RULES}
${ATTRIBUTION_RULES}
${NO_CROSS_REFERENCE_RULES}
- Output ONLY the rendered Markdown — no preamble, no surrounding code fence, no leftover template comments or frontmatter.`;

/**
 * Build the user prompt for template mode: the template followed by the change
 * material.
 *
 * @param template - The parsed template.
 * @param changesMaterial - The commit/working-change material (see {@link buildUserPrompt} / {@link workingChangesToMaterial}).
 * @returns The user-turn prompt string.
 */
export function buildTemplatePrompt(template: Template, changesMaterial: string): string {
  const frontmatter =
    template.frontmatter !== ''
      ? `Global directives (frontmatter):\n${template.frontmatter}\n\n`
      : '';
  return `TEMPLATE — follow it exactly (sections, order, wording):\n\n${frontmatter}${template.body}\n\n---\n\n${changesMaterial}`;
}

/**
 * Strip a single wrapping Markdown code fence from the model's output, if
 * present. Models sometimes wrap the whole response in triple-backtick fences.
 *
 * @param text - The raw model output.
 * @returns The unwrapped, trimmed text.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/;
  const match = fence.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

/** A Markdown heading line (`#` … `######` followed by a space). */
const HEADING_RE = /^#{1,6}\s/;
/** A "real content" line: heading, bullet, block quote, or table row. */
const CONTENT_RE = /^(?:#{1,6}\s|[-*+]\s|>\s|\|)/;
/** A Conventional Commit subject line. */
const COMMIT_SUBJECT_RE = /^[a-z]+(?:\([^)]+\))?!?:\s/i;

/**
 * Remove conversational preamble/postamble that an agentic CLI provider
 * (`claude -p`) can wrap around the requested output, despite the system
 * prompt. The cleanup is format-aware and conservative — it never strips when
 * it can't find the expected anchor, so on already-clean output (e.g. the
 * Anthropic API provider, or the `_No changes_` sentinel) it is a no-op.
 *
 * - `notes` / templated output starts with a Markdown heading: drop anything
 *   before the first heading, and any trailing lines after the last
 *   heading/bullet/quote/table line.
 * - `commit` output starts with a `type(scope): subject` line: drop anything
 *   before it. (The body is free-form, so the tail is left untouched.)
 *
 * @param text - The raw (fence-stripped) model output.
 * @param format - The expected output shape.
 * @returns The cleaned text.
 */
export function cleanModelOutput(text: string, format: OutputFormat): string {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  const lines = trimmed.split('\n');

  if (format === 'commit') {
    const subject = lines.findIndex((line) => COMMIT_SUBJECT_RE.test(line.trim()));
    if (subject <= 0) return trimmed; // not found, or already first — leave as-is
    return lines.slice(subject).join('\n').trim();
  }

  const firstHeading = lines.findIndex((line) => HEADING_RE.test(line));
  if (firstHeading === -1) return trimmed; // no heading (e.g. a sentinel) — leave as-is

  let end = lines.length - 1;
  while (end > firstHeading && !CONTENT_RE.test(lines[end].trimStart())) end--;
  return lines.slice(firstHeading, end + 1).join('\n').trim();
}

/**
 * A trailing parenthetical at the end of a line, e.g. `… (a1b2c3d)` or
 * `… (a1b2c3d, e4f5a6b)`. The contents are validated against real hashes before
 * anything is removed.
 */
const TRAILING_PARENS_RE = /\s*\(([^()]*)\)\s*$/;

/**
 * The Markdown-link citation shape, e.g. `… ([a1b2c3d](https://…/a1b2c3d))`,
 * which nests parentheses and so cannot match {@link TRAILING_PARENS_RE}.
 *
 * Only reachable if a model invents a commit URL it was never given — a model
 * that ignores the no-hashes rule the way `apple` does could, so it is covered.
 */
const TRAILING_LINKED_HASHES_RE = /\s*\(\s*((?:\[[^\]]*\]\([^()]*\)\s*,?\s*)+)\)\s*$/;

/** A bare hex token that could be an abbreviated commit hash. */
const HEX_TOKEN_RE = /^[0-9a-f]{7,40}$/i;

/**
 * Remove commit hashes the output was never supposed to carry (GG-63).
 *
 * {@link ATTRIBUTION_RULES} tells the model the per-commit file lists are for
 * reasoning and that hashes must not be echoed unless the format asks — and
 * `--link-commits` (FR-31) is the only thing that asks. A prompt is advisory
 * though, and the smallest backend (`apple`) ignores it: it appended a hash to
 * every bullet on a plain `--provider apple` run. This makes the guarantee
 * structural, so it holds regardless of how well a model follows instructions.
 *
 * False positives are ruled out by construction rather than by heuristics: a
 * parenthetical is only removed when **every** token inside it matches a hash
 * gitgist actually put in the prompt. So `(3x faster)`, `(#123)`, `(see docs)` —
 * and even a genuinely hex-shaped English word like `(defaced)` — are all left
 * alone, because they are not hashes from this range.
 *
 * @param text - The model's output.
 * @param hashes - Commit hashes from the range (full and/or abbreviated).
 * @returns The output with unrequested hash citations removed.
 */
export function stripUnrequestedHashes(text: string, hashes: readonly string[]): string {
  if (hashes.length === 0) return text;
  const known = new Set(hashes.map((h) => h.toLowerCase()));

  /** Whether `token` is an abbreviation of (or equal to) a hash we supplied. */
  const isKnownHash = (token: string): boolean => {
    if (!HEX_TOKEN_RE.test(token)) return false;
    const lower = token.toLowerCase();
    for (const hash of known) {
      if (hash.startsWith(lower) || lower.startsWith(hash)) return true;
    }
    return false;
  };

  return text
    .split('\n')
    .map((line) => {
      const match = TRAILING_PARENS_RE.exec(line) ?? TRAILING_LINKED_HASHES_RE.exec(line);
      if (match === null) return line;
      // Reduce each entry to its bare hash: drop a Markdown-link wrapper
      // (`[a1b2c3d](url)` → `a1b2c3d`) and any inline-code backticks.
      const tokens = match[1]
        .split(',')
        .map((part) =>
          part
            .trim()
            .replace(/^\[([^\]]*)\]\([^()]*\)$/, '$1')
            .replace(/^`|`$/g, ''),
        )
        .filter((part) => part !== '');
      if (tokens.length === 0 || !tokens.every(isKnownHash)) return line;
      return line.slice(0, match.index).trimEnd();
    })
    .join('\n');
}

/**
 * Default cap on how many paths are listed per commit in the attribution map.
 * A commit that touches fifty files says "broad change" just as well with ten
 * paths and a `+40 more` — and the remaining budget is better spent on the diff.
 */
const DEFAULT_MAX_ATTRIBUTED_FILES = 10;

/** Share of the diff budget the attribution map is allowed to consume. */
const ATTRIBUTION_BUDGET_SHARE = 0.15;

/** Rough chars per rendered path (`src/providers/anthropicApi.ts, `). */
const APPROX_PATH_CHARS = 30;

/**
 * How many paths to list per commit, given the diff budget the material has to
 * share (GG-58).
 *
 * The map is cheap but not free — on a 4000-char on-device budget the full
 * form would eat the entire allowance the diff needs. This keeps it to roughly
 * {@link ATTRIBUTION_BUDGET_SHARE} of the budget, shrinking the per-commit list
 * as the budget tightens or the range grows.
 *
 * @param budget - Char budget the diff material is working within.
 * @param commitCount - Commits in the range.
 * @returns Paths to list per commit, or `0` when even one per commit won't fit.
 */
export function attributionFilesPerCommit(budget: number, commitCount: number): number {
  if (commitCount <= 0) return 0;
  const allowance = budget * ATTRIBUTION_BUDGET_SHARE;
  const perCommit = Math.floor(allowance / (commitCount * APPROX_PATH_CHARS));
  return Math.min(perCommit, DEFAULT_MAX_ATTRIBUTED_FILES);
}

/** Which files each commit touched, for {@link commitsToMaterial} (GG-58). */
export interface CommitAttribution {
  /** Full commit hash → the paths it touched (`readCommitFiles`). */
  files: Map<string, string[]>;
  /** Max paths listed per commit before a `+N more` (default: 10). */
  maxFilesPerCommit?: number;
}

/**
 * Render commits as the material fed to the model: one bullet per commit
 * subject, with a truncated body indented beneath it when present.
 *
 * @param commits - The commits to format.
 * @returns The Markdown-ish material block.
 */
export function commitsToMaterial(commits: Commit[], attribution?: CommitAttribution): string {
  const perCommit = attribution?.files;
  const maxFiles = attribution?.maxFilesPerCommit ?? DEFAULT_MAX_ATTRIBUTED_FILES;
  return commits
    .map((commit) => {
      // The short hash rides along whenever an attribution map is present —
      // without it the model has no handle to attribute a change to (GG-58).
      let entry = perCommit === undefined ? `- ${commit.subject}` : `- ${commit.subject} (${commit.shortHash})`;
      const body = commit.body.trim();
      if (body.length > 0) {
        const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
        const indented = snippet
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        entry += `\n${indented}`;
      }
      const files = perCommit?.get(commit.hash);
      if (files !== undefined && files.length > 0) {
        const shown = files.slice(0, maxFiles);
        const overflow = files.length - shown.length;
        const more = overflow > 0 ? `, +${String(overflow)} more` : '';
        entry += `\n  files: ${shown.join(', ')}${more}`;
      }
      return entry;
    })
    .join('\n');
}

/**
 * Build the user prompt for a commit range.
 *
 * @param range - The git range the commits came from.
 * @param commits - The commits to summarize.
 * @returns The user-turn prompt string.
 */
export function buildUserPrompt(
  range: string,
  commits: Commit[],
  attribution?: CommitAttribution,
): string {
  const count = commits.length;
  const noun = count === 1 ? 'commit' : 'commits';
  return `Here ${count === 1 ? 'is' : 'are'} the ${String(count)} ${noun} in \`${range}\` (newest first):\n\n${commitsToMaterial(commits, attribution)}`;
}

/**
 * Build the prompt fragment carrying the range's actual code diff — the
 * evidence the summary must be grounded in (GG-50).
 *
 * The complete changed-file list and stat come first (they always survive the
 * char budget), then the patch. Anything held back — a truncated patch, or
 * files whose diff was dropped as generated/lockfile noise — is stated
 * explicitly, so the model knows the boundary of what it can claim rather than
 * guessing past it.
 *
 * @param diff - The range diff from `readRangeDiff`.
 * @returns A labeled block of diff material, or `''` when nothing changed.
 */
export function rangeDiffToMaterial(diff: RangeDiff): string {
  if (diff.isEmpty) return '';
  const count = diff.files.length;
  const noun = count === 1 ? 'file' : 'files';
  const parts = [
    `Code diff for \`${diff.range}\` — the authoritative record of what actually changed. Ground the summary in this, not in the commit messages above:`,
    `### Changed ${noun} (${String(count)})\n${diff.stat}`,
  ];
  if (diff.patch !== '') parts.push(`### Patch\n${diff.patch}`);
  if (diff.excluded.length > 0) {
    parts.push(
      `Note: these changed files are listed above but their diff was omitted as generated/lockfile noise — do not describe their contents: ${diff.excluded.join(', ')}`,
    );
  }
  if (diff.trimmedFiles.length > 0) {
    parts.push(
      `Note: every changed file above appears in the patch, but these had their diff shortened to fit — you are seeing part of each, not all of it: ${diff.trimmedFiles.join(', ')}`,
    );
  }
  if (diff.truncated) {
    parts.push(
      'Note: the patch above was truncated to fit. Summarize only what is visible in it; do not speculate about the omitted portion.',
    );
  }
  return parts.join('\n\n');
}

/**
 * Build the prompt fragment describing uncommitted (working-tree) changes.
 *
 * @param working - The working changes gathered by `readWorkingChanges`.
 * @returns A labeled block of the diff material.
 */
export function workingChangesToMaterial(working: WorkingChanges): string {
  const parts = [
    `Uncommitted changes (not yet committed) — summarize what they do for the reader:\n\n${working.diff}`,
  ];
  // Same honesty contract as rangeDiffToMaterial (GG-54): name what was held
  // back rather than letting the model assume it saw everything.
  if (working.excluded.length > 0) {
    parts.push(
      `Note: these uncommitted files changed but their diff was omitted as generated/lockfile noise — do not describe their contents: ${working.excluded.join(', ')}`,
    );
  }
  if (working.trimmedFiles.length > 0) {
    parts.push(
      `Note: these uncommitted files had their diff shortened to fit — you are seeing part of each, not all of it: ${working.trimmedFiles.join(', ')}`,
    );
  }
  if (working.truncated) {
    parts.push(
      'Note: the uncommitted diff above was truncated to fit. Summarize only what is visible in it; do not speculate about the omitted portion.',
    );
  }
  return parts.join('\n\n');
}
