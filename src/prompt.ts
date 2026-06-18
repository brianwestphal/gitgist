import type { Commit } from './types.js';

/**
 * System prompt instructing the model to turn commits into grouped,
 * user-facing release notes. The sections are intentionally not fixed — the
 * model picks whatever headings best fit the actual changes.
 */
export const SYSTEM_PROMPT = `You are a release-notes generator. You are given the git commits between two points in a repository's history. Write concise, user-facing release notes in Markdown.

Rules:
- Output ONLY Markdown — no preamble, no explanation, no closing remarks, and do not wrap the whole thing in a code fence.
- Organize the changes under \`##\` section headings grouped by theme that fits THIS set of changes (for example: Features, Bug Fixes, Performance, UX, Documentation, Breaking Changes). Invent whatever sections describe the work best, and omit any section that would be empty. Order sections by impact, most important first; put "Breaking Changes" first whenever there are any.
- Each change is a single \`-\` bullet on one short, user-facing line. Combine several related commits into one bullet where that reads better.
- INCLUDE user-visible changes: new features, bug fixes, performance, UX, breaking changes, and notable behavior changes.
- EXCLUDE noise: ticket IDs, pure-internal refactors, test-only changes, CI/build tweaks, routine dependency bumps, and implementation detail.
- Scale the amount of detail to the volume of real user-facing work. Do not pad, and do not invent changes that are not present in the commits.
- If there are no user-facing changes, output exactly: \`_No user-facing changes._\``;

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
