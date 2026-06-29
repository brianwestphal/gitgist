import { buildChangelog, renderMarkdown, renderWorkingChanges } from './changelog.js';
import { readCommits, readWorkingChanges, resolveCommitRange } from './git.js';
import {
  buildTemplatePrompt,
  buildUserPrompt,
  cleanModelOutput,
  COMMIT_SYSTEM_PROMPT,
  isEmptyNotesSentinel,
  SYSTEM_PROMPT,
  TEMPLATE_SYSTEM_PROMPT,
  workingChangesToMaterial,
} from './prompt.js';
import { resolveProvider } from './providers/index.js';
import { loadTemplate } from './template.js';
import type { Commit, ProviderName, ReleaseNotesOptions, WorkingChanges } from './types.js';

/** Format an unknown thrown value as a short message for a warning line. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a string is set and non-empty (an explicit fallback override). */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

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

  const warn = options.warn ?? ((m: string): void => void process.stderr.write(`gitgist: ${m}\n`));

  // A configured secondary provider/endpoint/model to retry with on a primary
  // error or likely-invalid response. Each unset field inherits the primary's.
  const hasFallback =
    options.fallbackProvider !== undefined ||
    isSet(options.fallbackEndpoint) ||
    isSet(options.fallbackModel);

  // One AI round-trip with an explicit provider config: resolve, generate,
  // clean. The three AI paths below differ only in system + user prompt.
  const runProvider = async (
    provider: ProviderName | undefined,
    endpoint: string | undefined,
    model: string | undefined,
    system: string,
    prompt: string,
  ): Promise<string> => {
    const resolved = await resolveProvider(provider, {
      endpoint,
      model,
      language: options.language,
    });
    const generated = await resolved.generate({
      system,
      prompt,
      model,
      maxTokens: options.maxTokens,
    });
    return cleanModelOutput(generated, format);
  };

  const runFallback = (system: string, prompt: string): Promise<string> =>
    runProvider(
      options.fallbackProvider ?? options.provider,
      options.fallbackEndpoint ?? options.endpoint,
      options.fallbackModel ?? options.model,
      system,
      prompt,
    );

  // Generate with the primary provider, retrying once with the configured
  // fallback when the primary errors or returns a likely-invalid response
  // (`isInvalid`). Returns the best result and whether it is still suspect — the
  // caller decides what a suspect result means (the notes path falls back to the
  // deterministic changelog; commit/template use `() => false`, so they never
  // flag suspect and only the on-error retry applies).
  const generateViaAI = async (
    system: string,
    prompt: string,
    isInvalid: (out: string) => boolean,
  ): Promise<{ text: string; suspect: boolean }> => {
    let primary: string;
    try {
      primary = await runProvider(options.provider, options.endpoint, options.model, system, prompt);
    } catch (error) {
      if (!hasFallback) throw error;
      warn(`primary provider failed (${errorMessage(error)}); retrying with the fallback provider.`);
      const text = await runFallback(system, prompt);
      return { text, suspect: isInvalid(text) };
    }

    if (!isInvalid(primary)) return { text: primary, suspect: false };
    if (!hasFallback) return { text: primary, suspect: true };

    warn('primary provider returned no user-facing changes for a non-empty range; retrying with the fallback provider.');
    try {
      const text = await runFallback(system, prompt);
      return { text, suspect: isInvalid(text) };
    } catch (error) {
      warn(`fallback provider failed (${errorMessage(error)}); keeping the primary result.`);
      return { text: primary, suspect: true };
    }
  };

  // Deterministic Conventional-Commit notes (the `--no-ai` rendering), reused as
  // the final safety net when an AI notes run stays suspect.
  const buildDeterministicNotes = (): string => {
    const pieces: string[] = [];
    if (haveCommits) pieces.push(renderMarkdown(buildChangelog(range, commits)).trimEnd());
    if (haveWorking && working !== undefined) pieces.push(renderWorkingChanges(working));
    return pieces.join('\n\n');
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
    ({ text: body } = await generateViaAI(
      COMMIT_SYSTEM_PROMPT,
      buildPromptMaterial(commits, working),
      () => false,
    ));
  } else if (options.template !== undefined) {
    if (options.ai === false) {
      throw new Error('--template requires AI; remove --no-ai.');
    }
    const template = await loadTemplate(options.template, cwd);
    ({ text: body } = await generateViaAI(
      TEMPLATE_SYSTEM_PROMPT,
      buildTemplatePrompt(template, buildPromptMaterial(commits, working)),
      () => false,
    ));
  } else if (options.ai === false) {
    body = buildDeterministicNotes();
  } else {
    // Notes path: a returned empty-notes sentinel is suspect when the range
    // actually had commits — try the fallback provider, then the deterministic
    // changelog rather than silently trusting it (GG-39).
    const notesInvalid = (out: string): boolean => haveCommits && isEmptyNotesSentinel(out);
    const { text, suspect } = await generateViaAI(
      SYSTEM_PROMPT,
      buildPromptMaterial(commits, working),
      notesInvalid,
    );
    if (suspect) {
      const noun = commits.length === 1 ? 'commit' : 'commits';
      warn(
        `model reported no user-facing changes for ${String(commits.length)} ${noun} in \`${range}\` — falling back to the deterministic changelog. Re-run, set --fallback-provider/--fallback-model, or use --no-ai if that is correct.`,
      );
      body = buildDeterministicNotes();
    } else {
      body = text;
    }
  }

  // A commit message has no Markdown title; only notes get the `--title` heading.
  const title = options.title;
  const heading =
    format !== 'commit' && title !== undefined && title !== '' ? `# ${title}\n\n` : '';
  return `${heading}${body}\n`;
}
