import { buildChangelog, renderMarkdown } from './changelog.js';
import { readCommits, resolveCommitRange } from './git.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { resolveProvider } from './providers/index.js';
import type { ReleaseNotesOptions } from './types.js';

/**
 * Generate release notes for a commit range, using AI to organize the changes
 * into themed Markdown sections (Features, Bug Fixes, …).
 *
 * The flow is: resolve the range → read commits → either ask the AI provider to
 * write grouped notes, or (with `ai: false`) group deterministically by
 * Conventional Commit type.
 *
 * @param options - Range, provider, and rendering options.
 * @returns The rendered Markdown release notes.
 */
export async function generateReleaseNotes(options: ReleaseNotesOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const range = options.range ?? (await resolveCommitRange(options.from, options.to, cwd));
  const commits = await readCommits(range, { cwd });

  let body: string;
  if (commits.length === 0) {
    body = `_No changes in \`${range}\`._`;
  } else if (options.ai === false) {
    body = renderMarkdown(buildChangelog(range, commits)).trimEnd();
  } else {
    const provider = await resolveProvider(options.provider);
    const generated = await provider.generate({
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(range, commits),
      model: options.model,
      maxTokens: options.maxTokens,
    });
    body = generated.trim();
  }

  const title = options.title;
  const heading = title !== undefined && title !== '' ? `# ${title}\n\n` : '';
  return `${heading}${body}\n`;
}
