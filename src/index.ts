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

export {
  buildChangelog,
  DEFAULT_GROUPS,
  renderMarkdown,
  renderWorkingChanges,
} from './changelog.js';
export { latestTag, readCommits, readWorkingChanges, resolveCommitRange } from './git.js';
export { parseCommit, type RawCommit } from './parse.js';
export {
  buildTemplatePrompt,
  buildUserPrompt,
  cleanModelOutput,
  COMMIT_SYSTEM_PROMPT,
  commitsToMaterial,
  isEmptyNotesSentinel,
  NO_USER_FACING_CHANGES,
  stripCodeFences,
  SYSTEM_PROMPT,
  TEMPLATE_SYSTEM_PROMPT,
  workingChangesToMaterial,
} from './prompt.js';
export {
  type AIProvider,
  anthropicApiProvider,
  type AnthropicApiProviderConfig,
  appleProvider,
  type AppleProviderConfig,
  AUTO_LANGUAGE,
  AUTO_ORDER,
  claudeCliProvider,
  type CliProviderSpec,
  codexProvider,
  createAnthropicApiProvider,
  createAppleProvider,
  createCliProvider,
  createLocalProvider,
  DEFAULT_LOCAL_ENDPOINT,
  detectSystemLanguage,
  geminiProvider,
  type GenerateRequest,
  localProvider,
  type LocalProviderConfig,
  opencodeProvider,
  PROVIDERS,
  resolveProvider,
} from './providers/index.js';
export { generateReleaseNotes } from './releaseNotes.js';
export { loadTemplate, parseTemplate, type Template } from './template.js';
export type {
  Changelog,
  ChangelogOptions,
  ChangelogSection,
  Commit,
  OutputFormat,
  ProviderName,
  ReadCommitsOptions,
  ReleaseNotesOptions,
  WorkingChangeOptions,
  WorkingChanges,
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
