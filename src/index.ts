/**
 * gitgist — generate release notes and changelogs from a range of git commits.
 *
 * The typical flow is {@link readCommits} (read a range from git) →
 * {@link buildChangelog} (group by Conventional Commit type) →
 * {@link renderMarkdown} (emit a Markdown document). {@link generateChangelog}
 * wires the three together for the common case.
 */
import { buildChangelog, renderMarkdown } from './changelog.js';
import { readCommits } from './git.js';
import type { ChangelogOptions, ReadCommitsOptions } from './types.js';

export { buildChangelog, DEFAULT_GROUPS, renderMarkdown } from './changelog.js';
export { readCommits } from './git.js';
export { parseCommit, type RawCommit } from './parse.js';
export type {
  Changelog,
  ChangelogOptions,
  ChangelogSection,
  Commit,
  ReadCommitsOptions,
} from './types.js';

/**
 * Read a git range and render it directly to a Markdown changelog.
 *
 * @param range - A git revision range, e.g. `v1.0.0..HEAD`.
 * @param options - Combined read and rendering options.
 * @returns The rendered Markdown changelog.
 */
export async function generateChangelog(
  range: string,
  options: ReadCommitsOptions & ChangelogOptions = {},
): Promise<string> {
  const commits = await readCommits(range, options);
  const changelog = buildChangelog(range, commits, options);
  return renderMarkdown(changelog, options);
}
