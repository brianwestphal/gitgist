import { buildChangelog, renderMarkdown, renderWorkingChanges } from './changelog.js';
import { readCommits, readWorkingChanges, resolveCommitRange } from './git.js';
import { buildUserPrompt, SYSTEM_PROMPT, workingChangesToMaterial } from './prompt.js';
import { resolveProvider } from './providers/index.js';
import type { ReleaseNotesOptions, WorkingChanges } from './types.js';

/**
 * Generate release notes for a commit range and/or the uncommitted working
 * tree, using AI to organize the changes into themed Markdown sections.
 *
 * The flow is: resolve what to summarize → read commits and/or working changes →
 * either ask the AI provider to write grouped notes, or (with `ai: false`) group
 * commits deterministically by Conventional Commit type and list working-tree
 * files.
 *
 * Working-tree flags (`staged` / `unstaged` / `untracked`): when used **without**
 * an explicit range they summarize only the pending changes (handy for drafting
 * a commit message); when used **with** a range they're folded in alongside the
 * commits.
 *
 * @param options - Range, working-tree, provider, and rendering options.
 * @returns The rendered Markdown release notes.
 */
export async function generateReleaseNotes(options: ReleaseNotesOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();

  const wantWorking =
    options.staged === true || options.unstaged === true || options.untracked === true;
  const explicitRange =
    options.range !== undefined || options.from !== undefined || options.to !== undefined;

  // Read commits unless we're summarizing pending changes only (working flags
  // with no explicit range).
  let range = '';
  let commits = [] as Awaited<ReturnType<typeof readCommits>>;
  if (!wantWorking || explicitRange) {
    range = options.range ?? (await resolveCommitRange(options.from, options.to, cwd));
    commits = await readCommits(range, { cwd });
  }

  let working: WorkingChanges | undefined;
  if (wantWorking) {
    working = await readWorkingChanges({
      cwd,
      staged: options.staged,
      unstaged: options.unstaged,
      untracked: options.untracked,
    });
  }

  const haveCommits = commits.length > 0;
  const haveWorking = working !== undefined && !working.isEmpty;

  let body: string;
  if (!haveCommits && !haveWorking) {
    body =
      wantWorking && !explicitRange
        ? '_No uncommitted changes._'
        : `_No changes in \`${range}\`._`;
  } else if (options.ai === false) {
    const pieces: string[] = [];
    if (haveCommits) pieces.push(renderMarkdown(buildChangelog(range, commits)).trimEnd());
    if (haveWorking && working !== undefined) pieces.push(renderWorkingChanges(working));
    body = pieces.join('\n\n');
  } else {
    const provider = await resolveProvider(options.provider);
    const parts: string[] = [];
    if (haveCommits) parts.push(buildUserPrompt(range, commits));
    if (haveWorking && working !== undefined) parts.push(workingChangesToMaterial(working));
    const generated = await provider.generate({
      system: SYSTEM_PROMPT,
      prompt: parts.join('\n\n'),
      model: options.model,
      maxTokens: options.maxTokens,
    });
    body = generated.trim();
  }

  const title = options.title;
  const heading = title !== undefined && title !== '' ? `# ${title}\n\n` : '';
  return `${heading}${body}\n`;
}
