import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCommit, type RawCommit } from './parse.js';
import type { Commit, ReadCommitsOptions } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Field and record separators for the `git log` pretty format. Both are control
 * characters that will not appear in commit text, so we can split safely.
 */
const FIELD_SEP = '';
const RECORD_SEP = '';

const PRETTY_FORMAT = ['%H', '%an', '%aI', '%s', '%b'].join(FIELD_SEP) + RECORD_SEP;

/**
 * Read and parse all commits in a git range.
 *
 * @param range - A git revision range, e.g. `v1.0.0..HEAD` or `HEAD~10..HEAD`.
 * @param options - Optional repository location.
 * @returns The parsed commits, newest first (git's default order).
 */
export async function readCommits(range: string, options: ReadCommitsOptions = {}): Promise<Commit[]> {
  const cwd = options.cwd ?? process.cwd();

  const { stdout } = await execFileAsync(
    'git',
    ['log', `--pretty=format:${PRETTY_FORMAT}`, range],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );

  return stdout
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, author, date, subject, body = ''] = record.split(FIELD_SEP);
      const raw: RawCommit = { hash, author, date, subject, body: body.trim() };
      return parseCommit(raw);
    });
}
