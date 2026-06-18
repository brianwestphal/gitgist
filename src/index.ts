/**
 * gitgist — generate AI-powered release notes / changelogs from a range of git
 * commits.
 *
 * Primary entry point: {@link generateReleaseNotes}, which reads a commit range
 * and asks an AI provider (Claude) to organize the changes into themed Markdown
 * sections. Pass `ai: false` for a deterministic, offline Conventional Commits
 * grouping ({@link generateChangelog}).
 */
import { buildChangelog, renderMarkdown } from './changelog.js';
import { readCommits } from './git.js';
import type { ChangelogOptions, ReadCommitsOptions } from './types.js';

export { buildChangelog, DEFAULT_GROUPS, renderMarkdown } from './changelog.js';
export { latestTag, readCommits, resolveCommitRange } from './git.js';
export { parseCommit, type RawCommit } from './parse.js';
export {
  buildUserPrompt,
  commitsToMaterial,
  stripCodeFences,
  SYSTEM_PROMPT,
} from './prompt.js';
export {
  type AIProvider,
  anthropicApiProvider,
  claudeCliProvider,
  type GenerateRequest,
  PROVIDERS,
  resolveProvider,
} from './providers/index.js';
export { generateReleaseNotes } from './releaseNotes.js';
export type {
  Changelog,
  ChangelogOptions,
  ChangelogSection,
  Commit,
  ProviderName,
  ReadCommitsOptions,
  ReleaseNotesOptions,
} from './types.js';

/**
 * Read a git range and render it directly to a deterministic Markdown changelog
 * grouped by Conventional Commit type — no AI involved. For AI-organized notes,
 * use {@link generateReleaseNotes}.
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
