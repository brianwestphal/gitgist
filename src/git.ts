import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCommit, type RawCommit } from './parse.js';
import type {
  Commit,
  RangeDiff,
  RangeDiffOptions,
  ReadCommitsOptions,
  WorkingChangeOptions,
  WorkingChanges,
} from './types.js';

const execFileAsync = promisify(execFile);

/** Generous output cap for git invocations (diffs can be large). */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Per-section diff cap (chars) so a huge diff can't blow up the prompt. */
const MAX_DIFF_CHARS = 8000;

/** Default char budget for a commit range's patch body. */
const DEFAULT_MAX_RANGE_DIFF_CHARS = 24000;

/** Char budget for the per-file stat. Kept well under the patch budget — it is a summary. */
const MAX_STAT_CHARS = 4000;

/**
 * Git's canonical empty-tree object id. Diffing it against a single revision
 * yields "everything up to that revision" — the right base when the repository
 * has no tag to start from and the range is a bare rev (see
 * {@link resolveCommitRange}).
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Paths whose diff *content* is noise in release notes: lockfiles, build
 * output, vendored dependencies, and generated assets. They are excluded from
 * the patch body so the character budget goes to real source, but they stay in
 * the changed-file list and the stat — the model still learns that they changed
 * (and is told which ones were held back), just not line by line.
 */
const NOISE_PATHSPECS = [
  ':(exclude)*.lock',
  ':(exclude)*lock.json',
  ':(exclude)*lock.yaml',
  ':(exclude)*.min.js',
  ':(exclude)*.min.css',
  ':(exclude)*.map',
  ':(exclude)*.snap',
  ':(exclude)dist/*',
  ':(exclude)build/*',
  ':(exclude)vendor/*',
  ':(exclude)node_modules/*',
];

/**
 * Field separator for the `git log` pretty format — a control character that is
 * vanishingly unlikely to appear in commit text. Records are separated by NUL
 * via `git log -z` (a byte git guarantees cannot appear in its data), so even a
 * commit body containing this field separator can't corrupt record boundaries,
 * and we defensively rejoin any extra split fields back into the body.
 */
const FIELD_SEP = '';

/** Number of leading fixed fields before the free-form body (`%b`). */
const FIXED_FIELDS = 4;

const PRETTY_FORMAT = ['%H', '%an', '%aI', '%s', '%b'].join(FIELD_SEP);

/**
 * Read and parse all commits in a git range.
 *
 * @param range - A git revision range, e.g. `v1.0.0..HEAD` or `HEAD~10..HEAD`.
 * @param options - Optional repository location.
 * @returns The parsed commits, newest first (git's default order).
 */
export async function readCommits(range: string, options: ReadCommitsOptions = {}): Promise<Commit[]> {
  const cwd = options.cwd ?? process.cwd();

  // `-z` separates commits with NUL — robust against any character (including
  // the field separator and newlines) appearing inside a commit message.
  const { stdout } = await execFileAsync(
    'git',
    ['log', '-z', `--pretty=format:${PRETTY_FORMAT}`, range],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );

  return stdout
    .split('\0')
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const fields = record.split(FIELD_SEP);
      const [hash, author, date, subject] = fields;
      // Rejoin any trailing fields so a body that itself contains FIELD_SEP is
      // preserved rather than truncated.
      const body = fields.slice(FIXED_FIELDS).join(FIELD_SEP);
      const raw: RawCommit = { hash, author, date, subject, body: body.trim() };
      return parseCommit(raw);
    });
}

/**
 * Find the most recent tag reachable from `HEAD`.
 *
 * @param cwd - Repository directory (default: `process.cwd()`).
 * @returns The tag name, or `null` if the repository has no tags.
 */
export async function latestTag(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], { cwd });
    const tag = stdout.trim();
    return tag === '' ? null : tag;
  } catch {
    // `git describe` exits non-zero when there are no tags — treat as "no tag".
    return null;
  }
}

/**
 * Resolve a `from`/`to` pair into a git revision range.
 *
 * `to` defaults to `HEAD`. `from` defaults to the most recent tag; if the
 * repository has no tags, the range is just `to` (the full history up to it).
 *
 * @param from - Range start (e.g. a tag), or `undefined` to auto-detect.
 * @param to - Range end, or `undefined` for `HEAD`.
 * @param cwd - Repository directory (default: `process.cwd()`).
 * @returns A range usable with {@link readCommits}.
 */
export async function resolveCommitRange(
  from: string | undefined,
  to: string | undefined,
  cwd: string = process.cwd(),
): Promise<string> {
  const target = to ?? 'HEAD';
  const base = from ?? (await latestTag(cwd));
  return base === null ? target : `${base}..${target}`;
}

/** NUL-separated file list from a git command (empties filtered). */
async function gitNames(args: string[], cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER });
  return stdout.split('\0').filter((name) => name.length > 0);
}

