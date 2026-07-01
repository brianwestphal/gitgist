import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCommit, type RawCommit } from './parse.js';
import type { Commit, ReadCommitsOptions, WorkingChangeOptions, WorkingChanges } from './types.js';

const execFileAsync = promisify(execFile);

/** Generous output cap for git invocations (diffs can be large). */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Per-section diff cap (chars) so a huge diff can't blow up the prompt. */
const MAX_DIFF_CHARS = 8000;

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

/** Trim a diff to a sane length so a huge change can't dominate the prompt. */
function capDiff(diff: string): string {
  const trimmed = diff.trim();
  return trimmed.length > MAX_DIFF_CHARS
    ? `${trimmed.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)`
    : trimmed;
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
