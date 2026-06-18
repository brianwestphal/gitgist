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

/**
 * Which AI backend to use for release-note generation.
 *
 * - `auto` — prefer the Anthropic API (if `ANTHROPIC_API_KEY` is set), else the
 *   `claude` CLI.
 * - `anthropic-api` — the Anthropic Messages API via the official SDK.
 * - `claude-cli` — shell out to the locally installed, signed-in `claude` CLI.
 */
export type ProviderName = 'auto' | 'anthropic-api' | 'claude-cli';

/** Options for {@link generateReleaseNotes}. */
export interface ReleaseNotesOptions {
  /** Start of the range (e.g. a tag). Defaults to the most recent tag. */
  from?: string;
  /** End of the range. Defaults to `HEAD`. */
  to?: string;
  /**
   * An explicit git revision range (e.g. `v1.0.0..HEAD`). When set, takes
   * precedence over {@link from} / {@link to}.
   */
  range?: string;
  /** Working directory of the git repository (default: `process.cwd()`). */
  cwd?: string;
  /**
   * When `false`, skip the AI and group commits deterministically by
   * Conventional Commit type instead (default: `true`).
   */
  ai?: boolean;
  /** Which AI provider to use (default: `auto`). */
  provider?: ProviderName;
  /** Model id for the `anthropic-api` provider (default: `claude-opus-4-8`). */
  model?: string;
  /** Max output tokens for the `anthropic-api` provider (default: 16000). */
  maxTokens?: number;
  /** Heading text rendered as a top-level `#` heading above the notes. */
  title?: string;
}
