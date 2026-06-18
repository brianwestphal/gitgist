import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCommit, type RawCommit } from './parse.js';
import type { Commit, ReadCommitsOptions } from './types.js';

const execFileAsync = promisify(execFile);

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
    { cwd, maxBuffer: 64 * 1024 * 1024 },
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
