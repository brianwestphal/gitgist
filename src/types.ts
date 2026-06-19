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
 * - `auto` — prefer a signed-in CLI (e.g. `claude`), else an API-key backend.
 * - `claude-cli` — shell out to the locally installed, signed-in `claude` CLI.
 * - `anthropic-api` — the Anthropic Messages API via the official SDK.
 * - `local` — a local OpenAI-compatible endpoint (Ollama / LM Studio / …);
 *   opt-in only, never auto-selected.
 * - `apple` — on-device macOS Apple Foundation Models (a free, private
 *   fallback when no Claude backend is available).
 */
export type ProviderName = 'auto' | 'anthropic-api' | 'claude-cli' | 'local' | 'apple';

/**
 * Output shape:
 * - `notes` (default) — themed Markdown release notes (`## Section` + bullets).
 * - `commit` — a single Conventional Commit message (`type(scope): subject`,
 *   optional body and `BREAKING CHANGE:` footer). Requires AI.
 */
export type OutputFormat = 'notes' | 'commit';

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
  /** Model id (the `anthropic-api` model, or the `local` model name). */
  model?: string;
  /** Base URL for the `local` provider (default: `GITGIST_LOCAL_ENDPOINT` or Ollama). */
  endpoint?: string;
  /**
   * Language hint for the on-device `apple` provider's prompt. Defaults to the
   * detected system language; pass a language name / BCP-47 code to override, or
   * `auto` to omit the hint. Ignored by other providers.
   */
  language?: string;
  /** Max output tokens for the `anthropic-api` provider (default: 16000). */
  maxTokens?: number;
  /** Heading text rendered as a top-level `#` heading above the notes (ignored for `commit` format). */
  title?: string;
  /** Output shape (default: `notes`). `commit` requires AI. */
  format?: OutputFormat;
  /**
   * Path to a Markdown template file that defines the output sections and
   * guidance (see `loadTemplate`). Requires AI; incompatible with `format: 'commit'`.
   */
  template?: string;
  /** Include staged (indexed) changes — `git diff --staged`. */
  staged?: boolean;
  /** Include unstaged changes to tracked files — `git diff`. */
  unstaged?: boolean;
  /** Include untracked (new) files. */
  untracked?: boolean;
}

/** Which categories of uncommitted change to read. */
export interface WorkingChangeOptions {
  /** Repository directory (default: `process.cwd()`). */
  cwd?: string;
  /** Include staged (indexed) changes. */
  staged?: boolean;
  /** Include unstaged changes to tracked files. */
  unstaged?: boolean;
  /** Include untracked (new) files. */
  untracked?: boolean;
}

/** Uncommitted changes in the working tree, gathered by `readWorkingChanges`. */
export interface WorkingChanges {
  /** Paths of staged (indexed) files. */
  staged: string[];
  /** Paths of tracked files with unstaged modifications. */
  unstaged: string[];
  /** Paths of untracked (new) files. */
  untracked: string[];
  /** Formatted diff material (per-category `###` sections) for the AI. */
  diff: string;
  /** True when no requested category has any change. */
  isEmpty: boolean;
}
