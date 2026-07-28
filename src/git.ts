import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  capPatch,
  capText,
  DEFAULT_MAX_DIFF_CHARS,
  MAX_STAT_CHARS,
  shareBudget,
} from './diffBudget.js';
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

/**
 * Git's canonical empty-tree object id. Diffing it against a single revision
 * yields "everything up to that revision" — the right base when the repository
 * has no tag to start from and the range is a bare rev (see
 * {@link resolveCommitRange}).
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Path patterns whose diff *content* is noise in release notes: lockfiles,
 * build output, vendored dependencies, and generated assets. Their patch body
 * is held back so the character budget goes to real source, but they stay in
 * the changed-file list and the stat — the model still learns that they changed
 * (and is told which ones were held back), just not line by line.
 *
 * These defaults lean JS/TS. Projects add their own with `--exclude`, or drop
 * the list entirely with `--no-default-excludes` (e.g. a repo that ships `dist/`
 * as its product, or a Go module whose `vendor/` is the change). See
 * `docs/8-exclusions.md`.
 *
 * Bare git pathspec patterns — the `:(exclude)` magic is applied by
 * {@link buildExcludePathspecs}.
 */
export const DEFAULT_EXCLUDES = [
  '*.lock',
  '*lock.json',
  '*lock.yaml',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  'dist/*',
  'build/*',
  'vendor/*',
  'node_modules/*',
];

/**
 * Build the `:(exclude)` pathspec arguments for a diff command.
 *
 * @param exclude - Extra patterns from `--exclude` / the `exclude` option.
 * @param useDefaults - Whether to include {@link DEFAULT_EXCLUDES} (default: `true`).
 * @returns Pathspec arguments, or `[]` when nothing is excluded at all.
 */
export function buildExcludePathspecs(
  exclude: string[] = [],
  useDefaults = true,
): string[] {
  const patterns = [...(useDefaults ? DEFAULT_EXCLUDES : []), ...exclude].filter(
    (pattern) => pattern.trim() !== '',
  );
  // De-duplicate so a pattern repeated across the defaults and `--exclude`
  // doesn't appear twice in the git invocation.
  return [...new Set(patterns)].map((pattern) => `:(exclude)${pattern}`);
}

/** Append the pathspec separator + patterns, or nothing when none are set. */
function withPathspecs(args: string[], pathspecs: string[]): string[] {
  return pathspecs.length > 0 ? [...args, '--', ...pathspecs] : args;
}

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
 * Marks the start of a commit record in {@link readCommitFiles} output. Distinct
 * from {@link FIELD_SEP} (0x1F) so the two parsers can never be confused, and a
 * control character git guarantees won't appear in a path.
 */
const COMMIT_MARKER = '';

/**
 * Read which files each commit in a range touched — the **attribution map**.
 *
 * This is the cheap answer to "which commit introduced this change?" (GG-58).
 * The net range diff shows *what* changed but has no notion of which commit did
 * it or in what order; segmenting the patch per commit would cost 1.2–1.7× the
 * whole diff to re-send hunks the model already has. A file list per commit
 * costs a fraction of that and adds information rather than repeating it.
 *
 * Honors the same exclusions as the diff (FR-27), so the map never advertises a
 * lockfile the model was told to ignore.
 *
 * @param range - A git revision range, e.g. `v1.0.0..HEAD`.
 * @param options - Repository location and exclusions (`maxChars` is unused).
 * @returns Full commit hash → the paths it touched, in `git log` order.
 */
export async function readCommitFiles(
  range: string,
  options: RangeDiffOptions = {},
): Promise<Map<string, string[]>> {
  const cwd = options.cwd ?? process.cwd();
  const excludes = buildExcludePathspecs(options.exclude, options.defaultExcludes);
  const { stdout } = await execFileAsync(
    'git',
    withPathspecs(['log', '-z', `--format=${COMMIT_MARKER}%H`, '--name-only', range], excludes),
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );

  const byCommit = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of stdout.split('\0')) {
    const token = raw.trim();
    if (token === '') continue;
    if (token.startsWith(COMMIT_MARKER)) {
      current = [];
      byCommit.set(token.slice(COMMIT_MARKER.length), current);
    } else if (current !== undefined) {
      current.push(token);
    }
  }
  return byCommit;
}

/**
 * Hosts whose commit-page URL shape gitgist knows. Anything else gets bare
 * hashes rather than a guessed link — a wrong URL is worse than none.
 */
const COMMIT_URL_HOSTS: Record<string, string | undefined> = {
  'github.com': 'commit',
  'gitlab.com': 'commit',
  'bitbucket.org': 'commits',
};

/**
 * Turn a git remote URL into a commit-URL template (GG-59).
 *
 * Handles the three forms a remote comes in — `git@host:owner/repo.git`,
 * `https://host/owner/repo.git`, and `ssh://git@host/owner/repo.git` — and maps
 * the host to its commit path (`/commit/` on GitHub and GitLab, `/commits/` on
 * Bitbucket).
 *
 * @param remote - The raw remote URL.
 * @returns A template containing `{hash}`, or `null` for an unrecognized host.
 */
export function commitUrlFromRemote(remote: string): string | null {
  const trimmed = remote.trim();
  // `git@host:owner/repo` (scp-like) or a URL with a scheme.
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(trimmed);
  const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const match = scp ?? url;
  if (match === null) return null;

  const host = match[1].toLowerCase();
  const segment = COMMIT_URL_HOSTS[host];
  if (segment === undefined) return null;

  const path = match[2].replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  if (path === '') return null;
  return `https://${host}/${path}/${segment}/{hash}`;
}

