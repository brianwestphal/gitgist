/**
 * Shared types for gitgist.
 */

/**
 * A single commit read from the git history, after parsing the subject line
 * for Conventional Commits structure (type/scope/breaking).
 */
export interface Commit {
  /** Full 40-character commit hash. */
  hash: string;
  /** Abbreviated (7-character) commit hash. */
  shortHash: string;
  /** Raw subject line (first line of the commit message). */
  subject: string;
  /** Commit body (everything after the subject, may be empty). */
  body: string;
  /** Author name. */
  author: string;
  /** Author date in ISO-8601 form. */
  date: string;
  /** Conventional Commit type (e.g. `feat`, `fix`), or `null` if unparsed. */
  type: string | null;
  /** Conventional Commit scope (e.g. `cli`), or `null` if absent. */
  scope: string | null;
  /** Human-readable description with the `type(scope):` prefix stripped. */
  description: string;
  /** Whether the commit declares a breaking change. */
  breaking: boolean;
}

/** A group of commits sharing a Conventional Commit type. */
export interface ChangelogSection {
  /** The type key (e.g. `feat`), or `other` for unclassified commits. */
  type: string;
  /** Display title for the section (e.g. `Features`). */
  title: string;
  /** Commits belonging to this section. */
  commits: Commit[];
}

/** A structured changelog for a commit range. */
export interface Changelog {
  /** The git range the changelog was generated from (e.g. `v1.0.0..HEAD`). */
  range: string;
  /** Commits that introduce breaking changes, surfaced separately. */
  breaking: Commit[];
  /** Grouped, non-empty sections in display order. */
  sections: ChangelogSection[];
}

/** Options controlling how a commit range is read from git. */
export interface ReadCommitsOptions {
  /** Working directory of the git repository (default: `process.cwd()`). */
  cwd?: string;
}

/** Options controlling changelog generation and rendering. */
export interface ChangelogOptions {
  /** Heading text rendered above the changelog (default: none). */
  title?: string;
  /**
   * Map of Conventional Commit type to section title and display order.
   * Commits whose type is not present fall into the `other` section.
   */
  groups?: Record<string, string>;
}
