import type { Commit } from './types.js';

/**
 * Conventional Commit subject pattern: `type(scope)!: description`.
 * The scope and the breaking-change `!` marker are optional.
 */
const SUBJECT_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<description>.+)$/i;

/** Footer token that, per the spec, also signals a breaking change. */
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;

/** Raw fields read from a single git-log record, before Conventional parsing. */
export interface RawCommit {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
}

/**
 * Parse a raw commit's subject line for Conventional Commits structure.
 *
 * Unparseable subjects yield a commit with `type: null` and the full subject as
 * its `description`, so nothing is dropped from the changelog.
 *
 * @param raw - The raw commit fields read from git.
 * @returns The enriched {@link Commit}.
 */
export function parseCommit(raw: RawCommit): Commit {
  const match = SUBJECT_RE.exec(raw.subject);
  const breakingFooter = BREAKING_FOOTER_RE.test(raw.body);

  if (!match?.groups) {
    return {
      hash: raw.hash,
      shortHash: raw.hash.slice(0, 7),
      subject: raw.subject,
      body: raw.body,
      author: raw.author,
      date: raw.date,
      type: null,
      scope: null,
      description: raw.subject,
      breaking: breakingFooter,
    };
  }

  const { type, scope, bang, description } = match.groups as {
    type: string;
    scope?: string;
    bang?: string;
    description: string;
  };

  return {
    hash: raw.hash,
    shortHash: raw.hash.slice(0, 7),
    subject: raw.subject,
    body: raw.body,
    author: raw.author,
    date: raw.date,
    type: type.toLowerCase(),
    scope: scope ?? null,
    description: description.trim(),
    breaking: bang === '!' || breakingFooter,
  };
}