/**
 * Read the repository's `origin` remote and derive a commit-URL template.
 *
 * @param cwd - Repository directory (default: `process.cwd()`).
 * @returns The template, or `null` when there is no remote or the host is unknown.
 */
export async function detectCommitUrl(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
    return commitUrlFromRemote(stdout);
  } catch {
    // No `origin` remote (or not a repo) — bare hashes are the right fallback.
    return null;
  }
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
 * @param options - Repository location, the patch char budget, and exclusions.
 * @returns The changed files, stat, capped patch, and what was held back.
 */
export async function readRangeDiff(
  range: string,
  options: RangeDiffOptions = {},
): Promise<RangeDiff> {
  const cwd = options.cwd ?? process.cwd();
  const maxChars = options.maxChars ?? DEFAULT_MAX_DIFF_CHARS;
  const excludes = buildExcludePathspecs(options.exclude, options.defaultExcludes);
  const revs = rangeToDiffArgs(range);

  const files = await gitNames(['diff', '--name-only', '-z', ...revs], cwd);
  if (files.length === 0) {
    return {
      range,
      files,
      stat: '',
      patch: '',
      excluded: [],
      trimmedFiles: [],
      truncated: false,
      isEmpty: true,
    };
  }

  const { stdout: statOut } = await execFileAsync(
    'git',
    ['diff', '--stat=200', '--no-color', ...revs],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );
  const { stdout: patchOut } = await execFileAsync(
    'git',
    withPathspecs(['diff', '--no-color', ...revs], excludes),
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );
  // Which files survived the exclusion pathspecs — the rest changed but
  // contribute no patch text, and the material says so explicitly.
  const patched = new Set(
    await gitNames(withPathspecs(['diff', '--name-only', '-z', ...revs], excludes), cwd),
  );

  const stat = capText(statOut, MAX_STAT_CHARS, 'file list truncated');
  const patch = capPatch(patchOut, maxChars);

  return {
    range,
    files,
    stat: stat.text,
    patch: patch.text,
    excluded: files.filter((file) => !patched.has(file)),
    trimmedFiles: patch.trimmed,
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
 * Same two guarantees as {@link readRangeDiff}, so both diff paths behave alike
 * (GG-54): generated/lockfile **noise is kept out of the patch bodies** (but
 * stays in the per-category file lists and is reported in {@link
 * WorkingChanges.excluded}), and the whole thing is bounded by one char budget
 * — {@link WorkingChangeOptions.maxChars}, shared across only the sections that
 * actually have content, so `--staged` alone gets the full budget rather than a
 * fixed third of it.
 *
 * @param options - Which categories (staged / unstaged / untracked) to gather, plus the budget.
 * @returns The changed file paths per category plus formatted diff material.
 */
export async function readWorkingChanges(options: WorkingChangeOptions = {}): Promise<WorkingChanges> {
  const cwd = options.cwd ?? process.cwd();
  const budget = options.maxChars ?? DEFAULT_MAX_DIFF_CHARS;
  const excludes = buildExcludePathspecs(options.exclude, options.defaultExcludes);
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  const excluded: string[] = [];
  // Raw, uncapped sections gathered first — the budget can only be shared out
  // once we know how many sections actually carry content.
  const raw: { title: string; diff: string }[] = [];

  /** Read one tracked-diff category: full file list, noise-free patch. */
  const trackedCategory = async (
    title: string,
    into: string[],
    diffArgs: string[],
  ): Promise<void> => {
    into.push(...(await gitNames([...diffArgs, '--name-only', '-z'], cwd)));
    const kept = new Set(
      await gitNames(withPathspecs([...diffArgs, '--name-only', '-z'], excludes), cwd),
    );
    excluded.push(...into.filter((file) => !kept.has(file)));
    const { stdout } = await execFileAsync(
      'git',
      withPathspecs([...diffArgs, '--no-color'], excludes),
      { cwd, maxBuffer: GIT_MAX_BUFFER },
    );
    if (stdout.trim() !== '') raw.push({ title, diff: stdout });
  };

  if (options.staged === true) {
    await trackedCategory('Staged changes', staged, ['diff', '--staged']);
  }

  if (options.unstaged === true) {
    await trackedCategory('Unstaged changes', unstaged, ['diff']);
  }

  if (options.untracked === true) {
    const lsArgs = ['ls-files', '--others', '--exclude-standard', '-z'];
    untracked.push(...(await gitNames(lsArgs, cwd)));
    const kept = new Set(await gitNames(withPathspecs(lsArgs, excludes), cwd));
    excluded.push(...untracked.filter((file) => !kept.has(file)));
    const parts: string[] = [];
    for (const path of untracked) {
      if (kept.has(path)) parts.push(await untrackedDiff(path, cwd));
    }
    const diff = parts.join('\n');
    if (diff.trim() !== '') raw.push({ title: 'New (untracked) files', diff });
  }

  const perSection = shareBudget(budget, raw.length);
  let truncated = false;
  const trimmedFiles: string[] = [];
  const sections = raw.map(({ title, diff }) => {
    // Same per-file allocation as the range patch (GG-57), so a staged file
    // late in the alphabet can't be squeezed out by an earlier one.
    const capped = capPatch(diff, perSection);
    truncated = truncated || capped.truncated;
    trimmedFiles.push(...capped.trimmed);
    return `### ${title}\n${capped.text}`;
  });

  return {
    staged,
    unstaged,
    untracked,
    excluded,
    diff: sections.join('\n\n'),
    trimmedFiles,
    truncated,
    isEmpty: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  };
}
