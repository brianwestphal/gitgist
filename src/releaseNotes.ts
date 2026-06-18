import { buildChangelog, renderMarkdown, renderWorkingChanges } from './changelog.js';
import { readCommits, readWorkingChanges, resolveCommitRange } from './git.js';
import {
  buildTemplatePrompt,
  buildUserPrompt,
  cleanModelOutput,
  COMMIT_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  TEMPLATE_SYSTEM_PROMPT,
  workingChangesToMaterial,
} from './prompt.js';
import { resolveProvider } from './providers/index.js';
import { loadTemplate } from './template.js';
import type { Commit, ReleaseNotesOptions, WorkingChanges } from './types.js';

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
  let commits: Commit[] = [];
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
  const format = options.format ?? 'notes';

  // Build the AI material (commit messages + working-tree diffs) once.
  const buildPromptMaterial = (commitList: Commit[], wc: WorkingChanges | undefined): string => {
    const parts: string[] = [];
    if (commitList.length > 0) parts.push(buildUserPrompt(range, commitList));
    if (wc !== undefined && !wc.isEmpty) parts.push(workingChangesToMaterial(wc));
    return parts.join('\n\n');
  };

  // One AI round-trip: resolve the provider, generate, clean the output. The
  // three AI paths below differ only in the system prompt and the user prompt.
  const generateViaAI = async (system: string, prompt: string): Promise<string> => {
    const provider = await resolveProvider(options.provider, {
      endpoint: options.endpoint,
      model: options.model,
    });
    const generated = await provider.generate({
      system,
      prompt,
      model: options.model,
      maxTokens: options.maxTokens,
    });
    return cleanModelOutput(generated, format);
  };

  if (options.template !== undefined && format === 'commit') {
    throw new Error('--template cannot be combined with --format commit.');
  }

  let body: string;
  if (!haveCommits && !haveWorking) {
    body =
      wantWorking && !explicitRange
        ? '_No uncommitted changes._'
        : `_No changes in \`${range}\`._`;
  } else if (format === 'commit') {
    if (options.ai === false) {
      throw new Error('--format commit requires AI; remove --no-ai.');
    }
    body = await generateViaAI(COMMIT_SYSTEM_PROMPT, buildPromptMaterial(commits, working));
  } else if (options.template !== undefined) {
    if (options.ai === false) {
      throw new Error('--template requires AI; remove --no-ai.');
    }
    const template = await loadTemplate(options.template, cwd);
    body = await generateViaAI(
      TEMPLATE_SYSTEM_PROMPT,
      buildTemplatePrompt(template, buildPromptMaterial(commits, working)),
    );
  } else if (options.ai === false) {
    const pieces: string[] = [];
    if (haveCommits) pieces.push(renderMarkdown(buildChangelog(range, commits)).trimEnd());
    if (haveWorking && working !== undefined) pieces.push(renderWorkingChanges(working));
    body = pieces.join('\n\n');
  } else {
    body = await generateViaAI(SYSTEM_PROMPT, buildPromptMaterial(commits, working));
  }

  // A commit message has no Markdown title; only notes get the `--title` heading.
  const title = options.title;
  const heading =
    format !== 'commit' && title !== undefined && title !== '' ? `# ${title}\n\n` : '';
  return `${heading}${body}\n`;
}
