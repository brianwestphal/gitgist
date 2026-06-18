import type { Template } from './template.js';
import type { Commit, OutputFormat, WorkingChanges } from './types.js';

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
- Scale the amount of detail to the volume of real user-facing work. Do not pad, and do not invent changes that are not present in the commits.
- If there are no user-facing changes, output exactly: \`_No user-facing changes._\``;

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
 * Render commits as the material fed to the model: one bullet per commit
 * subject, with a truncated body indented beneath it when present.
 *
 * @param commits - The commits to format.
 * @returns The Markdown-ish material block.
 */
export function commitsToMaterial(commits: Commit[]): string {
  return commits
    .map((commit) => {
      let entry = `- ${commit.subject}`;
      const body = commit.body.trim();
      if (body.length > 0) {
        const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
        const indented = snippet
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        entry += `\n${indented}`;
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
export function buildUserPrompt(range: string, commits: Commit[]): string {
  const count = commits.length;
  const noun = count === 1 ? 'commit' : 'commits';
  return `Here ${count === 1 ? 'is' : 'are'} the ${String(count)} ${noun} in \`${range}\`:\n\n${commitsToMaterial(commits)}`;
}

/**
 * Build the prompt fragment describing uncommitted (working-tree) changes.
 *
 * @param working - The working changes gathered by `readWorkingChanges`.
 * @returns A labeled block of the diff material.
 */
export function workingChangesToMaterial(working: WorkingChanges): string {
  return `Uncommitted changes (not yet committed) — summarize what they do for the reader:\n\n${working.diff}`;
}