/** Trim text to a char budget, appending `note` when anything was cut. */
function capText(text: string, maxChars: number, note: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, maxChars)}\n… (${note})`, truncated: true };
}

/** Trim a diff to a sane length so a huge change can't dominate the prompt. */
function capDiff(diff: string): string {
  return capText(diff, MAX_DIFF_CHARS, 'diff truncated').text;
}

/**
 * Turn a `git log`-style range into the revision arguments `git diff` needs.
 *
 * `git log a..b` lists the commits reachable from `b` but not `a`; the diff
 * that corresponds to exactly those commits is the merge-base form `a...b`
 * (identical to `a..b` on the linear histories this normally runs against, but
 * correct when the branches diverged). A bare revision — what
 * {@link resolveCommitRange} returns for an untagged repository — means "all
 * history up to here", so it diffs against the empty tree.
 *
 * @param range - The range handed to {@link readCommits}.
 * @returns Revision arguments for `git diff`.
 */
function rangeToDiffArgs(range: string): string[] {
  if (range.includes('...')) return [range];
  const separator = range.indexOf('..');
  if (separator !== -1) {
    const from = range.slice(0, separator);
    const to = range.slice(separator + 2);
    return [`${from}...${to === '' ? 'HEAD' : to}`];
  }
  return [EMPTY_TREE, range];
}

/**
 * Read the **actual code change** for a commit range: the changed-file list,
 * the per-file stat, and the unified patch (minus generated/lockfile noise).
 *
 * This is what lets gitgist describe what the code *does* rather than what the
 * commit log and changelog *claim* it does — commit subjects are a summary
 * written by a human before review, and documentation files in a range restate
 * intent rather than behavior. The patch is the evidence.
 *
 * The changed-file list is always complete; only the patch body is trimmed to
 * {@link RangeDiffOptions.maxChars}, so a huge range degrades to "here is every
 * file that changed, and as much of the diff as fits" rather than to nothing.
 *
 * @param range - A git revision range, e.g. `v1.0.0..HEAD`, or a bare revision.
 * @param options - Repository location and the patch char budget.
 * @returns The changed files, stat, capped patch, and what was held back.
 */
export async function readRangeDiff(
  range: string,
  options: RangeDiffOptions = {},
): Promise<RangeDiff> {
  const cwd = options.cwd ?? process.cwd();
  const maxChars = options.maxChars ?? DEFAULT_MAX_RANGE_DIFF_CHARS;
  const revs = rangeToDiffArgs(range);

  const files = await gitNames(['diff', '--name-only', '-z', ...revs], cwd);
  if (files.length === 0) {
    return { range, files, stat: '', patch: '', excluded: [], truncated: false, isEmpty: true };
  }

  const { stdout: statOut } = await execFileAsync(
    'git',
    ['diff', '--stat=200', '--no-color', ...revs],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );
  const { stdout: patchOut } = await execFileAsync(
    'git',
    ['diff', '--no-color', ...revs, '--', ...NOISE_PATHSPECS],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );
  // Which files survived the noise pathspecs — the rest changed but contribute
  // no patch text, and the material says so explicitly.
  const patched = new Set(
    await gitNames(['diff', '--name-only', '-z', ...revs, '--', ...NOISE_PATHSPECS], cwd),
  );

  const stat = capText(statOut, MAX_STAT_CHARS, 'file list truncated');
  const patch = capText(patchOut, maxChars, `patch truncated at ${String(maxChars)} characters`);

  return {
    range,
    files,
    stat: stat.text,
    patch: patch.text,
    excluded: files.filter((file) => !patched.has(file)),
    truncated: stat.truncated || patch.truncated,
    isEmpty: false,
  };
}

/** Diff of a single untracked file against /dev/null (shows it as all-added). */
async function untrackedDiff(path: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--no-index', '--', '/dev/null', path],
      { cwd, maxBuffer: GIT_MAX_BUFFER },
    );
    // Defensive: `git diff --no-index /dev/null <file>` always reports a new
    // file (mode/index differ, even for an empty file) and so always exits
    // non-zero — the diff arrives via the catch below, never here.
    /* v8 ignore next */
    return stdout;
  } catch (err: unknown) {
    // `git diff --no-index` exits 1 whenever the files differ — which is always
    // for a new file — and the diff itself is on stdout of the rejected call.
    if (typeof err === 'object' && err !== null && 'stdout' in err) {
      const { stdout } = err as { stdout?: unknown };
      if (typeof stdout === 'string') return stdout;
    }
    // Defensive: real `git diff --no-index` always attaches the diff to the
    // rejected call's `stdout`, so this fallback is effectively unreachable.
    /* v8 ignore next */
    return `new file: ${path}`;
  }
}

/**
 * Read uncommitted changes from the working tree, for summarizing pending work
 * (e.g. to draft a commit message) or to fold into release notes alongside the
 * committed history.
 *
 * @param options - Which categories (staged / unstaged / untracked) to gather.
 * @returns The changed file paths per category plus formatted diff material.
 */
export async function readWorkingChanges(options: WorkingChangeOptions = {}): Promise<WorkingChanges> {
  const cwd = options.cwd ?? process.cwd();
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  const sections: string[] = [];

  if (options.staged === true) {
    staged.push(...(await gitNames(['diff', '--staged', '--name-only', '-z'], cwd)));
    const { stdout } = await execFileAsync('git', ['diff', '--staged', '--no-color'], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    });
    const diff = capDiff(stdout);
    if (diff !== '') sections.push(`### Staged changes\n${diff}`);
  }

  if (options.unstaged === true) {
    unstaged.push(...(await gitNames(['diff', '--name-only', '-z'], cwd)));
    const { stdout } = await execFileAsync('git', ['diff', '--no-color'], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    });
    const diff = capDiff(stdout);
    if (diff !== '') sections.push(`### Unstaged changes\n${diff}`);
  }

  if (options.untracked === true) {
    untracked.push(...(await gitNames(['ls-files', '--others', '--exclude-standard', '-z'], cwd)));
    const parts: string[] = [];
    for (const path of untracked) {
      parts.push(await untrackedDiff(path, cwd));
    }
    const diff = capDiff(parts.join('\n'));
    if (diff !== '') sections.push(`### New (untracked) files\n${diff}`);
  }

  return {
    staged,
    unstaged,
    untracked,
    diff: sections.join('\n\n'),
    isEmpty: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  };
}
